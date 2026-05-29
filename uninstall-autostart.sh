#!/usr/bin/env bash
# Remove the launchd auto-start agents installed by install-autostart.sh.
set -e
cd "$(dirname "$0")"
LA_DIR="$HOME/Library/LaunchAgents"
UID_=$(id -u)

for label in com.cheapcamportal.mediamtx com.cheapcamportal.portal; do
  launchctl bootout "gui/$UID_/$label" 2>/dev/null && echo "stopped $label" || echo "$label was not running"
  rm -f "$LA_DIR/$label.plist" && echo "removed $LA_DIR/$label.plist" || true
done

echo
echo "Auto-start disabled. Services will not restart on next login."
echo "(Right now they remain stopped. Run ./start.sh to bring them back this session.)"
