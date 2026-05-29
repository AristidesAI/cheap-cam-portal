#!/usr/bin/env bash
# Start MediaMTX + the portal backend in the background.
# Idempotent: kills any previous run first.

set -e
cd "$(dirname "$0")"

if [[ ! -f mediamtx.yml ]]; then
  echo "No mediamtx.yml. Run ./setup.sh first." >&2
  exit 1
fi

# shellcheck disable=SC1091
set -a; source .env; set +a

mkdir -p logs

./stop.sh >/dev/null 2>&1 || true

# Locate binaries
MEDIAMTX_BIN=$(command -v mediamtx || true)
[[ -z "$MEDIAMTX_BIN" && -x /opt/homebrew/opt/mediamtx/bin/mediamtx ]] && MEDIAMTX_BIN=/opt/homebrew/opt/mediamtx/bin/mediamtx
[[ -z "$MEDIAMTX_BIN" && -x /usr/local/opt/mediamtx/bin/mediamtx ]] && MEDIAMTX_BIN=/usr/local/opt/mediamtx/bin/mediamtx
if [[ -z "$MEDIAMTX_BIN" ]]; then
  echo "mediamtx not found. Run ./setup.sh." >&2
  exit 1
fi

PY_BIN=$(command -v python3 || true)
[[ -z "$PY_BIN" && -x /opt/homebrew/bin/python3 ]] && PY_BIN=/opt/homebrew/bin/python3
[[ -z "$PY_BIN" ]] && { echo "python3 not found." >&2; exit 1; }

# Start mediamtx
nohup "$MEDIAMTX_BIN" mediamtx.yml > logs/mediamtx.log 2>&1 &
MEDIAMTX_PID=$!
echo $MEDIAMTX_PID > .mediamtx.pid

# Give mediamtx a moment to bind
sleep 1

# Start portal backend
nohup "$PY_BIN" portal/portal.py > logs/portal.log 2>&1 &
PORTAL_PID=$!
echo $PORTAL_PID > .portal.pid

# Wait briefly and check both still alive
sleep 1
if ! kill -0 "$MEDIAMTX_PID" 2>/dev/null; then
  echo "mediamtx crashed. See logs/mediamtx.log" >&2
  tail -20 logs/mediamtx.log >&2
  exit 1
fi
if ! kill -0 "$PORTAL_PID" 2>/dev/null; then
  echo "portal crashed. See logs/portal.log" >&2
  tail -20 logs/portal.log >&2
  exit 1
fi

echo "Started:"
echo "  mediamtx pid: $MEDIAMTX_PID  (log: logs/mediamtx.log)"
echo "  portal pid:   $PORTAL_PID  (log: logs/portal.log)"
echo "  open:         http://127.0.0.1:${HTTP_PORT:-8888}/"
