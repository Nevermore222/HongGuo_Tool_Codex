const fs = require('node:fs/promises')
const path = require('node:path')

const quarkApiBase = 'https://drive-pc.quark.cn'

const getQuarkCookiePath = (userDataPath) =>
  path.join(userDataPath, 'quark-cookie.txt')

const normalize = (value) => String(value || '').trim()
const normalizePathSegment = (value) =>
  normalize(value).replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim()

const parseEpisodeIndex = (fileName) => {
  const text = normalize(fileName)
  const patterns = [
    /第\s*([0-9]{1,3})\s*[集话]/i,
    /\bEP?\s*([0-9]{1,3})\b/i,
    /\b([0-9]{1,3})\b/,
  ]

  for (const pattern of patterns) {
    const matched = pattern.exec(text)
    if (matched) {
      const value = Number(matched[1])
      if (Number.isFinite(value) && value > 0) {
        return value
      }
    }
  }

  return 0
}

const isDirectory = (item) =>
  item?.dir === true ||
  item?.file_type === 0 ||
  item?.obj_category === 'folder'

const isVideoFile = (item) => {
  const category = normalize(item?.obj_category).toLowerCase()
  if (category.includes('video')) {
    return true
  }

  const fileName = normalize(item?.file_name).toLowerCase()
  return ['.mp4', '.mkv', '.avi', '.mov', '.m3u8', '.flv', '.ts'].some((ext) =>
    fileName.endsWith(ext),
  )
}

const isImageFile = (item) => {
  const category = normalize(item?.obj_category).toLowerCase()
  if (category.includes('image')) {
    return true
  }

  const fileName = normalize(item?.file_name).toLowerCase()
  return ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'].some((ext) =>
    fileName.endsWith(ext),
  )
}

const readPersistedCookie = async (userDataPath) => {
  try {
    const raw = await fs.readFile(getQuarkCookiePath(userDataPath), 'utf8')
    return normalize(raw)
  } catch {
    return ''
  }
}

const resolveQuarkCookie = async (userDataPath) => {
  const envCookie = normalize(process.env.QUARK_COOKIE)
  if (envCookie) {
    return envCookie
  }
  return readPersistedCookie(userDataPath)
}

const saveQuarkCookie = async ({ userDataPath, cookie }) => {
  const normalized = normalize(cookie)
  if (!normalized) {
    throw new Error('Cookie 不能为空。')
  }
  await fs.mkdir(userDataPath, { recursive: true })
  await fs.writeFile(getQuarkCookiePath(userDataPath), normalized, 'utf8')
  return true
}

