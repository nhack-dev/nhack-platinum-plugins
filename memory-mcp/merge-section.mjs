

import { createHash } from 'crypto'


export function sectionSha(text) {
  return createHash('sha256').update(String(text), 'utf8').digest('hex')
}


function findAll(text, needle) {
  const at = []
  let i = 0
  while (true) {
    const n = text.indexOf(needle, i)
    if (n < 0) break
    at.push(n)
    i = n + needle.length     
  }
  return at
}


export function mergeSection(existing, section, marker, opts = {}) {
  if (typeof existing !== 'string') return { text: null, mode: 'refuse', reason: '中身が 文字列では ありません' }
  if (typeof section !== 'string')  return { text: null, mode: 'refuse', reason: '節が 文字列では ありません' }
  const begin = marker && marker.begin
  const end   = marker && marker.end
  if (!begin || !end) return { text: null, mode: 'refuse', reason: '印が 空です' }
  if (begin === end)  return { text: null, mode: 'refuse', reason: '始めと 終わりの 印が 同じです' }

  
  if (section.includes(begin) || section.includes(end)) {
    return { text: null, mode: 'refuse', reason: '節の 中に 印が 入っています' }
  }

  const b = findAll(existing, begin)
  const e = findAll(existing, end)

  
  if (b.length === 0 && e.length === 0) {
    const sep = existing === '' ? '' : (existing.endsWith('\n') ? '\n' : '\n\n')
    return { text: existing + sep + begin + '\n' + section + '\n' + end + '\n', mode: 'append', reason: '印が 無いので 末尾に 足しました' }
  }

  
  if (b.length !== 1 || e.length !== 1) {
    return { text: null, mode: 'refuse', reason: `印の 数が 合いません（始め ${b.length} 個 ／ 終わり ${e.length} 個）` }
  }
  if (e[0] < b[0] + begin.length) {
    return { text: null, mode: 'refuse', reason: '終わりの 印が 始めより 前に あります' }
  }

  
  const head = existing.slice(0, b[0])
  const tail = existing.slice(e[0] + end.length)
  const now  = existing.slice(b[0] + begin.length, e[0])
  const next = '\n' + section + '\n'
  if (now === next) return { text: existing, mode: 'noop', reason: '中身が 同じなので 書きません' }

  
  
  
  
  const lastSha = opts && opts.lastSha
  if (lastSha && sectionSha(now) !== lastSha) {
    return {
      text: head + begin + next + end + tail,
      mode: 'replace-edited',
      reason: '印の中が 変わっています',
      edited: now,
    }
  }

  return { text: head + begin + next + end + tail, mode: 'replace', reason: '印の 間だけ 差し替えました' }
}
