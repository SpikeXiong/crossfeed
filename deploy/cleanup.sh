#!/usr/bin/env bash
# Crossfeed · OpenCLI cleanup
# Usage: ./deploy/cleanup.sh [--yes]
#
# Deletes:
#   ~/.opencli                         (runtime, adapters, login cookies)
#   global npm package @jackwener/opencli
# Does not uninstall the Crossfeed service (that is ./deploy/install.sh --uninstall).
set -euo pipefail

YES=0
for arg in "$@"; do
  case "$arg" in
    --yes|-y|-Yes) YES=1 ;;
  esac
done

OPENCLI_HOME="${OPENCLI_HOME:-$HOME/.opencli}"

echo "Will remove:"
echo "  ${OPENCLI_HOME}"
echo "  global npm package @jackwener/opencli"
echo
if [[ "$YES" -ne 1 ]]; then
  printf 'Type YES to continue: '
  read -r ans
  if [[ "$ans" != "YES" ]]; then
    echo "Cancelled."
    exit 0
  fi
fi

if [[ -e "$OPENCLI_HOME" ]]; then
  echo "==> Removing ${OPENCLI_HOME}"
  # Symlink first (do not follow into a real package elsewhere)
  if [[ -L "$OPENCLI_HOME/node_modules/@jackwener/opencli" ]]; then
    rm -f "$OPENCLI_HOME/node_modules/@jackwener/opencli"
  fi
  rm -rf "$OPENCLI_HOME"
else
  echo "No ${OPENCLI_HOME}"
fi

if command -v npm >/dev/null 2>&1; then
  echo "==> npm uninstall -g @jackwener/opencli"
  npm uninstall -g --no-fund --no-audit @jackwener/opencli >/dev/null 2>&1 || \
    echo "global uninstall skipped (not installed or failed)"
else
  echo "npm not found; skipped global uninstall"
fi

if [[ -e "$OPENCLI_HOME" ]]; then
  echo "Still exists: ${OPENCLI_HOME}" >&2
  exit 1
fi

echo "OpenCLI user dir cleaned. Next: ./deploy/install.sh --opencli"
