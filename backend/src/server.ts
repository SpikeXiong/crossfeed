// Crossfeed 后端入口（Hono）
// 设计：单进程多路由，AI/OpenCLI 耗时操作直接 await（fast 模式）
// 新增：SQLite 持久化信息流，每 5h 清理过期
// 新增：结构化日志（ring buffer + /api/logs 端点）
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { feedHandler, feedStreamHandler, searchHistoryHandler } from './routes/feed.js';
import {
  purgeExpired,
  closeDb,
  getAllConfig,
  getConfig,
  setConfig,
  getFeedCacheStats,
  countTranslationCache,
  clearTranslationCache,
  clearCaches,
} from './lib/persistence.js';
import { logger, getLogBuffer, clearLogBuffer } from './lib/logger.js';
import { clearCache } from './lib/cache.js';
import { parseIntSafe } from './lib/parse.js';
import { feedTtlSec, defaultPerPage, enrichConcurrency, defaultTheme, defaultPerSource, maxAgeDays, translateEnabled, translateProvider } from './lib/runtimeConfig.js';
import { FEED_THEMES } from './lib/feed.js';
import { PLATFORM_HOMES } from './lib/authStatus.js';
import { getConnInfo } from '@hono/node-server/conninfo';
import {
  isLocalAdminRequest,
  sanitizeConfig,
  PUBLIC_WRITE_KEYS,
} from './lib/localAdmin.js';
import type { Context } from 'hono';

const app = new Hono();

// 请求日志中间件：每个请求自动记录 method + path + status + ms
app.use('*', async (c, next) => {
  const start = Date.now();
  const { method, path } = c.req;
  await next();
  const ms = Date.now() - start;
  const status = c.res.status;
  // 过滤掉无意义的轮询
  if (path === '/api/cache/status' || path === '/') {
    logger.debug(`${method} ${path} ${status} ${ms}ms`, { ms, status }, 'http');
  } else {
    logger.info(`${method} ${path} ${status} ${ms}ms`, { ms, status }, 'http');
  }
});

// CORS：本机 Web + 后续 App（Capacitor / 局域网）。默认放开 Origin，用 CORS_ORIGINS 收紧。
// 后端刻意听 0.0.0.0，App 才能打到这台机器的局域网 IP。
function resolveCorsOrigin(origin: string): string {
  if (!origin) return '*';
  const extra = (process.env.CORS_ORIGINS || '*').split(',').map(s => s.trim()).filter(Boolean);
  if (extra.includes('*')) return origin;
  if (extra.includes(origin)) return origin;
  if (
    /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin) ||
    /^https?:\/\/192\.168\.\d+\.\d+:\d+$/.test(origin) ||
    /^https?:\/\/10\.\d+\.\d+\.\d+:\d+$/.test(origin) ||
    /^https?:\/\/172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+:\d+$/.test(origin) ||
    /^https?:\/\/[\w.-]+\.local:\d+$/.test(origin) ||
    /^capacitor:\/\//.test(origin) ||
    /^ionic:\/\//.test(origin)
  ) return origin;
  return extra[0] || origin;
}

function remoteAddress(c: Context): string | undefined {
  try {
    return getConnInfo(c).remote.address;
  } catch {
    return undefined;
  }
}

function isLocalAdmin(c: Context): boolean {
  return isLocalAdminRequest({
    origin: c.req.header('origin'),
    referer: c.req.header('referer'),
    remoteAddress: remoteAddress(c),
  });
}

function forbidRemoteAdmin(c: Context) {
  if (isLocalAdmin(c)) return null;
  return c.json({ ok: false, error: '仅本机可操作，请用 localhost 打开页面' }, 403);
}

app.use('*', cors({
  origin: resolveCorsOrigin,
  credentials: true,
}));

// 健康检查 + App 启动探测
app.get('/', (c) => c.json({ ok: true, service: 'crossfeed-backend', version: '0.3.0' }));

app.get('/api/runtime', (c) => {
  const localAdmin = isLocalAdmin(c);
  return c.json({
    ok: true,
    service: 'crossfeed-backend',
    version: '0.3.0',
    listen: `${process.env.HOST || '0.0.0.0'}:${process.env.PORT || '4000'}`,
    localAdmin,
    platforms: PLATFORM_HOMES.map(p => ({ id: p.id, homeUrl: p.homeUrl, public: !!p.public })),
    themes: Object.entries(FEED_THEMES).map(([id, t]) => ({ id, label: t.label })),
    feed: {
      ttlSeconds: feedTtlSec(),
      perPage: defaultPerPage(),
      perSource: defaultPerSource(),
      maxAgeDays: maxAgeDays(),
      enrichConcurrency: enrichConcurrency(),
      theme: defaultTheme(),
    },
    translate: {
      enabled: translateEnabled(),
      provider: localAdmin ? translateProvider() : undefined,
    },
  });
});

