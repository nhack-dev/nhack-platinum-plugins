












import fs from 'node:fs'
import { isSecretExt, isSecretName, hasSecretWord, maxScanBytes,
  isMediaExt, hasSecretText, mediaMagic } from './filters.mjs'
import path from 'node:path'
import crypto from 'node:crypto'


const _sg = await (async () => {
  const tried = []
  for (const n of ['./safeguard.mjs', './archive-safeguard.mjs']) {
    try {
      const m = await import(n)
      if (m.collectFiles && m.Refused) return m
      tried.push(`${n}: 読めたが 欲しいものが 無い`)
    } catch (e) { tried.push(`${n}: ${e.code ?? (e.code || 'failed')}`) }
  }
  throw new Error(`集める道具が 見つかりません … 見た ${tried.length}箇所: ${tried.join(' / ')}`)
})()
const { collectFiles, Refused } = _sg




const MAX_FILE = null










export function screen(file, head) {
  const base = path.basename(file)
  const ext = path.extname(base).toLowerCase()

  if (isSecretExt(file)) return { send: false, why: 'secret-ext' }
  if (isSecretName(file) || hasSecretWord(file)) return { send: false, why: 'secret-name' }
  if (isMediaExt(file)) return { send: false, why: 'media-ext' }

  if (head && head.length) {
    for (const m of mediaMagic()) {
      if (m.b && startsWith(head, m.b, 0) && (!m.at12 || startsWith(head, m.at12, 8))) {
        return { send: false, why: `media-magic:${m.name}` }
      }
      if (m.at4 && startsWith(head, m.at4, 4)) return { send: false, why: `media-magic:${m.name}` }
    }
    const text = head.toString('utf8')
    if (hasSecretText(text)) return { send: false, why: 'secret-content' }
  }
  return { send: true }
}

function startsWith(buf, bytes, at) {
  if (buf.length < at + bytes.length) return false
  for (let i = 0; i < bytes.length; i++) if (buf[at + i] !== bytes[i]) return false
  return true
}


function readHead(file, n = maxScanBytes()) {
  let fd
  try {
    fd = fs.openSync(file, 'r')
    const buf = Buffer.allocUnsafe(n)
    const read = fs.readSync(fd, buf, 0, n, 0)
    return buf.subarray(0, read)
  } catch { return null }
  finally { if (fd !== undefined) try { fs.closeSync(fd) } catch {} }
}

const LARGE = 32 * 1024 * 1024       
const EDGE = 1024 * 1024             
const CHUNK = 8 * 1024 * 1024        



const REFUSED_FOREVER = new Set([400, 413, 415, 422])


export function md5Range(file, from, len) {
  if (len <= 0) return crypto.createHash('md5').digest('hex')
  const fd = fs.openSync(file, 'r')
  try {
    const h = crypto.createHash('md5')
    const buf = Buffer.allocUnsafe(Math.min(len, 1024 * 1024))
    let done = 0
    while (done < len) {
      const want = Math.min(buf.length, len - done)
      const n = fs.readSync(fd, buf, 0, want, from + done)
      if (n <= 0) break
      h.update(buf.subarray(0, n)); done += n
    }
    return h.digest('hex')
  } finally { fs.closeSync(fd) }
}


export function fingerprint(file, size, large = LARGE) {
  if (size <= large) return { md5: md5File(file), big: false }
  return {
    big: true,
    head: md5Range(file, 0, Math.min(EDGE, size)),
    tail: md5Range(file, Math.max(0, size - EDGE), Math.min(EDGE, size)),
  }
}

function md5File(file) {
  const h = crypto.createHash('md5')
  const fd = fs.openSync(file, 'r')
  try {
    const buf = Buffer.allocUnsafe(1024 * 1024)
    let off = 0, n
    while ((n = fs.readSync(fd, buf, 0, buf.length, off)) > 0) {
      h.update(buf.subarray(0, n)); off += n
    }
  } finally { fs.closeSync(fd) }
  return h.digest('hex')
}


