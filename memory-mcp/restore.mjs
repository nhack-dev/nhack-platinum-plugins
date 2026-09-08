
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync, lstatSync, unlinkSync, rmSync, readdirSync, cpSync, renameSync, rmdirSync, realpathSync } from 'node:fs'
import { join, dirname, resolve, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { judgeCopyFreshness, UNKNOWN } from './memory-contract.mjs'

const md5 = (b) => createHash('md5').update(b).digest('hex')


export function planOne(rec, { root } = {}) {
  const base = rec.root || root
  if (!base || !rec.rel) return { rec, action: 'ask', state: UNKNOWN, note: '🔴 root/rel が 無い' }
  const p = join(base, rec.rel)

  let localHash, localMtime
  if (existsSync(p)) {
    try {
      localHash = md5(readFileSync(p))
      localMtime = new Date(statSync(p).mtimeMs).toISOString()
    } catch (e) {
      
      return { rec, path: p, action: 'ask', state: UNKNOWN, note: `🔴 ローカルが 読めない: ${e.code || 'failed'}` }
    }
  }
  const r = judgeCopyFreshness({
    localHash, serverHash: rec.sha,
    localMtime, serverSyncedAt: rec.synced_at,
  })
  return { rec, path: p, action: r.action ?? 'ask', state: r.state, note: r.note }
}

export function plan(recs, opts = {}) {
  if (!Array.isArray(recs)) return { ok: false, reason: '🔴 引数の 形が 違います（測れなかった）' }
  const out = { ok: true, restore: [], none: [], keep: [], ask: [] }
  for (const rec of recs) {
    const d = planOne(rec, opts)
    ;(out[d.action] ?? out.ask).push(d)
  }
  return out
}


function _writeOne(path, content, checks, backupDir) {
  
  
  
  for (const c of checks) {                      
    let v
    try { v = c(path, content) }
    catch (e) { return { written: false, reason: `🟡 ${c.name || '検査'}: 落ちました（${e.code || 'failed'}）測れないので 書きません` } }
    if (v && v.blocked) return { written: false, reason: `🔴 ${c.name || '検査'}: ${v.reason}` }
    if (v && (v.measurable === false || v.ok === null)) {
      return { written: false, reason: `🟡 ${c.name || '検査'}: 測れませんでした（${v.reason ?? '理由なし'}）書きません` }
    }
  }
  if (existsSync(path)) {                        
    mkdirSync(backupDir, { recursive: true })
    writeFileSync(join(backupDir, path.replace(/[/\\]/g, '_') + '.bak'), readFileSync(path))
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
  return { written: true }
}



export function blank(manifest, { root, agentRoot, backupDir, expectName, checks = [], dryRun = false } = {}) {
  if (!Array.isArray(manifest)) return { ok: false, reason: '🔴 引数の 形が 違います（測れませんでした）' }
  
  
  if (!dryRun && !backupDir) return { ok: false, reason: '🔴 控えの 置き場が 無い（測れなかった）' }
  
  
  
  
  const res = { dryRun, blanked: 0, nameChecked: 0, wouldBlank: [], refused: [], failed: [], skipped: [] }
  for (const m of manifest) {
    if (m?.ours !== true) { res.refused.push({ rel: m?.rel, why: '🔴 この 操作の 対象では ありません' }); continue }
    
    
    
    if (m.blankable !== true) { res.refused.push({ rel: m.rel, why: '🟡 触ってよいと 書かれていません（壊す恐れが あるので 断ります）' }); continue }
    
    
    
    if (agentRoot) {
      const abs = resolve(join(m.root || root || '', m.rel))
      const rootAbs = resolve(agentRoot)
      if (!abs.startsWith(rootAbs + sep) && abs !== rootAbs) {
        res.refused.push({ rel: m.rel, why: `🔴 範囲の 外です（${rootAbs} の 中では ありません）` }); continue
      }
    }
    
    
    const base = m.root || root
    if (!base || !m.rel || /[*?]/.test(m.rel)) { res.refused.push({ rel: m?.rel, why: '🔴 置き場か 名前が 無い、または ワイルドカード' }); continue }
    const p = join(base, m.rel)
    
    
    
    
    
    if (!existsSync(base)) {
      res.failed.push({ rel: m.rel, why: `🔴 置き場が 見つかりません: ${base}（名前か 版が 違うかも しれません）` })
      continue
    }
    
    
    
    
    
    
    
    
    const wantName = m.expectName || expectName
    if (wantName) {
      res.nameChecked++
      const pj = join(base, '.claude-plugin', 'plugin.json')
      if (!existsSync(pj)) {
        res.failed.push({ rel: m.rel, why: `🔴 製品の 名前を 確かめられません（${pj} が 在りません）` })
        continue
      }
      let nm
      try { nm = JSON.parse(readFileSync(pj, 'utf8')).name }
      catch (e) { res.failed.push({ rel: m.rel, why: `🔴 製品の 名前を 読めません: ${e.code || 'failed'}` }); continue }
      if (nm !== wantName) {
        res.failed.push({ rel: m.rel, why: '🔴 設定と 実物が 合いません（止めました）' })
        continue
      }
    }
    
    
    
    
    
    
    if (existsSync(p)) {
      let st
      try { st = lstatSync(p) } catch (e) { res.failed.push({ rel: m.rel, why: `🔴 種別を 読めません: ${e.code || 'failed'}` }); continue }
      if (st.isSymbolicLink()) {
        if (dryRun) { res.wouldBlank.push({ rel: m.rel, why: '🔗 リンクなので 外します（リンク先は 触りません）' }); continue }
        try { unlinkSync(p); res.blanked++; continue }
        catch (e) { res.failed.push({ rel: m.rel, why: `🔴 リンクを 外せません: ${e.code || 'failed'}` }); continue }
      }
    }
    if (!existsSync(p)) { res.skipped.push({ rel: m.rel, why: '🟡 元から 在りません' }); continue }
    
    
    
    
    if (m.marker) {
      let cur
      try { cur = readFileSync(p, 'utf8') } catch (e) { res.failed.push({ rel: m.rel, why: `🟡 読めない: ${e.code || 'failed'}` }); continue }
      
      
      
      
      const S = `<!-- ${m.marker}_START`, E = `<!-- ${m.marker}_END`
      
      
      const count = (t, w) => { let n = 0, i = 0; while ((i = t.indexOf(w, i)) >= 0) { n++; i += w.length } return n }
      const nS = count(cur, S), nE = count(cur, E)
      
      
      if (nS === 0 && nE === 0) { res.skipped.push({ rel: m.rel, why: '🟡 目印が 見つかりません（まだ 入って いない か、消された）' }); continue }
      if (nS === 0 || nE === 0) {
        res.failed.push({ rel: m.rel, why: `🔴 目印が 片方だけ 在ります（開始 ${nS}・終了 ${nE}）どこまでが 対象か 決められないので 止めます` })
        continue
      }
      if (nS !== 1 || nE !== 1) {
        res.failed.push({ rel: m.rel, why: `🔴 目印が ${nS}組 在ります（どちらが 正か 決められないので 止めます）` })
        continue
      }
      const si = cur.indexOf(S), ei = cur.indexOf(E)
      if (ei < si) { res.failed.push({ rel: m.rel, why: '🔴 目印の 順番が 逆です（止めます）' }); continue }
      
      
      
      const so = cur.indexOf('-->', si)
      if (so < 0 || so > ei) { res.failed.push({ rel: m.rel, why: '🔴 目印が 閉じて いません（止めます）' }); continue }
      const next = cur.slice(0, so + 3) + '\n' + cur.slice(ei)   
      if (dryRun) { res.wouldBlank.push(`${m.rel}（目印の間だけ）`); continue }
      const w = _writeOne(p, next, checks, backupDir)
      if (!w.written) { res.failed.push({ rel: m.rel, why: w.reason }); continue }
      let after
      try { after = readFileSync(p, 'utf8') } catch (e) { res.failed.push({ rel: m.rel, why: `🟡 読み直せない: ${e.code || 'failed'}` }); continue }
      
      const s2 = after.indexOf(S), e2 = after.indexOf(E)
      const inner = s2 >= 0 && e2 > s2 ? after.slice(after.indexOf('-->', s2) + 3, e2).trim() : 'x'
      if (inner.length !== 0) { res.failed.push({ rel: m.rel, why: '🔴 まだ 終わって いません（もう一度 お試しください）' }); continue }
      res.blanked++
      continue
    }
    if (dryRun) {
      
      const blocked = checks.map(c => [c, c(p, '')]).find(([, v]) => v && v.blocked)
      if (blocked) { res.failed.push({ rel: m.rel, why: `🔴 ${blocked[0].name || '検査'}: ${blocked[1].reason}` }); continue }
      res.wouldBlank.push(m.rel); continue          
    }
    const w = _writeOne(p, '', checks, backupDir)
    if (!w.written) { res.failed.push({ rel: m.rel, why: w.reason }); continue }
    
    let after
    try { after = readFileSync(p, 'utf8') } catch (e) { res.failed.push({ rel: m.rel, why: `🟡 読み直せない: ${e.code || 'failed'}` }); continue }
    if (after.length !== 0) { res.failed.push({ rel: m.rel, why: '🔴 まだ 終わって いません（もう一度 お試しください）' }); continue }
    res.blanked++
  }
  res.limits = [
    '決められた もの以外は 1件も 触りません（あなたの 記憶・成果物は 対象外です）',
    '知らない ものが 混ざったら 断って 続けます（1件ずつ 独立して いる ため）',
    '控えを 残します（あとから 元に 戻せます）',
    'そのあと 動かなくなったかは 見ていません',
    '触ってよいと はっきり 書かれていない ファイルは 断ります（安全側）',
  ]
  
  
  
  
  
  return { ...res, ok: res.failed.length === 0 }
}

export function apply(planned, { backupDir, checks = [] } = {}) {
  if (!planned?.ok) return { ok: false, reason: planned?.reason ?? '🔴 計画が 無い' }
  if (!backupDir) return { ok: false, reason: '🔴 控えの 置き場が 無い（測れなかった）' }
  const res = { written: 0, skipped: [], blocked: [] }
  for (const d of planned.restore) {
    const c = d.rec.content
    if (typeof c !== 'string') { res.skipped.push({ rel: d.rec.rel, why: '🟡 中身が 無い' }); continue }
    const w = _writeOne(d.path, c, checks, backupDir)
    if (w.written) res.written++
    else res.blocked.push({ rel: d.rec.rel, why: w.reason })
  }
  
  res.kept = planned.keep.length
  res.unknown = planned.ask.length
  res.limits = [
    '設定が 正しいかは 見て いません',
    '決められた もの以外は 見て いません',
    
  ]
  
  
  
  
  
  return { ok: true, ...res }
}


export function blankTree(targets, { agentRoot, backupDir, dangerous = [], allowBackupInside = false, dryRun = false, scopeGate } = {}) {
  if (!Array.isArray(targets)) return { ok: false, reason: '🔴 対象が 配列では ありません（測れませんでした）' }
  if (!agentRoot) return { ok: false, reason: '🔴 大元が 渡されて いません（cwd は 使いません）' }
  if (!dryRun && !backupDir) return { ok: false, reason: '🔴 控えの 置き場が 無い（測れなかった）' }

  const rootAbs = resolve(agentRoot)                 
  const res = { dryRun, removed: 0, wouldRemove: [], refused: [], failed: [], skipped: [], warnings: [] }

  
  
  
  
  
  
  
  
  const list = [...targets].sort((a, b) => ((a && a.order) || 0) - ((b && b.order) || 0))

  
  
  
  
  
  if (backupDir && !allowBackupInside) {
    const bAbs = resolve(backupDir)
    if (bAbs === rootAbs || bAbs.startsWith(rootAbs + sep)) {
      return { ok: false, reason: `🔴 控えの 置き場が 消す 対象の 中に あります（${bAbs}）戻せなく なるので 止めます（通すなら allowBackupInside:true）` }
    }
  }

  
  
  const home = process.env.HOME || ''
  const WELL_KNOWN = [home, '/', '/Users', '/System', '/Library', '/Applications',
                      join(home, 'Documents'), join(home, 'Desktop'), join(home, 'Downloads')]
    .filter(Boolean).map(x => resolve(x))
  
  const never = new Set(dangerous.filter(Boolean).map(x => resolve(x)))
  const warn = (p) => { if (WELL_KNOWN.includes(p)) res.warnings.push(`🟡 ${p} は よく 知られた 場所です（止めて いません）`) }

  if (never.has(rootAbs)) {
    return { ok: false, reason: `🔴 この 操作は 許可されて いません（${rootAbs}）` }
  }
  warn(rootAbs)

  for (const t of list) {
    const rel = typeof t === 'string' ? t : t?.rel
    if (!rel || /[*?]/.test(rel)) { res.refused.push({ rel, why: '🔴 名前が 無い、または ワイルドカード' }); continue }
    if (t?.ours !== undefined && t.ours !== true) { res.refused.push({ rel, why: '🔴 この 操作の 対象では ありません' }); continue }

    const p = resolve(join(rootAbs, rel))            
    
    if (p !== rootAbs && !p.startsWith(rootAbs + sep)) {
      
      
      
      
      if (typeof scopeGate === 'function') {
        const g = scopeGate(rel)
        if (g && g.ok === false) {
          res.refused.push({ rel, why: `🔴 範囲の 外です（${g.gate || 'ESCAPES_ROOT'}）` })
          continue
        }
      }
      res.warnings.push(`🟡 ${rel} は 大元の 外を 指します（${typeof scopeGate === 'function' ? '門が 通しました' : '止めて いません'}）`)
    }
    if (never.has(p)) { res.refused.push({ rel, why: `🔴 この 操作は 許可されて いません（${p}）` }); continue }
    warn(p)

    let st
    try { st = lstatSync(p) }
    catch (e) {
      if (e.code === 'ENOENT') { res.skipped.push({ rel, why: '🟡 元から 在りません' }); continue }
      res.failed.push({ rel, why: `🔴 種別を 読めません: ${e.code || 'failed'}` }); continue
    }

    
    if (st.isSymbolicLink()) {
      if (dryRun) { res.wouldRemove.push({ rel, kind: 'リンク', why: '🔗 リンクだけ 外します（リンク先は 触りません）' }); continue }
      try { unlinkSync(p); res.removed++ } catch (e) { res.failed.push({ rel, why: `🔴 リンクを 外せません: ${e.code || 'failed'}` }) }
      continue
    }

    if (dryRun) {
      
      
      
      
      
      let n = 0, links = 0
      try {
        const ents = readdirSync(p, { withFileTypes: true })
        n = ents.length
        links = ents.filter(e => e.isSymbolicLink()).length
      } catch { n = -1 }
      res.wouldRemove.push({
        rel, kind: st.isDirectory() ? 'フォルダ' : 'ファイル',
        直下: n, リンク: links,
        note: n > 0 ? '🟡 直下の 数です（中の 深さは 数えて いません）' : undefined,
      })
      continue
    }

    
    
    
    
    try {
      mkdirSync(backupDir, { recursive: true })
      cpSync(p, join(backupDir, rel.replace(/[/\\]/g, '_')), { recursive: true })
    } catch (e) {
      
      res.failed.push({ rel, why: `🔴 控えを 取れません: ${e.code || 'failed'}（消して いません）` }); continue
    }
    try { rmSync(p, { recursive: true, force: true }) }
    catch (e) { res.failed.push({ rel, why: `🔴 消せません: ${e.code || 'failed'}` }); continue }

    
    if (existsSync(p)) { res.failed.push({ rel, why: '🔴 まだ 残って います' }); continue }
    res.removed++
  }

  res.limits = [
    '決められた もの以外は 1件も 触りません',
    'リンクは 外すだけ（リンク先は 触りません）',
    '控えを 取ってから 消します（取れなければ 消しません）',
    '控えは 対象の 外に 置いて ください（中に 置くと 一緒に 消えます）',
    'そのあと 動かなくなったかは 見て いません',
  ]
  return { ...res, ok: res.failed.length === 0 }
}


export function fixTree(plan, { agentRoot, backupDir, dryRun = false } = {}) {
  if (!Array.isArray(plan)) return { ok: false, reason: '🔴 手順が 配列では ありません（測れませんでした）' }
  if (!agentRoot) return { ok: false, reason: '🔴 大元が 渡されて いません（cwd は 使いません）' }
  if (!dryRun && !backupDir) return { ok: false, reason: '🔴 控えの 置き場が 無い（測れなかった）' }

  const rootAbs = resolve(agentRoot)
  const res = { dryRun, done: 0, steps: [], failed: [], skipped: [], warnings: [], rolledBack: 'none' }

  if (backupDir) {
    const bAbs = resolve(backupDir)
    if (bAbs === rootAbs || bAbs.startsWith(rootAbs + sep)) {
      return { ok: false, reason: `🔴 控えの 置き場が 直す 対象の 中に あります（${bAbs}）戻せなく なるので 止めます` }
    }
  }

  const list = [...plan].sort((a, b) => ((a && a.order) || 0) - ((b && b.order) || 0))
  const undo = []                     

  const inside = (p) => p === rootAbs || p.startsWith(rootAbs + sep)

  for (const s of list) {
    const op = s?.op
    try {
      if (op === 'keep') { res.steps.push({ op, rel: s.rel, why: '🟡 そのまま' }); continue }

      if (op === 'mkdir') {
        const p = resolve(join(rootAbs, s.rel || ''))
        if (!inside(p)) res.warnings.push(`🟡 ${s.rel} は 大元の 外です（止めて いません）`)
        if (existsSync(p)) { res.skipped.push({ op, rel: s.rel, why: '🟡 もう 在ります（触りません）' }); continue }
        if (dryRun) { res.steps.push({ op, rel: s.rel, why: '作ります' }); continue }
        
        
        
        
        const firstMade = mkdirSync(p, { recursive: true })
        
        
        
        
        
        undo.push(() => {
          
          const chain = []
          if (firstMade) {
            let cur = p
            const top = resolve(firstMade)
            while (true) {
              chain.push(cur)
              if (resolve(cur) === top) break
              const up = dirname(cur)
              if (up === cur) break
              cur = up
            }
          } else { chain.push(p) }
          for (const c of chain) {
            try { rmdirSync(c) }
            catch (e) {
              
              if (e.code !== 'ENOENT') res.warnings.push(`🟡 戻せません（作った フォルダが 残ります）: ${c.slice(rootAbs.length + 1)} — ${e.code}`)
              break
            }
          }
        })
        res.steps.push({ op, rel: s.rel, why: '✅ 作りました' }); res.done++
        continue
      }

      if (op === 'move') {
        const from = resolve(join(rootAbs, s.from || ''))
        const to   = resolve(join(rootAbs, s.to   || ''))
        if (!inside(from)) res.warnings.push(`🟡 ${s.from} は 大元の 外です（止めて いません）`)
        if (!existsSync(from)) { res.skipped.push({ op, rel: s.from, why: '🟡 元が 在りません' }); continue }
        
        if (existsSync(to)) { res.failed.push({ op, rel: s.to, why: '🔴 行き先が もう 在ります（上書きしません）' }); break }
        if (dryRun) { res.steps.push({ op, from: s.from, to: s.to, why: '動かします' }); continue }
        mkdirSync(dirname(to), { recursive: true })
        renameSync(from, to)
        undo.push(() => {
          try { renameSync(to, from) }
          catch (e) { res.warnings.push(`🔴 戻せません（動かした ものが 戻りません）: ${s.from} — ${e.code}`) }
        })
        res.steps.push({ op, from: s.from, to: s.to, why: '✅ 動かしました' }); res.done++
        continue
      }

      if (op === 'rewrite') {
        const p = resolve(join(rootAbs, s.rel || ''))
        if (!inside(p)) res.warnings.push(`🟡 ${s.rel} は 大元の 外です（止めて いません）`)
        if (!existsSync(p)) { res.skipped.push({ op, rel: s.rel, why: '🟡 在りません' }); continue }
        if (typeof s.find !== 'string' || s.find === '') { res.failed.push({ op, rel: s.rel, why: '🔴 探す 文字列が ありません' }); break }
        let cur
        try { cur = readFileSync(p, 'utf8') } catch (e) { res.failed.push({ op, rel: s.rel, why: `🔴 読めません: ${e.code || 'failed'}` }); break }
        const n = cur.split(s.find).length - 1
        
        
        
        
        
        
        if (typeof s.expect === 'number' && n !== s.expect) {
          res.failed.push({ op, rel: s.rel, why: '🔴 設定と 実物が 合いません（もう一度 お試しください）' })
          break
        }
        if (n === 0) { res.skipped.push({ op, rel: s.rel, why: '🟡 設定と 実物が 合いません' }); continue }
        if (dryRun) { res.steps.push({ op, rel: s.rel, hits: n, why: `${n}箇所 書き換えます` }); continue }
        
        mkdirSync(backupDir, { recursive: true })
        const bak = join(backupDir, s.rel.replace(/[/\\]/g, '_') + '.bak')
        writeFileSync(bak, cur)
        writeFileSync(p, cur.split(s.find).join(s.replace ?? ''))
        undo.push(() => {
          try { writeFileSync(p, readFileSync(bak)) }
          catch (e) { res.warnings.push(`🔴 戻せません（書き換えが 戻りません）: ${s.rel} — ${e.code} ／ 控え ${bak}`) }
        })
        res.steps.push({ op, rel: s.rel, hits: n, why: `✅ ${n}箇所 書き換えました` }); res.done++
        continue
      }

      res.failed.push({ op: op ?? '(無い)', rel: s?.rel, why: '🔴 知らない 動詞です' }); break
    } catch (e) {
      res.failed.push({ op, rel: s?.rel ?? s?.from, why: `🔴 落ちました: ${e.code || 'failed'}` }); break
    }
  }

  
  if (!dryRun && res.failed.length > 0 && undo.length > 0) {
    const before = res.warnings.length
    for (let i = undo.length - 1; i >= 0; i--) undo[i]()
    
    
    
    
    res.rolledBack = res.warnings.length > before ? 'partial' : 'full'
    res.done = 0
  } else if (!dryRun && res.failed.length > 0) {
    res.rolledBack = 'none'                                
  }

  res.limits = [
    '1つでも 失敗したら 戻します（rolledBack … full ／ partial ／ none）',
    '知らない ものが 混ざったら 止めます（飛ばしません。順番に 意味が ある ため）',
    '戻し切れなかった ものは warnings に 出します',
    '行き先が もう 在るときは 動かしません（上書きしません）',
    '控えは 対象の 外に 置いて ください',
    '動いて いる 最中に 呼ばないで ください（起動時に 呼ぶ ためのものです）',
  ]
  return { ...res, ok: res.failed.length === 0 }
}


export function countMatches(queries, { agentRoot, maxBytes = 4 * 1024 * 1024 } = {}) {
  if (!Array.isArray(queries)) return { ok: false, reason: '🔴 引数の 形が 違います（測れませんでした）' }
  if (!agentRoot) return { ok: false, reason: '🔴 大元が 渡されて いません（cwd は 使いません）' }
  const rootAbs = resolve(agentRoot)
  const out = []
  for (const q of queries) {
    const rel = q?.rel, find = q?.find
    if (!rel || typeof find !== 'string' || find === '') {
      out.push({ rel, find, count: null, why: '🔴 引数の 形が 違います' }); continue
    }
    const p = resolve(join(rootAbs, rel))
    if (p !== rootAbs && !p.startsWith(rootAbs + sep)) {
      out.push({ rel, find, count: null, why: '🔴 この 操作の 対象では ありません' }); continue
    }
    
    
    
    
    try {
      const real = realpathSync(p)
      const realRoot = realpathSync(rootAbs)
      if (real !== realRoot && !real.startsWith(realRoot + sep)) {
        out.push({ rel, find, count: null, why: '🔴 この 操作の 対象では ありません（実体が 外に 出ます）' }); continue
      }
    } catch {  }
    let st
    try { st = lstatSync(p) }
    catch (e) {
      out.push({ rel, find, count: e.code === 'ENOENT' ? 0 : null, why: e.code === 'ENOENT' ? '🟡 在りません' : `🟡 読めません: ${e.code}` })
      continue
    }
    
    if (st.isSymbolicLink()) { out.push({ rel, find, count: null, why: '🟡 リンクなので 数えません' }); continue }
    if (!st.isFile()) { out.push({ rel, find, count: null, why: '🟡 ファイルでは ありません' }); continue }
    
    if (st.size > maxBytes) { out.push({ rel, find, count: null, why: '🟡 大きいので 数えません' }); continue }
    let s
    try { s = readFileSync(p, 'utf8') }
    catch (e) { out.push({ rel, find, count: null, why: `🟡 読めません: ${e.code}` }); continue }
    out.push({ rel, find, count: s.split(find).length - 1 })
  }
  return { ok: true, results: out, limits: ['数だけ 返します（中身・行番号・大きさは 返しません）'] }
}


export function scanLayout({ agentRoot, allow = [], maxEntries = 200 } = {}) {
  if (!agentRoot) return { ok: false, reason: '🔴 大元が 渡されて いません（cwd は 使いません）' }
  if (!Array.isArray(allow)) return { ok: false, reason: '🔴 引数の 形が 違います（測れませんでした）' }
  const rootAbs = resolve(agentRoot)
  let ents
  try { ents = readdirSync(rootAbs, { withFileTypes: true }) }
  catch (e) { return { ok: false, reason: `🔴 大元を 読めません: ${e.code}（測れませんでした）` } }

  const known = new Set(allow)
  const entries = []
  let others = 0, truncated = false
  for (const e of ents) {
    if (entries.length >= maxEntries) { truncated = true; break }
    if (!known.has(e.name)) { others++; continue }        
    const kind = e.isSymbolicLink() ? 'link' : (e.isDirectory() ? 'dir' : 'file')
    const rec = { rel: e.name, kind }
    
    if (kind === 'dir') {
      try { rec.n = readdirSync(join(rootAbs, e.name), { withFileTypes: true }).length }
      catch { rec.n = null }                              
    }
    entries.push(rec)
  }
  
  const missing = allow.filter(a => !entries.some(x => x.rel === a))
  return {
    ok: true, entries, missing, others, truncated,
    limits: [
      '決められた 名前の ものだけ 返します（それ以外は 数だけ）',
      '中身は 1バイトも 返しません',
      '直下だけ 見ます（深い ところは 数えません）',
      'リンクは 辿りません',
    ],
  }
}


export function planLayoutFix(current, { want = [], aliases = [] } = {}) {
  if (!current || !Array.isArray(current.entries)) {
    return { ok: false, reason: '🔴 引数の 形が 違います（測れませんでした）' }
  }
  if (!Array.isArray(want) || !Array.isArray(aliases)) {
    return { ok: false, reason: '🔴 引数の 形が 違います（測れませんでした）' }
  }
  const have = new Map(current.entries.map(e => [e.rel, e]))
  const steps = []
  const notes = []
  let order = 0

  
  const moved = new Set()
  for (const a of aliases) {
    if (!a?.from || !a?.to) { notes.push('🟡 対応表の 形が 違うので 飛ばしました'); continue }
    if (!have.has(a.from)) continue                       
    if (have.has(a.to)) {                                 
      notes.push(`🔴 ${a.from} と ${a.to} が 両方 在ります（動かしません）`); continue
    }
    steps.push({ op: 'move', from: a.from, to: a.to, order: ++order })
    moved.add(a.to)
  }

  
  
  const mk = []
  for (const w of want) {
    const rel = typeof w === 'string' ? w : w?.rel
    const kind = typeof w === 'string' ? 'dir' : (w?.kind || 'dir')
    if (!rel) { notes.push('🟡 あるべき ものの 形が 違うので 飛ばしました'); continue }
    if (have.has(rel) || moved.has(rel)) continue
    if (kind !== 'dir') { notes.push(`🟡 ${rel} は ここでは 作りません（フォルダだけ 作ります）`); continue }
    mk.push({ op: 'mkdir', rel, order: 0 })
  }
  
  const out = []
  let n = 0
  for (const s of mk) out.push({ ...s, order: ++n })
  for (const s of steps) out.push({ ...s, order: ++n })

  
  for (const a of aliases) {
    if (!out.some(s => s.op === 'move' && s.from === a.from)) continue
    for (const rel of (a.rewriteIn || [])) {
      out.push({
        op: 'rewrite', rel,
        find: a.findText ?? a.from, replace: a.replaceText ?? a.to,
        
        order: ++n,
      })
    }
  }

  
  for (const w of want) {
    const rel = typeof w === 'string' ? w : w?.rel
    if (rel && have.has(rel) && !out.some(s => s.rel === rel || s.to === rel)) {
      out.push({ op: 'keep', rel })
    }
  }

  return {
    ok: true, steps: out, notes,
    limits: [
      '別の 名前かどうかは 対応表だけで 決めます（形からは 推測しません）',
      'フォルダだけ 作ります（ファイルは 作りません）',
      '両方 在るときは 動かしません（上書きしません）',
      'expect は 入って いません（数を 測ってから 呼ぶ側が 入れて ください）',
    ],
  }
}


export function countUnknownIds(rels, { agentRoot, known = [], pattern = /\b\d{17,20}\b/g, maxBytes = 4 * 1024 * 1024 } = {}) {
  if (!Array.isArray(rels)) return { ok: false, reason: '🔴 引数の 形が 違います（測れませんでした）' }
  if (!agentRoot) return { ok: false, reason: '🔴 大元が 渡されて いません（cwd は 使いません）' }
  if (!Array.isArray(known)) return { ok: false, reason: '🔴 引数の 形が 違います（測れませんでした）' }
  const rootAbs = resolve(agentRoot)
  const knownSet = new Set(known.map(String))
  const out = []
  for (const rel of rels) {
    if (typeof rel !== 'string' || !rel) { out.push({ rel, total: null, known: null, unknown: null, why: '🔴 引数の 形が 違います' }); continue }
    const p = resolve(join(rootAbs, rel))
    if (p !== rootAbs && !p.startsWith(rootAbs + sep)) { out.push({ rel, total: null, known: null, unknown: null, why: '🔴 この 操作の 対象では ありません' }); continue }
    
    try {
      const real = realpathSync(p), realRoot = realpathSync(rootAbs)
      if (real !== realRoot && !real.startsWith(realRoot + sep)) {
        out.push({ rel, total: null, known: null, unknown: null, why: '🔴 この 操作の 対象では ありません（実体が 外に 出ます）' }); continue
      }
    } catch {}
    let st
    try { st = lstatSync(p) }
    catch (e) { out.push({ rel, total: e.code === 'ENOENT' ? 0 : null, known: e.code === 'ENOENT' ? 0 : null, unknown: e.code === 'ENOENT' ? 0 : null, why: e.code === 'ENOENT' ? '🟡 在りません' : `🟡 読めません: ${e.code}` }); continue }
    if (st.isSymbolicLink()) { out.push({ rel, total: null, known: null, unknown: null, why: '🟡 リンクなので 数えません' }); continue }
    if (!st.isFile()) { out.push({ rel, total: null, known: null, unknown: null, why: '🟡 ファイルでは ありません' }); continue }
    if (st.size > maxBytes) { out.push({ rel, total: null, known: null, unknown: null, why: '🟡 大きいので 数えません' }); continue }
    let s
    try { s = readFileSync(p, 'utf8') } catch (e) { out.push({ rel, total: null, known: null, unknown: null, why: `🟡 読めません: ${e.code}` }); continue }
    const found = s.match(pattern) || []
    const uniq = [...new Set(found)]
    const k = uniq.filter(x => knownSet.has(x)).length
    out.push({ rel, total: uniq.length, known: k, unknown: uniq.length - k })
  }
  return { ok: true, results: out, limits: ['数だけ 返します（どの ID かは 返しません）', '17〜20桁の 数字を 数えます（別の 形は 数えません）'] }
}
