// 信息流持久化：SQLite 文件库
// 设计：
//   - 5h TTL（CROSSFEED_FEED_TTL_SECONDS 可配）
//   - 启动时 + 每 5h 清理过期（server.ts 调度）
//   - getOrFetch(cacheKey, ttl, loader) 拿/取一体
//   - 失败兜底：如果 SQLite 写不进去，loader 的结果照样返（不阻断业务）
import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { FeedItem } from './normalize.js';
import { logger } from './logger.js';
import { parseIntSafe } from './parse.js';
import { env } from './env.js';

let DATA_DIR = env('dataDir', './data');
let DB_PATH = env('dbPath', join(DATA_DIR, 'crossfeed.db'));
const DEFAULT_TTL_SEC = parseIntSafe(env('feedTtl', '18000'), 18000, 60);

// 单例 DB
let _db: Database.Database | null = null;

/** 测试/启动前重定向库路径（会关掉已有连接） */
export function configurePersistence(opts: { dbPath?: string; dataDir?: string }) {
  closeDb();
  if (opts.dataDir) DATA_DIR = opts.dataDir;
  if (opts.dbPath) DB_PATH = opts.dbPath;
}

// 初始化：search_history / app_config / translation_cache
function ensureAuxTables(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS search_history (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      query       TEXT NOT NULL,
      last_used_at INTEGER NOT NULL,
      result_count INTEGER NOT NULL DEFAULT 0,
      UNIQUE(query)
    );
    CREATE INDEX IF NOT EXISTS idx_search_used ON search_history(last_used_at DESC);

    -- 配置表：key-value 存运行时配置（翻译 API key、平台 enable、TTL 等）
    CREATE TABLE IF NOT EXISTS app_config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS translation_cache (
      src_hash TEXT NOT NULL,
      target  TEXT NOT NULL,
      src     TEXT NOT NULL,
      dst     TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (src_hash, target)
    );
  `);
}

export function getSharedDb(): Database.Database {
  if (_db) return _db;
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');     // 并发读 + 单写
  db.pragma('synchronous = NORMAL');   // WAL 下 NORMAL 安全
  db.exec(`
    CREATE TABLE IF NOT EXISTS feed_items (
      cache_key  TEXT NOT NULL,
      id         TEXT NOT NULL,
      payload    TEXT NOT NULL,
      platform   TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      PRIMARY KEY (cache_key, id)
    );
    CREATE INDEX IF NOT EXISTS idx_expires ON feed_items(expires_at);
    CREATE INDEX IF NOT EXISTS idx_platform ON feed_items(platform);
  `);
  ensureAuxTables(db);
  _db = db;
  return db;
}

function getDb(): Database.Database {
  return getSharedDb();
}

// ---------- 核心 API ----------

/** 取出某 cache_key 下所有未过期的 FeedItem */
export function getActiveItems(cacheKey: string): FeedItem[] {
  try {
    const db = getDb();
    const now = Date.now();
    // 同时读 payload 和 fetched_at：fetched_at 用来给旧 item 兜底 publishedAt
    const rows = db
      .prepare(
        `SELECT payload, fetched_at FROM feed_items
         WHERE cache_key = ? AND expires_at > ?
         ORDER BY fetched_at DESC`
      )
      .all(cacheKey, now) as { payload: string; fetched_at: number }[];
    return rows
      .map(r => {
        const item = safeParse(r.payload);
        if (!item) return null;
        return item;
      })
      .filter((x): x is FeedItem => !!x);
  } catch (e) {
    logger.error('getActiveItems failed', { cacheKey, err: String(e) }, 'db');
    return [];
  }
}

/** 批量 UPSERT（去重 by (cache_key, id)） */
export function saveItems(cacheKey: string, items: FeedItem[], ttlSec: number = DEFAULT_TTL_SEC): number {
  if (items.length === 0) return 0;
  try {
    const db = getDb();
    const now = Date.now();
    const expiresAt = now + ttlSec * 1000;
    const stmt = db.prepare(`
      INSERT INTO feed_items (cache_key, id, payload, platform, fetched_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(cache_key, id) DO UPDATE SET
        payload    = excluded.payload,
        platform   = excluded.platform,
        fetched_at = excluded.fetched_at,
        expires_at = excluded.expires_at
    `);
    const tx = db.transaction((rows: FeedItem[]) => {
      let n = 0;
      for (const it of rows) {
        stmt.run(cacheKey, it.id, JSON.stringify(it), it.platform, now, expiresAt);
        n++;
      }
      return n;
    });
    return tx(items);
  } catch (e) {
    console.error('[persistence] saveItems failed:', e);
    return 0;
  }
}

/** 单条 patch 缩略图：定位到 (cache_key, refId) 那行，更新 payload.thumbnail。
 *  用于 fire-and-forget 后台 enrichment：图补到了就回写库，前端下次访问时直接拿。
 *  注：payload 是 JSON 字符串，所以走 "取 → 改 → 写" 模式，不用 json_set。 */
export function updateThumbnail(cacheKey: string, refId: string, thumbnail: string): boolean {
  try {
    const db = getDb();
    const row = db.prepare(
      `SELECT id, payload FROM feed_items
       WHERE cache_key = ? AND json_extract(payload, '$.refId') = ?
       LIMIT 1`
    ).get(cacheKey, refId) as { id: string; payload: string } | undefined;
    if (!row) return false;
    let obj: any;
    try { obj = JSON.parse(row.payload); } catch { return false; }
    obj.thumbnail = thumbnail;
    db.prepare(`UPDATE feed_items SET payload = ? WHERE cache_key = ? AND id = ?`)
      .run(JSON.stringify(obj), cacheKey, row.id);
    return true;
  } catch (e) {
    console.error('[persistence] updateThumbnail failed:', e);
    return false;
  }
}

/** 清理过期内容（DELETE WHERE expires_at < now） */
export function purgeExpired(): number {
  try {
    const db = getDb();
    const now = Date.now();
    const res = db.prepare(`DELETE FROM feed_items WHERE expires_at < ?`).run(now);
    if (res.changes > 0) {
      console.log(`[persistence] purged ${res.changes} expired items`);
    }
    return res.changes;
  } catch (e) {
    console.error('[persistence] purgeExpired failed:', e);
    return 0;
  }
}

/** 取或取：有新鲜的就返，没有就 loader 拉完再存再返 */
export async function getOrFetch<T extends FeedItem[]>(
  cacheKey: string,
  ttlSec: number,
  loader: () => Promise<{ items: T; errors?: Record<string, string> }>
): Promise<{ items: T; errors: Record<string, string>; fromCache: boolean }> {
  const cached = getActiveItems(cacheKey);
  if (cached.length > 0) {
    return { items: cached as T, errors: {}, fromCache: true };
  }
  const result = await loader();
  if (result.items.length > 0) {
    saveItems(cacheKey, result.items, ttlSec);
  }
  return { items: result.items, errors: result.errors || {}, fromCache: false };
}

// ---------- 工具 ----------

function safeParse(s: string): FeedItem | null {
  try {
    return JSON.parse(s) as FeedItem;
  } catch {
    return null;
  }
}

/** 派生稳定的 cache key */
export function deriveCacheKey(mode: string, q: string, platforms: string[], theme: string = 'mixed'): string {
  const sortedP = [...platforms].sort().join(',');
  if (mode === 'search') return `search:${q || '_'}:${sortedP}`;
  if (mode === 'single') return `single:${sortedP}`;
  const t = theme === 'tech' || theme === 'society' ? theme : 'mixed';
  return `mixed:${t}:${sortedP}`;
}

// =============================================================
//  搜索历史（独立表，永久保留，不被 5h 清理）
// =============================================================

/** 记录一次搜索：query 不存在则插入，存在则更新 last_used_at 和 result_count */
export function recordSearchHistory(query: string, resultCount: number): void {
  const trimmed = query.trim();
  if (!trimmed) return;
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO search_history (query, last_used_at, result_count)
      VALUES (?, ?, ?)
      ON CONFLICT(query) DO UPDATE SET
        last_used_at  = excluded.last_used_at,
        result_count  = excluded.result_count
    `).run(trimmed, Date.now(), resultCount);
  } catch (e) {
    console.error('[persistence] recordSearchHistory failed:', e);
  }
}