function pickOnly(realRoot, only) {
  const files = [], outside = []
  for (const rel of only) {
    if (typeof rel !== 'string' || !rel) continue
    if (path.isAbsolute(rel)) { outside.push(rel); continue }
    const abs = path.resolve(realRoot, rel)
    if (abs !== realRoot && !abs.startsWith(realRoot + path.sep)) { outside.push(rel); continue }
    let real
    try { real = fs.realpathSync(abs) } catch { continue }        
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) { outside.push(rel); continue }
    let st
    try { st = fs.statSync(real) } catch { continue }
    if (!st.isFile()) continue
    files.push(real)
  }
  return { files, links: [], oversize: [], outside, bytes: 0 }
}


function same(prev, fp, size) {
  if (prev.bytes !== size) return false
  if (fp.big) return prev.head === fp.head && prev.tail === fp.tail
  return prev.md5 === fp.md5
}


function isAppend(abs, prev) {
  if (!prev.bytes) return false
  if (prev.md5) return md5Range(abs, 0, prev.bytes) === prev.md5
  if (prev.head) {
    const head = md5Range(abs, 0, Math.min(EDGE, prev.bytes))
    const tail = md5Range(abs, Math.max(0, prev.bytes - EDGE), Math.min(EDGE, prev.bytes))
    return head === prev.head && tail === prev.tail
  }
  return false
}


export async function loadStateRemote({ fetchImpl, baseUrl, token, clientId }) {
  try {
    const res = await fetchImpl(
      `${baseUrl}/api/client/state?clientId=${encodeURIComponent(clientId)}`,
      { headers: { Authorization: `Bot ${token}` } },
    )
    if (res.status === 404) return { known: {}, source: 'first' }
    if (res.status !== 200) return { known: {}, source: 'unreachable' }
    const b = await res.json()
    if (!b || typeof b.known !== 'object' || b.known === null) return { known: {}, source: 'broken' }
    return { known: b.known, source: 'loaded' }
  } catch { return { known: {}, source: 'unreachable' } }
}

export function loadState(stateFile) {
  
  
  if (!stateFile) return { known: {}, source: 'none' }
  if (!fs.existsSync(stateFile)) return { known: {}, source: 'first' }
  try {
    const o = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
    if (!o || typeof o.known !== 'object') return { known: {}, source: 'broken' }
    return { known: o.known, source: 'loaded' }
  } catch { return { known: {}, source: 'broken' } }
}

