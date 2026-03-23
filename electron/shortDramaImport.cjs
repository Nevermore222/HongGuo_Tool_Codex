const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const yauzl = require('yauzl')

const defaultSheetName = '表格视图'
const shortDramaCategory = '短剧查询导入'
const shortDramaAdapterId = 'short-drama-library'
const shortDramaDescription = '由短剧查询 Excel 模板导入的网盘资源索引，支持重复导入自动更新。'
const shortDramaNotePrefix = '短剧查询模板导入记录'
const shortDramaPosterGradient = 'linear-gradient(160deg, #1f2937 0%, #0f766e 100%)'

const getShortDramaDbPath = (userDataPath) =>
  path.join(userDataPath, 'short-drama-library.db')

const xmlEntityMap = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
}

const decodeXmlText = (value) =>
  String(value || '')
    .replace(/&(amp|lt|gt|quot|apos);/g, (token) => xmlEntityMap[token] || token)
    .replace(/&#(\d+);/g, (_token, digits) =>
      String.fromCodePoint(Number.parseInt(digits, 10)),
    )
    .replace(/&#x([0-9a-fA-F]+);/g, (_token, hex) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )

const normalizeWhitespace = (value) => String(value || '').replace(/\s+/g, ' ').trim()

const parseAttributes = (rawAttributes) => {
  const attributes = {}
  const matcher = /([A-Za-z_][A-Za-z0-9_.:-]*)="([^"]*)"/g

  let matched = matcher.exec(rawAttributes)
  while (matched) {
    attributes[matched[1]] = decodeXmlText(matched[2])
    matched = matcher.exec(rawAttributes)
  }

  return attributes
}

const extractTextFromNode = (xmlFragment) => {
  if (!xmlFragment) {
    return ''
  }

  const segments = []
  const matcher = /<t\b[^>]*>([\s\S]*?)<\/t>/g
  let matched = matcher.exec(xmlFragment)

  while (matched) {
    segments.push(decodeXmlText(matched[1]))
    matched = matcher.exec(xmlFragment)
  }

  if (segments.length > 0) {
    return segments.join('')
  }

  return decodeXmlText(xmlFragment.replace(/<[^>]+>/g, ''))
}

const readEntryBuffer = (zipFile, entry) =>
  new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error) {
        reject(error)
        return
      }

      const chunks = []
      stream.on('data', (chunk) => chunks.push(chunk))
      stream.on('error', (streamError) => reject(streamError))
      stream.on('end', () => resolve(Buffer.concat(chunks)))
    })
  })

const readZipTextEntries = async (filePath) =>
  new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, (openError, zipFile) => {
      if (openError) {
        reject(openError)
        return
      }

      const entries = new Map()
      let settled = false

      const settle = (callback, value) => {
        if (settled) {
          return
        }
        settled = true
        zipFile.close()
        callback(value)
      }

      zipFile.on('entry', async (entry) => {
        if (entry.fileName.endsWith('/')) {
          zipFile.readEntry()
          return
        }

        if (!/\.xml$|\.rels$/i.test(entry.fileName)) {
          zipFile.readEntry()
          return
        }

        try {
          const payload = await readEntryBuffer(zipFile, entry)
          entries.set(entry.fileName, payload.toString('utf8'))
          zipFile.readEntry()
        } catch (error) {
          settle(reject, error)
        }
      })

      zipFile.on('end', () => settle(resolve, entries))
      zipFile.on('error', (error) => settle(reject, error))
      zipFile.readEntry()
    })
  })

const parseRelationships = (relsXml) => {
  const relationById = new Map()
  const relationMatcher = /<Relationship\b([^>]*)\/>/g
  let matched = relationMatcher.exec(relsXml)

  while (matched) {
    const attributes = parseAttributes(matched[1])
    if (attributes.Id && attributes.Target) {
      relationById.set(attributes.Id, attributes.Target)
    }
    matched = relationMatcher.exec(relsXml)
  }

  return relationById
}

