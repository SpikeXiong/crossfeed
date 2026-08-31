# OpenCLI Adapter：如何可复制

Crossfeed 不内置爬虫。所有源都通过本机 `opencli <site> <command> -f json` 拿数据。你自己的 Adapter 和官方 Adapter 走同一条调用链。

## 一台机器上怎么接

1. 安装 OpenCLI（Node >= 21）：

```bash
./deploy/install.sh --opencli   # 官方包 + 本仓库 Adapter
# 或手动：npm install -g @jackwener/opencli
opencli doctor          # 浏览器类 adapter 需要绿
opencli list -f json    # 看当前机器有哪些 site/command
```

2. **Crossfeed Adapter** 源文件在仓库 `deploy/opencli-clis/`，一键脚本拷到：

```
~/.opencli/clis/<site>/<command>.js
```

改完后把文件放进仓库 `deploy/opencli-clis/`，下次一键部署会同步过去。

3. Crossfeed 解析可执行文件的顺序：

1. 设置页 `opencli.path` 或环境变量 `OPENCLI_BIN`（绝对路径）
2. `~/.opencli/node_modules/@jackwener/opencli/dist/src/main.js`
3. 旧路径 `.../dist/cli.js`
4. PATH 里的 `opencli`

`.js` 入口会用当前 Node 启动，不依赖 shebang。

4. 在设置 → 数据源点 **探测已装 Adapter**，或：

```bash
curl -s http://127.0.0.1:4000/api/opencli/status | jq
```

`required` 列表是 Crossfeed 实际会调用的命令。缺的补 Adapter，多的不影响。

## Crossfeed 调用契约

```
opencli <site> <command> [args...] -f json [--window background] [--site-session ephemeral|persistent]
```

- stdout 必须是 **JSON 数组**（或单对象，后端会包成数组）。
- 混有 `(node:…)` / `Update available` 行会被剥掉再 parse。
- 不认识 `--window` 时后端会自动降级，再降级到只带 `-f json`。

需要登录的源（小红书 feed、抖音 video）使用 `--site-session persistent`。

### 各源期望字段（归一化用）

| site / command | 关键字段 |
|---|---|
| bilibili/hot | `bvid`, `title`, `url`, `author`, `play` |
| bilibili/search | `url`（含 `/video/BVxxx`）, `title`, `play` |
| bilibili/video | `{field,value}` 或对象里的 `thumbnail` |
| weibo/hot | `word`, `hot_value`, `rank`, `label`, `url` |
| weibo/search | `title`, `author`, `time`, `url`, `id` |
| zhihu/hot · search | `title`, `url`, `heat`, `answers` |
| hackernews/top · search | `id`, `title`, `url`, `score`, `comments`, `author` |
| youtube/search | `url`（`v=`）, `title`, `channel`/`author`, `views` |
| youtube/video | `thumbnail` |
| twitter/search | `id`, `text`, `author`, `url`, `likes`, `views`, `created_at` |
| douyin/search | `desc`, `url`（`/video/<id>`）, `plays`, `likes` |
| douyin/video | `cover` |
| xiaohongshu/feed · search | `note_id`/`id`, `title`, `url`, `cover` |
| xiaohongshu/note-cover | `cover` |

单位可以是 `4.2万` / `1.2M`，后端 `toNum` 会换算。

## 换机器 / 给 App 用同一套源

复制这三样就能复现：

1. 再跑 `./deploy/install.sh --opencli`（官方包 + `deploy/opencli-clis/`）
2. 需要登录的站点：在新机器上再扫一次码（persistent session 不能当文件拷）

可选：把 `./data/crossfeed.db` 拷过去，缓存和设置（含翻译 key）会一起走。密钥在库里是明文，只在受信机器之间拷。

App 侧不要再实现一遍抓取。App 只打这台电脑的 HTTP：

```
GET  http://<电脑局域网IP>:4000/api/runtime
GET  http://<电脑局域网IP>:4000/api/feed/stream?mode=mixed&theme=mixed&sort=shuffle
```

后端默认 `HOST=0.0.0.0`。用 `CORS_ORIGINS=*`（默认）或写成 App 的 origin 列表。

## 新写一个 Adapter 的最短路径

```bash
opencli browser init mysite/hot
# 编辑 ~/.opencli/clis/mysite/hot.js
opencli validate mysite/hot
opencli mysite/hot -f json
```

字段对齐上表后，把 `mysite` 加进 `backend/src/lib/feed.ts` 的 `sourcesForTheme` 和 `frontend` 的 `ALL_PLATFORMS` 即可。不必改 OpenCLI 调用层。
