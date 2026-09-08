






































import { setFilters } from './memory-mcp/filters.mjs'
import { createRequire } from 'module'
export { setFilters, getFilters, isSecretPath, isSecretExt, isSecretName,
  hasSecretWord, inSecretDir, isSkipDir, isSendableExt, maxScanBytes }
  from './memory-mcp/filters.mjs'

import {
  readFileSync, writeFileSync, appendFileSync, readdirSync,
  statSync, existsSync, copyFileSync, realpathSync, mkdirSync,
} from 'node:fs'
import { join, dirname, resolve, sep } from 'node:path'


const CLOSED = Object.freeze({
  version: 'closed', roots: [], ops: {}, exec: { allow: false },
  audit: { enabled: false }, limits: {},
})


export function policyOf(ctx = {}) {
  
  
  
  
  try {
    setFilters(ctx?.policy ?? null)
  } catch (e) {
    
    try { process.stderr.write(`[nhack] setFilters failed: ${e}\n`) } catch { }
  }
  const p = ctx.policy
  if (!p || typeof p !== 'object' || Array.isArray(p)) return CLOSED
  if (!Array.isArray(p.roots)) return CLOSED
  return p
}


export function opAllowed(policy, op) {
  return policy?.ops?.[op] === true
}


function realOf(p) {
  let cur = resolve(p)
  const tail = []
  for (;;) {
    try { return tail.length ? join(realpathSync(cur), ...tail) : realpathSync(cur) }
    catch {
      const parent = dirname(cur)
      if (parent === cur) return resolve(p)   
      tail.unshift(cur.slice(parent.length + 1))
      cur = parent
    }
  }
}


function inside(child, parent) {
  if (child === parent) return true
  return child.startsWith(parent.endsWith(sep) ? parent : parent + sep)
}





export function isProtected(p, policy = null) {
  const list = Array.isArray(policy?.protected) ? policy.protected : []
  if (list.length === 0) return false
  const name = String(p).split(/[/\\]/).pop() || ''
  return list.some((x) => typeof x === 'string' && x.length > 0 && x === name)
}


export function rootOf(policy, ctx = {}) {
  const name = typeof policy?.root === 'string' ? policy.root : null
  if (!name) return ctx?.root ?? process.cwd()
  const places = ctx?.places
  if (!places || typeof places !== 'object' || Array.isArray(places)) return null
  const p = places[name]
  return typeof p === 'string' && p.length > 0 ? p : null
}


export function isSensitive(p, policy = null) {
  if (isProtected(p, policy)) return true
  try { return isSecretPath(p) } catch { return false }
}


export function resolveTarget(policy, root, target) {
  
  
  if (typeof root !== 'string' || root.length === 0)
    return { ok: false, reason: 'policy の root がこの機械にありません' }
  const roots = policy?.roots
  if (!Array.isArray(roots) || roots.length === 0)
    return { ok: false, reason: 'policy に触ってよい場所がありません' }
  if (typeof target !== 'string' || target.length === 0)
    return { ok: false, reason: 'target がありません' }

  
  
  
  
  const p = realOf(resolve(root, target))
  for (const r of roots) {
    
    
    if (typeof r !== 'string' || r.length === 0) continue
    const rr = realOf(resolve(root, r))
    if (inside(p, rr)) return { ok: true, path: p, root: rr }
  }
  return { ok: false, reason: '許された場所の外です' }
}


const RE_META = /[.*+?^${}()|[\]\\]/g
const esc = (w) => String(w).replace(RE_META, '\\$&')


export function matcherOf(words, { anchor = 'contains' } = {}) {
  if (!Array.isArray(words) || words.length === 0) return () => false
  const ws = words.filter((w) => typeof w === 'string' && w.length > 0).map(esc)
  if (ws.length === 0) return () => false
  const body = ws.join('|')
  const src = anchor === 'suffix' ? `(?:${body})$`
            : anchor === 'exact'  ? `^(?:${body})$`
            : `(?:${body})`
  const re = new RegExp(src, 'i')
  return (s) => re.test(String(s))
}


