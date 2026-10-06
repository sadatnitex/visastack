#!/usr/bin/env bash
# Starts a throwaway local Postgres 16 for the load harness. Made-up data only.
# Usage: packages/load/scripts/start-postgres.sh [data-dir] [port]
# Prints the connection string on the last line. Stop with: pg_ctl -D <data-dir> stop
set -euo pipefail
DIR="${1:-${TMPDIR:-/tmp}/visastack-load-pg}"
PORT="${2:-5433}"
BIN="$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)"
if [ ! -d "$DIR" ]; then
  mkdir -p "$DIR"
  if [ "$(id -u)" = "0" ]; then
    id -u pgload >/dev/null 2>&1 || useradd -m pgload
    chown pgload "$DIR"
    su pgload -c "$BIN/initdb -D $DIR -A trust -U postgres >/dev/null"
  else
    "$BIN/initdb" -D "$DIR" -A trust -U postgres >/dev/null
  fi
fi
RUN() { if [ "$(id -u)" = "0" ]; then su pgload -c "$*"; else bash -c "$*"; fi; }
RUN "$BIN/pg_ctl -D $DIR -o '-p $PORT -c max_connections=200 -c listen_addresses=127.0.0.1 -c unix_socket_directories=$DIR' -l $DIR/server.log -w start" >/dev/null
echo "postgres://postgres@127.0.0.1:$PORT/postgres"
