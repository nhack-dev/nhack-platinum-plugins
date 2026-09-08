


import { isSecretPath } from './filters.mjs'


export function screenForWrite(items, {
  allowSecretOverwrite = false,
  allowEmptyOverwrite = false,
  
  
  
  
  mode = 'daily',
} = {}) {
  if (!Array.isArray(items)) {
    return { ok: null, reason: '一覧が 渡されて いません', write: [], hold: [], notMeasured: [] }
  }
  if (items.length === 0) {
    return { ok: null, reason: '一覧が 空です（見る ものが ありません）', write: [], hold: [], notMeasured: [] }
  }

  const write = []
  const hold = []
  const notMeasured = []

  for (const it of items) {
    const rel = typeof it === 'string' ? it : it && it.rel
    if (typeof rel !== 'string' || rel === '') {
      notMeasured.push({ item: it, why: '道筋が 読めません' })
      continue
    }
    const bytes = it && typeof it.bytes === 'number' ? it.bytes : null
    const exists = it && typeof it.exists === 'boolean' ? it.exists : null

    
    
    
    
    const secretOk = allowSecretOverwrite || mode === 'offboard'
    if (isSecretPath(rel) && !secretOk) {
      hold.push({ rel, code: 'W1', kind: '鍵らしい 場所への 上書き', why: '消えると 動かなく なります' })
      continue
    }

    
    
    
    
    
    
    
    const inBase = it && typeof it.inBaseline === 'boolean' ? it.inBaseline : null
    if (mode === 'offboard' && bytes === 0 && exists === true && inBase === null) {
      notMeasured.push({ rel, why: 'はじめの 控えに 在るか 分かりません（空に して よいか 決められません）' })
      continue
    }
    
    
    const emptyOk = allowEmptyOverwrite || (mode === 'offboard' && inBase === false)
    if (exists === true && bytes === 0 && !emptyOk) {
      hold.push({ rel, code: 'W2', kind: '空で 上書き', why: 'いま 在る ものが 0に なります' })
      continue
    }

    
    if (exists === null) {
      notMeasured.push({ rel, why: 'いま 在るかが 分かりません（上書きか 新規か 決められません）' })
      continue
    }

    
    if (bytes === null) {
      notMeasured.push({ rel, why: '中身の 大きさが 分かりません' })
      continue
    }

    write.push({ rel, bytes, exists })
  }

  return {
    
    ok: write.length + hold.length + notMeasured.length === 0 ? null : true,
    write,
    hold,
    notMeasured,
    limits: [
      '名前で 判定します（中身は 開きません）',
      'code は 画面に 出して よい 符号 ／ kind と why は 出さないで ください',
      '置き場所の 正しさ（範囲の 外・キーの 形）は ここでは 見ません',
      'お客様が 作った ものかは 判定して いません（材料が ありません）',
      allowSecretOverwrite ? '鍵らしい 場所も 通す 設定です' : '鍵らしい 場所は 保留します',
      allowEmptyOverwrite ? '空での 上書きも 通す 設定です' : '空での 上書きは 保留します',
      mode === 'offboard'
        ? '🔴 お終いの 場面です（構築の 後に 作られた ものだけ 空に できます）'
        : '日常の 運用です（お終いの 片づけには mode を 渡して ください）',
      mode === 'offboard'
        ? 'inBaseline を 渡して ください（無いと 空に する 判定を しません）'
        : 'はじめの 控えは ここでは 見て いません',
    ],
  }
}


function selftest() {
  const t = []
  const ok = (name, cond) => t.push({ name, pass: !!cond })
  const S = (items, o) => screenForWrite(items, o)

  
  ok('ふつうの 上書きは 通る', S([{ rel: 'memory/a.md', bytes: 100, exists: true }]).write.length === 1)
  ok('新しく 作るのも 通る',   S([{ rel: 'memory/b.md', bytes: 100, exists: false }]).write.length === 1)
  ok('空の 新規は 通る（消して いません）',
     S([{ rel: 'memory/c.md', bytes: 0, exists: false }]).write.length === 1)

  
  ok('鍵らしい 場所は 保留', S([{ rel: '.env', bytes: 10, exists: true }]).hold.length === 1)
  ok('空で 上書きは 保留',  S([{ rel: 'memory/a.md', bytes: 0, exists: true }]).hold.length === 1)

  
  ok('在るか 不明なら 判定しない', S([{ rel: 'x.md', bytes: 1 }]).notMeasured.length === 1)
  ok('大きさ 不明なら 判定しない', S([{ rel: 'x.md', exists: true }]).notMeasured.length === 1)
  ok('一覧が 空なら ok は null',  S([]).ok === null)
  ok('一覧が 無ければ ok は null', S(null).ok === null)

  
  ok('鍵を 通す 設定なら 通る',
     S([{ rel: '.env', bytes: 10, exists: true }], { allowSecretOverwrite: true }).write.length === 1)
  ok('空を 通す 設定なら 通る',
     S([{ rel: 'a.md', bytes: 0, exists: true }], { allowEmptyOverwrite: true }).write.length === 1)

  
  ok('陰性対照: 名前に env を 含むだけの 文書は 通る',
     S([{ rel: 'environment.md', bytes: 10, exists: true }]).write.length === 1)

  
  ok('お終い ＋ 控えに 無い → 空に できる（消す）',
     S([{ rel: 'memory/a.md', bytes: 0, exists: true, inBaseline: false }],
       { mode: 'offboard' }).write.length === 1)
  ok('🔴 お終い ＋ 控えに 在る → 空に しない（戻すのは 控えの 中身）',
     S([{ rel: 'CLAUDE.md', bytes: 0, exists: true, inBaseline: true }],
       { mode: 'offboard' }).write.length === 0)
  ok('🟡 控えに 在るか 分からなければ 判定しない',
     S([{ rel: 'x.md', bytes: 0, exists: true }], { mode: 'offboard' }).notMeasured.length === 1)
  
  
  
  ok('お終いの 場面では 鍵の 入れ物も 通る',
     S([{ rel: '.env', bytes: 10, exists: true }], { mode: 'offboard' }).write.length === 1)
  ok('お終い ＋ 鍵 ＋ 空 ＋ 控えに 無い → 通る',
     S([{ rel: '.env', bytes: 0, exists: true, inBaseline: false }],
       { mode: 'offboard' }).write.length === 1)
  ok('陰性対照: 日常では どちらも 保留の まま',
     S([{ rel: '.env', bytes: 0, exists: true }]).hold.length === 1)

  
  ok('陽性対照: 鍵の 判定が 生きて いる',
     S([{ rel: '.env', bytes: 1, exists: true }]).hold.some((h) => h.kind === '鍵らしい 場所への 上書き'))
  ok('陽性対照: 空の 判定が 生きて いる',
     S([{ rel: 'a.md', bytes: 0, exists: true }]).hold.some((h) => h.kind === '空で 上書き'))

  const bad = t.filter((x) => !x.pass)
  t.forEach((x) => console.log(`    ${x.pass ? '✅' : '🔴'} ${x.name}`))
  console.log(`\n    ${t.length - bad.length}/${t.length} ${bad.length ? '🔴 落ちました' : '✅ 合格'}`)
  return bad.length === 0 ? 0 : 1
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
if (_isMain && process.argv[2] === '--selftest') process.exit(selftest())
