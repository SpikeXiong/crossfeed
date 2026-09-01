#!/usr/bin/env bash
# Crossfeed · 启动脚本（macOS / Linux）
# 直接 ./start.sh，或双击运行
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

# 默认端口（与 deploy/install.sh 一致）
export CROSSFEED_PORT="${CROSSFEED_PORT:-4000}"
export CROSSFEED_HOST="${CROSSFEED_HOST:-0.0.0.0}"
export NODE_ENV="${NODE_ENV:-production}"

# OPENCLI_BIN 探测
if [[ -z "${CROSSFEED_OPENCLI_BIN:-}" ]]; then
  OPENCLI_HOME="${OPENCLI_HOME:-$HOME/.opencli}"
  for p in \
    "$OPENCLI_HOME/node_modules/@jackwener/opencli/dist/src/main.js" \
    "$OPENCLI_HOME/node_modules/@jackwener/opencli/dist/cli.js"; do
    if [[ -f "$p" ]]; then
      export CROSSFEED_OPENCLI_BIN="$p"
      break
    fi
  done
  if [[ -z "${CROSSFEED_OPENCLI_BIN:-}" ]] && command -v opencli >/dev/null 2>&1; then
    export CROSSFEED_OPENCLI_BIN="$(command -v opencli)"
  fi
fi

# data 目录
mkdir -p "$ROOT/data"

LOG_DIR="$ROOT/data"
LOG_FILE="$LOG_DIR/crossfeed.log"

echo "==============================================="
echo " Crossfeed · 本机信息流"
echo " 端口  : ${CROSSFEED_HOST}:${CROSSFEED_PORT}"
echo " 后端  : backend/dist/server.js"
echo " 日志  : $LOG_FILE"
echo " 停止  : Ctrl+C，或 pkill -f 'backend/dist/server.js'"
echo "==============================================="

exec node "$ROOT/backend/dist/server.js"
