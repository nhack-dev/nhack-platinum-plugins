




import fs from 'node:fs'
import path from 'node:path'








async function load(want, ...names) {
  const tried = []
  for (const n of names) {
    try {
      const m = await import(n)
      if (m[want]) return m
      tried.push(`${n}: 読めたが ${want} が無い`)
    } catch (e) { tried.push(`${n}: ${e.code ?? (e.code || 'failed')}`) }
  }
  
  throw new Error(`${want} が 見つかりません … 見た ${tried.length}箇所: ${tried.join(' / ')}`)
}

const _bk = await load('makeBackup', './backup.mjs', './archive-backup.mjs')
const _sl = await load('sealFile', './seal-stream.mjs', './archive-seal.mjs')
const _up = await load('uploadArchive', './upload.mjs', './archive-upload.mjs')
const _rs = await load('restore', './restore.mjs', './archive-restore.mjs')
const _sg = await load('Refused', './safeguard.mjs', './archive-safeguard.mjs')

const makeBackup = _bk.makeBackup
const sealFile = _sl.sealFile
const uploadArchive = _up.uploadArchive
const restore = _rs.restore
const Refused = _sg.Refused


export const LOADED = {
  backup: _bk.makeBackup ? 'ok' : 'missing',
  seal: _sl.sealFile ? 'ok' : 'missing',
  upload: _up.uploadArchive ? 'ok' : 'missing',
  restore: _rs.restore ? 'ok' : 'missing',
  safeguard: _sg.Refused ? 'ok' : 'missing',
}


export async function archiveForClient(a) {
  const { baseUrl, token, clientId, root, workDir, kekRaw } = a ?? {}
  const step = a?.onStep ?? (() => {})
  if (!clientId) throw new Refused('PE_CLIENT', 'お客様の識別子がありません')
  if (!root || !path.isAbsolute(root)) throw new Refused('PE_ROOT', '大元が絶対パスではありません')
  if (!workDir || !path.isAbsolute(workDir)) throw new Refused('PE_WORK', '作業の置き場が絶対パスではありません')

  
  const archiveId = `${clientId}-${new Date().toISOString().replace(/[:.]/g, '-')}`

  
  step({ at: 'backup', archiveId })
  const backup = makeBackup({ root, destDir: workDir, clientId })
  if (backup.verified !== true) throw new Refused('PE_NOT_VERIFIED', '控えが揃いませんでした')

  
  let envelope, file = backup.archive
  if (kekRaw) {
    step({ at: 'seal', archiveId })
    const out = path.join(workDir, `${archiveId}.enc`)
    envelope = await sealFile({ file: backup.archive, out, kekRaw, aad: { archiveId, kind: 'archive' } })
    file = envelope.ctFile ?? out
  }

  
  step({ at: 'upload', archiveId })
  const receipt = await uploadArchive({
    baseUrl, token, clientId, archiveId, backup, envelope, file,
    fetchImpl: a?.fetchImpl,
  })

  step({ at: 'done', archiveId })
  return { archiveId, files: backup.files, bytes: backup.bytes, sealed: !!kekRaw, receipt }
}


export function restoreForClient(a) {
  const { backup, into, dryRun = false } = a ?? {}
  if (!backup) throw new Refused('PE_NO_BACKUP', '控えの情報がありません')
  return restore({ backup, into, dryRun })
}


export function preflight(a) {
  const { baseUrl, token, clientId, root, workDir } = a ?? {}
  const ng = []
  if (!baseUrl) ng.push('設定が足りません')
  if (!token) ng.push('設定が足りません')
  if (!clientId) ng.push('お客様の識別子がありません')
  if (!root || !path.isAbsolute(root)) ng.push('大元が絶対パスではありません')
  else if (!fs.existsSync(root)) ng.push('大元が見つかりません')
  if (!workDir || !path.isAbsolute(workDir)) ng.push('作業の置き場が絶対パスではありません')
  else if (path.resolve(workDir).startsWith(path.resolve(root) + path.sep)) {
    ng.push('作業の置き場が 大元の中にあります（控えが 控えの対象に入ります）')
  }
  return { ok: ng.length === 0, reasons: ng }
}
