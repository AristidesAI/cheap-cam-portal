#!/usr/bin/env bash
# Install launchd user agents so MediaMTX + the portal start automatically
# every time you log into your Mac.
# Run as your regular user (no sudo). Reverse with ./uninstall-autostart.sh.

set -e
cd "$(dirname "$0")"
INSTALL_DIR="$(pwd)"
LA_DIR="$HOME/Library/LaunchAgents"

if [[ ! -f mediamtx.yml ]]; then
  echo "Run ./setup.sh first." >&2
  exit 1
fi

# Resolve binaries
MEDIAMTX_BIN=$(command -v mediamtx || true)
[[ -z "$MEDIAMTX_BIN" && -x /opt/homebrew/opt/mediamtx/bin/mediamtx ]] && MEDIAMTX_BIN=/opt/homebrew/opt/mediamtx/bin/mediamtx
[[ -z "$MEDIAMTX_BIN" && -x /usr/local/opt/mediamtx/bin/mediamtx ]] && MEDIAMTX_BIN=/usr/local/opt/mediamtx/bin/mediamtx
[[ -z "$MEDIAMTX_BIN" ]] && { echo "mediamtx binary not found" >&2; exit 1; }

PYTHON_BIN=$(command -v python3 || true)
[[ -z "$PYTHON_BIN" && -x /opt/homebrew/bin/python3 ]] && PYTHON_BIN=/opt/homebrew/bin/python3
[[ -z "$PYTHON_BIN" ]] && { echo "python3 not found" >&2; exit 1; }

mkdir -p "$LA_DIR" "$INSTALL_DIR/logs"

render() {
  local tpl="$1" dst="$2"
  sed -e "s|{{INSTALL_DIR}}|$INSTALL_DIR|g" \
      -e "s|{{MEDIAMTX_BIN}}|$MEDIAMTX_BIN|g" \
      -e "s|{{PYTHON_BIN}}|$PYTHON_BIN|g" \
      "$tpl" > "$dst"
}

# Stop any manual instances first to avoid port conflicts
./stop.sh >/dev/null 2>&1 || true

# Render and load
render launchd/com.cheapcamportal.mediamtx.plist.template \
       "$LA_DIR/com.cheapcamportal.mediamtx.plist"
render launchd/com.cheapcamportal.portal.plist.template \
       "$LA_DIR/com.cheapcamportal.portal.plist"

# Unload first in case they were already loaded
launchctl bootout "gui/$(id -u)/com.cheapcamportal.mediamtx" 2>/dev/null || true
launchctl bootout "gui/$(id -u)/com.cheapcamportal.portal"   2>/dev/null || true
# Load
launchctl bootstrap "gui/$(id -u)" "$LA_DIR/com.cheapcamportal.mediamtx.plist"
launchctl bootstrap "gui/$(id -u)" "$LA_DIR/com.cheapcamportal.portal.plist"

echo "Installed launch agents:"
echo "  $LA_DIR/com.cheapcamportal.mediamtx.plist"
echo "  $LA_DIR/com.cheapcamportal.portal.plist"
echo
echo "They will start every time you log in."
echo "Logs: $INSTALL_DIR/logs/"
echo "Open: http://127.0.0.1:8888/"
echo "To remove: ./uninstall-autostart.sh"
