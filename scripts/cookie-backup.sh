#!/usr/bin/env bash
# nhack-platinum v1.6.0 — Cookie backup (Mac/Linux)
#
#
# 設定（CLAUDE.md or ~/.cookie-persist.conf）:
#   chrome_user_data_dir: "~/Library/Application Support/Google/Chrome"  # 任意
#   cookie_backup_dir: "~/.nhack/cookie-backups"  # 任意
#   discord_webhook_url: "https://discord.com/api/webhooks/..."  # 任意
#

set -uo pipefail

readonly CONFIG_USER="${HOME}/.cookie-persist.conf"
readonly CONFIG_CLAUDE="${COOKIE_PERSIST_CLAUDE_MD:-${HOME}/CLAUDE.md}"
readonly LOG_FILE="${COOKIE_BACKUP_LOG:-/tmp/cookie-backup.log}"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG_FILE"
}

read_config_value() {
  local key="$1"
  local file="$2"
  [[ -f "$file" ]] || return 1
  local raw
  raw="$(grep -E "^[[:space:]]*${key}[[:space:]]*:" "$file" 2>/dev/null | head -1 | sed -E "s/^[[:space:]]*${key}[[:space:]]*:[[:space:]]*//; s/[[:space:]]*#.*$//; s/^[\"']//; s/[\"']$//")"
  [[ -n "$raw" ]] && printf '%s' "$raw"
}

config_get() {
  local key="$1"
  local default="${2:-}"
  local v
  v="$(read_config_value "$key" "$CONFIG_USER" 2>/dev/null)" || true
  if [[ -z "$v" ]]; then
    v="$(read_config_value "$key" "$CONFIG_CLAUDE" 2>/dev/null)" || true
  fi
  printf '%s' "${v:-$default}"
}

# ────────────────────────────────────────────
# ────────────────────────────────────────────
ENABLE="$(config_get 'enable_cookie_persist' 'false')"
if [[ "$ENABLE" != "true" ]]; then
  exit 0
fi

CHROME_PROFILE="$(config_get 'chrome_profile_name' 'Default')"
case "$(uname -s)" in
  Darwin) DEFAULT_USER_DATA_DIR="${HOME}/Library/Application Support/Google/Chrome" ;;
  Linux)  DEFAULT_USER_DATA_DIR="${HOME}/.config/google-chrome" ;;
  *)      log "ERROR: unsupported OS $(uname -s)"; exit 1 ;;
esac
CHROME_USER_DATA_DIR="$(config_get 'chrome_user_data_dir' "$DEFAULT_USER_DATA_DIR")"
BACKUP_DIR="$(config_get 'cookie_backup_dir' "${HOME}/.nhack/cookie-backups")"
KEEP_DAYS="$(config_get 'cookie_backup_keep_days' '7')"
DISCORD_WEBHOOK="$(config_get 'discord_webhook_url' '')"

CHROME_USER_DATA_DIR="${CHROME_USER_DATA_DIR/#\~/$HOME}"
BACKUP_DIR="${BACKUP_DIR/#\~/$HOME}"

COOKIE_FILE_NETWORK="${CHROME_USER_DATA_DIR}/${CHROME_PROFILE}/Network/Cookies"
COOKIE_FILE_LEGACY="${CHROME_USER_DATA_DIR}/${CHROME_PROFILE}/Cookies"
if [[ -f "$COOKIE_FILE_NETWORK" ]]; then
  SRC_COOKIE="$COOKIE_FILE_NETWORK"
elif [[ -f "$COOKIE_FILE_LEGACY" ]]; then
  SRC_COOKIE="$COOKIE_FILE_LEGACY"
else
  log "ERROR: Cookies file not found under '${CHROME_USER_DATA_DIR}/${CHROME_PROFILE}'"
  exit 1
fi

# ────────────────────────────────────────────
# 通知
# ────────────────────────────────────────────
notify_discord() {
  local message="$1"
  [[ -z "$DISCORD_WEBHOOK" ]] && return 0
  curl -sS -X POST -H 'Content-Type: application/json' \
    -d "$(printf '{"content": %s}' "$(printf '%s' "$message" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')")" \
    "$DISCORD_WEBHOOK" >> "$LOG_FILE" 2>&1 || log "WARN: discord webhook failed"
}

# ────────────────────────────────────────────
# ────────────────────────────────────────────
backup_cookies() {
  local date_tag="$1"
  local dest="${BACKUP_DIR}/${date_tag}-${CHROME_PROFILE}-Cookies"
  mkdir -p "$BACKUP_DIR" || { log "ERROR: mkdir failed: $BACKUP_DIR"; return 1; }

  if command -v sqlite3 >/dev/null 2>&1; then
    if sqlite3 "$SRC_COOKIE" ".backup '${dest}'" 2>>"$LOG_FILE"; then
      log "OK: sqlite3 hot backup → ${dest}"
    else
      log "WARN: sqlite3 .backup failed, falling back to cp"
      cp -p "$SRC_COOKIE" "$dest" || { log "ERROR: cp failed"; return 1; }
    fi
  else
    cp -p "$SRC_COOKIE" "$dest" || { log "ERROR: cp failed"; return 1; }
    log "OK: cp backup (sqlite3 unavailable) → ${dest}"
  fi

  if command -v sqlite3 >/dev/null 2>&1; then
    local check
    check="$(sqlite3 "$dest" 'PRAGMA integrity_check;' 2>>"$LOG_FILE" | head -1)"
    if [[ "$check" != "ok" ]]; then
      log "ERROR: integrity_check failed for ${dest}: ${check}"
      rm -f "$dest"
      return 1
    fi
  fi

  return 0
}

# ────────────────────────────────────────────
# ────────────────────────────────────────────
rotate_backups() {
  [[ -d "$BACKUP_DIR" ]] || return 0
  local removed=0
  while IFS= read -r -d '' f; do
    rm -f "$f" && removed=$((removed + 1))
  done < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name "*-${CHROME_PROFILE}-Cookies" -mtime +"$KEEP_DAYS" -print0 2>/dev/null)
  if (( removed > 0 )); then
    log "ROTATE: removed ${removed} backup(s) older than ${KEEP_DAYS} days"
  fi
}

# ────────────────────────────────────────────
# ────────────────────────────────────────────
main() {
  local date_tag
  date_tag="$(date '+%Y%m%d')"

  if backup_cookies "$date_tag"; then
    rotate_backups
    log "DONE: backup ok (profile=${CHROME_PROFILE}, date=${date_tag})"
    exit 0
  fi

  log "FAIL: backup failed (profile=${CHROME_PROFILE}, date=${date_tag})"
  notify_discord "🚨 [cookie-backup] バックアップ失敗 (profile=${CHROME_PROFILE}). ログ: ${LOG_FILE}"
  exit 1
}

main "$@"