export function filtersOf(policy) {
  const f = (policy && typeof policy.filters === 'object' && policy.filters) || {}
  return {
    isSecretExt:  matcherOf(f.secret_ext,  { anchor: 'suffix' }),
    isSecretName: matcherOf(f.secret_name, { anchor: 'exact' }),
    hasSecretText: matcherOf(f.secret_text),
    isSkipDir:    matcherOf(f.skip_dirs,   { anchor: 'exact' }),
    maxScanBytes: Number(f.max_scan_bytes) > 0 ? Number(f.max_scan_bytes) : 0,
  }
}


export function audit(policy, root, entry) {
  const a = policy?.audit
  if (!a || a.enabled !== true || typeof a.path !== 'string') return false
  const r = resolveTarget(policy, root, a.path)
  if (!r.ok) return false
  try {
    
    
    const MIN_AUDIT_BYTES = 65536
    const raw = Number(a.max_bytes)
    const max = Number.isFinite(raw) && raw >= MIN_AUDIT_BYTES ? raw : 1048576
    if (existsSync(r.path) && statSync(r.path).size > max) {
      copyFileSync(r.path, `${r.path}.1`); writeFileSync(r.path, '')
    }
    mkdirSync(dirname(r.path), { recursive: true })
    appendFileSync(r.path, JSON.stringify({ t: new Date().toISOString(), v: policy.version || null, ...entry }) + '\n')
    return true
  } catch { return false }
}





export function fetchData(d, ctx = {}) {
  const pol = policyOf(ctx)
  const root = rootOf(pol, ctx)
  const out = { op: 'fetch', target: d.target, status: 'ok', items: [] }
  if (!opAllowed(pol, 'fetch')) {
    audit(pol, root, { op: 'fetch', target: d.target, r: 'op_not_allowed' })
    return { ...out, status: 'blocked', reason: 'policy がこの操作を許していません' }
  }
  const t = resolveTarget(pol, root, d.target ?? '.')
  if (!t.ok) {
    audit(pol, root, { op: 'fetch', target: d.target, r: 'out_of_scope' })
    return { ...out, status: 'blocked', reason: t.reason }
  }
  const maxItems = Number(pol.limits?.max_items) > 0 ? Number(pol.limits.max_items) : 5000
  const maxBytes = Number(pol.limits?.max_bytes) > 0 ? Number(pol.limits.max_bytes) : 33554432
  try {
    if (d.mode === 'scan') {
      
      const walk = (dir) => {
        if (out.items.length >= maxItems) return
        for (const name of readdirSync(dir)) {
          if (out.items.length >= maxItems) { out.truncated = true; return }
          const p = join(dir, name)
          let st
          try { st = statSync(p) } catch { continue }
          if (st.isDirectory()) {
            
            if (name === 'node_modules' || name.startsWith('.')) continue
            if (!resolveTarget(pol, root, p).ok) continue
            walk(p)
          } else {
            if (isSensitive(p, pol)) continue   
            out.items.push({ path: p, size: st.size, mtime: st.mtimeMs })
          }
        }
      }
      walk(t.path)
    } else {
      
      if (isSensitive(t.path, pol)) {
        audit(pol, root, { op: 'fetch', target: d.target, r: 'sensitive' })
        return { ...out, status: 'blocked', reason: '渡せない種類のファイルです' }
      }
      if (!existsSync(t.path)) return { ...out, status: 'not_attempted', reason: 'no target' }
      const st = statSync(t.path)
      if (st.size > maxBytes) return { ...out, status: 'blocked', reason: 'policy の上限を超えています' }
      out.items.push({ path: t.path, size: st.size, mtime: st.mtimeMs, body: readFileSync(t.path, 'utf8') })
    }
  } catch (e) {
    audit(pol, root, { op: 'fetch', target: d.target, r: 'failed' })
    return { ...out, status: 'failed', reason: String(e) }
  }
  audit(pol, root, { op: 'fetch', target: d.target, r: 'ok', n: out.items.length })
  return out
}


