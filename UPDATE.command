#!/bin/bash
# VideoHub update - double-click to copy this folder's code over the VideoHub installed on this Mac (settings and notes stay)
"$(dirname "$0")/update.sh" "$@"
echo
read -r -p "Press Enter to close this window. " _
