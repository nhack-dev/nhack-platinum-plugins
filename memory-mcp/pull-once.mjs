
import { applyPull } from './apply-pull.mjs'

const MODES = new Set(['ensure-dir', 'create-if-missing', 'section'])


export function whyBad(it) {
  if (!it || typeof it !== 'object') return '中身が ありません'
  if (typeof it.rel !== 'string' || it.rel === '') return '置き場が ありません'
  if (!MODES.has(it.mode)) return `知らない 直し方: ${it.mode}`
  if (it.mode === 'create-if-missing' && it.content != null && typeof it.content !== 'string')
    return '中身が 文字列で ありません'
  if (it.mode === 'section') {
    if (typeof it.section !== 'string') return '節が 文字列で ありません'
    const m = it.marker
    if (!m || typeof m.begin !== 'string' || typeof m.end !== 'string' || !m.begin || !m.end)
      return '印が ありません'
    if (it.lastSha != null && typeof it.lastSha !== 'string') return '指紋が 文字列で ありません'
  }
  return null
}


export function sift(body) {
  const items = body && Array.isArray(body.items) ? body.items : null
  if (!items) return { ok: [], dropped: [], note: '形が 違います' }
  const ok = [], dropped = []
  for (const it of items) {
    const why = whyBad(it)
    if (why) dropped.push({ rel: it && it.rel, why }); else ok.push(it)
  }
  return { ok, dropped, note: null }
}


export async function pullOnce({ url, root, fetchImpl, sendBack, headers, io }) {
  let res
  try { res = await fetchImpl(url, { headers: headers || {} }) }
  catch (e) { return { state: 'no-network', note: String(e && (e.code || 'failed') || e) } }

  if (!res || typeof res.status !== 'number') return { state: 'bad-response' }
  if (res.status === 304) return { state: 'unchanged' }
  if (res.status !== 200) return { state: 'not-ok', status: res.status }

  let body
  try { body = await res.json() } catch { return { state: 'bad-json' } }

  const { ok, dropped, note } = sift(body)
  if (note) return { state: 'bad-shape', note, dropped }
  if (ok.length === 0) return { state: 'nothing', dropped }

  const r = await applyPull({ root, items: ok, sendBack, io })
  return { state: 'applied', dropped, ...r }
}