const toPosixPath = (value) => String(value || '').replaceAll('\\', '/')

const resolveZipTargetPath = (baseEntryPath, target) => {
  const normalizedTarget = toPosixPath(target)
  if (/^[a-z]+:/i.test(normalizedTarget)) {
    return normalizedTarget
  }

  const baseDir = path.posix.dirname(toPosixPath(baseEntryPath))
  return path.posix.normalize(path.posix.join(baseDir, normalizedTarget))
}

const parseWorkbookSheetPath = ({
  workbookXml,
  workbookRelsXml,
  preferredSheetName,
}) => {
  const sheets = []
  const sheetMatcher = /<sheet\b([^>]*)\/?>/g
  let matched = sheetMatcher.exec(workbookXml)

  while (matched) {
    const attributes = parseAttributes(matched[1])
    const relationId = attributes['r:id']
    if (attributes.name && relationId) {
      sheets.push({
        name: attributes.name,
        relationId,
      })
    }
    matched = sheetMatcher.exec(workbookXml)
  }

  if (sheets.length === 0) {
    throw new Error('未在工作簿中找到可用工作表。')
  }

  const relations = parseRelationships(workbookRelsXml)
  const selectedSheet =
    sheets.find((item) => item.name === preferredSheetName) || sheets[0]
  const target = relations.get(selectedSheet.relationId)

  if (!target) {
    throw new Error(`工作表 ${selectedSheet.name} 缺少关系映射。`)
  }

  return {
    sheetName: selectedSheet.name,
    sheetPath: resolveZipTargetPath('xl/workbook.xml', target),
  }
}

const parseSharedStrings = (sharedStringsXml) => {
  if (!sharedStringsXml) {
    return []
  }

  const values = []
  const sharedMatcher = /<si\b[^>]*>([\s\S]*?)<\/si>/g
  let matched = sharedMatcher.exec(sharedStringsXml)

  while (matched) {
    values.push(extractTextFromNode(matched[1]))
    matched = sharedMatcher.exec(sharedStringsXml)
  }

  return values
}

const splitCellReference = (cellRef) => {
  const matched = /^([A-Z]+)(\d+)$/.exec(cellRef || '')
  if (!matched) {
    return null
  }

  return {
    column: matched[1],
    row: Number.parseInt(matched[2], 10),
  }
}

const columnToNumber = (column) => {
  let value = 0
  for (const char of column) {
    value = value * 26 + (char.charCodeAt(0) - 64)
  }
  return value
}

const numberToColumn = (value) => {
  let next = value
  let result = ''

  while (next > 0) {
    const remainder = (next - 1) % 26
    result = String.fromCharCode(65 + remainder) + result
    next = Math.floor((next - 1) / 26)
  }

  return result
}

const expandCellRange = (ref) => {
  if (!ref.includes(':')) {
    return [ref]
  }

  const [startRef, endRef] = ref.split(':', 2)
  const start = splitCellReference(startRef)
  const end = splitCellReference(endRef)

  if (!start || !end) {
    return [startRef]
  }

  const startColumn = columnToNumber(start.column)
  const endColumn = columnToNumber(end.column)
  const fromColumn = Math.min(startColumn, endColumn)
  const toColumn = Math.max(startColumn, endColumn)
  const fromRow = Math.min(start.row, end.row)
  const toRow = Math.max(start.row, end.row)
  const cells = []

  for (let rowIndex = fromRow; rowIndex <= toRow; rowIndex += 1) {
    for (let columnIndex = fromColumn; columnIndex <= toColumn; columnIndex += 1) {
      cells.push(`${numberToColumn(columnIndex)}${rowIndex}`)
      if (cells.length > 32) {
        return cells
      }
    }
  }

  return cells
}

