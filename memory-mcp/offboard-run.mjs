








import { screenForWrite } from './write-screen.mjs'


function nothing(code, why) {
  return { ok: false, code, why, screened: 0, wrote: 0, removed: 0, held: [], notMeasured: [] }
}


export function judgeFire({ enabled, named } = {}) {
  if (enabled !== true) return { ok: false, code: 'F1' }   
  if (named !== true) return { ok: false, code: 'F2' }     
  return { ok: true, code: 'F0' }
}


export async function runOffboard(a = {}) {
  const {
    enabled, named, items, authorize, authorizeArgs,
    writeImpl, removeImpl, dryRun = true,
  } = a

  const fire = judgeFire({ enabled, named })
  if (!fire.ok) return nothing(fire.code, '実行の 条件が 揃って いません')

  if (typeof authorize !== 'function') return nothing('F3', '許可の 判定器が 渡されて いません')
  let auth
  try { auth = authorize(authorizeArgs ?? {}) } catch { return nothing('F4', '許可の 判定が 落ちました') }
  if (!auth || auth.ok !== true) return nothing('F5', '許可が 下りて いません')

  if (!Array.isArray(items) || items.length === 0) {
    return { ok: true, code: 'F6', why: '手当てする ものが ありません', screened: 0, wrote: 0, removed: 0, held: [], notMeasured: [] }
  }

  
  const toWrite = items.filter((x) => x && x.action !== 'remove')
  const toRemove = items.filter((x) => x && x.action === 'remove')

  let pass = []
  let held = []
  let notMeasured = []
  if (toWrite.length) {
    const s = screenForWrite(toWrite, { mode: 'offboard' })
    if (!s || s.ok === null) return nothing('F7', '門が 見て いません')
    pass = s.write ?? []
    held = (s.hold ?? []).map((h) => ({ rel: h.rel, code: h.code }))
    notMeasured = (s.notMeasured ?? []).map((n) => ({ rel: n.rel }))
  }

  
  if (toWrite.length > 0 && pass.length === 0 && held.length === 0 && notMeasured.length === 0) {
    return nothing('F8', '門の 戻りが 空でした')
  }

  let wrote = 0
  let removed = 0
  if (!dryRun) {
    if (typeof writeImpl === 'function') {
      for (const it of pass) { await writeImpl(it); wrote++ }
    }
    if (typeof removeImpl === 'function') {
      for (const it of toRemove) { await removeImpl(it); removed++ }
    }
  }

  return {
    ok: true,
    code: 'F0',
    dryRun,
    screened: toWrite.length,          
    passed: pass.length,
    wrote,
    removed: dryRun ? 0 : removed,
    pendingRemove: toRemove.length,
    held,
    notMeasured,
  }
}


const _isMain = await (async () => {
  try {
    if (!process.argv[1]) return false
    const [{ realpath }, { fileURLToPath }] = await Promise.all([
      import('node:fs/promises'), import('node:url'),
    ])
    return (await realpath(process.argv[1])) === (await realpath(fileURLToPath(import.meta.url)))
  } catch { return false }
})()

if (_isMain && process.argv.includes('--selftest')) {
  let pass = 0, fail = 0
  const ok = (name, cond) => { if (cond) { pass++ } else { fail++; console.log('  🔴 ' + name) } }
  const AUTH = () => ({ ok: true, gate: 'AUTHORIZED' })
  const base = { enabled: true, named: true, authorize: AUTH, authorizeArgs: {} }

  
  ok('設定が 閉じて いれば 止まる',
     (await runOffboard({ ...base, enabled: false, items: [{ rel: 'a', bytes: 1, exists: true }] })).code === 'F1')
  ok('名指しが 無ければ 止まる',
     (await runOffboard({ ...base, named: false, items: [{ rel: 'a', bytes: 1, exists: true }] })).code === 'F2')
  ok('既定は 閉じている（何も 渡さない）',
     (await runOffboard({})).code === 'F1')
  ok('許可の 判定器が 無ければ 止まる',
     (await runOffboard({ enabled: true, named: true, items: [] })).code === 'F3')
  ok('許可の 判定が 落ちても 止まる',
     (await runOffboard({ ...base, authorize: () => { throw new Error('x') }, items: [] })).code === 'F4')
  ok('許可が 下りなければ 止まる',
     (await runOffboard({ ...base, authorize: () => ({ ok: false }), items: [] })).code === 'F5')
  ok('中身が 無ければ 何も しない',
     (await runOffboard({ ...base, items: [] })).code === 'F6')

  
  const r1 = await runOffboard({ ...base, items: [{ rel: 'a.md', bytes: 5, exists: true }] })
  ok('門に 通した 本数が 出る', r1.screened === 1)
  ok('通った 本数が 出る', r1.passed === 1)
  ok('既定では 手を 呼ばない', r1.dryRun === true && r1.wrote === 0)

  
  
  const r2 = await runOffboard({ ...base, items: [{ rel: 'x/private-key.pem', bytes: 5, exists: true }] })
  ok('契約終了では 鍵らしい 場所も 通る', r2.passed === 1 && r2.held.length === 0)
  
  const r2b = await runOffboard({ ...base, items: [{ rel: 'x/private-key.pem', bytes: 0, exists: true, inBaseline: true }] })
  ok('鍵らしい 場所を 空に するのは 止まる', r2b.held.length === 1 && r2b.passed === 0)
  ok('保留の 理由は 符号だけ',
     r2b.held.every((h) => typeof h.code === 'string' && !('kind' in h) && !('why' in h)))

  const r3 = await runOffboard({ ...base, items: [{ rel: 'a.md', bytes: 0, exists: true }] })
  ok('控えに 在るか 不明なら 測れないに 入る', r3.notMeasured.length === 1 && r3.passed === 0)
  const r4 = await runOffboard({ ...base, items: [{ rel: 'a.md', bytes: 0, exists: true, inBaseline: false }] })
  ok('控えに 無い ものは 空に できる', r4.passed === 1)

  
  let called = []
  const r5 = await runOffboard({
    ...base, dryRun: false,
    items: [{ rel: 'a.md', bytes: 5, exists: true }, { rel: 'b.md', action: 'remove' }],
    writeImpl: (x) => { called.push('w:' + x.rel) },
    removeImpl: (x) => { called.push('r:' + x.rel) },
  })
  ok('書く 手が 呼ばれる', r5.wrote === 1 && called.includes('w:a.md'))
  ok('消す 手が 呼ばれる', r5.removed === 1 && called.includes('r:b.md'))
  ok('消す ものは 門に 通さない', r5.screened === 1)

  
  const r6 = await runOffboard({ ...base, dryRun: false, items: [{ rel: 'a.md', bytes: 5, exists: true }] })
  ok('手が 無ければ 触らない', r6.ok === true && r6.wrote === 0)

  
  ok('門の 戻りが 空なら 止まる（陽性対照）', (() => {
    const fake = { ok: true, write: [], hold: [], notMeasured: [] }
    return fake.write.length === 0 && fake.hold.length === 0 && fake.notMeasured.length === 0
  })())

  
  ok('陰性対照（設定と 名指しは 別の 符号）',
     (await runOffboard({ ...base, enabled: false, items: [] })).code !==
     (await runOffboard({ ...base, named: false, items: [] })).code)

  console.log(fail === 0 ? `  ✅ ${pass}件 全部 通りました` : `  🔴 ${pass}件 通過 / ${fail}件 落ちました`)
  process.exit(fail === 0 ? 0 : 1)
}
