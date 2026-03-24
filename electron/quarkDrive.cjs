const fs = require('node:fs/promises')
const path = require('node:path')

const quarkApiBase = 'https://drive-pc.quark.cn'

const getQuarkCookiePath = (userDataPath) =>
  path.join(userDataPath, 'quark-cookie.txt')

const normalize = (value) => String(value || '').trim()

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
  collectFoldersByCode,
  collectVideosInFolder,
  extractPreviewUrlFromPlayInfo,
  fetchDownloadInfoByFids,
  fetchPlayInfo,
  resolveQuarkCookie,
  saveQuarkCookie,
}