export function saveState(stateFile, known) {
  if (!stateFile) return
  fs.mkdirSync(path.dirname(stateFile), { recursive: true })
  const tmp = `${stateFile}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ v: 1, at: new Date().toISOString(), known }))
  fs.renameSync(tmp, stateFile)      
}


export function diff(a) {
  const { root, known = {}, maxFileBytes = MAX_FILE, largeBytes = LARGE, only } = a ?? {}
  if (!root || !path.isAbsolute(root)) throw new Refused('SC_ROOT', '大元が絶対パスではありません')

  const realRoot = fs.realpathSync(root)
  
  
  const found = Array.isArray(only) ? pickOnly(realRoot, only) : collectFiles(realRoot, { maxFileBytes })

  const changed = [], skipped = [], unchanged = [], unreadable = []
  for (const abs of found.files) {
    const rel = path.relative(realRoot, abs)
    let st
    try { st = fs.statSync(abs) } catch { unreadable.push({ rel, why: 'stat' }); continue }

    const head = readHead(abs)
    if (head === null) { unreadable.push({ rel, why: 'open' }); continue }
    const s = screen(abs, head)
    if (!s.send) { skipped.push({ rel, why: s.why, bytes: st.size }); continue }

    const prev = known[rel]
    const mtime = Math.floor(st.mtimeMs)
    
    if (prev && prev.bytes === st.size && prev.mtime === mtime) {
      unchanged.push(rel); continue
    }
    let fp
    try { fp = fingerprint(abs, st.size, largeBytes) } catch { unreadable.push({ rel, why: 'read' }); continue }
    
    if (prev && same(prev, fp, st.size)) {
      unchanged.push(rel)
      known[rel] = { ...prev, bytes: st.size, mtime }   
      continue
    }
    
    
    let from = 0
    if (prev && st.size > prev.bytes && isAppend(abs, prev)) from = prev.bytes
    changed.push({ rel, abs, bytes: st.size, mtime, fp, from, isNew: !prev })
  }

  
  const here = new Set([...changed.map(c => c.rel), ...unchanged, ...skipped.map(s => s.rel)])
  
  
  const gone = (Array.isArray(only) ? only : Object.keys(known)).filter(r => known[r] && !here.has(r))

  return {
    changed, skipped, unchanged, unreadable, gone,
    links: found.links.length,
    oversize: found.oversize.length,
    outside: (found.outside ?? []).length,   
    total: found.files.length,
    scanned: !Array.isArray(only),           
  }
}


async function loadOptional(want, ...names) {
  for (const n of names) {
    try { const m = await import(n); if (typeof m[want] === 'function') return m[want] } catch {}
  }
  return null
}


export async function sendChanged(a) {
  const {
    root, clientId, baseUrl, token, stateFile,
    maxFileBytes = MAX_FILE, limit = Infinity, chunkBytes = CHUNK, largeBytes = LARGE,
    manifest = true, only, baseline = false,
  } = a ?? {}
  const fetchImpl = a?.fetchImpl ?? globalThis.fetch
  
  if (!baseUrl) throw new Refused('SC_URL', '設定が足りません')
  if (!token) throw new Refused('SC_TOKEN', '設定が足りません')

  
  const st = stateFile
    ? loadState(stateFile)
    : await loadStateRemote({ fetchImpl, baseUrl, token, clientId })
  
  
  if (st.source === 'unreachable') {
    throw new Refused('SC_NO_STATE', 'いま実行できません')
  }
  const known = { ...st.known }
  const d = diff({ root, known, maxFileBytes, largeBytes, only })

  
  
  
  let blockedByPeer = [], needsSplit = []
  if (a?.peerScreen !== false) {
    const peer = a?.screenImpl ?? await loadOptional(
      'screenForUpload', './upload-scope.mjs', './scope-gate.mjs', './archive-scope-gate.mjs')
    if (peer) {
      try {
        const r = await peer(
          d.changed.map(c => ({ path: c.rel, bytes: c.bytes })),
          { maxBytes: maxFileBytes, perRequestBytes: chunkBytes },
        )
        const stop = new Set()
        for (const x of (r?.blocked ?? [])) stop.add(x.path ?? x.rel)
        for (const x of (r?.notMeasured ?? [])) stop.add(x.path ?? x.rel)
        
        
        needsSplit = (r?.needsSplit ?? []).map(x => x.path ?? x.rel)
        if (stop.size) {
          blockedByPeer = d.changed.filter(c => stop.has(c.rel)).map(c => c.rel)
          d.changed = d.changed.filter(c => !stop.has(c.rel))
        }
      } catch {  }
    }
  }


  const sent = [], failed = [], refused = []
  let n = 0
  for (const c of d.changed) {
    if (n >= limit) break
    n++
    let out
    try {
      out = await sendOne({ fetchImpl, baseUrl, token, clientId, c, chunkBytes, baseline })
    } catch (e) { failed.push({ rel: c.rel, why: e?.code ?? 'throw' }); continue }
    if (!out.ok) {
      
      
      if (REFUSED_FOREVER.has(out.status)) {
        known[c.rel] = { bytes: c.bytes, mtime: c.mtime, ...c.fp, refused: out.status }
        refused.push({ rel: c.rel, status: out.status })
        continue
      }
      failed.push({ rel: c.rel, why: out.why, status: out.status })
      continue
    }

    known[c.rel] = { bytes: c.bytes, mtime: c.mtime, ...c.fp }
    sent.push({ rel: c.rel, bytes: out.bytes, from: c.from, parts: out.parts, waited: out.waited ?? 0 })
  }

  
  
  
  let manifestSent = null
  if (manifest && sent.length) {
    try {
      const res = await fetchImpl(`${baseUrl}/api/client/manifest?clientId=${encodeURIComponent(clientId)}`, {
        method: 'POST',
        headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          at: new Date().toISOString(),
          files: sent.map(x => ({ path: x.rel, size: known[x.rel]?.bytes, ...pick(known[x.rel]) })),
          gone: d.gone,
          
          state: stateFile ? undefined : { known },
          
          baseline: baseline || undefined,
        }),
      })
      manifestSent = res.status === 200 || res.status === 201
    } catch { manifestSent = false }
  }

  
  
  if (stateFile) saveState(stateFile, known)

  return {
    clientId,
    stateSource: st.source,
    total: d.total,
    changed: d.changed.length,
    sent: sent.length,
    sentBytes: sent.reduce((s, x) => s + x.bytes, 0),
    waitedMs: sent.reduce((s, x) => s + (x.waited ?? 0), 0),   
    failed: failed.length,
    refused: refused.length,          
    skipped: d.skipped.length,
    blockedByPeer: blockedByPeer.length,
    manifestSent,                      
    needsSplit: needsSplit.length,     
    unchanged: d.unchanged.length,
    unreadable: d.unreadable.length,
    gone: d.gone.length,
    outside: d.outside,
    scanned: d.scanned,
    baseline,
    links: d.links,
    oversize: d.oversize,
    remaining: Math.max(0, d.changed.length - n),
    details: { sent, failed, refused, skipped: d.skipped, unreadable: d.unreadable, gone: d.gone, blockedByPeer, needsSplit },
    at: new Date().toISOString(),
  }
}


async function sendOne({ fetchImpl, baseUrl, token, clientId, c, chunkBytes, baseline = false }) {
  const size = c.bytes
  const from = c.from ?? 0
  if (from >= size) return { ok: true, bytes: 0, parts: 0, waited: 0 }   

  const fd = fs.openSync(c.abs, 'r')
  try {
    let off = from, parts = 0, waitedTotal = 0
    while (off < size) {
      const len = Math.min(chunkBytes, size - off)
      const buf = Buffer.allocUnsafe(len)
      const n = fs.readSync(fd, buf, 0, len, off)
      if (n <= 0) return { ok: false, why: 'short-read' }
      const body = buf.subarray(0, n)
      const md5 = crypto.createHash('md5').update(body).digest('hex')
      const final = off + n >= size
      const r = await putFile({
        fetchImpl, baseUrl, token, clientId, rel: c.rel, body, md5,
        offset: off, total: size, mode: from > 0 ? 'append' : 'full', final, baseline,
      })
      if (!r.ok) return r
      
      if (r.md5 && r.md5 !== md5) return { ok: false, why: 'md5-mismatch' }
      waitedTotal += r.waited ?? 0
      off += n; parts++
    }
    return { ok: true, bytes: size - from, parts, waited: waitedTotal }
  } finally { fs.closeSync(fd) }
}


function pick(k) {
  if (!k) return {}
  return k.md5 ? { md5: k.md5 } : { head: k.head, tail: k.tail }
}


const wait = (ms) => new Promise(r => setTimeout(r, ms))


async function putFile({ fetchImpl, baseUrl, token, clientId, rel, body, md5, offset = 0, total, mode = 'full', final = true, retries = 3, baseline = false }) {
  
  
  const url = `${baseUrl}/api/client/file`
    + `?clientId=${encodeURIComponent(clientId)}&rel=${encodeURIComponent(rel)}`
    + `&sha=${encodeURIComponent(md5)}&hashAlg=md5`
    + `&offset=${offset}&total=${total ?? body.length}&mode=${mode}&final=${final ? 1 : 0}`
    + (baseline ? '&baseline=1' : '')
  let res, waited = 0
  for (let i = 0; ; i++) {
    res = await fetchImpl(url, {
      method: 'PUT',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/octet-stream' },
      body,
    })
    if (res.status !== 429 || i >= retries) break
    
    const hinted = Number(res.headers?.get?.('Retry-After'))
    const ms = Number.isFinite(hinted) && hinted > 0 ? hinted * 1000 : 250 * (2 ** i)
    waited += ms
    await wait(ms)
  }
  if (res.status === 429) return { ok: false, status: 429, why: 'busy', waited }
  if (res.status !== 200 && res.status !== 201) {
    return { ok: false, status: res.status, why: 'status' }
  }
  let b = null
  try { b = await res.json() } catch {  }
  return { ok: true, status: res.status, md5: b?.md5 ?? b?.sha, waited }
}
