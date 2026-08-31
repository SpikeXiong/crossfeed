# Crossfeed · Makefile
# 用法：make <target>，比如 make dev / make install

# ============================================================
#  安装 & 清理
# ============================================================

.PHONY: install
install: ## 安装所有依赖（root + workspaces）
	npm install
	@echo "✓ 依赖安装完成"

.PHONY: clean
clean: ## 清理所有 node_modules 和构建产物
	rm -rf node_modules backend/node_modules frontend/node_modules
	rm -rf backend/dist frontend/dist
	@echo "✓ 清理完成"

.PHONY: reset
reset: clean install ## 完全清理后重新安装
	@echo "✓ 重置完成"

# ============================================================
#  开发
# ============================================================

.PHONY: dev
dev: ## 同时启动后端 (4000) + 前端 (3000)
	npm run dev

.PHONY: dev-backend
dev-backend: ## 只启动后端
	npm run dev:backend

.PHONY: dev-frontend
dev-frontend: ## 只启动前端
	npm run dev:frontend

# ============================================================
#  生产构建
# ============================================================

.PHONY: build
build: ## 构建生产产物
	npm run build
	@echo "✓ 构建完成"

.PHONY: start
start: ## 启动后端（生产模式，需先 build）
	npm run start:backend

.PHONY: preview
preview: ## 预览前端构建产物
	npm run preview:frontend

# ============================================================
#  调试
# ============================================================

.PHONY: health
health: ## 健康检查
	@echo "→ 后端 health:"
	@curl -s --noproxy '*' http://127.0.0.1:4000/ || echo "  ✗ 后端未启动"
	@echo "→ 前端 health:"
	@curl -s --noproxy '*' -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:3000/ || echo "  ✗ 前端未启动"

.PHONY: logs
logs: ## 跟踪日志
	tail -f /tmp/crossfeed.log

.PHONY: stop
stop: ## 停止所有服务
	pkill -f "tsx src/server.ts" || true
	pkill -f "vite" || true
	pkill -f "concurrently" || true
	@echo "✓ 已停止所有服务"

# ============================================================
#  工具
# ============================================================

.PHONY: test-api
test-api: ## 测试 /api/feed 接口
	curl -s --noproxy '*' 'http://127.0.0.1:4000/api/feed?mode=mixed&enrich=fast' | python3 -m json.tool | head -50

.PHONY: cache-clear
cache-clear: ## 清除缓存（需重启服务生效）
	@echo "→ 重启服务以清除内存缓存..."
	$(MAKE) stop
	@echo "✓ 缓存已清（下次启动即生效）"

# ============================================================
#  帮助
# ============================================================

.PHONY: help
help: ## 显示帮助
	@echo "用法：make <target>"
	@echo ""
	@echo "可用 target："
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'