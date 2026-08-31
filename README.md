# Crossfeed

本机多源信息流。把 B 站、微博、知乎、抖音、小红书、YouTube、X、Hacker News 混在同一条时间线上，用 OpenCLI 在本机抓取，不经过第三方聚合站。

Web 和 API 默认听 **`0.0.0.0`**，同一局域网的手机可以直接打开。站点登录、条数、OpenCLI 路径等管理项 **只有用 `localhost` 打开时才能改**。

## 目录

- [它做什么](#它做什么)
- [架构](#架构)
- [环境要求](#环境要求)
- [本地开发](#本地开发)
- [局域网 / 手机](#局域网--手机)
- [设置与权限](#设置与权限)
- [OpenCLI 与 Adapter](#opencli-与-adapter)
- [环境变量](#环境变量)
- [HTTP API](#http-api)
- [测试](#测试)
- [部署](#部署)
  - [推荐：本机常驻](#1-推荐本机常驻)
  - [生产构建（本机）](#2-生产构建本机)
  - [Docker Compose](#3-docker-compose)
  - [Caddy / Nginx 反代](#4-caddy--nginx-反代)
  - [Fly.io 后端 + Vercel 前端](#5-flyio-后端--vercel-前端)
  - [部署注意](#部署注意)
- [Makefile](#makefile)
- [给后续 App](#给后续-app)
- [项目结构](#项目结构)

## 它做什么

- **综合 / 科技 / 社会** 三个主题；排序支持随机、最新、最热。
- 首页 SSE 流式出第一页，滚到底再从缓存翻页或向源站追加。
- 可选中文标题翻译（默认关）。免费接口或 OpenAI 兼容；也可用 MiniMax。
- SQLite 缓存信息流、翻译、搜索历史、运行时配置（默认 TTL 5 小时）。
- 需要登录的站（小红书、抖音、X、微博等）走本机 Chrome 的 OpenCLI persistent session。

## 架构

```
浏览器 / 手机
    │  :3000（Vite 开发，或 Nginx / Caddy）
    │  /api/*  → 反代到后端
    ▼
Hono 后端  :4000
    │  opencli <site> <command> -f json
    ▼
本机 OpenCLI + Chrome（~/.opencli/）
    │
    ▼
SQLite  ./data/crossfeed.db（或 $DATA_DIR）
```

前端是 Vite + React；后端是 Node + Hono + better-sqlite3。npm workspaces：`backend/`、`frontend/`。

## 环境要求

| 依赖 | 版本 / 说明 |
|---|---|
| Node.js | 本地开发建议 **22+**（后端脚本按 22 写的）。Docker 镜像用 Node 20。 |
| npm | 随 Node 安装 |
| [OpenCLI](https://github.com/jackwener/OpenCLI) | 抓取必需。`npm i -g @jackwener/opencli`，需要 Node ≥ 21。 |
| Chrome | 浏览器类 Adapter 用本机 Chrome；`opencli doctor` 应全绿。 |

可选：Docker、Caddy、flyctl、Vercel CLI（只在走对应部署方式时需要）。

## 本地开发

```bash
git clone <本仓库>
cd Person   # 或你的目录名
npm install

# 可选：翻译（也可之后在本机设置页填写，写入 SQLite）
# export MINIMAX_API_KEY=...
# export MINIMAX_BASE_URL=https://api.minimaxi.com/v1
# export MINIMAX_MODEL=MiniMax-M3

npm run dev
```

或 `make install && make dev`。

| 服务 | 本机 | 局域网 |
|---|---|---|
| Web | http://127.0.0.1:3000 | `http://<这台机器的IP>:3000` |
| API | http://127.0.0.1:4000 | `http://<这台机器的IP>:4000` |

开发时 Vite 把 `/api` 代理到 `127.0.0.1:4000`，前端不要自己拼后端 origin。

只起一边：

```bash
npm run dev:backend    # 4000
npm run dev:frontend    # 3000
```

健康检查：

```bash
make health
# 或
curl -s http://127.0.0.1:4000/
# {"ok":true,"service":"crossfeed-backend","version":"0.3.0"}
```

停掉：`make stop`。

## 局域网 / 手机

1. 电脑开着 `npm run dev`（或生产模式的后端 + 前端）。
2. 电脑和手机同一 Wi-Fi。
3. 手机浏览器打开 `http://<电脑局域网IP>:3000`（例如 `http://192.168.31.103:3000`）。
4. 看信息流、搜、切主题、开翻译都可以。

**改站点、登录、OpenCLI、缓存、日志必须在电脑上用 `http://localhost:3000`（或 `127.0.0.1`）打开。** 用局域网 IP 时齿轮会隐藏；直接打管理接口会 403。

第一次用小红书 / 抖音 / X：在 **本机 localhost** 打开设置 → 平台，点对应站点主页在本机 Chrome 登录。OpenCLI 复用同一套 cookie。状态来自最近一次成功拉取，不是假装成功。

## 设置与权限

| 操作 | localhost | 局域网 IP / 手机 |
|---|---|---|
| 看信息流、搜索、主题、排序 | 可以 | 可以 |
| 顶栏翻译开关 | 可以 | 可以 |
| 设置里的平台 / 登录 / 每源条数 | 可以 | 不行 |
| 数据源 TTL、OpenCLI 路径、清缓存、日志 | 可以 | 不行 |

后端看请求的 `Origin`（Vite 代理后 socket 会变成 `127.0.0.1`，所以不能只看连接 IP）。无 Origin 的 curl 则看 socket 是否回环地址。

## OpenCLI 与 Adapter

Crossfeed **不内置爬虫**。所有源都是：

```bash
opencli <site> <command> -f json
```

安装与探测：

```bash
npm install -g @jackwener/opencli
opencli doctor
opencli list -f json
```

私有 Adapter 放 `~/.opencli/clis/<site>/<command>.js`。设置 → 数据源点「探测已装 Adapter」，或：

```bash
curl -s http://127.0.0.1:4000/api/opencli/status
```

可执行文件解析顺序：设置页 `opencli.path` / `OPENCLI_BIN` → `~/.opencli/node_modules/@jackwener/opencli/dist/src/main.js` → PATH 里的 `opencli`。

换机器：拷 `~/.opencli/clis/`、重装 OpenCLI、需要登录的站再扫一次码。可选拷 `./data/crossfeed.db`（库里配置是明文，只在受信机器之间拷）。

字段契约、各源命令见 [docs/opencli-adapters.md](docs/opencli-adapters.md)。

## 环境变量

可写在 `backend/.env.local`（已被 gitignore）。设置页里同名项会覆盖环境变量，保存后立刻生效。

| 变量 | 默认 | 作用 |
|---|---|---|
| `HOST` | `0.0.0.0` | 监听地址。给局域网 / App 用，不要改成 `127.0.0.1` |
| `PORT` | `4000` | API 端口 |
| `CORS_ORIGINS` | `*` | 逗号分隔白名单；`*` 允许任意 Origin（含 Capacitor、局域网） |
| `OPENCLI_BIN` | 自动探测 | opencli 可执行文件或 `main.js` 的绝对路径 |
| `FEED_TTL_SECONDS` | `18000` | 信息流缓存秒数，可被设置页覆盖 |
| `DATA_DIR` | `./data` | 数据目录 |
| `DB_PATH` | `$DATA_DIR/crossfeed.db` | SQLite 路径 |
| `MINIMAX_API_KEY` | — | MiniMax 翻译（可选） |
| `MINIMAX_BASE_URL` | — | 默认 `https://api.minimaxi.com/v1` |
| `MINIMAX_MODEL` | — | 例如 `MiniMax-M3` |
| `NODE_ENV` | — | 生产设 `production` |

前端开发代理不需要 `VITE_API_BASE`。只有把静态前端单独部署到别的域名、且不用反代 `/api` 时，才需要在构建时注入后端地址（见 Vercel 脚本）。

## HTTP API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/` | 健康检查 |
| GET | `/api/runtime` | 版本、主题、perPage、`localAdmin` |
| GET | `/api/feed` | 同步拉取。`mode=mixed\|search\|single`，`theme`，`sort`，`page`，`perPage`，`platforms`，`fresh=1` |
| GET | `/api/feed/stream` | SSE，分源进度；首页只推第一页 |
| GET/DELETE | `/api/search/history` | 搜索历史 |
| GET/PUT | `/api/config` | 运行时配置。非本机 PUT 只能改 `feed.theme`、`translate.enabled` |
| POST | `/api/translate` | 翻译一段标题 |
| GET | `/api/cache/status` | 缓存条数 |
| DELETE | `/api/cache` | 清库内缓存 + 内存缓存（本机） |
| GET | `/api/platforms/status` | 各站登录探测（本机） |
| GET | `/api/opencli/status` | Adapter 是否装齐（本机） |
| GET/DELETE | `/api/logs` | 后端 ring buffer（本机） |
| POST | `/api/xhs/login` | 触发小红书登录流程（本机） |

SSE 示例：

```
GET /api/feed/stream?mode=mixed&theme=mixed&sort=shuffle
```

事件里会带分源 `ok` / `err` 和第一页条目。翻页用 `GET /api/feed?page=2`。

## 测试

```bash
npm test
# 或
npm run test -w backend
```

覆盖归一化、主题源、翻译、分页、缓存、本机管理鉴权等。

## 部署

抓取依赖 **本机 OpenCLI + Chrome**。云主机或纯容器里如果没有浏览器会话，信息流会空。下面几种方式按「这台机器能不能跑 OpenCLI」来选。

### 1. 推荐：本机常驻

最符合设计：电脑或 NAS 一直开着，手机只当客户端。

```bash
npm install
npm run dev
```

开机自启可用 launchd / systemd 跑 `npm run start:backend`（先 `npm run build`），前端用 Nginx 托管 `frontend/dist` 或继续 `vite preview`。

防火墙放行 **3000**（或你反代的 80/443）和如需直连 API 的 **4000**。

### 2. 生产构建（本机）

```bash
npm install
npm run build

# 终端 1：API
NODE_ENV=production npm run start:backend
# 监听 0.0.0.0:4000，读 backend/dist

# 终端 2：静态站 + /api 代理
npm run preview:frontend
# 默认 http://0.0.0.0:3001 ，/api 仍转到 127.0.0.1:4000
```

或 `make build` 后 `make start` + `make preview`。

把 `frontend/dist` 丢给任意静态服务器时，**必须把 `/api` 反代到后端**，并给 SSE 足够长的超时（建议 ≥ 120s，`proxy_buffering off`）。

### 3. Docker Compose

仓库根目录：

```bash
# 1. 准备环境（不要提交这个文件）
#    至少可以留空文件；翻译再填 MINIMAX_* 
touch backend/.env.local

# 2. 先在宿主机构建前端静态文件（compose 只挂 dist）
npm install
npm run build -w frontend

# 3. 启动
docker compose up -d --build
```

| 容器 | 端口 | 作用 |
|---|---|---|
| `crossfeed-backend` | 内部 4000 | API |
| `crossfeed-frontend` | **3000→80** | Nginx 托管 `frontend/dist`，`/api` 反代到 backend |
| `crossfeed-caddy` | **8080→80**、**8443→443** | 可选统一入口（见 `Caddyfile`） |

打开 http://localhost:3000 或 http://localhost:8080。

OpenCLI 默认 **不在镜像里**。要在容器里抓取，需要自己把 Chrome / OpenCLI 打进镜像或挂载，例如在 `docker-compose.yml` 里取消注释：

```yaml
# volumes:
#   - ~/.opencli:/root/.opencli
```

即便挂了配置，无头浏览器和扫码登录也比本机进程难维护。家用场景更建议后端跑在宿主机，Compose 只反代。

数据：镜像声明了 `VOLUME /app/data`。生产请再挂一个 named volume 或 bind mount，避免删容器丢 SQLite。

停止：`docker compose down`。

### 4. Caddy / Nginx 反代

**Nginx**（已提供 `deploy/nginx.conf`）：静态 `frontend/dist`，`location /api/` → `http://127.0.0.1:4000` 或 `http://backend:4000`。生产请加上：

```nginx
proxy_http_version 1.1;
proxy_set_header Connection '';
proxy_buffering off;
proxy_read_timeout 120s;
```

否则 SSE 可能被缓冲或过早断开。

**Caddy**（`Caddyfile`）：开发 compose 里是 `:80`。有域名时改成：

```
your.example.com {
  root * /var/www/html
  file_server
  try_files {path} /index.html
  reverse_proxy /api/* 127.0.0.1:4000
}
```

Caddy 会自动签 HTTPS。把构建好的 `frontend/dist` 放到 `root`。

### 5. Fly.io 后端 + Vercel 前端

适合 API 放公网、静态站走 CDN。 **公网机器上通常没有你的 Chrome 登录态，信息流会拉空。** 除非 Fly 机器里也装了 OpenCLI 并完成登录，否则只适合当「有公网域名的反代」，真正抓取仍应打回家。

后端：

```bash
brew install flyctl   # 或见 https://fly.io/docs/hands-on/install-flyctl/
fly auth login
export MINIMAX_API_KEY=...          # 可选
./deploy/deploy-fly.sh
# 默认 app：crossfeed-backend，区域 sin
# 成功后：https://crossfeed-backend.fly.dev/
```

脚本会 `fly apps create`、写入 secrets、`fly deploy`（`deploy/fly.toml` 指向根目录 `Dockerfile.backend`）。改名：

```bash
FLY_APP_NAME=my-crossfeed FLY_REGION=nrt ./deploy/deploy-fly.sh
```

前端：

```bash
npm i -g vercel
export API_BASE=https://crossfeed-backend.fly.dev/api
./deploy/deploy-vercel.sh
```

`frontend/vercel.json` 里 `/api/:path*` 默认 rewrite 到 `https://crossfeed-backend.fly.dev/api/:path*`。若 app 名不是这个，改 json 后再部署。

CORS：后端默认 `CORS_ORIGINS=*`。收紧时设成前端域名，例如：

```bash
fly secrets set CORS_ORIGINS=https://your-app.vercel.app --app crossfeed-backend
```

### 部署注意

1. **OpenCLI 必须能在跑后端的那台机器上执行。** 没有它就没有源。
2. 管理接口（改站点、清库、看日志）只认 **localhost Origin**。公网前端改不了站点，这是刻意的。
3. SQLite 要持久化：Docker / Fly 请挂 volume，不要写在可丢的容器层。
4. SSE：反代关闭缓冲、超时拉长。
5. 不要把 `backend/.env.local` 或 `*.db` 提交进 git（已在 `.gitignore`）。
6. `HOST` 保持 `0.0.0.0`，否则局域网和 App 连不上。

## Makefile

```bash
make help
make install      # npm install
make dev          # 前后端一起
make build        # 生产构建
make start        # 只起后端 dist
make preview      # 预览前端 dist
make health
make test-api
make stop
make clean
```

## 给后续 App

1. 电脑开着后端（`npm run dev:backend` 或 `start:backend`）。
2. App 的 API base：`http://<电脑IP>:4000`。
3. 启动先 `GET /api/runtime`，看 `localAdmin`、`feed.perPage`、主题列表。
4. 信息流用 `GET /api/feed/stream`；翻页 `GET /api/feed?page=2`。
5. **不要在 App 里再调 OpenCLI。** 登录和改站点请用户在电脑浏览器用 localhost 完成。

## 项目结构

```
├── backend/                 # Hono API
│   ├── src/server.ts
│   ├── src/lib/             # feed、OpenCLI、翻译、SQLite、本机鉴权
│   └── test/
├── frontend/                # Vite + React
│   ├── src/App.tsx
│   └── src/components/
├── deploy/                  # Fly / Vercel / Nginx
├── docs/opencli-adapters.md
├── Dockerfile.backend
├── docker-compose.yml
├── Caddyfile
└── Makefile
```