const requestJson = async ({ userDataPath, url, method = 'GET', body }) => {
  const cookie = await resolveQuarkCookie(userDataPath)
  if (!cookie) {
    throw new Error('未配置夸克 Cookie。请先在下载系统内保存 Cookie。')
  }

  const response = await fetch(url, {
    method,
    headers: {
      cookie,
      accept: 'application/json, text/plain, */*',
      referer: 'https://pan.quark.cn/',
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

  const text = await response.text()
  let payload = null
  try {
    payload = JSON.parse(text)
  } catch {
    payload = null
  }

  if (!response.ok) {
    throw new Error(`夸克接口失败：HTTP ${response.status} ${text.slice(0, 180)}`)
  }

  if (!payload || typeof payload !== 'object') {
    throw new Error(`夸克接口返回无效 JSON：${text.slice(0, 180)}`)
  }

  const code = Number(payload.code ?? 0)
  if (code !== 0) {
    throw new Error(`夸克接口返回异常：${payload.message || `code=${code}`}`)
  }

  return payload
}

const requestBuffer = async ({ userDataPath, url, method = 'GET', headers = {} }) => {
  const cookie = await resolveQuarkCookie(userDataPath)
  if (!cookie) {
    throw new Error('未配置夸克 Cookie。请先在下载系统内保存 Cookie。')
  }

  const response = await fetch(url, {
    method,
    headers: {
      cookie,
      accept: '*/*',
      referer: 'https://pan.quark.cn/',
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      ...headers,
    },
  })

  const buffer = Buffer.from(await response.arrayBuffer())
  if (!response.ok) {
    throw new Error(`夸克文件请求失败：HTTP ${response.status}`)
  }

  return {
    buffer,
    contentType: String(response.headers.get('content-type') || 'application/octet-stream'),
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const listChildren = async ({ userDataPath, pdirFid, page = 1, pageSize = 200 }) => {
  const query = new URLSearchParams({
    pr: 'ucpro',
    fr: 'pc',
    pdir_fid: String(pdirFid),
    _page: String(page),
    _size: String(pageSize),
    _sort: 'file_name:asc',
    fetch_total: '1',
  })
  const url = `${quarkApiBase}/1/clouddrive/file/sort?${query.toString()}`
  return requestJson({ userDataPath, url })
}

const parseShareUrl = (shareUrl) => {
  const raw = normalize(shareUrl)
  const pwdMatch = /[?&]pwd=([^&#]+)/i.exec(raw)
  const codeMatch = /\/s\/([A-Za-z0-9]+)/.exec(raw)
  const pathMatches = [...raw.matchAll(/\/([a-f0-9]{32})(?:-[^/?#]+)?/gi)]
  return {
    pwdId: codeMatch?.[1] || '',
    passcode: pwdMatch?.[1] || '',
    pdirFid:
      pathMatches.length > 0 ? String(pathMatches[pathMatches.length - 1]?.[1] || '0') : '0',
  }
}

const getShareToken = async ({ userDataPath, pwdId, passcode = '' }) => {
  const payload = await requestJson({
    userDataPath,
    url: `${quarkApiBase}/1/clouddrive/share/sharepage/token?pr=ucpro&fr=pc`,
    method: 'POST',
    body: {
      pwd_id: pwdId,
      passcode,
    },
  })

  return String(payload?.data?.stoken || '')
}

const listShareChildren = async ({
  userDataPath,
  pwdId,
  stoken,
  pdirFid = '0',
  pageSize = 50,
}) => {
  const rows = []
  let page = 1

  while (true) {
    const query = new URLSearchParams({
      pr: 'ucpro',
      fr: 'pc',
      pwd_id: String(pwdId),
      stoken: String(stoken),
      pdir_fid: String(pdirFid),
      force: '0',
      _page: String(page),
      _size: String(pageSize),
      _fetch_banner: '0',
      _fetch_share: '0',
      _fetch_total: '1',
      _sort: 'file_type:asc,updated_at:desc',
      ver: '2',
      fetch_share_full_path: '0',
    })
    const payload = await requestJson({
      userDataPath,
      url: `${quarkApiBase}/1/clouddrive/share/sharepage/detail?${query.toString()}`,
    })
    const list = Array.isArray(payload?.data?.list) ? payload.data.list : []
    rows.push(...list)
    const total = Number(payload?.metadata?._total || rows.length)
    if (list.length === 0 || rows.length >= total) {
      break
    }
    page += 1
  }

  return rows
}

const getFidsByPaths = async ({ userDataPath, filePaths }) => {
  const all = []
  const remaining = [...filePaths]

  while (remaining.length > 0) {
    const payload = await requestJson({
      userDataPath,
      url: `${quarkApiBase}/1/clouddrive/file/info/path_list?pr=ucpro&fr=pc`,
      method: 'POST',
      body: {
        file_path: remaining.splice(0, 50),
        namespace: '0',
      },
    })
    const rows = Array.isArray(payload?.data) ? payload.data : []
    all.push(...rows)
  }

  return all
}

const mkdirByPath = async ({ userDataPath, dirPath }) => {
  const payload = await requestJson({
    userDataPath,
    url: `${quarkApiBase}/1/clouddrive/file?pr=ucpro&fr=pc&uc_param_str=`,
    method: 'POST',
    body: {
      pdir_fid: '0',
      file_name: '',
      dir_path: dirPath,
      dir_init_lock: false,
    },
  })

  return payload?.data || {}
}

const ensureSaveDirectory = async ({ userDataPath, dirPath }) => {
  const normalizedPath = normalize(dirPath)
  const [existing] = await getFidsByPaths({
    userDataPath,
    filePaths: [normalizedPath],
  })
  if (existing?.fid) {
    return {
      fid: String(existing.fid),
      filePath: String(existing.file_path || normalizedPath),
    }
  }

  const created = await mkdirByPath({
    userDataPath,
    dirPath: normalizedPath,
  })
  return {
    fid: String(created.fid || ''),
    filePath: normalizedPath,
  }
}

const saveSharedFiles = async ({
  userDataPath,
  fidList,
  fidTokenList,
  toPdirFid,
  pwdId,
  stoken,
}) => {
  const query = new URLSearchParams({
    pr: 'ucpro',
    fr: 'pc',
    uc_param_str: '',
    app: 'clouddrive',
    __dt: String(Math.round((1 + Math.random() * 4) * 60 * 1000)),
    __t: String(Date.now()),
  })
  const payload = await requestJson({
    userDataPath,
    url: `${quarkApiBase}/1/clouddrive/share/sharepage/save?${query.toString()}`,
    method: 'POST',
    body: {
      fid_list: fidList,
      fid_token_list: fidTokenList,
      to_pdir_fid: String(toPdirFid),
      pwd_id: String(pwdId),
      stoken: String(stoken),
      pdir_fid: '0',
      scene: 'link',
    },
  })

  return payload?.data || {}
}

const waitForTask = async ({ userDataPath, taskId, maxAttempts = 60 }) => {
  for (let retryIndex = 0; retryIndex < maxAttempts; retryIndex += 1) {
    const query = new URLSearchParams({
      pr: 'ucpro',
      fr: 'pc',
      uc_param_str: '',
      task_id: String(taskId),
      retry_index: String(retryIndex),
      __dt: String(Math.round((1 + Math.random() * 4) * 60 * 1000)),
      __t: String(Date.now()),
    })
    const payload = await requestJson({
      userDataPath,
      url: `${quarkApiBase}/1/clouddrive/task?${query.toString()}`,
    })
    if (Number(payload?.data?.status) === 2) {
      return payload?.data || {}
    }
    await sleep(500)
  }

  throw new Error('夸克转存任务等待超时。')
}

const buildAutoSavePath = ({ dramaCode }) => `/duanju/${normalize(dramaCode || 'unknown')}`

const saveShareToDrive = async ({
  userDataPath,
  shareUrl,
  dramaCode,
  dramaTitle,
}) => {
  const { pwdId, passcode, pdirFid } = parseShareUrl(shareUrl)
  if (!pwdId) {
    throw new Error('夸克分享链接无效。')
  }

  const stoken = await getShareToken({
    userDataPath,
    pwdId,
    passcode,
  })
  if (!stoken) {
    throw new Error('获取分享 stoken 失败。')
  }

  const shareItems = await listShareChildren({
    userDataPath,
    pwdId,
    stoken,
    pdirFid: pdirFid || '0',
  })
  if (shareItems.length === 0) {
    throw new Error('分享为空或已失效。')
  }

  const saveDir = await ensureSaveDirectory({
    userDataPath,
    dirPath: buildAutoSavePath({ dramaCode, dramaTitle }),
  })

  const fidList = shareItems.map((item) => String(item.fid || '')).filter(Boolean)
  const fidTokenList = shareItems
    .map((item) => String(item.share_fid_token || ''))
    .filter(Boolean)
  if (fidList.length === 0 || fidTokenList.length !== fidList.length) {
    throw new Error('分享列表缺少可转存文件标识。')
  }

  const saveResult = await saveSharedFiles({
    userDataPath,
    fidList,
    fidTokenList,
    toPdirFid: saveDir.fid,
    pwdId,
    stoken,
  })
  const taskId = String(saveResult.task_id || '')
  if (!taskId) {
    throw new Error('夸克未返回转存任务 ID。')
  }

  const task = await waitForTask({
    userDataPath,
    taskId,
  })

  return {
    saveDirFid: String(saveDir.fid || ''),
    saveDirPath: String(saveDir.filePath || ''),
    savedTopFids: Array.isArray(task?.save_as?.save_as_top_fids)
      ? task.save_as.save_as_top_fids.map((item) => String(item || '')).filter(Boolean)
      : [],
  }
}

const collectFoldersByCode = async ({ userDataPath, dramaCode, maxDepth = 5 }) => {
  const queue = [{ fid: '0', depth: 0 }]
  const folders = []

  while (queue.length > 0) {
    const current = queue.shift()
    let page = 1
    let total = 0

    while (true) {
      const payload = await listChildren({
        userDataPath,
        pdirFid: current.fid,
        page,
      })
      const data = payload.data || {}
      const list = Array.isArray(data.list) ? data.list : []
      total = Number(data.total || total)

      for (const item of list) {
        if (!isDirectory(item)) {
          continue
        }

        const fid = normalize(item.fid)
        const folderName = normalize(item.file_name)
        if (!fid || !folderName) {
          continue
        }

        if (folderName.includes(dramaCode)) {
          folders.push({
            fid,
            folderName,
            depth: current.depth + 1,
          })
        }

        if (current.depth + 1 < maxDepth) {
          queue.push({ fid, depth: current.depth + 1 })
        }
      }

      if (list.length === 0 || page * 200 >= total) {
        break
      }
      page += 1
    }
  }

  return folders
}

const collectVideosInFolder = async ({ userDataPath, folderFid }) => {
  const rows = []
  const stack = [folderFid]

  while (stack.length > 0) {
    const currentFid = stack.pop()
    let page = 1
    let total = 0

    while (true) {
      const payload = await listChildren({
        userDataPath,
        pdirFid: currentFid,
        page,
      })
      const data = payload.data || {}
      const list = Array.isArray(data.list) ? data.list : []
      total = Number(data.total || total)

      for (const item of list) {
        const fid = normalize(item.fid)
        if (!fid) {
          continue
        }

        if (isDirectory(item)) {
          stack.push(fid)
          continue
        }

        if (!isVideoFile(item)) {
          continue
        }

        rows.push({
          fid,
          pdirFid: normalize(item.pdir_fid || currentFid),
          fileName: normalize(item.file_name),
          fileSize: Number(item.size || item.file_size || 0),
          updatedAt: item.updated_at || item.l_updated_at || Date.now(),
          episodeIndex: parseEpisodeIndex(item.file_name),
        })
      }

      if (list.length === 0 || page * 200 >= total) {
        break
      }
      page += 1
    }
  }

  return rows
}

const collectImagesInFolder = async ({ userDataPath, folderFid }) => {
  const rows = []
  const stack = [{ fid: folderFid, depth: 0 }]

  while (stack.length > 0) {
    const current = stack.pop()
    let page = 1
    let total = 0

    while (true) {
      const payload = await listChildren({
        userDataPath,
        pdirFid: current.fid,
        page,
      })
      const data = payload.data || {}
      const list = Array.isArray(data.list) ? data.list : []
      total = Number(data.total || total)

      for (const item of list) {
        const fid = normalize(item.fid)
        if (!fid) {
          continue
        }

        if (isDirectory(item)) {
          stack.push({ fid, depth: current.depth + 1 })
          continue
        }

        if (!isImageFile(item)) {
          continue
        }

        rows.push({
          fid,
          pdirFid: normalize(item.pdir_fid || current.fid),
          fileName: normalize(item.file_name),
          fileSize: Number(item.size || item.file_size || 0),
          updatedAt: item.updated_at || item.l_updated_at || Date.now(),
          depth: current.depth,
        })
      }

      if (list.length === 0 || page * 200 >= total) {
        break
      }
      page += 1
    }
  }

  return rows
}

const fetchDownloadInfoByFids = async ({ userDataPath, fids }) => {
  if (!Array.isArray(fids) || fids.length === 0) {
    return []
  }

  const payload = await requestJson({
    userDataPath,
    url: `${quarkApiBase}/1/clouddrive/file/download?pr=ucpro&fr=pc`,
    method: 'POST',
    body: { fids },
  })

  return Array.isArray(payload.data) ? payload.data : []
}

const fetchPlayInfo = async ({ userDataPath, fid }) => {
  const payload = await requestJson({
    userDataPath,
    url: `${quarkApiBase}/1/clouddrive/file/v2/play?pr=ucpro&fr=pc`,
    method: 'POST',
    body: { fid },
  })

  return payload.data || {}
}

const extractPreviewUrlFromPlayInfo = (playInfo) => {
  const videoList = Array.isArray(playInfo?.video_list) ? playInfo.video_list : []
  for (const item of videoList) {
    const url = normalize(item?.video_info?.url)
    if (url) {
      return url
    }
  }
  return ''
}

module.exports = {
  buildAutoSavePath,
  collectFoldersByCode,
  collectImagesInFolder,
  collectVideosInFolder,
  extractPreviewUrlFromPlayInfo,
  fetchDownloadInfoByFids,
  fetchPlayInfo,
  getFidsByPaths,
  getShareToken,
  listShareChildren,
  mkdirByPath,
  parseShareUrl,
  requestBuffer,
  resolveQuarkCookie,
  saveShareToDrive,
  saveQuarkCookie,
}
