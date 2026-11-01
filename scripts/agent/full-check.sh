#!/bin/bash
# Full local check, the same steps CI runs plus the browser and smoke checks.
# usage: PORT=3101 bash scripts/agent/full-check.sh <worktree> <logdir>
#        FROM=build PORT=3101 bash scripts/agent/full-check.sh <worktree> <logdir>   (resume)
# Read only <logdir>/summary.txt (one line per step, ends with DONE, or STALE/FAILED lines that
# say why the run cannot be trusted). Run it in the foreground of one background command, so the
# caller is told when it ends or dies; never two at once on the same port.
#
# Guards, each learned from a wasted run:
# - the port: anything still listening on it (found through /proc/net/tcp, so a detached
#   `next-server` whose command line names no port is found too) is a leftover Next server and is
#   stopped; anything else there aborts the run (never test against a stranger);
# - the server: the browser steps run only when the server answering on the port serves the
#   build this run just made (its BUILD_ID is in the page), and the server is always stopped
#   when the script exits, however it exits;
# - the code: the commit and the working tree are recorded at the start and checked at the end;
#   a change in between marks the run STALE (a helper edited files, or main was merged mid-run).
W=$1; L=$2; P=${PORT:-3100}; FROM=${FROM:-install}
mkdir -p "$L"; cd "$W" || exit 9
SP=
cleanup(){ [ -n "$SP" ] && kill "$SP" 2>/dev/null; wait "$SP" 2>/dev/null; }
trap cleanup EXIT
tree_id(){ printf '%s %s' "$(git rev-parse HEAD)" "$(git status --porcelain | sha1sum | cut -c1-12)"; }
START_TREE=$(tree_id)
if [ "$FROM" = install ]; then : > "$L/summary.txt"; else echo "resumed from $FROM at $(git rev-parse --short HEAD)" >> "$L/summary.txt"; fi
echo "tree $START_TREE" >> "$L/summary.txt"
step(){ n=$1; shift; s=$(date +%s); "$@" > "$L/$n.log" 2>&1; r=$?; echo "$n exit=$r $(( $(date +%s)-s ))s" >> "$L/summary.txt"; return $r; }
order="install audit lint typecheck test webtest build"
run=0; for s in $order; do [ "$s" = "$FROM" ] && run=1; [ $run = 1 ] && eval "do_$s=1"; done
[ -n "$do_install" ] && step install pnpm install --frozen-lockfile
[ -n "$do_audit" ] && step audit pnpm audit --prod --audit-level high
[ -n "$do_lint" ] && step lint pnpm run lint
[ -n "$do_typecheck" ] && step typecheck pnpm run typecheck
[ -n "$do_test" ] && step test pnpm run test
[ -n "$do_webtest" ] && step webtest bash -c 'cd apps/web && ./node_modules/.bin/vitest run'
step build pnpm --filter @visastack/web build || { echo DONE >> "$L/summary.txt"; exit 1; }
step supplychain node scripts/supply-chain/scan.mjs --no-skips --json "$L/supply-chain.json"

# Free the port: only an earlier Next server may be stopped.
# Who listens on the port, read from the kernel's own table (lsof cannot see every process here):
# the socket inode of the LISTEN row for this port, then the process holding that inode.
port_pids(){
  hex=$(printf '%04X' "$1")
  inodes=$(awk -v h=":$hex" '$2 ~ h"$" && $4 == "0A" {print $10}' /proc/net/tcp /proc/net/tcp6 2>/dev/null)
  for ino in $inodes; do
    for fd in /proc/[0-9]*/fd/*; do
      [ "$(readlink "$fd" 2>/dev/null)" = "socket:[$ino]" ] && echo "$fd" | cut -d/ -f3
    done
  done | sort -u
}
for pid in $(port_pids "$P"); do
  cmd=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null)
  case "$cmd" in
    *next-server*|*"next start"*|*next/dist/bin/next*) kill "$pid"; echo "port $P: stopped leftover server $pid" >> "$L/summary.txt" ;;
    *) echo "FAILED port $P is held by another program ($cmd); not testing against it" >> "$L/summary.txt"; echo DONE >> "$L/summary.txt"; exit 4 ;;
  esac
done
for i in $(seq 1 20); do [ -z "$(port_pids "$P")" ] && break; sleep 1; done

cd apps/web
BUILD_ID=$(cat .next/BUILD_ID 2>/dev/null)
SECRET=$(od -An -tx1 -N32 /dev/urandom | tr -d " \n"); [ ${#SECRET} -eq 64 ] || { echo "secret bad" >> "$L/summary.txt"; exit 3; }
NODE_ENV=production DEPLOYMENT_MODE=controlled_pilot IDENTITY_PROVIDER=neon_auth NEON_AUTH_BASE_URL=https://auth.placeholder.invalid/neondb/auth NEON_AUTH_COOKIE_SECRET=$SECRET ./node_modules/.bin/next start -p "$P" > "$L/server.log" 2>&1 &
SP=$!
ours=
for i in $(seq 1 60); do
  kill -0 "$SP" 2>/dev/null || break
  if [ -n "$BUILD_ID" ] && curl -s "http://localhost:$P/status" | grep -qF -- "$BUILD_ID"; then ours=1; break; fi
  sleep 1
done
if [ -z "$ours" ]; then
  echo "FAILED server on port $P is not this build ($BUILD_ID); see server.log" >> "$L/summary.txt"
  echo DONE >> "$L/summary.txt"; exit 5
fi
echo "server ok build $BUILD_ID" >> "$L/summary.txt"
cat > "$L/pw.config.mjs" <<EOC
export default { testDir: '$W/apps/web/e2e', testMatch: ['**/ux-public*.spec.ts','**/browser-security*.spec.ts','**/no-secret-auth*.spec.ts'], workers: 2, timeout: 60000, reporter: 'line',
 use: { baseURL: 'http://localhost:$P', launchOptions: { executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] } } };
EOC
step playwright bash -c "cd '$W/apps/web' && PLAYWRIGHT_BASE_URL=http://localhost:$P BASE_URL=http://localhost:$P npx playwright test -c '$L/pw.config.mjs'"
step smoke bash -c "cd '$W' && SMOKE_BASE_URL=http://localhost:$P node apps/web/scripts/smoke.mjs"
cd "$W"
END_TREE=$(tree_id)
[ "$END_TREE" = "$START_TREE" ] || echo "STALE the code changed during the run (start $START_TREE, end $END_TREE); run again" >> "$L/summary.txt"
echo DONE >> "$L/summary.txt"