/** 取最近 N 条搜索历史（按 last_used_at 倒序） */
export function getRecentSearches(limit: number = 10): Array<{ query: string; last_used_at: number; result_count: number }> {
  try {
    const db = getDb();
    return db.prepare(`
      SELECT query, last_used_at, result_count
      FROM search_history
      ORDER BY last_used_at DESC
      LIMIT ?
    `).all(limit) as any;
  } catch (e) {
    console.error('[persistence] getRecentSearches failed:', e);
    return [];
  }
}

/** 删除某条搜索历史 */
export function deleteSearchHistory(query: string): void {
  try {
    const db = getDb();
    db.prepare(`DELETE FROM search_history WHERE query = ?`).run(query);
  } catch (e) {
    console.error('[persistence] deleteSearchHistory failed:', e);
  }
}

/** 清空所有搜索历史 */
export function clearSearchHistory(): number {
  try {
    const db = getDb();
    return db.prepare(`DELETE FROM search_history`).run().changes;
  } catch (e) {
    console.error('[persistence] clearSearchHistory failed:', e);
    return 0;
  }
}

// =============================================================
//  app_config：运行时配置（key-value），由 /api/config 路由读写
// =============================================================

/** 读一个配置项（不存在返 null） */
export function getConfig<T = any>(key: string): T | null {
  try {
    const db = getDb();
    const row = db.prepare(`SELECT value FROM app_config WHERE key = ?`).get(key) as any;
    if (!row) return null;
    return JSON.parse(row.value);
  } catch (e) {
    console.error('[persistence] getConfig failed:', e);
    return null;
  }
}

