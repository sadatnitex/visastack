#!/bin/bash
# Full local check, the same steps CI runs plus the browser and smoke checks.
# usage: PORT=3101 bash scripts/agent/full-check.sh <worktree> <logdir>
# Read only <logdir>/summary.txt (one line per step, ends with DONE). Run it once, in the
# background, after review fixes are in; never two at once on the same port.
W=$1; L=$2; mkdir -p $L; cd $W || exit 9
step(){ n=$1; shift; s=$(date +%s); "$@" > $L/$n.log 2>&1; r=$?; echo "$n exit=$r $(( $(date +%s)-s ))s" >> $L/summary.txt; return $r; }
: > $L/summary.txt
# A dependency added on main is invisible until installed: always install first.
step install pnpm install --frozen-lockfile
step audit pnpm audit --prod --audit-level high
step lint pnpm run lint
step typecheck pnpm run typecheck
step test pnpm run test
step webtest bash -c 'cd apps/web && ./node_modules/.bin/vitest run'
step build pnpm --filter @visastack/web build || { echo DONE >> $L/summary.txt; exit 1; }
step supplychain node scripts/supply-chain/scan.mjs --no-skips --json $L/supply-chain.json
cd apps/web
SECRET=$(od -An -tx1 -N32 /dev/urandom | tr -d " \n"); [ ${#SECRET} -eq 64 ] || { echo "secret bad" >> $L/summary.txt; exit 3; }
NODE_ENV=production DEPLOYMENT_MODE=controlled_pilot IDENTITY_PROVIDER=neon_auth NEON_AUTH_BASE_URL=https://auth.placeholder.invalid/neondb/auth NEON_AUTH_COOKIE_SECRET=$SECRET ./node_modules/.bin/next start -p ${PORT:-3100} > $L/server.log 2>&1 &
SP=$!
for i in $(seq 1 60); do curl -s -o /dev/null http://localhost:${PORT:-3100}/ && break; sleep 1; done
cat > $L/pw.config.mjs <<EOC
export default { testDir: '$W/apps/web/e2e', testMatch: ['**/ux-public*.spec.ts','**/browser-security*.spec.ts','**/no-secret-auth*.spec.ts'], workers: 2, timeout: 60000, reporter: 'line',
 use: { baseURL: 'http://localhost:${PORT:-3100}', launchOptions: { executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] } } };
EOC
step playwright bash -c "cd $W/apps/web && PLAYWRIGHT_BASE_URL=http://localhost:${PORT:-3100} BASE_URL=http://localhost:${PORT:-3100} npx playwright test -c $L/pw.config.mjs"
step smoke bash -c "cd $W && SMOKE_BASE_URL=http://localhost:${PORT:-3100} node apps/web/scripts/smoke.mjs"
kill $SP
echo DONE >> $L/summary.txt
