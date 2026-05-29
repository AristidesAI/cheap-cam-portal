#!/usr/bin/env bash
# Render mediamtx.yml from mediamtx.template.yml using values from .env.
# Called by setup.sh, and safe to re-run any time you change .env.

set -e
cd "$(dirname "$0")"

if [[ ! -f .env ]]; then
  echo "No .env found. Run ./setup.sh first." >&2
  exit 1
fi

# shellcheck disable=SC1091
set -a; source .env; set +a

: "${CAM_IP:?CAM_IP missing in .env}"
: "${CAM_USER:?CAM_USER missing in .env}"
: "${CAM_PASS:?CAM_PASS missing in .env}"
: "${CAM_PORT:=8554}"
: "${CAM_PATH:=stream1}"
: "${WEBRTC_PORT:=8889}"

# Use python for the substitution so special chars in CAM_PASS survive intact.
/usr/bin/env python3 - <<PY
import os
mapping = {
  "CAM_IP":      os.environ["CAM_IP"],
  "CAM_USER":    os.environ["CAM_USER"],
  "CAM_PASS":    os.environ["CAM_PASS"],
  "CAM_PORT":    os.environ.get("CAM_PORT","8554"),
  "CAM_PATH":    os.environ.get("CAM_PATH","stream1"),
  "WEBRTC_PORT": os.environ.get("WEBRTC_PORT","8889"),
}
with open("mediamtx.template.yml") as f: tpl = f.read()
for k, v in mapping.items():
  tpl = tpl.replace("{{"+k+"}}", v)
with open("mediamtx.yml","w") as f: f.write(tpl)
print("wrote mediamtx.yml")
PY
