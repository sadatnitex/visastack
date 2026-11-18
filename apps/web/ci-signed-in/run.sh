#!/usr/bin/env bash
# Signed-in guard: one run, the same on the CI machine and locally (docs/operations/ci-signed-in-guard.md).
# Run after `pnpm --filter @visastack/web build`, with a throwaway Postgres on 127.0.0.1 and an
# empty database named by DATABASE_URL (from any folder; it works in apps/web):
#   DATABASE_URL=postgres://postgres@127.0.0.1:5432/ci_signed_in bash apps/web/ci-signed-in/run.sh
# Starts the loopback sign-in stand-in, starts the unchanged production build against it, seeds
# the made-up people and runs the browser tests. Stops everything it started on exit.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -n "${VERCEL:-}" ]; then echo "The signed-in guard never runs on Vercel."; exit 1; fi
: "${DATABASE_URL:?DATABASE_URL must name an empty throwaway database on 127.0.0.1}"
PORT="${CI_SIGNED_IN_PORT:-3100}"
BRIDGE_PORT="${CI_DB_BRIDGE_PORT:-45432}"

# Something already on a port would be tested instead of this run's server.
port_free() { ! (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
for port in "$PORT" "$BRIDGE_PORT"; do
  if ! port_free "$port"; then echo "Port $port is already in use; stop that server first."; exit 1; fi
done

made_run_dir=no
if [ -n "${CI_SIGNED_IN_RUN_DIR:-}" ]; then
  RUN_DIR="$CI_SIGNED_IN_RUN_DIR"
else
  RUN_DIR="$(mktemp -d)"
  made_run_dir=yes
fi
mkdir -p "$RUN_DIR"
chmod 700 "$RUN_DIR"
export CI_SIGNED_IN_RUN_DIR="$RUN_DIR"

pids=()
cleanup() {
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  # The run's key and tokens are useless after it; a folder the caller named is theirs to keep.
  if [ "$made_run_dir" = yes ]; then rm -rf "$RUN_DIR"; fi
}
trap cleanup EXIT

show_logs() {
  echo "--- stand-in log ---"
  tail -40 "$RUN_DIR/stand-in.log" 2>/dev/null || true
  echo "--- app log (last 80 lines) ---"
  tail -80 "$RUN_DIR/next.log" 2>/dev/null || true
}

# 1. The stand-in sign-in service (loopback, fresh certificate and tokens for this run).
node ci-signed-in/stand-in-auth.mjs "$RUN_DIR" > "$RUN_DIR/stand-in.log" 2>&1 &
pids+=("$!")
for _ in $(seq 1 50); do [ -f "$RUN_DIR/stand-in.json" ] && break; sleep 0.2; done
if [ ! -f "$RUN_DIR/stand-in.json" ]; then show_logs; exit 1; fi
STAND_IN_URL="$(node -p "require(process.argv[1]).baseUrl" "$RUN_DIR/stand-in.json")"

# 2. The unchanged production build: sign-in goes to the stand-in, which only this process
#    trusts; the database driver goes through the loopback bridge (db-preload.cjs).
(
  export NODE_ENV=production
  export DEPLOYMENT_MODE=controlled_pilot
  export IDENTITY_PROVIDER=neon_auth
  export NEXT_TELEMETRY_DISABLED=1
  export NEON_AUTH_BASE_URL="$STAND_IN_URL"
  NEON_AUTH_COOKIE_SECRET="$(openssl rand -hex 32)"
  export NEON_AUTH_COOKIE_SECRET
  export NODE_EXTRA_CA_CERTS="$RUN_DIR/cert.pem"
  export CI_DB_PRELOAD_START=1
  export CI_DB_BRIDGE_PORT="$BRIDGE_PORT"
  export NODE_OPTIONS="--require ./ci-signed-in/db-preload.cjs"
  exec ./node_modules/.bin/next start -p "$PORT"
) > "$RUN_DIR/next.log" 2>&1 &
server_pid="$!"
pids+=("$server_pid")
ready=no
for _ in $(seq 1 60); do
  if ! kill -0 "$server_pid" 2>/dev/null; then echo "The app stopped while starting."; break; fi
  if ! port_free "$BRIDGE_PORT" && curl -sf -o /dev/null "http://localhost:$PORT/"; then
    ready=yes
    break
  fi
  sleep 2
done
if [ "$ready" != yes ]; then
  echo "The app did not start (or its database bridge did not open) within 120 seconds."
  show_logs
  exit 1
fi

# 3. Seed (global setup) and the browser tests.
status=0
PLAYWRIGHT_BASE_URL="http://localhost:$PORT" ./node_modules/.bin/playwright test \
  -c playwright.ci-signed-in.config.ts "$@" || status=$?
if [ "$status" -ne 0 ]; then show_logs; fi
exit "$status"
