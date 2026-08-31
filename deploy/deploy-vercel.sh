#!/bin/bash
# Crossfeed 前端部署到 Vercel

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}Crossfeed · Vercel 前端部署${NC}"
echo "================================"
echo ""

# 检查 vercel CLI
if ! command -v vercel &> /dev/null; then
  echo -e "${RED}✗ 缺少依赖：vercel CLI${NC}"
  echo "  安装：npm i -g vercel"
  exit 1
fi

# 检查登录
if ! vercel whoami &> /dev/null; then
  echo -e "${YELLOW}→ 登录 Vercel${NC}"
  vercel login
fi

# 询问后端地址
if [ -z "$API_BASE" ]; then
  read -p "后端地址（比如 https://crossfeed-backend.fly.dev/api）: " API_BASE
fi

cd "$(dirname "$0")/../frontend"

echo ""
echo -e "API base: ${YELLOW}$API_BASE${NC}"
echo ""

# 设置环境变量
vercel env add VITE_API_BASE production <<< "$API_BASE"

# 部署
echo -e "${YELLOW}→ 部署到 Vercel${NC}"
vercel --prod

echo ""
echo -e "${GREEN}✓ 部署完成！${NC}"