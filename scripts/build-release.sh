#!/usr/bin/env bash
# Crossfeed · 跨平台 Release 打包脚本
# 用法（在 GitHub Actions runner 或本地）：
#   bash scripts/build-release.sh \
#     --version v0.1.0 \
#     --target macos-x64 \
#     --archive zip \
#     --stage release-staging
#
# 作用：
#   1. 拷贝 backend/dist、frontend/dist、start/install 脚本、README、deploy/install.sh
#   2. 在 stage/backend 跑 `npm ci --omit=dev`，得到只含生产依赖的 node_modules
#      （这样能砍掉 typescript / tsx / vite / @types / @vitejs / tailwind 等构建期依赖）
#   3. 拷贝到 stage/，打包成 crossfeed-{version}-{target}.{archive}
set -euo pipefail

usage() {
  cat <<'EOF'
用法：bash scripts/build-release.sh --version V --target LABEL --archive zip|tar.gz --stage DIR
  --version    Git tag，例如 v0.1.0
  --target     linux-x64 | macos-x64 | macos-arm64 | windows-x64
  --archive    zip | tar.gz
  --stage      输出 staging 目录
EOF
}

VERSION=""
TARGET=""
ARCHIVE=""
STAGE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)  VERSION="$2"; shift 2 ;;
    --target)   TARGET="$2"; shift 2 ;;
    --archive)  ARCHIVE="$2"; shift 2 ;;
    --stage)    STAGE="$2"; shift 2 ;;
    -h|--help)  usage; exit 0 ;;
    *) echo "未知参数: $1"; usage; exit 1 ;;
  esac
done

[[ -n "$VERSION" ]] || { echo "缺 --version"; exit 1; }
[[ -n "$TARGET"  ]] || { echo "缺 --target";  exit 1; }
[[ -n "$ARCHIVE" ]] || { echo "缺 --archive"; exit 1; }
[[ -n "$STAGE"   ]] || { echo "缺 --stage";   exit 1; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# 标准化 version：v0.1.0 → 用于产物名
OUT_NAME="crossfeed-${VERSION}-${TARGET}"
STAGE_DIR="${STAGE%/}/${OUT_NAME}"
echo "==> 打包：$OUT_NAME.$ARCHIVE"
echo "==> 临时目录：$STAGE_DIR"

# 清理
rm -rf "$STAGE"
mkdir -p "$STAGE_DIR"

# 1) 复制构建产物
echo "==> 拷贝 backend/dist + frontend/dist"
mkdir -p "$STAGE_DIR/backend" "$STAGE_DIR/frontend"
cp -R "$ROOT/backend/dist"  "$STAGE_DIR/backend/"
cp -R "$ROOT/frontend/dist" "$STAGE_DIR/frontend/"

# 2) 用根 lockfile 装生产依赖（workspace 没有独立的 backend/package-lock.json）
echo "==> npm ci --omit=dev（生产依赖）"
TMP_INSTALL="$(mktemp -d)"
mkdir -p "$TMP_INSTALL/backend" "$TMP_INSTALL/frontend"
cp "$ROOT/package.json" "$ROOT/package-lock.json" "$TMP_INSTALL/"
cp "$ROOT/backend/package.json" "$TMP_INSTALL/backend/"
cp "$ROOT/frontend/package.json" "$TMP_INSTALL/frontend/"
# 探测 npm 绝对路径（subshell 里 PATH 会被切到 /usr/bin，npm 通常在 /opt/homebrew/bin）
NPM_BIN="$(command -v npm)"
NODE_BIN_DIR="$(cd "$(dirname "$NPM_BIN")" && pwd)"
(
  cd "$TMP_INSTALL"
  export PATH="$NODE_BIN_DIR:$PATH"
  npm ci --omit=dev --no-audit --no-fund --ignore-scripts \
    >/dev/null
  # 再跑一次允许 scripts（better-sqlite3 的 native rebuild 不能 ignore）
  npm rebuild --omit=dev --ignore-scripts=false >/dev/null
)
# workspace 依赖 hoist 到根 node_modules；backend 下也可能有嵌套包
cp -R "$TMP_INSTALL/node_modules" "$STAGE_DIR/node_modules"
if [[ -d "$TMP_INSTALL/backend/node_modules" ]]; then
  cp -R "$TMP_INSTALL/backend/node_modules" "$STAGE_DIR/backend/node_modules"
fi
rm -rf "$TMP_INSTALL"

# 3) 顶层 node_modules：仅放 concurrently（root devDep 实际不进 prod）—— 不放
# 4) 拷贝启动 / 安装 / 文档
echo "==> 拷贝启动 / 安装脚本 / README"
cp "$ROOT/start.sh"     "$STAGE_DIR/"
cp "$ROOT/start.bat"    "$STAGE_DIR/"
cp "$ROOT/start.ps1"    "$STAGE_DIR/"
cp -R "$ROOT/deploy"    "$STAGE_DIR/deploy"
cp "$ROOT/README.md"    "$STAGE_DIR/"

# 5) data 目录占位
mkdir -p "$STAGE_DIR/data"
touch "$STAGE_DIR/data/.gitkeep"

# 6) 写一个 README-addendum 提示用户首次运行要装 OpenCLI
cat > "$STAGE_DIR/INSTALL.txt" <<EOF
Crossfeed ${VERSION}
==================

解压即跑。注意：本 zip 不含 OpenCLI（OpenCLI 是 Go 写的 npm 包，跨平台二进制较大），
也不含 Chrome / Edge（系统必须已装）。

首次运行（任选其一）：

  macOS / Linux：
    ./install.sh                 # 一键：装 OpenCLI + 同步 Adapter + 注册开机自启
    ./start.sh                   # 只启动，不注册自启
    ./deploy/install.sh --opencli  # 只装 OpenCLI，不动系统服务

  Windows（PowerShell）：
    .\deploy\install.ps1         # 一键：装 OpenCLI + 同步 Adapter + 注册任务计划
    .\start.bat                  # 只启动
    .\deploy\install.ps1 -OpenCliOnly   # 只装 OpenCLI

要求：Node.js ≥ 21、npm、本机 Chrome / Edge。
OpenCLI 会装到 ~/.opencli/（macOS / Linux）或 %USERPROFILE%\.opencli\（Windows）。
登录态留在 OpenCLI 用户目录，卸载服务不会动它。

详细说明见 README.md。
EOF

# 7) 打包
echo "==> 打包"
cd "$STAGE"
case "$ARCHIVE" in
  zip)
    OUT="$STAGE/${OUT_NAME}.zip"
    if command -v zip >/dev/null 2>&1; then
      zip -r -q "$OUT" "$OUT_NAME"
    else
      # 退而求其次：PowerShell Compress-Archive（macOS / Linux 也可能装了 pwsh）
      if command -v pwsh >/dev/null 2>&1; then
        pwsh -NoProfile -Command "Compress-Archive -Path '${OUT_NAME}' -DestinationPath '${OUT}' -Force"
      else
        echo "找不到 zip 命令，也没 pwsh。装一个：brew install zip / apt install zip"
        exit 1
      fi
    fi
    ;;
  tar.gz)
    OUT="$STAGE/${OUT_NAME}.tar.gz"
    tar -czf "$OUT" "$OUT_NAME"
    ;;
  *)
    echo "未知 archive 格式：$ARCHIVE（只支持 zip / tar.gz）"
    exit 1
    ;;
esac

echo "==> 完成：$OUT"
ls -lh "$OUT"
