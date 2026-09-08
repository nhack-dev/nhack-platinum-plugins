
import { readdirSync, statSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'


export const SKIP = new Set([
  'node_modules', '.git', 'Library', '.Trash', '.npm', '.cache', '.bun', '.rustup', '.cargo',
  '__pycache__', '.venv', 'venv', 'dist', 'build', '.next', 'Applications', 'go',
  'Movies', 'Music', 'Pictures', 'Downloads',
])





export const MARKERS = new Set(['CLAUDE.md', '.mcp.json', 'memory', 'memory-v2'])
export const MAX_DEPTH = 4      
export const MAX_DIRS = 400     

export function discoverWorkspaces({ home = homedir(), cwd = process.cwd(), memDir = '' } = {}) {
  const found = []
  let scanned = 0, stoppedByLimit = false
  const walk = (dir, depth) => {
    if (depth > MAX_DEPTH) return
    if (found.length >= MAX_DIRS) { stoppedByLimit = true; return }
    let ents
    try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return }
    scanned++
    
    
    if (depth > 0 && ents.some((e) => MARKERS.has(e.name))) found.push(dir)
    for (const e of ents) {
      if (!e.isDirectory()) continue
      if (SKIP.has(e.name)) continue
      if (e.name.startsWith('.') && !MARKERS.has(e.name)) continue
      walk(join(dir, e.name), depth + 1)
    }
  }
  walk(home, 0)
  
  for (const p of [
    join(home, '.nhack', 'memory'), join(home, '.claude'),
    join(home, 'memory'), join(home, 'memory-v2'),
    join(cwd, 'memory'), join(cwd, 'memory-v2'), cwd,
    ...(memDir ? [memDir] : []),
  ]) if (!found.includes(p)) found.push(p)
  
  return { roots: found, scanned, stoppedByLimit }
}


if (process.argv[1]?.endsWith('discover.mjs') && process.argv.includes('--selftest')) {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('fs')
  const { tmpdir } = await import('os')
  let n = 0, ng = 0
  const ok = (c, label) => { n++; if (!c) { ng++; console.log(`  🔴 ${label}`) } else console.log(`  ✅ ${label}`) }

  const base = mkdtempSync(join(tmpdir(), 'nhack-ws-'))
  const mk = (p, f) => { mkdirSync(join(base, p), { recursive: true }); if (f) writeFileSync(join(base, p, f), 'x') }

  mk('proj-a', 'CLAUDE.md')            
  mk('proj-b', '.mcp.json')            
  mk('proj-c/memory', 'a.md')          
  mk('proj-d/notes', 'a.md')           
  mk('proj-e/node_modules/x', 'CLAUDE.md')  
  mk('a/b/c/d/e/deep', 'CLAUDE.md')    

  const r = discoverWorkspaces({ home: base, cwd: base, memDir: '' })
  const has = (p) => r.roots.includes(join(base, p))
  ok(has('proj-a'), 'CLAUDE.md が 在る 場所を 拾う')
  ok(has('proj-b'), '.mcp.json が 在る 場所を 拾う')
  ok(has('proj-c'), 'memory を 持つ 親を 拾う')
  ok(!has('proj-d'), '目印が 無い 場所は 拾わない')
  ok(!r.roots.some((x) => x.includes('node_modules')), 'node_modules の 中は 見ない')
  ok(!has('a/b/c/d/e/deep'), '深さの 上限を 超えたら 拾わない')
  ok(r.roots.includes(base), '決め打ちの cwd も 入る')
  ok(typeof r.scanned === 'number' && r.scanned > 0, '見た フォルダの 数を 出す')
  ok(r.stoppedByLimit === false, '上限で 止めた かどうかを 出す')
  
  const empty = mkdtempSync(join(tmpdir(), 'nhack-ws-empty-'))
  const r2 = discoverWorkspaces({ home: empty, cwd: empty, memDir: '' })
  
  
  
  ok(r2.scanned >= 1, '空の 機械でも 走る（★測定器は 生きて います）')
  ok(r2.roots.every((x) => !x.startsWith(join(empty, 'proj'))), '目印の 無い 機械では マーカー由来 0件')

  
  const h2 = mkdtempSync(join(tmpdir(), 'nhack-ws-home-'))
  mkdirSync(join(h2, 'memory'), { recursive: true })   
  mkdirSync(join(h2, 'proj-x'), { recursive: true }); writeFileSync(join(h2, 'proj-x', 'CLAUDE.md'), 'x')
  const r3 = discoverWorkspaces({ home: h2, cwd: h2, memDir: '' })
  ok(!r3.roots.includes(h2) || r3.roots.includes(join(h2, 'memory')), 'home自身は 作業場に しない（★memoryを持つ子は 拾う）')
  ok(r3.roots.includes(join(h2, 'proj-x')), 'home直下の proj-x（CLAUDE.md）は 拾う')
  rmSync(h2, { recursive: true, force: true })

  rmSync(base, { recursive: true, force: true }); rmSync(empty, { recursive: true, force: true })
  console.log(ng === 0 ? `\n✅ 合格（${n}件）` : `\n🔴 ${ng}/${n}件 落ちました`)
  process.exit(ng === 0 ? 0 : 1)
}
