#!/bin/bash
# x402engine healthcheck — runs every 15 minutes via crontab
# Checks: /health, /.well-known/x402.json (3 networks), /health/deep (DB + MegaETH RPC)

set -euo pipefail

BASE_URL="https://x402engine.app"
LOG_DIR="$HOME/x402-gateway/logs"
ALERT_LOG="$LOG_DIR/healthcheck-alerts.log"
TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
FAILED=0

mkdir -p "$LOG_DIR"

log() { echo "[$TS] $1"; }
alert() {
  echo "[$TS] ALERT: $1" | tee -a "$ALERT_LOG"
  FAILED=1
}

# 1. Basic health
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$BASE_URL/health" 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "200" ]; then
  log "OK /health (${HTTP_CODE})"
else
  alert "/health returned ${HTTP_CODE}"
fi

# 2. Discovery — verify all 3 networks advertised
DISCOVERY=$(curl -s --max-time 10 "$BASE_URL/.well-known/x402.json" 2>/dev/null || echo "{}")
DISCOVERY_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$BASE_URL/.well-known/x402.json" 2>/dev/null || echo "000")

if [ "$DISCOVERY_CODE" = "200" ]; then
  log "OK /.well-known/x402.json (${DISCOVERY_CODE})"

  # Check each network is present
  for NET in base solana megaeth; do
    if echo "$DISCOVERY" | grep -q "\"$NET\""; then
      log "  OK network: $NET"
    else
      alert "/.well-known/x402.json missing network: $NET"
    fi
  done

  # Check service count > 0
  SVC_COUNT=$(echo "$DISCOVERY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('services',[])))" 2>/dev/null || echo "0")
  if [ "$SVC_COUNT" -gt 0 ]; then
    log "  OK services: $SVC_COUNT"
  else
    alert "/.well-known/x402.json has 0 services"
  fi
else
  alert "/.well-known/x402.json returned ${DISCOVERY_CODE}"
fi

# 3. Deep health — checks DB + MegaETH RPC (no auth = basic checks only)
DEEP=$(curl -s --max-time 15 "$BASE_URL/health/deep" 2>/dev/null || echo "{}")
DEEP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$BASE_URL/health/deep" 2>/dev/null || echo "000")

if [ "$DEEP_CODE" = "200" ]; then
  log "OK /health/deep (${DEEP_CODE})"
elif [ "$DEEP_CODE" = "503" ]; then
  # 503 = degraded — parse which checks failed
  DB_STATUS=$(echo "$DEEP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('checks',{}).get('database','unknown'))" 2>/dev/null || echo "unknown")
  MEGA_STATUS=$(echo "$DEEP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('checks',{}).get('megaethRpc','unknown'))" 2>/dev/null || echo "unknown")
  alert "/health/deep degraded — db=${DB_STATUS} megaeth=${MEGA_STATUS}"
else
  alert "/health/deep returned ${DEEP_CODE}"
fi

# Summary
if [ "$FAILED" = "0" ]; then
  log "ALL CHECKS PASSED"
else
  log "CHECKS FAILED — see $ALERT_LOG"
fi
