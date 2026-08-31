# Crossfeed

本机多源信息流。Web 和 API 都听 **`0.0.0.0`**，同一局域网的手机/电脑可以直接打开。抓取全部走本机 OpenCLI（含你自己的 Adapter）。

## 启动

```bash
npm install
# 可选：翻译
# export MINIMAX_API_KEY=...
# 或之后在设置页填写（写入 SQLite，立即生效）
npm run dev
```

- Web：http://127.0.0.1:3000 ，局域网 `http://<这台机器的IP>:3000`
- API：http://127.0.0.1:4000 ，局域网 `http://<这台机器的IP>:4000`
- App 探测：`GET /api/runtime`

需要 Node 22+（后端）、本机已装 [OpenCLI](https://github.com/jackwener/OpenCLI)。

## 第一次用小红书

点「登录小红书」，扫码。状态来自**最近一次成功拉取**，不是 3 秒后假装成功。失败会显示「需登录」。

## 环境变量

| 变量 | 默认 | 作用 |
|---|---|---|
| `HOST` | `0.0.0.0` | 给 App 留着，不要改成 127.0.0.1 |
| `PORT` | `4000` | API 端口 |
| `CORS_ORIGINS` | `*` | 逗号分隔白名单；`*` 允许任意 Origin（含 Capacitor） |
| `OPENCLI_BIN` | 自动探测 | opencli 可执行文件或 `main.js` |
| `FEED_TTL_SECONDS` | `18000` | 可被设置页覆盖 |
| `MINIMAX_API_KEY` / `BASE_URL` / `MODEL` | — | 可被设置页覆盖 |
| `DB_PATH` / `DATA_DIR` | `./data/crossfeed.db` | SQLite |

设置页的 TTL、每页条数、OpenCLI 路径、MiniMax、补图并发、跳过文字平台 **保存后立刻生效**（不再只写库不用）。

## 主题

综合 / 科技 / 社会。只改 YouTube、X、抖音的默认搜索词，不再把国外源钉死在「AI」。

## OpenCLI 与自定义 Adapter

见 [docs/opencli-adapters.md](docs/opencli-adapters.md)。换机器：拷 `~/.opencli/clis/` + 重装 OpenCLI + 重新登录需要 cookie 的站。

设置页「探测已装 Adapter」或 `GET /api/opencli/status` 可核对 Crossfeed 需要的 `site/command` 缺不缺。

## 给后续 App

1. 电脑开着 `npm run dev:backend`（或 `start:backend`）。
2. App 把 API base 配成 `http://<电脑IP>:4000`。
3. 先打 `GET /api/runtime` 确认版本、主题、perPage。
4. 信息流用 `GET /api/feed/stream`（SSE）看分源进度；翻页用 `GET /api/feed?page=2`。
5. 不要在 App 里再调 OpenCLI。

## 测试

```bash
npm test
```
