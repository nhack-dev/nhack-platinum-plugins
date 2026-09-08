




import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { collectFiles, assertCollectSafe, Refused, resolveDeep } from './archive-safeguard.mjs'


export function makeBackup(a) {
  const { root, destDir, clientId, maxFileBytes } = a ?? {}
  if (!root || !path.isAbsolute(root)) throw new Refused('BK_ROOT', '大元が絶対パスではありません')
  if (!destDir || !path.isAbsolute(destDir)) throw new Refused('BK_DEST', '控えの置き場が絶対パスではありません')
  if (!clientId) throw new Refused('BK_CLIENT', '識別子がありません')

  const realRoot = fs.realpathSync(root)
  
  const realDest = resolveDeep(destDir)   
  if (realDest === realRoot || realDest.startsWith(realRoot + path.sep)) {
    throw new Refused('BK_DEST_INSIDE', '控えの置き場が大元の中にあります')
  }
  fs.mkdirSync(destDir, { recursive: true })

  
  const found = collectFiles(realRoot, { maxFileBytes })
  assertCollectSafe(found)

  
  const listPath = path.join(destDir, `${clientId}-${stamp()}.list`)
  fs.writeFileSync(listPath, found.files.map(f => path.relative(realRoot, f)).join('\n') + '\n')
  const expected = { files: found.files.length, bytes: found.bytes }

  
  
  
  
  
  const archive = path.join(destDir, `${clientId}-${stamp()}.tar.zst`)
  try {
    execFileSync('sh', ['-c',
      `tar -C ${shq(realRoot)} --no-recursion -T ${shq(listPath)} -cf - | zstd -3 -q -T0 -o ${shq(archive)} -f`
    ], { stdio: ['ignore', 'ignore', 'pipe'] })
  } catch (e) {
    throw new Refused('BK_ARCHIVE_FAILED', '控えを作れませんでした')
  }

  
  const st = fs.statSync(archive)
  if (st.size < 1) throw new Refused('BK_EMPTY_ARCHIVE', '控えが空です')

  let inArchive
  try {
    
    const n = execFileSync('sh', ['-c',
      `zstd -d -q -c ${shq(archive)} | tar -tf - | grep -v '/$' | wc -l`
    ], { maxBuffer: 1024 }).toString().trim()
    inArchive = Number(n)
  } catch (e) {
    throw new Refused('BK_UNREADABLE', '控えを確認できませんでした')
  }
  if (inArchive !== expected.files) {
    throw new Refused('BK_COUNT_MISMATCH', '控えが揃いませんでした')
  }

  return {
    verified: true,                       
    clientId,
    archive,
    list: listPath,
    files: expected.files,
    bytes: st.size,                       
    sourceBytes: expected.bytes,
    md5: crypto.createHash('md5').update(fs.readFileSync(archive)).digest('hex'),
    skippedLinks: found.links.length,
    skippedOversize: found.oversize.length,
    at: new Date().toISOString(),
  }
}

function stamp() {
  
  return new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
}
function shq(s) { return `'${s.replace(/'/g, `'\\''`)}'` }
