#!/bin/bash
# VideoHub update for macOS: copies this folder's code over an existing VideoHub install on this Mac.
# Keeps the Mac's own data (data/: settings, render queue, caches) and every project's notes; nothing is deleted.
#   ./update.sh [--target <VideoHub folder>] [--no-skill] [--dry-run]
# (With git you can simply `git pull` inside the install instead, then run ./setup.sh again.)
SRC="$(cd "$(dirname "$0")" && pwd)"
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:/opt/local/bin"
TARGET=""; NOSKILL=0; DRY=0
while [ $# -gt 0 ]; do case "$1" in
  --target) TARGET="$2"; shift 2;; --no-skill) NOSKILL=1; shift;; --dry-run) DRY=1; shift;; *) echo "Unknown option: $1"; exit 2;; esac; done
say() { printf '%s\n' "$1"; }
say "== VideoHub update"
# 1. the installed VideoHub: given, or where the VideoHub app points
if [ -z "$TARGET" ]; then
  for HJ in "$HOME/Applications/VideoHub.app/Contents/Resources/app/hub.json" "/Applications/VideoHub.app/Contents/Resources/app/hub.json"; do
    [ -z "$TARGET" ] && [ -f "$HJ" ] && TARGET="$(/usr/bin/plutil -extract hubDir raw -o - "$HJ" 2>/dev/null)"
  done
  [ -z "$TARGET" ] && [ -f "$HOME/Desktop/VideoHub/server/hub.js" ] && TARGET="$HOME/Desktop/VideoHub"
fi
if [ -z "$TARGET" ] || [ ! -f "$TARGET/server/hub.js" ]; then echo "No installed VideoHub found. For a first install use ./setup.sh (or: ./update.sh --target <VideoHub folder>)."; exit 1; fi
TARGET="$(cd "$TARGET" && pwd)"
[ "$TARGET" = "$SRC" ] && { say "This folder is the installed VideoHub; nothing to update."; exit 0; }
say "Installed VideoHub: $TARGET"
# 2. not while something renders or cleans (the hub would be stopped under it)
PORT="$(sed -n 's/.*"port"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$TARGET/data/config.json" 2>/dev/null | head -1)"; PORT="${PORT:-7788}"
if curl -fs --max-time 2 "http://127.0.0.1:$PORT/api/ping" >/dev/null 2>&1; then
  BUSY="$(curl -fs --max-time 5 "http://127.0.0.1:$PORT/api/jobs" | grep -o '"state":"\(running\|queued\)"' | wc -l | tr -d ' ')"
  if [ "${BUSY:-0}" -gt 0 ]; then say "$BUSY render(s) running or queued. Run this again when they are done; nothing was changed."; exit 2; fi
  if curl -fs --max-time 5 "http://127.0.0.1:$PORT/api/disk/clean" | grep -q '"state":"running"'; then say "A cleanup is running. Run this again when it is done; nothing was changed."; exit 2; fi
fi
# 3. stop this install's hub (only node processes running <Target>/server/hub.js)
ITEMS="server ui electron templates skill claude examples engine-hooks docs scripts CLAUDE.md README.md LICENSE SETUP.cmd UPDATE.cmd SETUP.command OPEN.command UPDATE.command update.ps1 setup.ps1 uninstall.ps1 open.ps1 open.vbs setup.sh open.sh update.sh uninstall.sh package.json package-lock.json"
STAMP="$(date +%Y%m%d-%H%M%S)"; BAK="$TARGET/data/update-backup/$STAMP"
if [ $DRY = 1 ]; then say "  [dry run] would: stop the VideoHub server, back up the replaced code to $BAK and copy: $ITEMS"; exit 0; fi
for pid in $(pgrep -f "$TARGET/server/hub.js"); do kill "$pid" 2>/dev/null && say "VideoHub server stopped (pid $pid)"; done; sleep 0.8
# 4. backup of the code being replaced, then copy (adds and replaces; files only the old version had are left alone)
LOCK_OLD="$(shasum "$TARGET/package-lock.json" 2>/dev/null | cut -d' ' -f1)"
mkdir -p "$BAK"; N=0
for it in $ITEMS; do
  [ -e "$SRC/$it" ] || continue
  [ -e "$TARGET/$it" ] && { mkdir -p "$BAK/$it"; if [ -d "$TARGET/$it" ]; then rsync -a --exclude=/node_modules "$TARGET/$it/" "$BAK/$it/"; else rmdir "$BAK/$it"; cp -p "$TARGET/$it" "$BAK/$it"; fi; }
  mkdir -p "$(dirname "$TARGET/$it")"
  if [ -d "$SRC/$it" ]; then rsync -a --exclude=/node_modules --exclude=/hub.json --exclude=/build "$SRC/$it/" "$TARGET/$it/"; else cp -p "$SRC/$it" "$TARGET/$it"; fi
  N=$((N+1))
done
say "$N items copied (the old code is in $BAK)"
# 5. packages only when they changed
LOCK_NEW="$(shasum "$TARGET/package-lock.json" 2>/dev/null | cut -d' ' -f1)"
if [ "$LOCK_OLD" != "$LOCK_NEW" ] || [ ! -d "$TARGET/node_modules" ]; then (cd "$TARGET" && npm install --no-audit --no-fund --loglevel=error) && say "Packages updated" || { say "npm install failed"; exit 1; }; else say "Packages unchanged"; fi
# 6. the skill Claude reads (with the install's path filled in)
if [ $NOSKILL = 0 ] && [ -d "$HOME/.claude/skills/videohub" ]; then
  (cd "$TARGET" && node -e '
const fs=require("fs"),path=require("path"),hub=process.argv[1],dir=path.join(require("os").homedir(),".claude","skills","videohub");
const mac=t=>t.replace(/\{\{VIDEOHUB_DIR\}\}((?:\\[\w.-]+)+)/g,(_,r)=>hub+r.replace(/\\/g,"/")).replaceAll("{{VIDEOHUB_DIR}}",hub).replace(/<workspace>\\(\w+)(\\<[\w-]+>)?/g,(_,a,b)=>"<workspace>/"+a+(b?b.replace("\\","/"):"")).replace(/C:\\\\path\\\\to\\\\film/g,"/path/to/film");
for(const f of fs.readdirSync(path.join(hub,"skill","videohub")))fs.writeFileSync(path.join(dir,f),mac(fs.readFileSync(path.join(hub,"skill","videohub",f),"utf8")));' "$TARGET") && say "Skill updated"
fi
say ""
say "== Done. Open VideoHub with the Desktop icon (the server starts again with the new code)."
say "Claude sessions that are already open see the new hub_* tools after they restart them."
