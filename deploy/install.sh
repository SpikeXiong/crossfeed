#!/usr/bin/env bash
# Crossfeed 一键部署：OpenCLI + Adapter + 构建 + 本机用户服务
# 用法：
#   ./deploy/install.sh              全套
#   ./deploy/install.sh --opencli    只装 OpenCLI 和 Adapter
#   ./deploy/install.sh --uninstall  卸掉本机服务（不动 OpenCLI / 登录态）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

LABEL="com.crossfeed"
PORT="${PORT:-4000}"
HOST="${HOST:-0.0.0.0}"
OPENCLI_PKG="@jackwener/opencli"
CLIS_BUNDLE="$ROOT/deploy/opencli-clis"
OPENCLI_HOME="${OPENCLI_HOME:-$HOME/.opencli}"
OPENCLI_BIN=""

red() { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
dim() { printf '\033[90m%s\033[0m\n' "$*"; }

need() {
  command -v "$1" >/dev/null 2>&1 || {
    red "缺少 $1，请先安装后再跑这一步。"
    exit 1
  }
}

lan_ip() {
  local ip=""
  if command -v ipconfig >/dev/null 2>&1; then
    ip="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
  fi
  if [[ -z "$ip" ]] && command -v hostname >/dev/null 2>&1; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  fi
  printf '%s' "$ip"
}

chrome_ok() {
  [[ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]] && return 0
  command -v google-chrome >/dev/null 2>&1 && return 0
  command -v google-chrome-stable >/dev/null 2>&1 && return 0
  command -v chromium >/dev/null 2>&1 && return 0
  command -v chromium-browser >/dev/null 2>&1 && return 0
  return 1
}

resolve_opencli_bin() {
  local main cli
  main="$OPENCLI_HOME/node_modules/@jackwener/opencli/dist/src/main.js"
  cli="$OPENCLI_HOME/node_modules/@jackwener/opencli/dist/cli.js"
  if [[ -f "$main" ]]; then
    OPENCLI_BIN="$main"
  elif [[ -f "$cli" ]]; then
    OPENCLI_BIN="$cli"
  elif command -v opencli >/dev/null 2>&1; then
    OPENCLI_BIN="$(command -v opencli)"
  else
    OPENCLI_BIN=""
  fi
}

install_opencli_pkg() {
  mkdir -p "$OPENCLI_HOME"
  if [[ ! -f "$OPENCLI_HOME/package.json" ]]; then
    printf '%s\n' '{"name":"opencli-user-runtime","private":true,"type":"module"}' > "$OPENCLI_HOME/package.json"
  fi
  echo "==> 安装 ${OPENCLI_PKG} → ${OPENCLI_HOME}"
  (cd "$OPENCLI_HOME" && npm install --no-fund --no-audit "$OPENCLI_PKG")
  # 终端里也能直接打 opencli doctor；失败不挡（~/.opencli 里已有入口）
  npm install -g --no-fund --no-audit "$OPENCLI_PKG" >/dev/null 2>&1 || \
    dim "全局 npm 没装上 opencli 命令，不影响：后端会走 ${OPENCLI_HOME}"
}

sync_adapters() {
  if [[ ! -d "$CLIS_BUNDLE" ]]; then
    red "仓库里没有 ${CLIS_BUNDLE}，无法同步 Crossfeed Adapter。"
    exit 1
  fi
  echo "==> 同步 Adapter → ${OPENCLI_HOME}/clis"
  mkdir -p "$OPENCLI_HOME/clis"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a "$CLIS_BUNDLE/" "$OPENCLI_HOME/clis/"
  else
    cp -R "$CLIS_BUNDLE/." "$OPENCLI_HOME/clis/"
  fi
}

verify_opencli() {
  resolve_opencli_bin
  if [[ -z "$OPENCLI_BIN" ]]; then
    red "OpenCLI 装完后仍找不到入口。"
    exit 1
  fi
  echo "==> 探测 Adapter 列表"
  local out missing
  if [[ "$OPENCLI_BIN" == *.js ]]; then
    out="$("$NODE_BIN" "$OPENCLI_BIN" list -f json 2>/dev/null || true)"
  else
    out="$("$OPENCLI_BIN" list -f json 2>/dev/null || true)"
  fi
  if [[ -z "$out" ]]; then
    red "opencli list 没有输出。看：${OPENCLI_BIN}"
    exit 1
  fi
  local tmp
  tmp="$(mktemp)"
  printf '%s' "$out" > "$tmp"
  missing="$(python3 - "$tmp" <<'PY'
import json, sys
raw = "\n".join(
    l for l in open(sys.argv[1], encoding="utf-8").read().splitlines()
    if not l.startswith("(node:") and "Update available" not in l
).strip()
try:
    rows = json.loads(raw)
except Exception:
    print("PARSE_FAIL")
    raise SystemExit(0)
if not isinstance(rows, list):
    rows = []
have = {f"{x.get('site')}/{x.get('name') or x.get('command')}" for x in rows}
need = [
    "bilibili/hot", "weibo/feed", "zhihu/hot", "douyin/feed", "douyin/hot",
    "xiaohongshu/feed", "hackernews/top", "youtube/hot", "youtube/search",
    "twitter/timeline", "crossfeed/auth-scan",
]
print(" ".join(k for k in need if k not in have))
PY
)"
  rm -f "$tmp"
  if [[ "$missing" == *PARSE_FAIL* ]]; then
    dim "opencli list 不是 JSON，跳过命令核对。入口：${OPENCLI_BIN}"
  elif [[ -n "${missing// /}" ]]; then
    dim "还缺这些命令：${missing}"
    dim "官方包应自带 weibo/feed、twitter/timeline；其余应已从 deploy/opencli-clis 拷过去。"
  else
    green "OpenCLI 就绪：${OPENCLI_BIN}"
  fi
}

