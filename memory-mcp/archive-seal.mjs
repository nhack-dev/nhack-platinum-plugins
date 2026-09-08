













import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { Refused } from './archive-safeguard.mjs'





export const STREAM_FORMAT_VERSION = 2



export const STREAM_MODE = "detached"


export async function sealFile(a) {
  const { file, out, kekRaw, aad } = a ?? {}
  if (!file || !fs.existsSync(file)) throw new Refused('SF_NO_FILE', `元のファイルが在りません: ${file}`)
  if (!out || !path.isAbsolute(out)) throw new Refused('SF_OUT', '出力先が絶対パスではありません')
  if (!Buffer.isBuffer(kekRaw) || kekRaw.length !== 32) throw new Refused('SF_KEK', 'KEK が32バイトではありません')
  if (!aad || !aad.archiveId || !aad.kind) throw new Refused('SF_AAD', '引数が足りません')

  
  const dek = crypto.randomBytes(32)
  const iv = crypto.randomBytes(12)

  
  const cipher = crypto.createCipheriv('aes-256-gcm', dek, iv)
  cipher.setAAD(aadBytes(aad))
  await pipeline(fs.createReadStream(file), cipher, fs.createWriteStream(out))
  const authTag = cipher.getAuthTag()

  
  const wIv = crypto.randomBytes(12)
  const wrap = crypto.createCipheriv('aes-256-gcm', kekRaw, wIv)
  const wrappedDek = Buffer.concat([wrap.update(dek), wrap.final()])
  const wrapTag = wrap.getAuthTag()
  dek.fill(0)                                   

  return {
    v: STREAM_FORMAT_VERSION,
    mode: STREAM_MODE,
    ctFile: out,
    ctBytes: fs.statSync(out).size,
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    wrappedDek: wrappedDek.toString('base64'),
    wrapIv: wIv.toString('base64'),
    wrapTag: wrapTag.toString('base64'),
    aad,
  }
}


export async function openFile(a) {
  const { envelope, out, kekRaw, ctx, writeAudit } = a ?? {}
  if (!envelope || envelope.v !== STREAM_FORMAT_VERSION) {
    throw new Refused('OF_VERSION', 'この形式は扱えません')
  }
  
  if (envelope.mode !== STREAM_MODE) {
    throw new Refused('OF_MODE', `この口は ${STREAM_MODE} だけです: ${envelope.mode}`)
  }
  if (!Buffer.isBuffer(kekRaw) || kekRaw.length !== 32) throw new Refused('OF_KEK', 'KEK が32バイトではありません')
  if (!ctx || !['consult', 'restore'].includes(ctx.purpose)) {
    throw new Refused('OF_PURPOSE', `purpose は consult か restore だけです: ${ctx?.purpose}`)
  }
  if (!ctx.actor || !ctx.reason) throw new Refused('OF_CTX', 'actor と reason が要ります')
  if (typeof writeAudit !== 'function') throw new Refused('OF_NO_AUDIT', '監査を書く関数がありません')

  
  await writeAudit({ at: new Date().toISOString(), ...ctx, archiveId: envelope.aad?.archiveId, v: envelope.v })

  const wrap = crypto.createDecipheriv('aes-256-gcm', kekRaw, Buffer.from(envelope.wrapIv, 'base64'))
  wrap.setAuthTag(Buffer.from(envelope.wrapTag, 'base64'))
  let dek
  try { dek = Buffer.concat([wrap.update(Buffer.from(envelope.wrappedDek, 'base64')), wrap.final()]) }
  catch { throw new Refused('OF_UNWRAP', '鍵を開けませんでした（KEK が違うか、包みが壊れています）') }

  const dec = crypto.createDecipheriv('aes-256-gcm', dek, Buffer.from(envelope.iv, 'base64'))
  dec.setAAD(aadBytes(envelope.aad))
  dec.setAuthTag(Buffer.from(envelope.authTag, 'base64'))
  try { await pipeline(fs.createReadStream(envelope.ctFile), dec, fs.createWriteStream(out)) }
  catch { dek.fill(0); throw new Refused('OF_TAMPERED', '中身が書き換わっています（認証タグが合いません）') }
  dek.fill(0)
  return { out, bytes: fs.statSync(out).size }
}


function aadBytes(aad) {
  const sorted = Object.keys(aad).sort().reduce((o, k) => (o[k] = aad[k], o), {})
  return Buffer.from(JSON.stringify(sorted))
}
