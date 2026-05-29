#!/usr/bin/env bash
# Stop services started by start.sh.
cd "$(dirname "$0")"

killed=0
for pidfile in .mediamtx.pid .portal.pid; do
  if [[ -f "$pidfile" ]]; then
    pid=$(cat "$pidfile")
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null && killed=$((killed+1))
    fi
    rm -f "$pidfile"
  fi
done

# Also tear down any orphans that didn't get pid-tracked (e.g. crashed scripts)
pkill -f "$(pwd)/portal/portal.py"   2>/dev/null && killed=$((killed+1)) || true
pkill -f "mediamtx mediamtx.yml"     2>/dev/null && killed=$((killed+1)) || true

if [[ $killed -gt 0 ]]; then
  echo "stopped $killed process(es)"
else
  echo "nothing was running"
fi
