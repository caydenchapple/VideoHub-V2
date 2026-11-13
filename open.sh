#!/bin/bash
# Opens VideoHub: starts the server if it is not running, then the VideoHub app (or the default browser when the app is not
# installed). "--server": just the server, no window (the login item runs this way). The server starts the render
# protection itself.
HUB="$(cd "$(dirname "$0")" && pwd)"
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:/opt/local/bin"
PORT="${VIDEOHUB_PORT:-$(sed -n 's/.*"port"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$HUB/data/config.json" 2>/dev/null | head -1)}"
PORT="${PORT:-7788}"
URL="http://127.0.0.1:$PORT"
alive() { curl -fs --max-time 1 "$URL/api/ping" >/dev/null 2>&1; }
if ! alive; then
  NODE="$(command -v node)"
  if [ -z "$NODE" ]; then
    osascript -e 'display dialog "Node.js was not found. Run SETUP.command in the VideoHub folder." buttons {"OK"} with icon caution' >/dev/null 2>&1
    exit 1
  fi
  mkdir -p "$HUB/data"
  (cd "$HUB" && nohup "$NODE" server/hub.js >>"$HUB/data/hub.log" 2>&1 &)
  for _ in $(seq 1 40); do alive && break; sleep 0.25; done
fi
[ "$1" = "--server" ] && exit 0
# the VideoHub app (Electron, made by setup.sh) when it is installed, else the default browser
for APP in "$HOME/Applications/VideoHub.app" /Applications/VideoHub.app; do
  if [ -f "$APP/Contents/Resources/app/hub.json" ]; then open "$APP"; exit 0; fi
done
open "$URL"
