// GET /api/feed?mode=mixed&q=AI&platforms=bilibili,twitter
// GET /api/feed?mode=search&q=AI&platforms=...
// GET /api/feed?mode=single&platform=bilibili
// 行为：
//   - 先查 SQLite 缓存（5h TTL），有就直接返
//   - 没有再调 OpenCLI 拉（每个平台一个标签页，列表里带齐封面），再落库，再返
//   - 分页：?page=N&perPage=M (默认 30)
//   - 分页：?page=N&perPage=M (默认 30)。首页 SSE 只推第一页，其余从缓存翻页。
//   - 排序：?sort=time|engagement|shuffle (默认 shuffle, "反茧房"随机)
//   - 搜索模式额外写入 search_history 表
import type { Context } from 'hono';
import { pullMixedFeed, pullMixedFeedStreaming, sourcesForTheme, SINGLE_SOURCES, buildSearchSources } from '../lib/feed.js';
import {
  getOrFetch,
  deriveCacheKey,
  saveItems,
  getActiveItems,
  recordSearchHistory,
  getRecentSearches,
  deleteSearchHistory,
  clearSearchHistory,
  setConfig,
} from '../lib/persistence.js';
import type { FeedItem } from '../lib/normalize.js';
import { logger, timed } from '../lib/logger.js';
import { streamSSE } from 'hono/streaming';
import { sortItems, paginate } from '../lib/paginate.js';
import { parseIntSafe } from '../lib/parse.js';
import {
  feedTtlSec,
  defaultPerPage,
} from '../lib/runtimeConfig.js';

function resolveSources(c: Context) {
  const mode = c.req.query('mode') || 'mixed';
  const platform = c.req.query('platform') || 'bilibili';
  const q = c.req.query('q')?.trim() || '';
  const platformsParam = c.req.query('platforms') || '';
  const theme = c.req.query('theme') || 'mixed';

  let sources;
  let platformList: string[];
  if (mode === 'search') {
    sources = buildSearchSources(q);
    platformList = sources.map(s => s.platform);
  } else if (mode === 'single' && SINGLE_SOURCES[platform]) {
    sources = [SINGLE_SOURCES[platform]];
    platformList = [platform];
  } else {
    sources = sourcesForTheme(theme);
    platformList = sources.map(s => s.platform);
  }
  if (platformsParam) {
    const allowed = new Set(platformsParam.split(',').map(s => s.trim()).filter(Boolean));
    sources = sources.filter(s => allowed.has(s.platform));
    platformList = sources.map(s => s.platform);
  }
  return {
    mode,
    platform,
    q,
    theme,
    sources,
    platformList,
    cacheKey: deriveCacheKey(mode, q, platformList, theme),
  };
}

function rememberXhs(key: string, items: FeedItem[], err?: string) {
  if (!key.startsWith('xiaohongshu')) return;
  if (items.length > 0) {
    setConfig('xhs.lastOkAt', Date.now());
    setConfig('xhs.lastError', null);
  } else if (err) {
    setConfig('xhs.lastError', err);
  }
}

export async function feedHandler(c: Context) {
  const forceRefresh = c.req.query('fresh') === '1';
  const page = parseIntSafe(c.req.query('page'), 1, 1);
  const perPage = parseIntSafe(c.req.query('perPage'), defaultPerPage(), 6, 60);
  const sort = c.req.query('sort') || 'shuffle';
  const { mode, platform, q, sources, cacheKey } = resolveSources(c);
  const ttl = feedTtlSec();

  try {
    // 缓存层存全量（不分页），分页在内存里做（数据量小，48 条左右）
    const result = forceRefresh
      ? await fetchEnrichAndSave(cacheKey, sources)
      : await getOrFetch(cacheKey, ttl, () => fetchEnrichPartial(cacheKey, sources));

    // 只用原帖时间。实时热榜（live）在 pull 时已盖上拉取时刻。
    // 旧缓存若完全没有 publishedAt，保持为空，前端显示空白而不是伪装成「刚刚」。

    // 排序 + 分页
    // time/engagement 保持排序，不在页内再洗牌；shuffle 才按桶洗
    const sorted = sortItems(result.items, sort, 0);
    const paged = paginate(sorted, page, perPage, { shuffle: sort === 'shuffle' });

    // 预热：滚到第 4 桶时,后端 silent 触发 fresh 拉新内容
    // 等到第 5 桶用完时,新池子已经 ready,用户点"加载新内容"秒返
    const totalBuckets = Math.max(1, Math.ceil(result.items.length / perPage));
    if (page === totalBuckets - 1 && !forceRefresh && result.fromCache) {
      // 在后台跑,不 await,不阻塞当前响应
      setImmediate(() => {
        logger.info(`预热 ${cacheKey} 即将耗尽,silent refresh...`, { cacheKey }, 'feed');
        timed('feed', 'prewarm refresh', () => fetchEnrichAndSave(cacheKey, sources)).catch(e => {
          logger.warn('预热失败', { err: String(e) }, 'feed');
        });
      });
    }

    // 搜索模式记录历史
    if (mode === 'search' && q && page === 1) {
      recordSearchHistory(q, result.items.length);
    }

    // HTTP cache 头：浏览器/代理能复用响应
    // - max-age=60: 60 秒内直接返
    // - stale-while-revalidate=1800: 30 分钟内用过期的同时后台静默刷新
    // - force refresh 时: no-store
    c.header('Cache-Control', forceRefresh
      ? 'no-store'
      : 'public, max-age=60, stale-while-revalidate=1800'
    );

    // ETag：基于 cacheKey + page + sort, 客户端命中返 304
    // 必须 ASCII（Node 23 setHeader 严格 ByteString 检查，cacheKey 含中文 search query 会 throw）
    // 用 base64url 编码避免 Latin-1 限制
    const etagRaw = `${cacheKey}|p${page}|s${sort}`;
    const etag = `"${Buffer.from(etagRaw, 'utf8').toString('base64url')}"`;
    c.header('ETag', etag);
    if (c.req.header('if-none-match') === etag) {
      c.status(304);
      return c.body(null);
    }

    return c.json({
      ok: true,
      items: paged.items,
      errors: result.errors,
      mode,
      platform,
      q,
      enriched: true,
      fromCache: result.fromCache,
      cacheKey,
      ttlSeconds: ttl,
      pagination: {
        page,
        perPage,
        total: paged.total,
        hasMore: paged.hasMore,
      },
      sort,
      timestamp: Date.now(),
    });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 500);
  }
}

