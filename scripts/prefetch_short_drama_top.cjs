const os = require('node:os')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const {
  getShortDramaDbPath,
  getShortDramaSaveRequest,
  syncShortDramaEpisodesFromQuark,
} = require('../electron/shortDramaImport.cjs')
const { saveShareToDrive } = require('../electron/quarkDrive.cjs')

const userDataPath =
  process.env.HONGGUO_USER_DATA_PATH ||
  path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'hongguo-autotools')
const limit = Math.max(1, Number(process.env.SHORT_DRAMA_PREFETCH_LIMIT || 2000))
const delayMs = Math.max(0, Number(process.env.SHORT_DRAMA_PREFETCH_DELAY_MS || 800))

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const listRows = () => {
  const db = new DatabaseSync(getShortDramaDbPath(userDataPath))
  try {
    const rows = db
      .prepare(
        `
        SELECT drama_code, drama_name, quark_url, save_status, saved_root_fid
        FROM short_drama_resources
        ORDER BY CAST(drama_code AS INTEGER) DESC, id DESC
        LIMIT ?
      `,
      )
      .all(limit)
    return rows
  } finally {
    db.close()
  }
}

const processRow = async (row, index, total) => {
  const dramaCode = String(row.drama_code || '')
  const dramaTitle = String(row.drama_name || dramaCode)
  const shareUrl = String(row.quark_url || '').trim()
  process.stdout.write(`[${index + 1}/${total}] ${dramaCode} ${dramaTitle}\n`)

  try {
    let snapshot = getShortDramaSaveRequest({ userDataPath, dramaCode })
    if (!snapshot?.savedRootFid && shareUrl) {
      process.stdout.write(`  -> save share\n`)
      await saveShareToDrive({
        userDataPath,
        shareUrl,
        dramaCode,
        dramaTitle,
      })
    }

    process.stdout.write(`  -> sync episodes and cache cover\n`)
    const result = await syncShortDramaEpisodesFromQuark({
      userDataPath,
      dramaCode,
      dramaTitle,
    })
    snapshot = getShortDramaSaveRequest({ userDataPath, dramaCode })
    process.stdout.write(
      `  -> ready ${result.readyEpisodes}/${result.syncedEpisodes} episodes, cover=${snapshot?.coverFileName || 'none'}\n`,
    )
  } catch (error) {
    process.stdout.write(
      `  -> failed: ${error instanceof Error ? error.message : 'unknown error'}\n`,
    )
  }
}

const main = async () => {
  const rows = listRows()
  process.stdout.write(`prefetch start: ${rows.length} rows, userData=${userDataPath}\n`)
  for (let index = 0; index < rows.length; index += 1) {
    await processRow(rows[index], index, rows.length)
    if (delayMs > 0 && index < rows.length - 1) {
      await sleep(delayMs)
    }
  }
  process.stdout.write('prefetch finished\n')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
