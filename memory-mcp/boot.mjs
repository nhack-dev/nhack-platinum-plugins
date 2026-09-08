
import { judgeRunPermission, judgeGetResponse, RUN, OK } from './memory-contract.mjs'
import { plan, apply, blank } from './restore.mjs'

export async function onStartup({
  probe, getProbe, botId, recs = [], manifest = [], roots = {}, backupDir, checks = [], dryRun = false,
  expectName,
} = {}) {
  const r = judgeRunPermission(probe)
  const base = { run: r.run, state: r.state, note: r.note }

  
  if (r.run === RUN.ALLOW) {
    
    
    
    
    const g = judgeGetResponse(getProbe, botId)
    if (g.state !== OK) {
      return { ...base, ok: false, written: 0, blanked: 0,
               reason: `🔴 受け取った 記憶を 使えません: ${g.note}\n1バイトも 書いて いません` }
    }
    const p = plan(recs)
    if (!p.ok) return { ...base, ok: false, reason: p.reason }
    return { ...base, ok: true, ...apply(p, { backupDir, checks }) }
  }

  
  if (r.run === RUN.BLANK) {
    
    
    
    
    
    
    
    const done = [], missing = [], merged = {
      blanked: 0, nameChecked: 0, wouldBlank: [], refused: [], failed: [], skipped: [],
    }
    
    
    
    const noKind = manifest.filter((m) => !m?.kind)
    for (const m of noKind) {
      merged.refused.push({ rel: m?.rel, why: '🔴 どの置き場の ものか 書かれて いません（kind）推測しません' })
    }
    const withKind = manifest.filter((m) => m?.kind)
    const want = [...new Set(withKind.map((m) => m.kind))]
    for (const kind of want) {
      const root = roots?.[kind]
      if (!root) { missing.push(kind); continue }          
      const part = withKind.filter((m) => m.kind === kind)
      const res = blank(part, { root, backupDir, expectName, checks, dryRun })
      
      
      
      
      
      
      if (!res.ok && res.failed === undefined) { missing.push(kind); continue }
      done.push(kind)
      merged.blanked += res.blanked
      
      
      if (typeof res.nameChecked === 'number') merged.nameChecked += res.nameChecked
      else merged.nameCheckUnknown = (merged.nameCheckUnknown || 0) + 1
      for (const k of ['wouldBlank', 'refused', 'failed', 'skipped']) merged[k].push(...res[k])
    }
    return {
      ...base, ...merged,
      kinds: { want, done, missing },
      
      
      
      ok: missing.length === 0 && merged.failed.length === 0 && noKind.length === 0,
      ...(missing.length || merged.failed.length
        ? { reason: [
            missing.length ? `🔴 置き場が 渡されて いません: ${missing.join(', ')}` : '',
            merged.failed.length ? `🔴 止めた ${merged.failed.length}件 … ${merged.failed.map((f) => `${f.rel}（${f.why}）`).join(' / ')}` : '',
            'まだ 終わって いません。人の 手が 要ります',
          ].filter(Boolean).join('\n') }
        : {}),
    }
  }

  
  
  
  
  return { ...base, ok: true, written: 0, blanked: 0, touched: 0 }
}
