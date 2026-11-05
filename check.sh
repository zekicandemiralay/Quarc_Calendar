#!/usr/bin/env bash
# ============================================================
#  Quarc Calendar — Health check. Run from the project root:
#    bash check.sh
# ============================================================
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'
FAIL=0
ok()   { printf "  ${GREEN}✓${NC} %s\n" "$1"; }
warn() { printf "  ${YELLOW}⚠${NC} %s\n" "$1"; }
fail() { printf "  ${RED}✗${NC} %s\n" "$1"; FAIL=$((FAIL+1)); }

[ -f .env ] && { set -a; source .env 2>/dev/null; set +a; } || warn "No .env file found"
HTTPS_PORT=${HTTPS_PORT:-4005}
BASE="https://localhost:${HTTPS_PORT}"

printf "\n${BOLD}Quarc Calendar — diagnostic${NC}  $(date '+%Y-%m-%d %H:%M:%S')\n\n"
docker info &>/dev/null || { printf "  ${RED}✗ Docker not accessible (try sudo)${NC}\n"; exit 1; }

for svc in backend frontend; do
  CID=$(docker ps -q --filter "label=com.docker.compose.service=${svc}" | head -1)
  [ -n "$CID" ] && ok "$svc: running" || fail "$svc: not running"
done
docker ps -q --filter "name=quarc-auth" | grep -q . && ok "quarc-auth: running" || fail "quarc-auth: not running (see Quarc_Notes/auth/README.md)"

CODE=$(curl -sk -o /dev/null -w "%{http_code}" --max-time 5 "${BASE}/" || echo 0)
[ "$CODE" = "200" ] && ok "HTTPS :${HTTPS_PORT} serves the app" || fail "HTTPS :${HTTPS_PORT} returned ${CODE}"

CODE=$(curl -sk -o /dev/null -w "%{http_code}" --max-time 5 "${BASE}/api/health" || echo 0)
[ "$CODE" = "200" ] && ok "/api/health reachable through nginx" || fail "/api/health returned ${CODE}"

CODE=$(curl -sk -o /dev/null -w "%{http_code}" --max-time 5 "${BASE}/api/sync/pull" || echo 0)
[ "$CODE" = "401" ] && ok "sync endpoint requires login (401 when anonymous)" || fail "/api/sync/pull anonymous returned ${CODE} (expected 401)"

CODE=$(curl -sk -o /dev/null -w "%{http_code}" --max-time 5 "${BASE}/api/auth/me" || echo 0)
[ "$CODE" = "401" ] && ok "shared login reachable (/api/auth/me → 401 when anonymous)" || fail "/api/auth/me returned ${CODE} (expected 401)"

echo
[ "$FAIL" -eq 0 ] && printf "${GREEN}${BOLD}All checks passed.${NC}\n" || { printf "${RED}${BOLD}${FAIL} check(s) failed.${NC}\n"; exit 1; }
