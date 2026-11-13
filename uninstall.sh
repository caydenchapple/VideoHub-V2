#!/bin/bash
# VideoHub uninstall for macOS (see scripts/uninstall-mac.mjs). ./uninstall.sh [--dry-run]
cd "$(dirname "$0")" || exit 1
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:/opt/local/bin"
exec node scripts/uninstall-mac.mjs "$@"
