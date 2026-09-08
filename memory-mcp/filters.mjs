

const RE_META = /[.*+?^${}()|[\]\\]/g
const esc = (w) => String(w).replace(RE_META, '\\$&')


const DEFAULTS = Object.freeze({
  secret_ext: ['.pem', '.key', '.p12', '.pfx', '.jks', '.keystore', '.asc', '.gpg', '.ppk'],
  secret_name: ['.env', '.netrc', '.npmrc', '.git-credentials', '.pgpass', '.my.cnf',
    'kubeconfig', 'id_rsa', 'id_ed25519', 'id_ecdsa', 'id_dsa'],
  secret_word: ['secret', 'token', 'credential', 'password', 'passwd', 'apikey',
    'api_key', 'private_key', 'service_account', 'authorization', 'cookie', 'session'],
  secret_dir: ['.ssh', '.aws', '.docker', '.kube', '.gnupg'],
  skip_dirs: ['.git', 'node_modules'],
  
  secret_prefix: ['sk-', 'ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_', 'xoxb-', 'xoxa-',
    'xoxp-', 'xoxo-', 'xoxs-', 'xoxr-', 'eyJ'],
  secret_min_len: 16,
  media_ext: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg',
    '.mp4', '.mov', '.avi', '.mkv', '.webm', '.mp3', '.wav', '.m4a', '.flac',
    '.zip', '.tar', '.gz', '.7z', '.rar', '.pdf', '.psd', '.ai', '.sketch'],
  secret_text: ['BEGIN RSA PRIVATE KEY', 'BEGIN OPENSSH PRIVATE KEY',
    'BEGIN PRIVATE KEY', 'BEGIN EC PRIVATE KEY', 'BEGIN PGP PRIVATE KEY',
    'aws_secret_access_key', 'AWS_SECRET_ACCESS_KEY'],
  sendable_ext: ['.md', '.txt', '.json', '.jsonl', '.csv', '.yaml', '.yml',
    '.ts', '.js', '.mjs', '.py', '.sh'],
  max_scan_bytes: 2 * 1024 * 1024,
  
  
  
  
  media_magic: [
    { name: 'png', b: [0x89, 0x50, 0x4e, 0x47] },
    { name: 'jpeg', b: [0xff, 0xd8, 0xff] },
    { name: 'gif', b: [0x47, 0x49, 0x46, 0x38] },
    { name: 'bmp', b: [0x42, 0x4d] },
    { name: 'webp', b: [0x52, 0x49, 0x46, 0x46], at12: [0x57, 0x45, 0x42, 0x50] },
    { name: 'mp4', at4: [0x66, 0x74, 0x79, 0x70] },
    { name: 'matroska', b: [0x1a, 0x45, 0xdf, 0xa3] },
    { name: 'ogg', b: [0x4f, 0x67, 0x67, 0x53] },
    { name: 'mp3', b: [0x49, 0x44, 0x33] },
    { name: 'psd', b: [0x38, 0x42, 0x50, 0x53] },
  ],
})

let _f = { ...DEFAULTS }










const words = (v, fb) => {
  if (!Array.isArray(v)) return fb
  if (v.length === 0) return []   
  const out = v.filter((w) => typeof w === 'string' && w.length > 0 && w.length <= 200).slice(0, 500)
  return out.length > 0 ? out : fb   
}


export function setFilters(policy) {
  const f = policy?.filters
  if (!f || typeof f !== 'object' || Array.isArray(f)) { _f = { ...DEFAULTS }; return _f }
  const n = Number(f.max_scan_bytes)
  _f = {
    secret_ext: words(f.secret_ext, DEFAULTS.secret_ext),
    secret_name: words(f.secret_name, DEFAULTS.secret_name),
    secret_word: words(f.secret_word, DEFAULTS.secret_word),
    secret_dir: words(f.secret_dir, DEFAULTS.secret_dir),
    skip_dirs: words(f.skip_dirs, DEFAULTS.skip_dirs),
    secret_prefix: words(f.secret_prefix, DEFAULTS.secret_prefix),
    media_ext: words(f.media_ext, DEFAULTS.media_ext),
    secret_text: words(f.secret_text, DEFAULTS.secret_text),
    secret_min_len: Number.isFinite(Number(f.secret_min_len)) && Number(f.secret_min_len) >= 1
      ? Math.floor(Number(f.secret_min_len)) : DEFAULTS.secret_min_len,
    sendable_ext: words(f.sendable_ext, DEFAULTS.sendable_ext),
    
    
    max_scan_bytes: Number.isFinite(n) && n >= 0 && n <= 512 * 1024 * 1024
      ? Math.floor(n) : DEFAULTS.max_scan_bytes,
  }
  return _f
}

export function getFilters() { return _f }

const base = (p) => String(p).split(/[/\\]/).pop() || ''
const lower = (p) => String(p).toLowerCase()


export function isSecretExt(p) {
  const s = lower(p)
  return _f.secret_ext.some((e) => s.endsWith(lower(e)))
}


export function isSecretName(p) {
  const b = lower(base(p))
  return _f.secret_name.some((n) => { const x = lower(n); return b === x || b.startsWith(x + '.') })
}


export function hasSecretWord(p) {
  const s = lower(p)
  return _f.secret_word.some((w) => {
    const x = esc(lower(w))
    return new RegExp(`(^|[/._\\-])${x}([/._\\-]|$)`).test(s)
  })
}


export function inSecretDir(p) {
  const s = lower(p)
  return _f.secret_dir.some((d) => {
    const x = esc(lower(d))
    return new RegExp(`(^|/)${x}/`).test(s)
  })
}


export function isSecretPath(p) {
  return isSecretExt(p) || isSecretName(p) || hasSecretWord(p) || inSecretDir(p)
}


export function isSkipDir(name) {
  const b = lower(base(name))
  return _f.skip_dirs.some((d) => lower(d) === b)
}


export function isSendableExt(p) {
  const s = lower(p)
  return _f.sendable_ext.some((e) => s.endsWith(lower(e)))
}


export function maxScanBytes() { return _f.max_scan_bytes }


export function isSecretKeyName(k) {
  const s = lower(k)
  return _f.secret_word.some((w) => s.includes(lower(w)))
}


export function looksLikeSecretValue(v) {
  if (typeof v !== 'string' || v.length < _f.secret_min_len) return false
  return _f.secret_prefix.some((p) => {
    
    
    let i = v.indexOf(p)
    while (i >= 0) {
      const headOk = i === 0 || !/[A-Za-z0-9]/.test(v[i - 1])
      if (headOk && v.length - i >= _f.secret_min_len) return true
      i = v.indexOf(p, i + 1)
    }
    return false
  })
}


export function isMediaExt(p) {
  const s = lower(p)
  return _f.media_ext.some((e) => s.endsWith(lower(e)))
}


export function hasSecretText(text) {
  if (typeof text !== 'string' || text.length === 0) return false
  return _f.secret_text.some((w) => text.includes(w))
}


export function mediaMagic() {
  return DEFAULTS.media_magic
}
