









import fs from 'node:fs'
import path from 'node:path'
import { Refused } from './archive-safeguard.mjs'

const PART = 16 * 1024 * 1024      


export async function uploadArchive(a) {
  const { baseUrl, token, clientId, archiveId, backup, envelope } = a ?? {}
  const fetchImpl = a?.fetchImpl ?? globalThis.fetch
  if (!baseUrl) throw new Refused('UP_URL', '設定が足りません')
  if (!token) throw new Refused('UP_TOKEN', '設定が足りません')
  if (!clientId || !archiveId) throw new Refused('UP_ID', '引数が足りません')
  if (!backup || backup.verified !== true) {
    throw new Refused('UP_NOT_VERIFIED', '控えが揃っていません')
  }

  const file = a.file ?? backup.archive
  if (!fs.existsSync(file)) throw new Refused('UP_NO_FILE', '控えが見つかりません')

  
  const bytes = fs.statSync(file).size
  if (bytes < 1) throw new Refused('UP_EMPTY', '控えが空です')

  const H = { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' }
  const call = async (p, init) => {
    const res = await fetchImpl(`${baseUrl}${p}`, init)
    let body = null
    try { body = await res.json() } catch {  }
    return { status: res.status, body }
  }

  
  const beg = await call('/api/archive/begin', {
    method: 'POST', headers: H,
    body: JSON.stringify({
      clientId, archiveId,
      expected: { files: backup.files, bytes },
      envelope: envelope ? stripSecrets(envelope) : undefined,
    }),
  })
  if (beg.status === 409) throw new Refused('UP_DUPLICATE', 'この識別子はすでに使われています')
  if (beg.status !== 200) throw new Refused('UP_BEGIN', 'いま実行できません')
  const { key, uploadId } = beg.body
  const partSize = Number(beg.body.partSizeHint) || PART

  
  const parts = []
  const fd = fs.openSync(file, 'r')
  try {
    let off = 0, n = 1
    while (off < bytes) {
      const len = Math.min(partSize, bytes - off)
      const buf = Buffer.allocUnsafe(len)
      fs.readSync(fd, buf, 0, len, off)
      const r = await fetchImpl(
        `${baseUrl}/api/archive/part?key=${encodeURIComponent(key)}&uploadId=${encodeURIComponent(uploadId)}&partNumber=${n}`,
        { method: 'PUT', headers: { Authorization: `Bot ${token}` }, body: buf },
      )
      if (r.status !== 200) throw new Refused('UP_PART', '途中で止まりました')
      const rb = await r.json()
      parts.push({ partNumber: rb.partNumber, etag: rb.etag })
      off += len; n++
    }
  } finally { fs.closeSync(fd) }

  
  const fin = await call('/api/archive/complete', {
    method: 'POST', headers: H, body: JSON.stringify({ key, uploadId, parts }),
  })
  if (fin.status !== 200) {
    throw new Refused('UP_COMPLETE', '完了できませんでした')
  }

  
  const receipt = fin.body?.receipt
  if (!receipt) throw new Refused('UP_NO_RECEIPT', '確認できませんでした')
  if (receipt.bytes !== bytes) {
    throw new Refused('UP_BYTES_MISMATCH', '確認できませんでした')
  }
  if (receipt.files !== backup.files) {
    throw new Refused('UP_FILES_MISMATCH', '確認できませんでした')
  }

  return { ...receipt, parts: parts.length, verified: true }
}


function stripSecrets(env) {
  const { ctFile, ...rest } = env      
  return rest
}