/** 写一个配置项（自动 JSON 序列化） */
export function setConfig(key: string, value: any): void {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO app_config (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `).run(key, JSON.stringify(value), Date.now());
  } catch (e) {
    console.error('[persistence] setConfig failed:', e);
  }
}

/** 批量读所有配置 */
export function getAllConfig(): Record<string, any> {
  try {
    const db = getDb();
    const rows = db.prepare(`SELECT key, value FROM app_config`).all() as any[];
    const out: Record<string, any> = {};
    for (const r of rows) {
      try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; }
    }
    return out;
  } catch (e) {
    console.error('[persistence] getAllConfig failed:', e);
    return {};
  }
}

/** 关库（测试 / graceful shutdown 用） */
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

export function getFeedCacheStats(): { total: number; alive: number; expired: number } {
  const db = getDb();
  const now = Date.now();
  const total = (db.prepare('SELECT COUNT(*) AS n FROM feed_items').get() as { n: number }).n;
  const alive = (db.prepare('SELECT COUNT(*) AS n FROM feed_items WHERE expires_at > ?').get(now) as { n: number }).n;
  return { total, alive, expired: total - alive };
}

export function countTranslationCache(): number {
  const db = getDb();
  return (db.prepare('SELECT COUNT(*) AS n FROM translation_cache').get() as { n: number }).n;
}

export function clearTranslationCache(): number {
  const db = getDb();
  return db.prepare('DELETE FROM translation_cache').run().changes;
}

/** 清空信息流缓存（保留设置和搜索历史） */
export function clearFeedCache(): number {
  const db = getDb();
  return db.prepare('DELETE FROM feed_items').run().changes;
}

/** 清空信息流 + 翻译缓存。不删 app_config / search_history。 */
export function clearCaches(): { feed: number; translations: number } {
  return {
    feed: clearFeedCache(),
    translations: clearTranslationCache(),
  };
}