// 搜索历史相关端点
export async function searchHistoryHandler(c: Context) {
  const method = c.req.method;
  if (method === 'GET') {
    const limit = parseIntSafe(c.req.query('limit'), 10, 1, 100);
    return c.json({ ok: true, history: getRecentSearches(limit) });
  }
  if (method === 'DELETE') {
    const query = c.req.query('query');
    if (query === '*') {
      const n = clearSearchHistory();
      return c.json({ ok: true, cleared: n });
    }
    if (query) {
      deleteSearchHistory(query);
      return c.json({ ok: true });
    }
    return c.json({ ok: false, error: 'query required' }, 400);
  }
  return c.json({ ok: false, error: 'method not allowed' }, 405);
}

// 强制刷新：拉 → 立刻落库 → 立即返回。后台异步补缩略图（fire-and-forget）。
// 收益：首拉 12s（opencli 3.7s + enrich 8s+）→ 0.5s（只剩 opencli）。
async function fetchEnrichAndSave(cacheKey: string, sources: any[]) {
  logger.info('fetchEnrichAndSave start', { cacheKey, sources: sources.length }, 'feed');
  const r = await pullMixedFeed({ sources });
  if (r.items.length > 0) {
    const saved = saveItems(cacheKey, r.items, feedTtlSec());
    logger.info('saved to cache', { count: saved, cacheKey }, 'feed');

    // 后台异步补缩略图：每条补到立刻 patch 回 SQLite，前端下次访问能直接拿到
    setImmediate(() => {
      enrichThumbnailsInBackground(cacheKey, r.items).catch(e => {
        logger.warn('background thumbnail enrichment failed', { err: String(e) }, 'feed');
      });
    });
  }
  return { items: r.items, errors: r.errors, fromCache: false };
}

// getOrFetch 走的 loader：首拉缓存为空时走这里。也是 fire-and-forget enrichment。
async function fetchEnrichPartial(cacheKey: string, sources: any[]) {
  const r = await pullMixedFeed({ sources });
  if (r.items.length > 0) {
    saveItems(cacheKey, r.items, feedTtlSec());
    setImmediate(() => {
      enrichThumbnailsInBackground(cacheKey, r.items).catch(e => {
        logger.warn('background thumbnail enrichment failed', { err: String(e) }, 'feed');
      });
    });
  }
  return { items: r.items, errors: r.errors };
}

// 列表页已经带齐卡片字段。这里只打一条日志，不再逐条开标签页。
async function enrichThumbnailsInBackground(
  cacheKey: string,
  items: FeedItem[],
  _onItemUpdated?: (item: FeedItem) => void | Promise<void>,
): Promise<void> {
  logger.info('skip per-item enrich (one tab per platform)', { cacheKey, items: items.length }, 'feed');
}

