
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, isAbsolute, normalize } from 'path'
import { mergeSection, sectionSha } from './merge-section.mjs'


export function safeJoin(root, rel) {
  if (typeof rel !== 'string' || rel === '') return null
  if (isAbsolute(rel)) return null
  if (rel.includes('\0')) return null
  const p = normalize(join(root, rel))
  const base = normalize(root.endsWith('/') ? root : root + '/')
  return p.startsWith(base) ? p : null
}


export function keepOutside(text, endMark, kept) {
  const i = text.indexOf(endMark)
  if (i < 0) return null
  const at = i + endMark.length
  const body = String(kept).replace(/^\n+|\n+$/g, '')
  if (body === '') return text
  return text.slice(0, at) + '\n' + body + '\n' + text.slice(at)
}


export async function applyPull({ root, items, sendBack, io }) {
  const rd = (io && io.read)   || (p => (existsSync(p) ? readFileSync(p, 'utf8') : ''))
  const wr = (io && io.write)  || ((p, t) => writeFileSync(p, t))
  const ex = (io && io.exists) || (p => existsSync(p))
  const mk = (io && io.mkdir)  || (p => { mkdirSync(p, { recursive: true }) })
  const out = { applied: [], noop: [], rescued: [], refused: [], failed: [] }

  for (const it of items || []) {
    const rel = it && it.rel
    const p = safeJoin(root, rel)
    if (!p) { out.refused.push({ rel, reason: '置き場が 範囲の 外です' }); continue }
    
    if (it.mode === 'ensure-dir') {
      if (ex(p)) { out.noop.push({ rel }); continue }
      try { mk(p); out.applied.push({ rel, mode: 'ensure-dir' }) }
      catch (e) { out.failed.push({ rel, reason: '作れません: ' + (e.code || 'failed') }) }
      continue
    }

    
    if (it.mode === 'create-if-missing') {
      if (ex(p)) { out.noop.push({ rel }); continue }
      try { wr(p, String(it.content ?? '')); out.applied.push({ rel, mode: 'create-if-missing' }) }
      catch (e) { out.failed.push({ rel, reason: '書けません: ' + (e.code || 'failed') }) }
      continue
    }

    if (it.mode !== 'section') { out.refused.push({ rel, reason: `知らない 直し方: ${it.mode}` }); continue }

    let cur
    try { cur = rd(p) } catch (e) { out.failed.push({ rel, reason: '読めません: ' + (e.code || 'failed') }); continue }

    const r = mergeSection(cur, String(it.section ?? ''), it.marker, { lastSha: it.lastSha })
    if (r.mode === 'refuse') { out.refused.push({ rel, reason: r.reason }); continue }
    if (r.mode === 'noop')   { out.noop.push({ rel }); continue }

    
    let text = r.text
    if (r.mode === 'replace-edited') {
      text = keepOutside(r.text, it.marker.end, r.edited)
      if (text === null) { out.failed.push({ rel, reason: '印の 終わりが 見つからず 移せません' }); continue }
      out.rescued.push({ rel, bytes: Buffer.byteLength(r.edited, 'utf8') })
      
      try { await sendBack(rel, r.edited) } catch {  }
    }

    try { wr(p, text); out.applied.push({ rel, mode: r.mode, sha: sectionSha('\n' + it.section + '\n') }) }
    catch (e) { out.failed.push({ rel, reason: '書けません: ' + (e.code || 'failed') }) }
  }
  return out
}
