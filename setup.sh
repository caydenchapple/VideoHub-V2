#!/bin/bash
# VideoHub setup for macOS: checks for Node.js, then runs scripts/setup-mac.mjs (see its header for the options).
#   ./setup.sh [--dry-run] [--yes] [--workspace <folder>] ...
cd "$(dirname "$0")" || exit 1
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:/opt/local/bin"
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  echo
  if command -v node >/dev/null 2>&1; then echo "Node.js is too old here (VideoHub needs version 22 or newer)."; else echo "Node.js is missing."; fi
  echo "VideoHub is a small program written for Node.js, so it cannot run without it."
  echo "Install it: open the Terminal app, paste this line and press Enter:"
  echo "    brew install node"
  echo "(No Homebrew? Get it first from https://brew.sh, or download Node from https://nodejs.org.)"
  echo "When it has finished, double-click SETUP.command again."
  exit 1
fi
exec node scripts/setup-mac.mjs "$@"
