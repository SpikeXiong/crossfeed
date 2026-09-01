#!/bin/bash
# Crossfeed 一键部署脚本
# 用法：
#   ./deploy/deploy-fly.sh       部署后端到 Fly.io
#   ./deploy/deploy-vercel.sh    部署前端到 Vercel

set -e

# ===== 颜色 =====
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# ===== 检查 =====
check_cmd() {
  if ! command -v "$1" &> /dev/null; then
    echo -e "${RED}✗ 缺少依赖：$1${NC}"
    echo "  安装：$2"
    exit 1
  fi
}

echo -e "${GREEN}Crossfeed · Fly.io 后端部署${NC}"
echo "================================"
echo ""

check_cmd "fly" "brew install flyctl"
check_cmd "docker" "https://docs.docker.com/get-docker/"

# 检查是否已登录
if ! fly auth whoami &> /dev/null; then
  echo -e "${YELLOW}→ 还未登录 Fly.io${NC}"
  fly auth signup
fi

APP_NAME=${FLY_APP_NAME:-crossfeed-backend}
REGION=${FLY_REGION:-sin}

echo ""
echo -e "App name: ${YELLOW}$APP_NAME${NC}"
echo -e "Region:   ${YELLOW}$REGION${NC}"
echo ""

# 询问 secrets
KEY="${CROSSFEED_LLM_API_KEY:-}"
BASE="${CROSSFEED_LLM_BASE_URL:-https://api.openai.com/v1}"
MODEL="${CROSSFEED_LLM_MODEL:-gpt-4o-mini}"

if [ -z "$KEY" ]; then
  read -r -p "CROSSFEED_LLM_API_KEY: " KEY
fi

# 准备 fly.toml（替换 app name）
cd "$(dirname "$0")/.."
sed -i '' "s/^app = \".*\"/app = \"$APP_NAME\"/" deploy/fly.toml
sed -i '' "s/^primary_region = \".*\"/primary_region = \"$REGION\"/" deploy/fly.toml

# 启动 app（如果不存在）
if ! fly apps list 2>/dev/null | grep -q "$APP_NAME"; then
  echo -e "${YELLOW}→ 创建 Fly.io app: $APP_NAME${NC}"
  fly apps create "$APP_NAME"
fi

# 设置 secrets
echo -e "${YELLOW}→ 设置 secrets${NC}"
fly secrets set \
  CROSSFEED_LLM_API_KEY="$KEY" \
  CROSSFEED_LLM_BASE_URL="$BASE" \
  CROSSFEED_LLM_MODEL="$MODEL" \
  --app "$APP_NAME"

# 部署
echo -e "${YELLOW}→ 开始部署${NC}"
cd deploy
fly deploy

echo ""
echo -e "${GREEN}✓ 部署完成！${NC}"
echo -e "访问：${YELLOW}https://$APP_NAME.fly.dev/${NC}"