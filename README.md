<div align="center">

# Crossfeed

**本机多源信息流 · 电脑当服务器，手机当客户端**

把 B 站、微博、知乎、抖音、小红书、YouTube、X、[Hacker News](https://news.ycombinator.com/) 混在同一条时间线上，用本机 [OpenCLI](https://github.com/jackwener/OpenCLI) 抓取，不经过第三方聚合站。站点登录和管理只允许 `localhost`。

</div>

<br/>

<div align="center">

[![Release](https://img.shields.io/github/v/release/SpikeXiong/crossfeed?style=for-the-badge&logo=github&logoColor=white&color=blue)](https://github.com/SpikeXiong/crossfeed/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/SpikeXiong/crossfeed/ci.yml?style=for-the-badge&logo=github-actions&logoColor=white&label=CI)](https://github.com/SpikeXiong/crossfeed/actions/workflows/ci.yml)
[![OpenCLI](https://img.shields.io/badge/Powered%20by-OpenCLI-00ADD8?style=for-the-badge&logo=powershell&logoColor=white)](https://github.com/jackwener/OpenCLI)
[![Node](https://img.shields.io/badge/Node.js-%E2%89%A521-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Backend](https://img.shields.io/badge/Hono-Backend-E36002?style=for-the-badge&logo=hono&logoColor=white)](https://hono.dev)
[![Frontend](https://img.shields.io/badge/Vite+React-Frontend-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev)
[![Storage](https://img.shields.io/badge/SQLite-Storage-003B57?style=for-the-badge&logo=sqlite&logoColor=white)](https://sqlite.org)
[![Platform](https://img.shields.io/badge/macOS%20%7C%20Linux%20%7C%20Windows-555555?style=for-the-badge&logo=windows&logoColor=white)](#)

</div>

<br/>

<div align="center">

[快速开始](#快速开始) · [部署](#部署) · [OpenCLI](#opencli) · [API](#http-api) · [致谢](#致谢)

</div>

---

## 它做什么

- **综合 / 科技 / 社会** 三个主题；随机、最新、最热排序。
- 首页用 SSE 流式出第一页，滚到底再从缓存翻页或向源站追加。
- 可选标题翻译（默认关）：[MyMemory](https://mymemory.translated.net/)、Google gtx、自建 [LibreTranslate](https://github.com/LibreTranslate/LibreTranslate)，或任意 OpenAI 兼容接口（含 MiniMax）。
- SQLite 缓存信息流、翻译、搜索历史和运行时配置（默认 TTL 5 小时）。
- 需要登录的站走本机 Chrome 的 OpenCLI persistent session。

## 下载

> **想跳过 npm 构建？** 直接从 [Releases](https://github.com/SpikeXiong/crossfeed/releases) 下载对应平台的 zip，解压即跑（每个平台独立构建，已含 `backend/dist` + `frontend/dist` + 生产 `node_modules`，不含 OpenCLI；首次跑会自装）。

| 平台 | zip | 解压后启动 |
| :--- | :--- | :--- |
| Linux x64 | `crossfeed-v*-linux-x64.tar.gz` | `./start.sh` 或 `./install.sh` |
| macOS x64（Intel） | `crossfeed-v*-macos-x64.zip` | `./start.sh` 或 `./install.sh` |
| macOS ARM64（Apple Silicon） | `crossfeed-v*-macos-arm64.zip` | `./start.sh` 或 `./install.sh` |
| Windows x64 | `crossfeed-v*-windows-x64.zip` | 双击 `start.bat`，或 `.\deploy\install.ps1` |

每个 release 都由 GitHub Actions 跨平台独立构建（参见 [.github/workflows/release.yml](.github/workflows/release.yml)），未签名的 `.zip` / `.tar.gz` 直接下载即可。

## 快速开始

需要 **Node.js ≥ 21**、npm、本机 **Chrome**。macOS / Linux / Windows。

### macOS / Linux

```bash
git clone https://github.com/SpikeXiong/crossfeed.git
cd crossfeed
./deploy/install.sh
```

或 `make deploy`。同一条命令会安装 [OpenCLI](https://github.com/jackwener/OpenCLI)、同步本仓库 Adapter、构建，并注册开机自启（macOS LaunchAgent / Linux systemd 用户服务）。

### Windows（PowerShell）

```powershell
git clone https://github.com/SpikeXiong/crossfeed.git
cd crossfeed
.\deploy\install.ps1
```

> 用 Git Bash / WSL 也可以直接跑 `./deploy/install.sh`（脚本会检测到 `MINGW*` / `MSYS*` / `CYGWIN*` / WSL 并走 Windows 路径）。

同一条命令会安装 OpenCLI、构建产物、注册 **Windows 任务计划**（`Crossfeed` 任务，登录时启动，不需要管理员权限），日志写到 `%LOCALAPPDATA%\Crossfeed\crossfeed.log`。

### 访问入口

| | |
|---|---|
| 本机（改站点、登录） | http://127.0.0.1:4000 |
| 手机（同一 Wi-Fi） | `http://<电脑IP>:4000` |
| 日志（macOS） | `~/Library/Logs/crossfeed.log` |
| 日志（Linux） | `journalctl --user -u crossfeed -f` |
| 日志（Windows） | `%LOCALAPPDATA%\Crossfeed\crossfeed.log` |
| 只装抓取 | `./deploy/install.sh --opencli` / `.\deploy\install.ps1 -OpenCliOnly` |
| 卸载服务 | `./deploy/install.sh --uninstall` / `.\deploy\install.ps1 -Uninstall`（**不动** OpenCLI 和登录 cookie） |
| 装但不注册自启 | `./deploy/install.sh --no-autostart` / `.\deploy\install.ps1 -NoAutostart` |

没装 Chrome 时 Hacker News 还能抓，其它站不行。需要登录的站请用 **localhost:4000** 打开设置扫码。`opencli doctor` 可自查浏览器。

不想开机自启：

```bash
npm install
npm run build
NODE_ENV=production npm run start    # 一个进程，http://0.0.0.0:4000
```

或 Windows：

```cmd
npm install
npm run build
set NODE_ENV=production
node backend\dist\server.js
```

开发（Vite `:3000` + API `:4000`）：

```bash
npm install && npm run dev
```

## 部署

抓取依赖 **本机 OpenCLI + Chrome**。云主机、纯容器、Vercel 上都没有你的浏览器登录态，信息流会空。真正能「一键」的只有：这台有 Chrome 的机器上跑一个进程。

生产模式下后端托管 `frontend/dist`，页面和 API 都在 **4000**。

### 一键（推荐）

见上方 [快速开始](#快速开始)。已有安装时跳过 OpenCLI；升级官方包：

```bash
CROSSFEED_OPENCLI_UPDATE=1 ./deploy/install.sh --opencli
```

防火墙放行 **4000**。LLM Key 写 `backend/.env.local` 的 `CROSSFEED_LLM_*`，或之后在 localhost 设置页填。

### Docker Compose

OpenCLI **不在镜像里**。家用场景更建议后端跑在宿主机；Compose 只适合反代。

```bash
touch backend/.env.local
npm install && npm run build -w frontend
docker compose up -d --build
```

| 容器 | 端口 |
|---|---|
| `crossfeed-backend` | 内部 4000 |
| `crossfeed-frontend` | **3000→80** |
| `crossfeed-caddy` | **8080→80**、**8443→443** |

要在容器里抓取，需自己挂 Chrome / `~/.opencli`，扫码登录也比本机进程难维护。SQLite 请再挂 volume。停止：`docker compose down`。

### Caddy / Nginx

一键部署后把整站反代到 `127.0.0.1:4000` 即可。SSE 关缓冲、超时 ≥ 120s。

```
your.example.com {
  reverse_proxy 127.0.0.1:4000
}
```

若仍自己托管 `frontend/dist`，必须把 `/api` 反代到后端。Nginx 示例见 `deploy/nginx.conf`，并加上 `proxy_buffering off` 与 `proxy_read_timeout 120s`。

### Fly.io + Vercel

适合有公网域名、再反代回家。公网机器上通常没有 Chrome 登录态，信息流会空。

```bash
./deploy/deploy-fly.sh          # 默认 app：crossfeed-backend，区域 sin
API_BASE=https://crossfeed-backend.fly.dev/api ./deploy/deploy-vercel.sh
```

`frontend/vercel.json` 里 `/api` rewrite 默认指向上述域名。CORS 收紧：`fly secrets set CROSSFEED_CORS_ORIGINS=https://your-app.vercel.app`。

### 注意

1. OpenCLI 必须能在跑后端的那台机器上执行。
2. 改站点、清库、看日志只认 **localhost Origin**。
3. SQLite 不要写在可丢的容器层。
4. 不要提交 `backend/.env.local` 或 `*.db`。
5. `CROSSFEED_HOST` 保持 `0.0.0.0`，否则局域网和 App 连不上。

## 局域网 / 手机

电脑开着服务，手机同一 Wi-Fi：

| 模式 | 地址 |
|---|---|
| 一键部署 | `http://<电脑IP>:4000` |
| 开发 | `http://<电脑IP>:3000` |

看信息流、搜索、切主题、开翻译都可以。**改站点、登录、OpenCLI、缓存、日志必须用 localhost**（部署后 `:4000`，开发 `:3000`）。局域网 IP 下齿轮会隐藏，管理接口返回 403。

第一次用小红书 / 抖音 / X：在本机 localhost 打开设置 → 平台，在本机 Chrome 登录。OpenCLI 复用同一套 cookie。

| 操作 | localhost | 局域网 / 手机 |
|---|---|---|
| 信息流、搜索、主题、排序 | 可以 | 可以 |
| 顶栏翻译开关 | 可以 | 可以 |
| 平台 / 登录 / 每源条数 | 可以 | 不行 |
| TTL、OpenCLI 路径、清缓存、日志 | 可以 | 不行 |

鉴权看请求的 `Origin`（Vite 代理后 socket 会变成 `127.0.0.1`）。无 Origin 的 curl 看 socket 是否回环地址。

## 架构

```
浏览器 / 手机
    │  开发 :3000（Vite，/api 代理到后端）
    │  部署 :4000（同一进程托管页面 + API）
    ▼
Hono  :4000
    │  opencli <site> <command> -f json
    ▼
本机 OpenCLI + Chrome（~/.opencli/）
    ▼
SQLite  ./data/crossfeed.db
```

npm workspaces：`backend/`、`frontend/`。

## OpenCLI

Crossfeed **不内置爬虫**。所有源都是：

```bash
opencli <site> <command> -f json
```

官方 Adapter 来自 [jackwener/OpenCLI](https://github.com/jackwener/OpenCLI)（`@jackwener/opencli`）。`~/.opencli/clis/` 里的同名命令会覆盖官方包。一键脚本会装官方包，并把本仓库 `deploy/opencli-clis/` 同步过去。

```bash
./deploy/install.sh --opencli
opencli doctor
opencli list -f json
curl -s http://127.0.0.1:4000/api/opencli/status
```

可执行文件：设置页 `opencli.path` / `CROSSFEED_OPENCLI_BIN` → `~/.opencli/node_modules/@jackwener/opencli/dist/src/main.js` → PATH 里的 `opencli`。

换机器再跑 `./deploy/install.sh`。登录态不能拷，需在新机器 localhost 再扫码。可选拷 `./data/crossfeed.db`（配置是明文，只在受信机器之间拷）。

字段契约见 [docs/opencli-adapters.md](docs/opencli-adapters.md)。

### 相对官方包的改动

对照 `@jackwener/opencli` 1.8.7。源文件在 `deploy/opencli-clis/`。

**新增命令：**

| 路径 | 命令 | 作用 |
|---|---|---|
| `youtube/hot.js` | `youtube hot` | YouTube 热门 |
| `douyin/hot.js` | `douyin hot` | 抖音热点榜 |
| `douyin/feed.js` | `douyin feed` | 抖音推荐（避免把侧栏话题当作品） |
| `crossfeed/auth-scan.js` | `crossfeed auth-scan` | 扫各站登录 cookie |

**覆盖官方命令**（多为封面 / 原帖时间）：

| 路径 | 改动 |
|---|---|
| `bilibili/hot.js`、`search.js` | `pic`、`pubdate` |
| `youtube/search.js` | `thumbnail`、`video_id` |
| `zhihu/hot.js` | `url`、`thumbnail`、`excerpt`、`created` |
| `weibo/hot.js` | 热搜上榜时间 |
| `xiaohongshu/feed.js`、`search.js` | 直接带 `cover` |
| `douyin/search.js` | 封面、相对时间；给 `feed` 复用 |
| `hackernews/top.js` | 原帖时间 |

X / Twitter 走官方 `timeline` / `search`，没有本仓库覆盖。

## 开发

```bash
npm install
npm run dev                 # 前端 :3000，API :4000
npm run dev:backend
npm run dev:frontend
npm test
make health                 # curl /api/health
make stop
```

| 服务 | 本机 | 局域网 |
|---|---|---|
| Web（开发） | http://127.0.0.1:3000 | `http://<IP>:3000` |
| API / 生产页 | http://127.0.0.1:4000 | `http://<IP>:4000` |

开发时 Vite 把 `/api` 代理到 `127.0.0.1:4000`。

```bash
make help
make install / dev / build / start
make opencli / deploy / undeploy
make health / logs / stop / clean
```

## 环境变量

写在 `backend/.env.local`（gitignore）。模板见 `backend/.env.example`。设置页里的项会覆盖同义环境变量，保存后立刻生效。

一律用 **`CROSSFEED_` 前缀**。LLM 相关用 `CROSSFEED_LLM_*`。

| 变量 | 默认 | 作用 |
|---|---|---|
| `CROSSFEED_HOST` | `0.0.0.0` | 监听地址。给局域网 / App 用 |
| `CROSSFEED_PORT` | `4000` | 页面 + API |
| `CROSSFEED_WEB_ROOT` | `frontend/dist` | 静态站目录 |
| `CROSSFEED_CORS_ORIGINS` | `*` | Origin 白名单 |
| `CROSSFEED_OPENCLI_BIN` | 自动探测 | opencli 或 `main.js` 的绝对路径 |
| `CROSSFEED_FEED_TTL_SECONDS` | `18000` | 信息流缓存秒数 |
| `CROSSFEED_DATA_DIR` | `./data` | 数据目录 |
| `CROSSFEED_DB_PATH` | `$CROSSFEED_DATA_DIR/crossfeed.db` | SQLite |
| `CROSSFEED_LLM_API_KEY` | — | LLM API Key（OpenAI 兼容） |
| `CROSSFEED_LLM_BASE_URL` | `https://api.openai.com/v1` | LLM 接口根路径 |
| `CROSSFEED_LLM_MODEL` | `gpt-4o-mini` | 模型名，例如 `MiniMax-M3` |
| `CROSSFEED_OPENCLI_MUTED` | `1` | `0` 则前台打开浏览器窗口 |
| `NODE_ENV` | — | 生产设 `production` |

只有把静态前端单独部署到别的域名、且不用反代 `/api` 时，才需要构建时注入后端地址（见 Vercel 脚本）。

## HTTP API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查（部署后 `/` 是页面） |
| GET | `/api/runtime` | 版本、主题、perPage、`localAdmin` |
| GET | `/api/feed` | `mode=mixed\|search\|single` |
| GET | `/api/feed/stream` | SSE，分源进度 |
| GET/DELETE | `/api/search/history` | 搜索历史 |
| GET/PUT | `/api/config` | 非本机 PUT 只能改 theme / 翻译开关 |
| POST | `/api/translate` | 翻译标题 |
| GET | `/api/cache/status` | 缓存条数 |
| DELETE | `/api/cache` | 清缓存（本机） |
| GET | `/api/platforms/status` | 登录探测（本机） |
| GET | `/api/opencli/status` | Adapter 是否装齐（本机） |
| GET/DELETE | `/api/logs` | 日志（本机） |
| POST | `/api/xhs/login` | 小红书登录（本机） |

```
GET /api/feed/stream?mode=mixed&theme=mixed&sort=shuffle
GET /api/feed?page=2
```

给后续 App：API base 为 `http://<电脑IP>:4000`。先 `GET /api/runtime`。**不要在 App 里再调 OpenCLI**，登录和改站点在电脑 localhost 完成。

## 项目结构

```
├── backend/                 # Hono + SQLite
├── frontend/                # Vite + React
├── deploy/
│   ├── install.sh           # 一键（macOS / Linux / Windows Git Bash）
│   ├── install.ps1          # 一键（Windows PowerShell）
│   ├── opencli-clis/        # 覆盖 / 新增的 Adapter
│   ├── nginx.conf
│   ├── deploy-fly.sh
│   └── deploy-vercel.sh
├── scripts/
│   └── build-release.sh     # 跨平台 release zip 打包
├── start.sh / start.bat / start.ps1   # 解压后双击启动
├── .github/workflows/
│   ├── ci.yml               # push / PR 跑 test + build
│   └── release.yml          # 推 v* tag 跨平台打 zip + 发 release
├── docs/opencli-adapters.md
├── Dockerfile.backend
├── docker-compose.yml
├── Caddyfile
└── Makefile
```

## 致谢

Crossfeed 站在这些开源项目之上。没有它们就没有这个仓库。

| 项目 | 用途 |
|---|---|
| [OpenCLI](https://github.com/jackwener/OpenCLI) | 本机浏览器 Adapter。所有源站抓取都走它；本仓库只覆盖/新增命令，不内置爬虫 |
| [Hono](https://github.com/honojs/hono) / [@hono/node-server](https://github.com/honojs/node-server) | HTTP API、CORS、SSE |
| [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) | 信息流与配置持久化 |
| [Vite](https://github.com/vitejs/vite) + [React](https://github.com/facebook/react) | 前端开发与构建 |
| [Radix UI](https://www.radix-ui.com/) + [shadcn/ui](https://ui.shadcn.com/) 风格组件 | Dialog / Tabs / Switch 等无样式原语 |
| [Tailwind CSS](https://tailwindcss.com/) | 样式 |
| [Lucide](https://lucide.dev/) | 图标 |
| [Framer Motion](https://github.com/motiondivision/motion) | 动效 |
| [react-masonry-css](https://github.com/paulcollett/react-masonry-css) | 瀑布流卡片 |
| [class-variance-authority](https://github.com/joe-bell/cva) / [clsx](https://github.com/lukeed/clsx) / [tailwind-merge](https://github.com/dcastil/tailwind-merge) | 组件变体与 class 合并 |
| [MyMemory](https://mymemory.translated.net/) / [LibreTranslate](https://github.com/LibreTranslate/LibreTranslate) | 可选免费翻译 |
| [Caddy](https://github.com/caddyserver/caddy) / [Nginx](https://nginx.org/) | 反代与 HTTPS |
| Node.js 内置 [test runner](https://nodejs.org/api/test.html) + [tsx](https://github.com/privatenumber/tsx) | 后端测试 |
| [GitHub Actions](https://github.com/features/actions) | 跨平台 CI + Release 打包 |

各源站点（哔哩哔哩、微博、知乎、抖音、小红书、YouTube、X、Hacker News）的数据和登录态属于对应平台，本项目只在你的机器上代为拉取，供个人阅读。

---

<div align="center">

<sub>Built with <a href="https://hono.dev"><img src="https://img.shields.io/badge/Hono-E36002?style=flat-square&logo=hono&logoColor=white" align="absmiddle"/></a> · <a href="https://react.dev"><img src="https://img.shields.io/badge/React-61DAFB?style=flat-square&logo=react&logoColor=black" align="absmiddle"/></a> · <a href="https://vitejs.dev"><img src="https://img.shields.io/badge/Vite-646CFF?style=flat-square&logo=vite&logoColor=white" align="absmiddle"/></a> · <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" align="absmiddle"/></a> · <a href="https://sqlite.org"><img src="https://img.shields.io/badge/SQLite-003B57?style=flat-square&logo=sqlite&logoColor=white" align="absmiddle"/></a></sub>

</div>
