#!/usr/bin/env bash
# nhack-platinum v1.6.0 — CDP watchdog (Mac/Linux)
#
# 設定（CLAUDE.md or ~/.cdp-watchdog.conf）:
#   chrome_user_data_dir: "~/Library/Application Support/Google/Chrome"  # 任意
#

set -uo pipefail

readonly CONFIG_USER="${HOME}/.cdp-watchdog.conf"
readonly CONFIG_CLAUDE="${CDP_WATCHDOG_CLAUDE_MD:-${HOME}/CLAUDE.md}"
readonly LOG_FILE="${CDP_WATCHDOG_LOG:-/tmp/cdp-watchdog.log}"
readonly FAIL_COUNT_FILE="${CDP_WATCHDOG_FAIL_COUNT:-/tmp/cdp-watchdog-fail-count}"
readonly CRITICAL_THRESHOLD=3

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG_FILE"
}

# ────────────────────────────────────────────
# ────────────────────────────────────────────
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
ENABLE="$(config_get 'enable_cdp_watchdog' 'false')"
if [[ "$ENABLE" != "true" ]]; then
  exit 0
fi

CDP_PORT="$(config_get 'cdp_port' '18801')"
CHROME_PROFILE="$(config_get 'chrome_profile_name' 'Default')"
CHROME_USER_DATA_DIR="$(config_get 'chrome_user_data_dir' "${HOME}/Library/Application Support/Google/Chrome")"
DISCORD_WEBHOOK="$(config_get 'discord_webhook_url' '')"

CHROME_USER_DATA_DIR="${CHROME_USER_DATA_DIR/#\~/$HOME}"

# OS判定（Mac/Linux）
case "$(uname -s)" in
  Darwin) CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ;;
  Linux)  CHROME_BIN="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)" ;;
  *)      log "ERROR: unsupported OS $(uname -s)"; exit 1 ;;
esac

if [[ ! -x "$CHROME_BIN" && "$(uname -s)" == "Darwin" ]]; then
  log "ERROR: Chrome not found at $CHROME_BIN"
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
# 死活確認
# ────────────────────────────────────────────
check_cdp_alive() {
  curl -sS --max-time 5 "http://localhost:${CDP_PORT}/json/version" >/dev/null 2>&1
}

# ────────────────────────────────────────────
# 復旧
# ────────────────────────────────────────────
restart_chrome() {
  log "RESTART: killing existing Chrome processes (CDP port ${CDP_PORT})"

  if pgrep -f -- "--remote-debugging-port=${CDP_PORT}" >/dev/null 2>&1; then
    pkill -f -- "--remote-debugging-port=${CDP_PORT}" 2>/dev/null || true
    sleep 2
    if pgrep -f -- "--remote-debugging-port=${CDP_PORT}" >/dev/null 2>&1; then
      pkill -9 -f -- "--remote-debugging-port=${CDP_PORT}" 2>/dev/null || true
    fi
  fi
  sleep 3

  log "RESTART: launching Chrome with profile='${CHROME_PROFILE}' port=${CDP_PORT}"
  nohup "$CHROME_BIN" \
    --remote-debugging-port="$CDP_PORT" \
    --remote-allow-origins='*' \
    --user-data-dir="$CHROME_USER_DATA_DIR" \
    --profile-directory="$CHROME_PROFILE" \
    >> "$LOG_FILE" 2>&1 &

  local i
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    sleep 1
    if check_cdp_alive; then
      log "RESTART: success after ${i}s"
      return 0
    fi
  done
  log "RESTART: failed (CDP not responding after 15s)"
  return 1
}

# ────────────────────────────────────────────
# ────────────────────────────────────────────
main() {
  if check_cdp_alive; then
    if [[ -f "$FAIL_COUNT_FILE" ]]; then
      rm -f "$FAIL_COUNT_FILE"
      log "OK: CDP alive (recovered, counter reset)"
    fi
    exit 0
  fi

  # 失敗
  local fail_count=0
  if [[ -f "$FAIL_COUNT_FILE" ]]; then
    fail_count="$(cat "$FAIL_COUNT_FILE" 2>/dev/null || echo 0)"
  fi
  fail_count=$((fail_count + 1))
  printf '%d' "$fail_count" > "$FAIL_COUNT_FILE"

  log "DOWN: CDP port ${CDP_PORT} not responding (consecutive failures: ${fail_count})"

  if restart_chrome; then
    notify_discord "✅ [cdp-watchdog] CDP復旧完了 (port ${CDP_PORT}). 投稿リトライ可能。"
    rm -f "$FAIL_COUNT_FILE"
    exit 0
  fi

  # 復旧失敗
  if (( fail_count >= CRITICAL_THRESHOLD )); then
    notify_discord "🚨 [cdp-watchdog] CRITICAL: CDP復旧失敗が${fail_count}回連続 (port ${CDP_PORT}). 手動対応必要。ログ: ${LOG_FILE}"
  else
    notify_discord "⚠️ [cdp-watchdog] CDP復旧失敗 ${fail_count}/${CRITICAL_THRESHOLD} (port ${CDP_PORT})"
  fi
  exit 1
}

main "$@"