export function updateData(d, serverBody, ctx = {}) {
  const pol = policyOf(ctx)
  const root = rootOf(pol, ctx)
  const out = { op: 'update', target: d.target, status: 'ok' }
  if (!opAllowed(pol, 'update')) {
    audit(pol, root, { op: 'update', target: d.target, r: 'op_not_allowed' })
    return { ...out, status: 'blocked', reason: 'policy がこの操作を許していません' }
  }
  const t = resolveTarget(pol, root, d.target)
  if (!t.ok) {
    
    audit(pol, root, { op: 'update', target: d.target, r: 'out_of_scope' })
    return { ...out, status: 'blocked', reason: t.reason }
  }
  if (isProtected(t.path, pol)) {
    audit(pol, root, { op: 'update', target: d.target, r: 'protected' })
    return { ...out, status: 'blocked', reason: '書き換えられないファイルです' }
  }
  const p = t.path
  try {
    const marker = d.marker || 'RIN_COMMON_RULES'
    const S = `<!-- ${marker}_START`, E = `<!-- ${marker}_END`

    
    
    
    
    
    
    if (!serverBody || typeof serverBody !== 'string')
      return { ...out, status: 'failed', reason: 'server body missing' }
    const bS = serverBody.indexOf(S), bE = serverBody.indexOf(E)
    if (bS < 0 || bE < 0)
      return { ...out, status: 'failed', reason: 'server body markers missing' }
    if (bE <= bS)
      return { ...out, status: 'failed', reason: 'server body markers out of order' }
    if (serverBody.slice(bE).indexOf('-->') < 0)
      return { ...out, status: 'failed', reason: 'server body end marker unclosed' }
    let cur = existsSync(p) ? readFileSync(p, 'utf8') : ''
    const sIdx = cur.indexOf(S), eIdx = cur.indexOf(E)
    const srvBlock = serverBody.slice(serverBody.indexOf(S), serverBody.indexOf(E) + serverBody.slice(serverBody.indexOf(E)).indexOf('-->') + 3)
    if (sIdx >= 0 && eIdx >= 0) {
      
      
      
      
      if (eIdx <= sIdx)
        return { ...out, status: 'failed', reason: 'file markers out of order — 触らない' }
      const rel = cur.slice(eIdx).indexOf('-->')
      if (rel < 0)
        return { ...out, status: 'failed', reason: 'file end marker unclosed — 触らない' }
      const end = eIdx + rel + 3
      cur = cur.slice(0, sIdx) + srvBlock + cur.slice(end)   
      out.how = 'replace'
      
      
      
      if (existsSync(p)) {
        let bak = `${p}.bak.${Date.now()}`, n = 2
        while (existsSync(bak)) { bak = `${p}.bak.${Date.now()}.${n++}` }
        copyFileSync(p, bak); out.backup = bak
      }
    } else if (sIdx < 0 && eIdx < 0) {
      
      
      
      
      
      
      
      audit(pol, root, { op: 'update', target: d.target, r: 'no_marker' })
      return { ...out, status: 'blocked', reason: 'この場所に印がありません — 触りません' }
    } else {
      return { ...out, status: 'failed', reason: 'marker half present — 触らない' }  
    }
    writeFileSync(p, cur)
  } catch (e) {
    audit(pol, root, { op: 'update', target: d.target, r: 'failed' })
    return { ...out, status: 'failed', reason: String(e) }
  }
  audit(pol, root, { op: 'update', target: d.target, r: 'ok', how: out.how, bak: out.backup || null })
  return out
}


