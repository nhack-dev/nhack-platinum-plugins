

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeBackup } from './archive-backup.mjs'
import { sealFile } from './archive-seal.mjs'
import { uploadArchive } from './archive-upload.mjs'


export async function archiveNow(a) {
  const { root, clientId, archiveId, token, baseUrl, kekB64 } = a ?? {}
  if (!root || !clientId || !archiveId || !token || !baseUrl) {
    return { ok: false, why: '引数が足りません' }
  }

  
  let work = null
  try {
    work = fs.mkdtempSync(path.join(a.workDir ?? os.tmpdir(), 'na-'))

    
    let bk
    try {
      bk = makeBackup({ root, destDir: path.join(work, 'bk'), clientId })
    } catch (e) {
      return { ok: false, why: reason(e, '控えを作れませんでした') }
    }
    if (bk.verified !== true) return { ok: false, why: '控えが揃いませんでした' }

    
    let sendFile = bk.archive
    let envelope
    if (kekB64) {
      let kek
      try {
        kek = Buffer.from(String(kekB64), 'base64')
      } catch { return { ok: false, why: '鍵の形が正しくありません' } }
      if (kek.length !== 32) return { ok: false, why: '鍵の形が正しくありません' }
      try {
        envelope = await sealFile({
          file: bk.archive, out: path.join(work, 'sealed.bin'),
          kekRaw: kek, aad: { archiveId, kind: 'archive' },
        })
        sendFile = envelope.ctFile
      } catch (e) {
        return { ok: false, why: reason(e, '封をできませんでした') }
      } finally {
        kek.fill(0)                                   
      }
    }

    
    try {
      await uploadArchive({
        baseUrl, token, clientId, archiveId,
        backup: { ...bk, archive: sendFile }, file: sendFile,
        envelope, fetchImpl: a.fetchImpl,
      })
    } catch (e) {
      return { ok: false, why: reason(e, '完了できませんでした') }
    }

    return { ok: true }
  } catch (e) {
    return { ok: false, why: reason(e, 'いま実行できません') }
  } finally {
    
    if (work) { try { fs.rmSync(work, { recursive: true, force: true }) } catch {  } }
  }
}


function reason(e, fallback) {
  const m = String(e?.message ?? '')
  
  if (e?.name === 'Refused' && m.length > 0 && m.length <= 40) return m
  return fallback
}
