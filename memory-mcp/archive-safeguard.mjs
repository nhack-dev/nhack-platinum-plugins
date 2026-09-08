






import fs from 'node:fs'
import path from 'node:path'


export const DESTRUCTIVE = new Set(['remove', 'clear', 'zero', 'overwrite', 'move'])

export const SAFE = new Set(['collect', 'read', 'mkdir', 'keep', 'rewrite'])

export class Refused extends Error {
  constructor(code, msg) { super(msg); this.name = 'Refused'; this.code = code }
}


export function assertAllowed(a) {
  const { op, client, target, backup } = a ?? {}

  
  if (!op || typeof op !== 'string') throw new Refused('NO_OP', '操作名がありません')
  if (!target || typeof target !== 'string') throw new Refused('NO_TARGET', '触る場所がありません')
  if (!path.isAbsolute(target)) throw new Refused('REL_TARGET', `触る場所が絶対パスではありません: ${target}`)
  if (!client || typeof client !== 'object') throw new Refused('NO_CLIENT', '利用者の情報がありません')
  if (!client.id) throw new Refused('NO_CLIENT_ID', '識別子がありません')

  
  const destructive = DESTRUCTIVE.has(op)
  if (!destructive && !SAFE.has(op)) {
    throw new Refused('UNKNOWN_OP', `知らない操作です: ${op}（安全側に倒して止めます）`)
  }
  if (!destructive) return { ok: true, op, destructive: false }

  
  if (client.status !== 'withdrawn') {
    throw new Refused(
      'CLIENT_CONTINUING',
      'この操作は許可されていません'
    )
  }

  
  if (!backup || typeof backup !== 'object') {
    throw new Refused('NO_BACKUP', `${op} には控えが要ります（控えの結果がありません）`)
  }
  if (backup.verified !== true) {
    throw new Refused('BACKUP_NOT_VERIFIED', '控えの検算が通っていません')
  }
  if (!Number.isInteger(backup.files) || backup.files < 1) {
    throw new Refused('BACKUP_EMPTY', '控えが揃っていません')
  }
  if (!Number.isInteger(backup.bytes) || backup.bytes < 1) {
    throw new Refused('BACKUP_ZERO_BYTES', '控えが揃っていません')
  }
  if (!backup.archive || !path.isAbsolute(backup.archive)) {
    throw new Refused('BACKUP_PATH', '控えの置き場が絶対パスではありません')
  }
  
  const realTarget = safeReal(target)
  const realArchive = safeReal(backup.archive)
  if (realArchive === realTarget || realArchive.startsWith(realTarget + path.sep)) {
    throw new Refused('BACKUP_INSIDE_TARGET', '控えが対象の中にあります（消すときに一緒に消えます）')
  }
  
  if (!fs.existsSync(backup.archive)) {
    throw new Refused('BACKUP_MISSING', '控えが見つかりません')
  }
  const st = fs.statSync(backup.archive)
  if (st.size !== backup.bytes) {
    throw new Refused('BACKUP_SIZE_MISMATCH', '控えが揃いませんでした')
  }
  
  if (backup.clientId && backup.clientId !== client.id) {
    throw new Refused('BACKUP_OTHER_CLIENT', '控えが一致しません')
  }

  return { ok: true, op, destructive: true, files: backup.files, bytes: backup.bytes }
}


export function resolveDeep(p) {
  const abs = path.resolve(p)
  const rest = []
  let cur = abs
  while (!fs.existsSync(cur)) {
    const parent = path.dirname(cur)
    if (parent === cur) return abs
    rest.unshift(path.basename(cur))
    cur = parent
  }
  try { return path.join(fs.realpathSync(cur), ...rest) } catch { return abs }
}

function safeReal(p) { return resolveDeep(p) }



















import { isSkipDir } from './filters.mjs'

export function collectFiles(root, opt = {}) {
  if (!root || !path.isAbsolute(root)) throw new Refused('COLLECT_ROOT', '大元が絶対パスではありません')
  if (!fs.existsSync(root)) throw new Refused('COLLECT_ROOT_MISSING', `大元が在りません: ${root}`)

  
  const realRoot = fs.realpathSync(root)
  const max = Number.isInteger(opt.maxFileBytes) ? opt.maxFileBytes : null

  const files = [], links = [], oversize = [], outside = [], skippedDirs = []
  let bytes = 0

  const walk = (dir) => {
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) }
    catch (e) { return }               
    for (const e of entries) {
      const p = path.join(dir, e.name)

      
      if (e.isSymbolicLink()) {
        let to = null
        try { to = fs.realpathSync(p) } catch { to = null }
        const escapes = !to || (to !== realRoot && !to.startsWith(realRoot + path.sep))
        links.push({ path: p, to, escapes })
        continue
      }

      if (e.isDirectory()) {
        if (isSkipDir(e.name)) { skippedDirs.push({ path: p, name: e.name }); continue }
        walk(p); continue
      }
      if (!e.isFile()) continue        

      
      let real
      try { real = fs.realpathSync(p) } catch { continue }
      if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
        outside.push({ path: p, real })
        continue
      }

      let st
      try { st = fs.statSync(p) } catch { continue }
      if (max !== null && st.size > max) { oversize.push({ path: p, bytes: st.size }); continue }

      files.push(p)
      bytes += st.size
    }
  }
  walk(realRoot)
  return { files, bytes, links, oversize, outside, skippedDirs }
}


export function assertCollectSafe(result, { minFiles = 1 } = {}) {
  if (!result || !Array.isArray(result.files)) throw new Refused('COLLECT_SHAPE', '集めた結果の形が違います')
  if (result.outside.length > 0) {
    throw new Refused('COLLECT_OUTSIDE', '範囲の外のものが混ざっています')
  }
  const escaping = result.links.filter(l => l.escapes)
  if (escaping.length > 0 && result.files.some(f => escaping.some(l => f.startsWith(l.path + path.sep)))) {
    throw new Refused('COLLECT_VIA_LINK', 'リンクの先のファイルが混ざっています')
  }
  if (result.files.length < minFiles) {
    throw new Refused('COLLECT_TOO_FEW', '集まりませんでした')
  }
  return { ok: true, files: result.files.length, bytes: result.bytes, skippedLinks: result.links.length }
}
