


export const CATALOG = [
  { key: 'homebrew',      label: 'Homebrew',        via: 'curl' },
  { key: 'claude-code',   label: 'Claude Code',     via: 'curl' },
  { key: 'bun',           label: 'Bun',             via: 'curl' },
  { key: 'node',          label: 'Node',            via: 'brew' },
  { key: 'tmux',          label: 'tmux',            via: 'brew' },
  { key: 'nhack-platinum', label: 'プラグイン',        via: 'plugin' },
  { key: 'my-agent',      label: '作業の フォルダ',    via: 'mkdir' },
  { key: 'setup-only',    label: '準備用の フォルダ',   via: 'mkdir' },
  { key: 'dot-claude',    label: '設定の 置き場',      via: 'mkdir' },
]

const KNOWN = new Set(CATALOG.map(c => c.key))


export function planOffboard({ found }) {
  const out = { remove: [], unknown: [], note: null }
  if (!Array.isArray(found)) return { ...out, note: '一覧の 形が 違います' }
  for (const f of found) {
    const item = { key: f && f.key, path: f && f.path, deps: (f && f.deps) || 0 }
    if (!item.key || !KNOWN.has(item.key)) { out.unknown.push({ ...item, why: '一覧に ありません' }); continue }
    out.remove.push({ ...item, why: '一覧にあります' })
  }
  return out
}


export function renderPlan(plan) {
  const rows = []
  for (const r of plan.remove)  rows.push({ mark: '外す',   ...r })
  for (const u of plan.unknown) rows.push({ mark: '触らない', ...u })
  return rows
}