// XHS 登录触发：调一次 feed 命令，OpenCLI 会弹出后台浏览器让用户扫码登录
// 登录会话被 --site-session persistent 保持，后续 XHS 调用自动带 cookie
app.post('/api/xhs/login', async (c) => {
  const denied = forbidRemoteAdmin(c);
  if (denied) return denied;
  try {
    const { callOpenCli } = await import('./lib/opencli.js');
    console.log('[xhs] triggering login flow, please scan QR in the popup window...');
    const r = await callOpenCli('xiaohongshu', 'feed', [], { siteSession: 'persistent', timeoutMs: 120000 });
    if (r.ok) {
      setConfig('xhs.lastOkAt', Date.now());
      setConfig('xhs.lastError', null);
      return c.json({ ok: true, loggedIn: true, message: '登录成功（如果弹出了登录窗口，请扫描二维码）', count: r.data?.length });
    }
    setConfig('xhs.lastError', r.error || 'unknown');
    return c.json({ ok: false, loggedIn: false, error: r.error || 'unknown' }, 500);
  } catch (e: any) {
    return c.json({ ok: false, error: e.message || String(e) }, 500);
  }
});

// 翻译端点：英文 title 翻译成中文（带 SQLite 缓存）
app.post('/api/translate', async (c) => {
  try {
    const body = await c.req.json();
    const { text, target = 'zh' } = body;
    if (!text || typeof text !== 'string') {
      return c.json({ ok: false, error: 'text required' }, 400);
    }
    const { translateText, isChineseText, getCachedTranslation } = await import('./lib/translate.js');
    const cached = getCachedTranslation(text, target);
    const isChinese = isChineseText(text);
    if (isChinese && target === 'zh') {
      return c.json({ ok: true, src: text, dst: text, cached: true, isChinese: true });
    }
    const start = Date.now();
    const dst = await translateText(text, target);
    const ms = Date.now() - start;
    return c.json({ ok: true, src: text, dst, cached: !!cached, isChinese: false, ms });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 500);
  }
});

// 缓存状态（运维用）
app.get('/api/cache/status', (c) => {
  try {
    const { total, alive, expired } = getFeedCacheStats();
    return c.json({ ok: true, total, alive, expired, ttlSeconds: feedTtlSec() });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 500);
  }
});

// API 路由
app.get('/api/feed', feedHandler);
// SSE 流式：每平台完成一条立刻 emit（cache hit 立即发完）
app.get('/api/feed/stream', feedStreamHandler);
app.get('/api/search/history', searchHistoryHandler);
app.delete('/api/search/history', searchHistoryHandler);

// 配置读写（key-value，存 app_config 表）
app.get('/api/config', (c) => {
  const localAdmin = isLocalAdmin(c);
  return c.json({
    ok: true,
    localAdmin,
    config: sanitizeConfig(getAllConfig() as Record<string, unknown>, localAdmin),
  });
});
app.put('/api/config', async (c) => {
  try {
    const body = await c.req.json();
    if (!body || typeof body !== 'object') {
      return c.json({ ok: false, error: 'body must be object' }, 400);
    }
    const localAdmin = isLocalAdmin(c);
    const keys = Object.keys(body);
    if (!localAdmin && keys.some(k => !PUBLIC_WRITE_KEYS.has(k))) {
      return c.json({ ok: false, error: '仅本机可修改站点与数据源设置，请用 localhost 打开' }, 403);
    }
    for (const [k, v] of Object.entries(body)) {
      if (typeof k === 'string' && k.length < 100) {
        setConfig(k, v);
      }
    }
    if ('opencli.path' in body) {
      const { resetOpenCliBin } = await import('./lib/opencli.js');
      resetOpenCliBin();
    }
    return c.json({
      ok: true,
      localAdmin,
      config: sanitizeConfig(getAllConfig() as Record<string, unknown>, localAdmin),
    });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 500);
  }
});

// 翻译缓存管理
app.get('/api/translate/stats', (c) => {
  const denied = forbidRemoteAdmin(c);
  if (denied) return denied;
  try {
    return c.json({ ok: true, total: countTranslationCache() });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 500);
  }
});
app.delete('/api/translate/cache', (c) => {
  const denied = forbidRemoteAdmin(c);
  if (denied) return denied;
  try {
    return c.json({ ok: true, cleared: clearTranslationCache() });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 500);
  }
});