ensure_opencli() {
  need node
  need npm
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
  if [[ "$NODE_MAJOR" -lt 21 ]]; then
    red "OpenCLI 需要 Node ≥ 21（当前 $(node -v)）。"
    exit 1
  fi
  NODE_BIN="$(command -v node)"
  NODE_DIR="$(cd "$(dirname "$NODE_BIN")" && pwd)"
  PATH_VALUE="${NODE_DIR}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

  if chrome_ok; then
    green "已找到 Chrome。"
  else
    dim "没找到 Chrome。B 站 / 小红书 / 抖音 / YouTube / X 会抓不到；Hacker News 仍可用。"
  fi

  resolve_opencli_bin
  if [[ -z "$OPENCLI_BIN" || "${OPENCLI_UPDATE:-}" == "1" ]]; then
    install_opencli_pkg
  else
    dim "OpenCLI 已在：${OPENCLI_BIN}（要升级设 OPENCLI_UPDATE=1）"
  fi
  sync_adapters
  verify_opencli
}

uninstall_macos() {
  local uid plist
  uid="$(id -u)"
  plist="$HOME/Library/LaunchAgents/${LABEL}.plist"
  launchctl bootout "gui/${uid}/${LABEL}" 2>/dev/null || \
    launchctl unload "$plist" 2>/dev/null || true
  rm -f "$plist"
}

uninstall_linux() {
  systemctl --user disable --now crossfeed.service 2>/dev/null || true
  rm -f "$HOME/.config/systemd/user/crossfeed.service"
  systemctl --user daemon-reload 2>/dev/null || true
}

do_uninstall() {
  case "$(uname -s)" in
    Darwin) uninstall_macos ;;
    Linux) uninstall_linux ;;
    *) red "未支持的系统：$(uname -s)"; exit 1 ;;
  esac
  green "已卸载本机服务。OpenCLI 和 ~/.opencli 登录态还在。"
}

if [[ "${1:-}" == "--uninstall" || "${1:-}" == "uninstall" ]]; then
  do_uninstall
  exit 0
fi

if [[ "${1:-}" == "--opencli" || "${1:-}" == "opencli" ]]; then
  ensure_opencli
  exit 0
fi

ensure_opencli

echo "==> npm install"
npm install

echo "==> 构建前后端"
npm run build

if [[ ! -f frontend/dist/index.html ]]; then
  red "frontend/dist/index.html 不存在，构建失败。"
  exit 1
fi

mkdir -p "$ROOT/data"

wait_health() {
  local i
  for i in $(seq 1 40); do
    if curl -sf --noproxy '*' "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

install_macos() {
  local uid plist logdir
  uid="$(id -u)"
  plist="$HOME/Library/LaunchAgents/${LABEL}.plist"
  logdir="$HOME/Library/Logs"
  mkdir -p "$(dirname "$plist")" "$logdir"

  uninstall_macos

  cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${ROOT}/backend/dist/server.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${ROOT}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key>
    <string>production</string>
    <key>HOST</key>
    <string>${HOST}</string>
    <key>PORT</key>
    <string>${PORT}</string>
    <key>PATH</key>
    <string>${PATH_VALUE}</string>
    <key>HOME</key>
    <string>${HOME}</string>
    <key>OPENCLI_BIN</key>
    <string>${OPENCLI_BIN}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${logdir}/crossfeed.log</string>
  <key>StandardErrorPath</key>
  <string>${logdir}/crossfeed.err.log</string>
</dict>
</plist>
EOF

  if ! launchctl bootstrap "gui/${uid}" "$plist" 2>/dev/null; then
    launchctl load -w "$plist"
  fi
  launchctl enable "gui/${uid}/${LABEL}" 2>/dev/null || true
  launchctl kickstart -k "gui/${uid}/${LABEL}" 2>/dev/null || true
  echo "$logdir/crossfeed.log"
}

install_linux() {
  local unit
  unit="$HOME/.config/systemd/user/crossfeed.service"
  mkdir -p "$(dirname "$unit")"
  cat > "$unit" <<EOF
[Unit]
Description=Crossfeed
After=network.target

[Service]
Type=simple
WorkingDirectory=${ROOT}
ExecStart=${NODE_BIN} ${ROOT}/backend/dist/server.js
Restart=on-failure
Environment=NODE_ENV=production
Environment=HOST=${HOST}
Environment=PORT=${PORT}
Environment=PATH=${PATH_VALUE}
Environment=HOME=${HOME}
Environment=OPENCLI_BIN=${OPENCLI_BIN}

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now crossfeed.service
  echo "journalctl --user -u crossfeed -f"
}

LOG_HINT=""
case "$(uname -s)" in
  Darwin) LOG_HINT="$(install_macos)" ;;
  Linux) LOG_HINT="$(install_linux)" ;;
  *)
    red "未支持的系统：$(uname -s)。可以手动：NODE_ENV=production npm run start"
    exit 1
    ;;
esac

if wait_health; then
  green "Crossfeed 已在本机跑起来。"
else
  red "服务没在 ${PORT} 端口起来。看日志：${LOG_HINT}"
  exit 1
fi

IP="$(lan_ip)"
echo
echo "  本机（改站点 / 登录用这个）：  http://127.0.0.1:${PORT}"
if [[ -n "$IP" ]]; then
  echo "  手机（同一 Wi-Fi）：          http://${IP}:${PORT}"
fi
echo "  OpenCLI：                      ${OPENCLI_BIN}"
echo "  日志：                         ${LOG_HINT}"
echo "  卸载服务：                     ./deploy/install.sh --uninstall"
echo
dim "需要登录的站：用 localhost 打开设置扫码。opencli doctor 可自查浏览器。"
