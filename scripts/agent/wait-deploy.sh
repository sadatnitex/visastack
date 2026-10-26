#!/bin/bash
# usage: bash scripts/agent/wait-deploy.sh <FULL merge sha>
# After a merge: waits for the CI push run, Deploy Smoke, Playwright Deploy Smoke and the Live
# signed-in check (each also has skipped runs for other environments; the success one counts),
# then prints the Vercel status.
SHA=$1
for i in $(seq 1 40); do
  OUT=$(gh api "repos/sadatnitex/visastack/actions/runs?head_sha=$SHA&per_page=50" --jq '.workflow_runs[] | "\(.name)|\(.status)|\(.conclusion)"' 2>/dev/null | sort | uniq)
  ok=0; bad=0
  for n in "CI" "Deploy Smoke" "Playwright Deploy Smoke" "Live signed-in check"; do
    echo "$OUT" | grep -q "^$n|completed|success" && ok=$((ok+1))
    echo "$OUT" | grep -q "^$n|completed|failure" && bad=1
  done
  if [ $ok = 4 ] || [ $bad = 1 ]; then break; fi
  sleep 45
done
echo "$OUT"
VS=$(gh api "repos/sadatnitex/visastack/commits/$SHA/statuses" --jq '[.[] | select(.context|test("Vercel"))][0] | "\(.context)|\(.state)"' 2>/dev/null)
echo "VERCEL: $VS"