// 平台会话清理（XHS / 抖音的 persistent session）
app.get('/api/xhs/status', (c) => {
  const denied = forbidRemoteAdmin(c);
  if (denied) return denied;
  const lastOkAt = getConfig<number>('xhs.lastOkAt');
  const lastError = getConfig<string>('xhs.lastError');
  let state: 'ok' | 'failed' | 'unknown' = 'unknown';
  if (lastOkAt && Date.now() - lastOkAt < feedTtlSec() * 1000) state = 'ok';
  else if (lastError) state = 'failed';
  return c.json({ ok: true, state, lastOkAt, lastError, loggedIn: state === 'ok' });
});

app.post('/api/xhs/clear-session', (c) => {
  const denied = forbidRemoteAdmin(c);
  if (denied) return denied;
  setConfig('xhs.lastOkAt', null);
  setConfig('xhs.lastError', null);
  return c.json({ ok: true, message: '已清本地登录标记。下次拉小红书时会重新走登录。' });
});

app.get('/api/platforms/status', async (c) => {
  const denied = forbidRemoteAdmin(c);
  if (denied) return denied;
  const { scanPlatformAuth } = await import('./lib/authStatus.js');
  const platforms = await scanPlatformAuth();
  return c.json({ ok: true, platforms });
});

app.delete('/api/cache', (c) => {
  const denied = forbidRemoteAdmin(c);
  if (denied) return denied;
  try {
    const cleared = clearCaches();
    const memory = clearCache();
    return c.json({ ok: true, cleared: { ...cleared, memory } });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 500);
  }
});

app.get('/api/opencli/status', async (c) => {
  const denied = forbidRemoteAdmin(c);
  if (denied) return denied;
  const { probeOpenCli } = await import('./lib/opencli.js');
  const probe = await probeOpenCli();
  return c.json({ ok: probe.ok, ...probe });
});

// 日志查看（供前端 SettingsDialog 的 Logs Tab 用）
app.get('/api/logs', (c) => {
  const denied = forbidRemoteAdmin(c);
  if (denied) return denied;
  const limit = parseIntSafe(c.req.query('limit'), 200, 1, 1000);
  const level = (c.req.query('level') || 'all') as any;
  const src = c.req.query('src') || undefined;
  const since = parseIntSafe(c.req.query('since'), 0, 0);
  return c.json({ ok: true, logs: getLogBuffer({ limit, level, src, since }) });
});
app.delete('/api/logs', (c) => {
  const denied = forbidRemoteAdmin(c);
  if (denied) return denied;
  clearLogBuffer();
  return c.json({ ok: true });
});

// 404
app.notFound((c) => c.json({ ok: false, error: 'not found' }, 404));

// 错误兜底
app.onError((err, c) => {
  console.error('[server] error:', err);
  return c.json({ ok: false, error: err.message || 'internal error' }, 500);
});

const PORT = parseIntSafe(process.env.PORT, 4000, 1, 65535);
const HOST = process.env.HOST || '0.0.0.0';

console.log(`🚀 Crossfeed backend starting on http://${HOST}:${PORT}`);

// 启动时清一次（防服务异常宕机后留下的过期行）
purgeExpired();

// 每 5 小时清理一次过期
const CLEANUP_MS = 5 * 60 * 60 * 1000;
const cleanupTimer = setInterval(() => {
  console.log('[server] running scheduled feed cleanup...');
  purgeExpired();
}, CLEANUP_MS);
cleanupTimer.unref?.();

// 优雅退出
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    console.log(`\n[server] ${sig} received, shutting down...`);
    clearInterval(cleanupTimer);
    closeDb();
    process.exit(0);
  });
}

// HTTP keep-alive：100 并发下 p99 37ms → ~20ms
// - keepAliveTimeout=65s：默认 5s 偏短，浏览器/curl 并发会反复建连
// - headersTimeout=66s：必须 > keepAliveTimeout（Node 内置校验）
// - requestTimeout=120s：兜住缩略图补抓这种长操作
const KEEPALIVE_MS = 65_000;

serve({
  fetch: app.fetch,
  port: PORT,
  hostname: HOST,
  serverOptions: {
    keepAliveTimeout: KEEPALIVE_MS,
    headersTimeout: KEEPALIVE_MS + 1_000,
    requestTimeout: 120_000,
  },
});
console.log(`[server] keep-alive enabled (timeout=${KEEPALIVE_MS}ms, requestTimeout=120s)`);