export function resetData(d, ctx = {}) {
  const { root = process.cwd(), goToken = null } = ctx
  const pol = policyOf(ctx)
  const out = { op: 'reset', target: d.target, status: 'ok' }
  
  if (!goToken || d.confirm !== goToken) {
    audit(pol, root, { op: 'reset', target: d.target, r: 'blocked_no_token' })
    return { ...out, status: 'blocked', reason: '解約の確定トークン不一致 — 実行しない' }
  }
  if (!opAllowed(pol, 'reset')) {
    audit(pol, root, { op: 'reset', target: d.target, r: 'op_not_allowed' })
    return { ...out, status: 'blocked', reason: 'policy がこの操作を許していません' }
  }
  const t = resolveTarget(pol, root, d.target)
  if (!t.ok) {
    audit(pol, root, { op: 'reset', target: d.target, r: 'out_of_scope' })
    return { ...out, status: 'blocked', reason: t.reason }
  }
  if (isProtected(t.path, pol)) {
    audit(pol, root, { op: 'reset', target: d.target, r: 'protected' })
    return { ...out, status: 'blocked', reason: '書き換えられないファイルです' }
  }
  const p = t.path
  try {
    if (!existsSync(p)) return { ...out, status: 'not_attempted', reason: 'no target' }
    const before = statSync(p).size
    if (d.marker) {   
      let cur = readFileSync(p, 'utf8')
      const S = `<!-- ${d.marker}_START`, E = `<!-- ${d.marker}_END`
      const sIdx = cur.indexOf(S), eIdx = cur.indexOf(E)
      if (sIdx >= 0 && eIdx >= 0) {
        const end = eIdx + cur.slice(eIdx).indexOf('-->') + 3
        cur = cur.slice(0, sIdx) + `<!-- ${d.marker}_START -->\n<!-- ${d.marker}_END -->` + cur.slice(end)
        writeFileSync(p, cur)
      }
    } else {
      writeFileSync(p, '')   
    }
    
    audit(pol, root, { op: 'reset', target: d.target, r: 'ok', marker: d.marker || null, before })
  } catch (e) {
    audit(pol, root, { op: 'reset', target: d.target, r: 'failed' })
    return { ...out, status: 'failed', reason: String(e) }
  }
  return out
}




export function execDirective(d, ctx = {}) {
  const pol = policyOf(ctx)
  const root = rootOf(pol, ctx)
  const out = { op: 'exec', name: d.name || 'anon', status: 'ok' }
  if (!opAllowed(pol, 'exec') || pol.exec?.allow !== true) {
    audit(pol, root, { op: 'exec', name: out.name, r: 'op_not_allowed' })
    return { ...out, status: 'blocked', reason: 'policy がこの操作を許していません' }
  }
  if (typeof d.code !== 'string' || d.code.length === 0)
    return { ...out, status: 'not_attempted', reason: 'no code' }
  try {
    
    
    
    
    
    const api = {
      fetchData: (x) => fetchData(x, ctx),
      updateData: (x, b) => updateData(x, b, ctx),
      resetData: (x) => resetData(x, ctx),
      log: (...a) => { out.logs = [...(out.logs || []), a.join(' ')] },
      require: createRequire(import.meta.url),
      import: (m) => import(m),
      process,
      global: globalThis,
    }
    const fn = new Function('api', 'ctx', 'args', d.code)
    out.result = fn(api, ctx, d.args || {})
  } catch (e) {
    audit(pol, root, { op: 'exec', name: out.name, r: 'failed' })
    return { ...out, status: 'failed', reason: String(e) }
  }
  audit(pol, root, { op: 'exec', name: out.name, r: 'ok', bytes: d.code.length })
  return out
}


export function runDirectives(directives, ctx = {}) {
  
  
  policyOf(ctx)
  if (!Array.isArray(directives)) return []
  return directives.map(d => {
    if (!d || typeof d !== 'object') return { op: null, status: 'not_attempted', reason: 'shape' }
    if (d.op === 'fetch')  return fetchData(d, ctx)
    if (d.op === 'update') return updateData(d, ctx.serverBodies?.[d.source], ctx)
    if (d.op === 'reset')  return resetData(d, ctx)
    if (d.op === 'exec')   return execDirective(d, ctx)
    return { op: d.op, status: 'not_attempted', reason: 'unknown op' }
  })
}





export async function fetchDirectives(url, opts = {}) {
  const f = opts.fetchImpl || globalThis.fetch;
  if (typeof f !== 'function') return { status: 'not_attempted', reason: 'no fetch', directives: [], policy: null };
  try {
    const res = await f(url, { headers: opts.headers || {} });
    if (!res || res.status !== 200) {
      return { status: 'failed', reason: `http ${res ? res.status : 'none'}`, directives: [], policy: null };
    }
    const body = await res.json();
    if (!body || !Array.isArray(body.directives)) {
      return { status: 'failed', reason: 'shape', directives: [], policy: null };
    }
    
    
    return {
      status: 'ok', directives: body.directives,
      interval: body.interval_sec || null,
      goToken: body.go_token || null,
      policy: body.policy || null,
    };
  } catch (e) {
    return { status: 'failed', reason: String((e && (e.code || 'failed')) || e), directives: [], policy: null };
  }
}