const extractCellValue = ({ type, body, sharedStrings }) => {
  if (!body) {
    return ''
  }

  if (type === 'inlineStr') {
    return normalizeWhitespace(extractTextFromNode(body))
  }

  const valueMatch = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)
  if (!valueMatch) {
    return ''
  }

  const rawValue = decodeXmlText(valueMatch[1])
  if (type === 's') {
    const sharedIndex = Number.parseInt(rawValue, 10)
    if (Number.isInteger(sharedIndex) && sharedIndex >= 0 && sharedIndex < sharedStrings.length) {
      return normalizeWhitespace(sharedStrings[sharedIndex])
    }
  }

  return normalizeWhitespace(rawValue)
}

const parseHyperlinkMap = ({ sheetXml, sheetRelsXml }) => {
  const relationTargets = parseRelationships(sheetRelsXml || '')
  const hyperlinkByCell = new Map()
  const hyperlinkMatcher = /<hyperlink\b([^>]*)\/?>/g
  let matched = hyperlinkMatcher.exec(sheetXml)

  while (matched) {
    const attributes = parseAttributes(matched[1])
    const ref = attributes.ref
    const relationId = attributes['r:id']
    if (!ref || !relationId) {
      matched = hyperlinkMatcher.exec(sheetXml)
      continue
    }

    const target = relationTargets.get(relationId)
    if (!target) {
      matched = hyperlinkMatcher.exec(sheetXml)
      continue
    }

    for (const cellRef of expandCellRange(ref)) {
      hyperlinkByCell.set(cellRef, target)
    }

    matched = hyperlinkMatcher.exec(sheetXml)
  }

  return hyperlinkByCell
}

const cleanHttpUrl = (value) => {
  const normalized = normalizeWhitespace(value)
  return /^https?:\/\//i.test(normalized) ? normalized : ''
}

const parseDramaNameParts = (dramaName) => {
  const normalizedName = normalizeWhitespace(dramaName)
  const matched = /^(\d{3,})\s*[-—－]\s*(.+)$/.exec(normalizedName)
  if (!matched) {
    return null
  }

  return {
    drama_code: matched[1],
    drama_title: normalizeWhitespace(matched[2]),
  }
}

const parseTemplateRows = ({ sheetXml, sheetRelsXml, sharedStrings }) => {
  const rows = []
  const hyperlinkByCell = parseHyperlinkMap({ sheetXml, sheetRelsXml })
  const rowMatcher = /<row\b([^>]*)>([\s\S]*?)<\/row>/g
  let rowMatch = rowMatcher.exec(sheetXml)

  while (rowMatch) {
    const rowAttributes = parseAttributes(rowMatch[1])
    const rowNumber = Number.parseInt(rowAttributes.r, 10)
    if (!Number.isInteger(rowNumber)) {
      rowMatch = rowMatcher.exec(sheetXml)
      continue
    }

    const rowBody = rowMatch[2]
    const valuesByColumn = new Map()
    const cellMatcher = /<c\b([^>]*?)\/>|<c\b([^>]*?)>([\s\S]*?)<\/c>/g
    let cellMatch = cellMatcher.exec(rowBody)

    while (cellMatch) {
      const rawAttributes = cellMatch[1] || cellMatch[2] || ''
      const cellAttributes = parseAttributes(rawAttributes)
      const cellRef = cellAttributes.r
      const type = cellAttributes.t || ''
      const body = cellMatch[3] || ''

      const parsedRef = splitCellReference(cellRef)
      if (parsedRef && (parsedRef.column === 'A' || parsedRef.column === 'B' || parsedRef.column === 'C')) {
        valuesByColumn.set(
          parsedRef.column,
          extractCellValue({ type, body, sharedStrings }),
        )
      }

      cellMatch = cellMatcher.exec(rowBody)
    }

    const dramaName = normalizeWhitespace(valuesByColumn.get('A') || '')
    if (!dramaName) {
      rowMatch = rowMatcher.exec(sheetXml)
      continue
    }

    const parts = parseDramaNameParts(dramaName)
    if (!parts) {
      rowMatch = rowMatcher.exec(sheetXml)
      continue
    }

    const quarkUrl = cleanHttpUrl(hyperlinkByCell.get(`B${rowNumber}`) || '')
    const baiduUrl = cleanHttpUrl(hyperlinkByCell.get(`C${rowNumber}`) || '')
    if (!quarkUrl && !baiduUrl) {
      rowMatch = rowMatcher.exec(sheetXml)
      continue
    }

    rows.push({
      source_row: rowNumber,
      drama_name: dramaName,
      drama_code: parts.drama_code,
      drama_title: parts.drama_title,
      quark_url: quarkUrl,
      baidu_url: baiduUrl,
    })

    rowMatch = rowMatcher.exec(sheetXml)
  }

  return rows
}

