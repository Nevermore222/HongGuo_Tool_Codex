#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'

const apiBase = process.env.QUARK_API_BASE || 'https://drive-pc.quark.cn'
const rootDirFid = process.env.QUARK_ROOT_FID || '0'
const cookie = process.env.QUARK_COOKIE || ''
const outputPath =
  process.env.QUARK_OUTPUT ||
  path.join(process.cwd(), `quark-manifest-${Date.now()}.csv`)

if (!cookie.trim()) {
  console.error('Missing QUARK_COOKIE. Please set env QUARK_COOKIE first.')
  process.exit(1)
}

const requestJson = async (url) => {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      cookie,
      accept: 'application/json, text/plain, */*',
      referer: 'https://pan.quark.cn/',
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    },
  })

  const text = await response.text()
  let payload = null
  try {
    payload = JSON.parse(text)
  } catch {
    payload = null
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 280)}`)
  }

  if (!payload || typeof payload !== 'object') {
    throw new Error(`Invalid JSON response: ${text.slice(0, 280)}`)
  }

  return payload
}

const fetchChildren = async (pdirFid, page = 1, pageSize = 200) => {
  const query = new URLSearchParams({
    pr: 'ucpro',
    fr: 'pc',
    pdir_fid: String(pdirFid),
    _page: String(page),
    _size: String(pageSize),
    _sort: 'file_name:asc',
    fetch_total: '1',
  })
  const url = `${apiBase.replace(/\/$/, '')}/1/clouddrive/file/sort?${query.toString()}`
  return requestJson(url)
}

const toNumber = (value) => {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

const parseDramaCodeAndTitle = (name) => {
  const trimmed = String(name || '').trim()
  const matched = /^(\d{3,})\s*[-—－]\s*(.+)$/.exec(trimmed)
  if (!matched) {
    return { dramaCode: '', dramaTitle: trimmed }
  }
  return { dramaCode: matched[1], dramaTitle: matched[2].trim() }
}

const parseEpisodeIndex = (fileName) => {
  const text = String(fileName || '')
  const patterns = [
    /第\s*([0-9]{1,3})\s*[集话]/i,
    /\bEP?\s*([0-9]{1,3})\b/i,
    /\b([0-9]{1,3})\b/,
  ]
  for (const pattern of patterns) {
    const matched = pattern.exec(text)
    if (matched) {
      return toNumber(matched[1])
    }
  }
  return 0
}

const isDirectory = (item) =>
  item?.dir === true ||
  item?.file_type === 0 ||
  item?.obj_category === 'folder'

const isVideoFile = (item) => {
  const category = String(item?.obj_category || '').toLowerCase()
  if (category.includes('video')) {
    return true
  }
  const fileName = String(item?.file_name || '').toLowerCase()
  return ['.mp4', '.mkv', '.avi', '.mov', '.m3u8', '.flv', '.ts'].some((ext) =>
    fileName.endsWith(ext),
  )
}

const escapeCsv = (value) => {
  const raw = String(value ?? '')
  if (raw.includes(',') || raw.includes('"') || raw.includes('\n')) {
    return `"${raw.replaceAll('"', '""')}"`
  }
  return raw
}

const rows = []

const walkDirectory = async (dirFid, context) => {
  let page = 1
  let total = 0

  while (true) {
    const payload = await fetchChildren(dirFid, page)
    const data = payload?.data || {}
    const list = Array.isArray(data.list) ? data.list : []
    total = toNumber(data.total || total)

    for (const item of list) {
      const fid = String(item?.fid || item?.file_id || '')
      const fileName = String(item?.file_name || '')
      if (!fid || !fileName) {
        continue
      }

      if (isDirectory(item)) {
        const nextContext =
          context.depth === 0
            ? {
                ...context,
                depth: 1,
                rootDramaName: fileName,
                ...parseDramaCodeAndTitle(fileName),
              }
            : {
                ...context,
                depth: context.depth + 1,
              }
        await walkDirectory(fid, nextContext)
        continue
      }

      if (!isVideoFile(item)) {
        continue
      }

      const episodeIndex = parseEpisodeIndex(fileName)
      rows.push({
        drama_code: context.dramaCode,
        drama_title: context.dramaTitle,
        root_folder_name: context.rootDramaName,
        episode_index: episodeIndex,
        file_name: fileName,
        quark_file_id: fid,
        file_size: toNumber(item?.size || item?.file_size),
        pdir_fid: String(item?.pdir_fid || dirFid),
        updated_at: item?.updated_at || item?.last_update_at || '',
      })
    }

    const loaded = page * 200
    if (list.length === 0 || loaded >= total) {
      break
    }
    page += 1
  }
}

const sortRows = (list) =>
  [...list].sort((a, b) => {
    if (a.drama_code && b.drama_code && a.drama_code !== b.drama_code) {
      return Number(b.drama_code) - Number(a.drama_code)
    }
    if (a.drama_title !== b.drama_title) {
      return a.drama_title.localeCompare(b.drama_title, 'zh-CN')
    }
    return a.episode_index - b.episode_index
  })

const main = async () => {
  console.log(`Scanning Quark drive from fid=${rootDirFid} ...`)
  await walkDirectory(rootDirFid, {
    depth: 0,
    dramaCode: '',
    dramaTitle: '',
    rootDramaName: '',
  })

  const ordered = sortRows(rows)
  const headers = [
    'drama_code',
    'drama_title',
    'episode_index',
    'file_name',
    'quark_file_id',
    'file_size',
    'pdir_fid',
    'updated_at',
    'preview_url',
    'download_url',
    'url_expire_at',
  ]

  const lines = [
    headers.join(','),
    ...ordered.map((row) =>
      [
        row.drama_code,
        row.drama_title,
        row.episode_index,
        row.file_name,
        row.quark_file_id,
        row.file_size,
        row.pdir_fid,
        row.updated_at,
        '',
        '',
        '',
      ]
        .map(escapeCsv)
        .join(','),
    ),
  ]

  await fs.writeFile(outputPath, `${lines.join('\n')}\n`, 'utf8')
  console.log(`Done. Rows=${ordered.length}`)
  console.log(`CSV: ${outputPath}`)
}

main().catch((error) => {
  console.error('Export failed:', error.message)
  process.exit(1)
})
