#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# verify-audit.sh — Post-audit verification script
# Run from repo root: bash verify-audit.sh
# ─────────────────────────────────────────────────────────────────────
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

PASS=0
FAIL=0
SKIP=0

log()  { echo -e "${CYAN}[$1]${NC} $2"; }
pass() { echo -e "  ${GREEN}✓${NC} $1"; PASS=$((PASS+1)); }
fail() { echo -e "  ${RED}✗${NC} $1"; FAIL=$((FAIL+1)); }
skip() { echo -e "  ${YELLOW}⊘${NC} $1 (skipped)"; SKIP=$((SKIP+1)); }
hr()   { echo -e "${CYAN}───────────────────────────────────────────────${NC}"; }

# ═════════════════════════════════════════════════════════════════════
#  STEP 1: Integration tests (419 expected)
# ═════════════════════════════════════════════════════════════════════
hr
log "STEP 1" "Running all 12 integration test suites"
hr

TOTAL_TESTS=0
TOTAL_FAILED=0

for batch in \
  pg-batch1-crud pg-batch2-medium pg-batch3-complex pg-batch4-reports \
  pg-batch5-tier4 pg-batch6-shopify pg-batch7-order-service pg-batch8-middleware \
  pg-batch9-audit-fixes pg-tenant-isolation pg-batch10-wave2 pg-batch11-admin; do

  echo -n "  Running $batch... "
  OUTPUT=$(cd backend && npx jest "tests/integration/${batch}.test.js" --no-coverage --forceExit 2>&1)
  TESTS=$(echo "$OUTPUT" | grep "Tests:" | head -1)
  PASSED=$(echo "$TESTS" | grep -oP '\d+ passed' | grep -oP '\d+' || echo "0")
  FAILED=$(echo "$TESTS" | grep -oP '\d+ failed' | grep -oP '\d+' || echo "0")

  TOTAL_TESTS=$((TOTAL_TESTS + PASSED + FAILED))
  TOTAL_FAILED=$((TOTAL_FAILED + FAILED))

  if [ "$FAILED" = "0" ] || [ -z "$FAILED" ]; then
    echo -e "${GREEN}${PASSED} passed${NC}"
  else
    echo -e "${RED}${FAILED} FAILED${NC} / ${PASSED} passed"
  fi
done

echo ""
if [ "$TOTAL_FAILED" = "0" ]; then
  pass "Integration tests: $TOTAL_TESTS passed, 0 failed"
else
  fail "Integration tests: $TOTAL_TESTS total, $TOTAL_FAILED FAILED"
fi

# ═════════════════════════════════════════════════════════════════════
#  STEP 2: Live E2E suite (specs 00-20)
# ═════════════════════════════════════════════════════════════════════
hr
log "STEP 2" "Running live E2E suite against sanopos.com"
hr

cd frontend
E2E_FAILED=0
for spec in $(seq -w 0 20); do
  FILE="tests/live/${spec}-*.spec.js"
  MATCH=$(ls $FILE 2>/dev/null || true)
  if [ -z "$MATCH" ]; then
    continue
  fi
  BASENAME=$(basename "$MATCH" .spec.js)
  echo -n "  Running $BASENAME... "
  OUTPUT=$(npx playwright test "$MATCH" --config=playwright.config.live.js 2>&1) || true
  if echo "$OUTPUT" | grep -q "passed"; then
    PCOUNT=$(echo "$OUTPUT" | grep -oP '\d+ passed' | grep -oP '\d+' || echo "?")
    echo -e "${GREEN}${PCOUNT} passed${NC}"
  else
    FCOUNT=$(echo "$OUTPUT" | grep -oP '\d+ failed' | grep -oP '\d+' || echo "?")
    echo -e "${RED}${FCOUNT} FAILED${NC}"
    E2E_FAILED=$((E2E_FAILED + 1))
  fi
done
cd ..

echo ""
if [ "$E2E_FAILED" = "0" ]; then
  pass "Live E2E suite: all specs passed"
else
  fail "Live E2E suite: $E2E_FAILED spec(s) failed"
fi

# ═════════════════════════════════════════════════════════════════════
#  STEP 3: Manual smoke test checklist
# ═════════════════════════════════════════════════════════════════════
hr
log "STEP 3" "Manual smoke test checklist"
hr
echo ""
echo "  Open https://sanopos.com and verify each item:"
echo ""
echo "  [ ] 1. Password reset — go to login, click Forgot Password,"
echo "         enter a username, check email for reset link"
echo ""
echo "  [ ] 2. Admin tax approval — go to /admin, navigate to Tax Rates,"
echo "         verify CRUD works (create, edit, delete a test rate)"
echo ""
echo "  [ ] 3. Printer settings — go to /settings/printer, verify page"
echo "         loads without sending x-employee-id: 1 in network tab"
echo ""
echo "  [ ] 4. Support ticket — click the ? button (bottom-right),"
echo "         submit a test ticket, verify it appears in /admin/support"
echo ""
echo "  [ ] 5. POS receipt reprint — make a sale, go to Sales History,"
echo "         click Reprint on a recent sale, verify receipt renders"
echo "         (should NOT open raw HTML in a popup)"
echo ""
echo "  [ ] 6. Security headers — open DevTools > Network, check any"
echo "         response from sanopos.com has X-Frame-Options: DENY and"
echo "         X-Content-Type-Options: nosniff"
echo ""
echo "  [ ] 7. Security headers (API) — check any response from"
echo "         api.sanopos.com has X-Content-Type-Options: nosniff"
echo "         and X-DNS-Prefetch-Control: off (helmet defaults)"
echo ""

# ═════════════════════════════════════════════════════════════════════
#  SUMMARY
# ═════════════════════════════════════════════════════════════════════
hr
log "SUMMARY" "Verification results"
hr
echo ""
echo -e "  ${GREEN}Passed:${NC}  $PASS"
echo -e "  ${RED}Failed:${NC}  $FAIL"
echo -e "  ${YELLOW}Skipped:${NC} $SKIP"
echo ""

if [ "$FAIL" = "0" ]; then
  echo -e "  ${GREEN}All automated checks passed.${NC}"
  echo "  Complete the manual smoke tests above, then merge the branch."
else
  echo -e "  ${RED}Some checks failed. Fix before merging.${NC}"
fi
echo ""