const parseShortDramaWorkbook = async ({ filePath, sheetName = defaultSheetName }) => {
  const entries = await readZipTextEntries(filePath)
  const workbookXml = entries.get('xl/workbook.xml')
  const workbookRelsXml = entries.get('xl/_rels/workbook.xml.rels')

  if (!workbookXml || !workbookRelsXml) {
    throw new Error('Excel 文件缺少工作簿元数据。')
  }

  const selected = parseWorkbookSheetPath({
    workbookXml,
    workbookRelsXml,
    preferredSheetName: sheetName,
  })

  const sheetXml = entries.get(selected.sheetPath)
  if (!sheetXml) {
    throw new Error(`未找到工作表内容：${selected.sheetPath}`)
  }

  const sheetRelsPath = path.posix.join(
    path.posix.dirname(selected.sheetPath),
    '_rels',
    `${path.posix.basename(selected.sheetPath)}.rels`,
  )
  const sheetRelsXml = entries.get(sheetRelsPath) || ''
  const sharedStrings = parseSharedStrings(entries.get('xl/sharedStrings.xml'))
  const rows = parseTemplateRows({
    sheetXml,
    sheetRelsXml,
    sharedStrings,
  })

  return {
    sheetName: selected.sheetName,
    rows,
  }
}

const ensureTableColumn = (db, tableName, columnName, sqlDefinition) => {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all()
  const exists = columns.some((column) => column.name === columnName)
  if (!exists) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${sqlDefinition}`)
  }
}

const ensureDatabaseSchema = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS short_drama_resources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_name TEXT NOT NULL,
      drama_code TEXT NOT NULL UNIQUE,
      drama_title TEXT NOT NULL DEFAULT '',
      quark_url TEXT NOT NULL DEFAULT '',
      baidu_url TEXT NOT NULL DEFAULT '',
      source_sheet TEXT NOT NULL DEFAULT '',
      source_row INTEGER NOT NULL DEFAULT 0,
      source_file TEXT NOT NULL DEFAULT '',
      imported_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_short_drama_code
      ON short_drama_resources (drama_code);

    CREATE TABLE IF NOT EXISTS short_drama_import_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_file TEXT NOT NULL,
      source_sheet TEXT NOT NULL,
      parsed_rows INTEGER NOT NULL DEFAULT 0,
      imported_rows INTEGER NOT NULL DEFAULT 0,
      inserted_rows INTEGER NOT NULL DEFAULT 0,
      updated_rows INTEGER NOT NULL DEFAULT 0,
      skipped_rows INTEGER NOT NULL DEFAULT 0,
      removed_rows INTEGER NOT NULL DEFAULT 0,
      sync_mode TEXT NOT NULL DEFAULT 'replace',
      imported_at TEXT NOT NULL
    );
  `)

  ensureTableColumn(db, 'short_drama_import_batches', 'removed_rows', 'INTEGER NOT NULL DEFAULT 0')
  ensureTableColumn(db, 'short_drama_import_batches', 'sync_mode', "TEXT NOT NULL DEFAULT 'replace'")
}

const hashString = (value) => {
  let hash = 2166136261
  for (const char of String(value || '')) {
    hash ^= char.charCodeAt(0)
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)
  }
  return Math.abs(hash >>> 0).toString(16)
}