// =============================================================
//  SSE 流式：GET /api/feed/stream?mode=mixed&...
//
//  行为：
//    - cache hit 立即发完全部 items（一次 emit）+ done
//    - cache miss 并发拉多源，每完成一个平台就 emit 一批
//    - 客户端断开时通过 c.req.raw.signal 中止后端拉取
//
//  事件类型：
//    - meta  : { startedAt, sources, fromCache }
//    - batch : { source, items, count }   每平台完成时
//    - done  : { total, ms, errors, fromCache }
// =============================================================
export async function feedStreamHandler(c: Context) {
  const forceRefresh = c.req.query('fresh') === '1';
  const sort = c.req.query('sort') || 'shuffle';
  const { mode, sources, platformList, cacheKey } = resolveSources(c);
  const startedAt = Date.now();
  const ttl = feedTtlSec();
  const perPage = parseIntSafe(c.req.query('perPage'), defaultPerPage(), 6, 60);

  // Search 模式：总是 fresh + 流式（用户偏好"搜什么都能看到拉取过程"）
  // Mixed 模式：cache hit 走快路径（保留原行为，避免无谓打 OpenCLI）
  const effectiveForceRefresh = forceRefresh || mode === 'search';

  return streamSSE(c, async (stream) => {
    const abort = c.req.raw.signal;
    let aborted = false;
    const onAbort = () => { aborted = true; };
    abort?.addEventListener('abort', onAbort);

    // 缩略图到手就 emit 一个 thumbnail 事件（前端按 id patch）
    const pushThumbnail = async (item: FeedItem) => {
      if (aborted) return;
      try {
        await stream.writeSSE({
          event: 'thumbnail',
          data: JSON.stringify({ id: item.id, thumbnail: item.thumbnail }),
        });
      } catch { /* 客户端断开，吞掉 */ }
    };

    try {
      // 1. 优先走缓存：有就直接发完
      const cached = effectiveForceRefresh ? [] : getActiveItemsSafe(cacheKey);
      if (cached.length > 0) {
        const sorted = sortItems(cached, sort, 0);
        const paged = paginate(sorted, 1, perPage, { shuffle: sort === 'shuffle' });
        await stream.writeSSE({
          event: 'meta',
          data: JSON.stringify({ startedAt, sources: platformList, fromCache: true, cacheKey, sort }),
        });
        await stream.writeSSE({
          event: 'batch',
          data: JSON.stringify({ source: 'cache', items: paged.items, count: paged.items.length }),
        });
        await stream.writeSSE({
          event: 'done',
          data: JSON.stringify({
            total: cached.length,
            ms: Date.now() - startedAt,
            errors: {},
            fromCache: true,
            cacheKey,
            hasMore: paged.hasMore,
            sort,
          }),
        });
        // cache hit：封面已在 SQLite 里。再补抓会把小红书/抖音公开页打出「频繁请求」。
        if (!aborted) {
          await stream.writeSSE({
            event: 'enrichDone',
            data: JSON.stringify({ total: cached.length, ms: Date.now() - startedAt, skipped: true }),
          });
        }
        return;
      }

      // 2. cache miss：并发拉，每完成一个就 emit
      await stream.writeSSE({
        event: 'meta',
        data: JSON.stringify({ startedAt, sources: platformList, fromCache: false, cacheKey, sort }),
      });

      const allItems: FeedItem[] = [];
      const errors: Record<string, string> = {};
      let emitted = 0;

      const { totalItems, errors: streamErrors } = await pullMixedFeedStreaming(
        { sources },
        async (key, items, err) => {
          if (aborted) return;
          allItems.push(...items);
          if (err) errors[key] = err;
          rememberXhs(key, items, err);
          const ranked = sort === 'shuffle' ? items : sortItems(items, sort, 0);
          const room = Math.max(0, perPage - emitted);
          const outgoing = ranked.slice(0, room);
          emitted += outgoing.length;
          await stream.writeSSE({
            event: 'batch',
            data: JSON.stringify({ source: key, items: outgoing, count: items.length, err }),
          });
        },
        { get aborted() { return aborted; } },
      );

      if (aborted) return;

      if (allItems.length > 0) {
        try { saveItems(cacheKey, allItems, ttl); } catch (e) {
          console.warn('[feed-stream] saveItems failed:', e);
        }
      }

      const paged = paginate(sortItems(allItems, sort, 0), 1, perPage, { shuffle: sort === 'shuffle' });
      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify({
          total: totalItems || allItems.length,
          ms: Date.now() - startedAt,
          errors: { ...errors, ...streamErrors },
          fromCache: false,
          cacheKey,
          hasMore: paged.hasMore,
          sort,
        }),
      });

      if (!aborted) {
        if (allItems.length > 0) {
          await enrichThumbnailsInBackground(cacheKey, allItems, pushThumbnail);
        }
        if (!aborted) {
          await stream.writeSSE({
            event: 'enrichDone',
            data: JSON.stringify({ total: allItems.length, ms: Date.now() - startedAt }),
          });
        }
      }
    } catch (e: any) {
      try {
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ error: e?.message || String(e) }),
        });
      } catch {}
    } finally {
      abort?.removeEventListener('abort', onAbort);
    }
  });
}

// 局部 import 避免循环：persistence 的 getActiveItems
function getActiveItemsSafe(key: string): FeedItem[] {
  try { return getActiveItems(key); } catch { return []; }
}
