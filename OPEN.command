#!/bin/bash
# Opens VideoHub (double-click). The Desktop icon made by setup does the same without a Terminal window.
exec /bin/bash "$(dirname "$0")/open.sh" "$@"