const buildSourceNote = (row) => {
  const notes = [shortDramaNotePrefix]
  if (row.quark_url) {
    notes.push(`夸克网盘：${row.quark_url}`)
  }
  if (row.baidu_url) {
    notes.push(`百度网盘：${row.baidu_url}`)
  }
  return notes.join('\n')
}

const pickTags = (row) => {
  const tags = ['Excel导入', '短剧查询']
  if (row.quark_url) {
    tags.push('夸克网盘')
  }
  if (row.baidu_url) {
    tags.push('百度网盘')
  }
  return tags
}

const buildDiscoveredSeriesRecord = (row) => ({
  id: row.drama_code ? `short-drama-${row.drama_code}` : `short-drama-${hashString(row.drama_name)}`,
  title: row.drama_name,
  category: shortDramaCategory,
  adapterId: shortDramaAdapterId,
  sourceId: row.drama_name,
  status: '资源发现',
  description: shortDramaDescription,
  tags: pickTags(row),
  totalEpisodes: 1,
  updatedAt: `已更新 ${new Date(row.updated_at).toLocaleString('zh-CN', { hour12: false })}`,
  posterGradient: shortDramaPosterGradient,
  sourceNote: buildSourceNote(row),
  episodes: [
    {
      index: 1,
      title: '网盘索引链接',
      duration: '待补充',
      sizeLabel: '网盘链接',
      hasPreview: false,
    },
  ],
})

const listShortDramaDiscoveredSeries = ({ userDataPath }) => {
  const db = new DatabaseSync(getShortDramaDbPath(userDataPath))

  try {
    ensureDatabaseSchema(db)
    const stmt = db.prepare(`
      SELECT drama_name, drama_code, drama_title, quark_url, baidu_url, updated_at
      FROM short_drama_resources
      ORDER BY CAST(drama_code AS INTEGER) DESC, id DESC
    `)

    const rows = stmt.all()
    return rows.map(buildDiscoveredSeriesRecord)
  } finally {
    db.close()
  }
}

const listShortDramaImportBatches = ({ userDataPath, limit = 20 }) => {
  const db = new DatabaseSync(getShortDramaDbPath(userDataPath))

  try {
    ensureDatabaseSchema(db)
    const stmt = db.prepare(`
      SELECT
        id,
        source_file,
        source_sheet,
        parsed_rows,
        imported_rows,
        inserted_rows,
        updated_rows,
        skipped_rows,
        removed_rows,
        sync_mode,
        imported_at
      FROM short_drama_import_batches
      ORDER BY id DESC
      LIMIT ?
    `)

    return stmt.all(Math.max(1, Number(limit) || 20))
  } finally {
    db.close()
  }
}

const listShortDramaTableRows = ({ userDataPath, limit = 500, offset = 0 }) => {
  const db = new DatabaseSync(getShortDramaDbPath(userDataPath))

  try {
    ensureDatabaseSchema(db)
    const rowsStmt = db.prepare(`
      SELECT
        drama_code,
        drama_name,
        quark_url,
        baidu_url,
        updated_at
      FROM short_drama_resources
      ORDER BY CAST(drama_code AS INTEGER) DESC, id DESC
      LIMIT ? OFFSET ?
    `)
    const countStmt = db.prepare(`
      SELECT COUNT(1) AS total
      FROM short_drama_resources
    `)

    const safeLimit = Math.max(1, Math.min(2000, Number(limit) || 500))
    const safeOffset = Math.max(0, Number(offset) || 0)
    const rows = rowsStmt.all(safeLimit, safeOffset)
    const total = Number(countStmt.get()?.total || 0)

    return {
      total,
      limit: safeLimit,
      offset: safeOffset,
      rows,
    }
  } finally {
    db.close()
  }
}

