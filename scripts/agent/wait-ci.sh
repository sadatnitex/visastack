#!/bin/bash
# usage: bash scripts/agent/wait-ci.sh <FULL head sha>
# One background loop: waits until the three required checks complete or any fails. A short or
# mistyped SHA never matches; pass the full 40-character SHA.
SHA=$1
REQ=("Lint · Build · Typecheck · Test" "No-secret Playwright checks" "No-secret smoke check")
for i in $(seq 1 60); do
  OUT=$(gh api "repos/sadatnitex/visastack/commits/$SHA/check-runs?per_page=100" --jq '.check_runs[] | "\(.name)|\(.status)|\(.conclusion)"' 2>/dev/null)
  done=0; fail=0
  for r in "${REQ[@]}"; do
    line=$(echo "$OUT" | grep -F "$r|" | head -1)
    case "$line" in *"|completed|success") done=$((done+1));; *"|completed|"*) fail=1;; esac
  done
  if echo "$OUT" | grep -q "|completed|failure"; then fail=1; fi
  if [ $fail = 1 ] || [ $done = 3 ]; then echo "$OUT"; [ $fail = 1 ] && echo RESULT=FAIL || echo RESULT=GREEN; exit 0; fi
  sleep 60
done
echo "$OUT"; echo RESULT=TIMEOUT