const importShortDramaWorkbook = async ({
  filePath,
  userDataPath,
  sheetName = defaultSheetName,
  syncMode = 'replace',
}) => {
  const effectiveSyncMode = syncMode === 'merge' ? 'merge' : 'replace'
  const parsed = await parseShortDramaWorkbook({ filePath, sheetName })
  const now = new Date().toISOString()
  const dbPath = getShortDramaDbPath(userDataPath)
  const db = new DatabaseSync(dbPath)

  try {
    ensureDatabaseSchema(db)

    const existing = new Set(
      db
        .prepare('SELECT drama_code FROM short_drama_resources')
        .all()
        .map((item) => item.drama_code),
    )
    const upsert = db.prepare(`
      INSERT INTO short_drama_resources (
        drama_name, drama_code, drama_title, quark_url, baidu_url,
        source_sheet, source_row, source_file, imported_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(drama_code) DO UPDATE SET
        drama_name = excluded.drama_name,
        drama_code = excluded.drama_code,
        drama_title = excluded.drama_title,
        quark_url = excluded.quark_url,
        baidu_url = excluded.baidu_url,
        source_sheet = excluded.source_sheet,
        source_row = excluded.source_row,
        source_file = excluded.source_file,
        imported_at = excluded.imported_at,
        updated_at = excluded.updated_at
    `)
    const appendBatch = db.prepare(`
      INSERT INTO short_drama_import_batches (
        source_file, source_sheet, parsed_rows, imported_rows,
        inserted_rows, updated_rows, skipped_rows, removed_rows, sync_mode, imported_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    let insertedRows = 0
    let updatedRows = 0
    let skippedRows = 0
    let removedRows = 0

    db.exec('BEGIN')
    try {
      db.exec(`
        CREATE TEMP TABLE IF NOT EXISTS __short_drama_import_codes (
          drama_code TEXT PRIMARY KEY
        );
        DELETE FROM __short_drama_import_codes;
      `)
      const insertTempCode = db.prepare(`
        INSERT OR IGNORE INTO __short_drama_import_codes (drama_code)
        VALUES (?)
      `)
      const removeMissingStmt = db.prepare(`
        DELETE FROM short_drama_resources
        WHERE drama_code NOT IN (
          SELECT drama_code FROM __short_drama_import_codes
        )
      `)

      for (const row of parsed.rows) {
        if (!row.drama_code || !row.drama_name || (!row.quark_url && !row.baidu_url)) {
          skippedRows += 1
          continue
        }

        insertTempCode.run(row.drama_code)

        const hasExisting = existing.has(row.drama_code)
        upsert.run(
          row.drama_name,
          row.drama_code || '',
          row.drama_title || row.drama_name,
          row.quark_url || '',
          row.baidu_url || '',
          parsed.sheetName,
          row.source_row || 0,
          filePath,
          now,
          now,
        )

        if (hasExisting) {
          updatedRows += 1
        } else {
          insertedRows += 1
          existing.add(row.drama_code)
        }
      }

      if (effectiveSyncMode === 'replace') {
        const deleteResult = removeMissingStmt.run()
        removedRows = Number(deleteResult.changes || 0)
      }

      const importedRows = insertedRows + updatedRows
      appendBatch.run(
        filePath,
        parsed.sheetName,
        parsed.rows.length,
        importedRows,
        insertedRows,
        updatedRows,
        skippedRows,
        removedRows,
        effectiveSyncMode,
        now,
      )
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }

    const totalRowsInDb = Number(
      db.prepare('SELECT COUNT(1) AS total FROM short_drama_resources').get()?.total || 0,
    )
    return {
      filePath,
      sheetName: parsed.sheetName,
      totalRows: parsed.rows.length,
      importedRows: insertedRows + updatedRows,
      insertedRows,
      updatedRows,
      skippedRows,
      removedRows,
      syncMode: effectiveSyncMode,
      databasePath: dbPath,
      seriesCount: totalRowsInDb,
    }
  } finally {
    db.close()
  }
}

module.exports = {
  getShortDramaDbPath,
  importShortDramaWorkbook,
  listShortDramaDiscoveredSeries,
  listShortDramaImportBatches,
  listShortDramaTableRows,
}
