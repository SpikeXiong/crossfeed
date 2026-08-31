import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'crossfeed-'));
process.env.DATA_DIR = dir;
process.env.DB_PATH = join(dir, 't.db');

const {
  configurePersistence,
  closeDb,
  saveItems,
  getActiveItems,
  updateThumbnail,
  deriveCacheKey,
  recordSearchHistory,
  getRecentSearches,
  deleteSearchHistory,
  clearSearchHistory,
  setConfig,
  getConfig,
  getAllConfig,
  getFeedCacheStats,
  countTranslationCache,
  purgeExpired,
  clearFeedCache,
  clearCaches,
} = await import('../src/lib/persistence.js');

configurePersistence({ dataDir: dir, dbPath: join(dir, 't.db') });

after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

const sample = {
  id: 'bilibili-BV1',
  platform: 'bilibili',
  type: 'video' as const,
  title: 't',
  url: 'https://www.bilibili.com/video/BV1',
  refId: 'BV1',
  metrics: { views: 10 },
};

describe('deriveCacheKey', () => {
  it('is stable regardless of platform order', () => {
    assert.equal(
      deriveCacheKey('mixed', '', ['bilibili', 'weibo']),
      deriveCacheKey('mixed', '', ['weibo', 'bilibili']),
    );
    assert.equal(deriveCacheKey('mixed', '', ['youtube'], 'tech'), 'mixed:tech:youtube');
    assert.equal(deriveCacheKey('mixed', '', ['bilibili', 'weibo']), 'mixed:mixed:bilibili,weibo');
    assert.equal(deriveCacheKey('search', 'AI', ['youtube']), 'search:AI:youtube');
    assert.equal(deriveCacheKey('single', '', ['zhihu']), 'single:zhihu');
  });
});

describe('feed_items', () => {
  it('round-trips items and patches thumbnails', () => {
    const key = 'mixed:test';
    assert.equal(saveItems(key, [sample], 3600), 1);
    const got = getActiveItems(key);
    assert.equal(got.length, 1);
    assert.equal(got[0].title, 't');
    assert.equal(updateThumbnail(key, 'BV1', 'https://img.example/c.jpg'), true);
    assert.equal(getActiveItems(key)[0].thumbnail, 'https://img.example/c.jpg');
    const stats = getFeedCacheStats();
    assert.ok(stats.alive >= 1);
  });

  it('does not return expired rows', () => {
    const key = 'mixed:expired';
    saveItems(key, [{ ...sample, id: 'old' }], -1);
    assert.equal(getActiveItems(key).length, 0);
    assert.ok(purgeExpired() >= 1);
  });
});

describe('search_history + config', () => {
  it('upserts search history and supports delete/clear', () => {
    recordSearchHistory('  AI  ', 3);
    recordSearchHistory('AI', 8);
    const hist = getRecentSearches(5);
    const ai = hist.find(h => h.query === 'AI');
    assert.ok(ai);
    assert.equal(ai!.result_count, 8);
    deleteSearchHistory('AI');
    assert.equal(getRecentSearches(5).find(h => h.query === 'AI'), undefined);
    recordSearchHistory('foo', 1);
    assert.ok(clearSearchHistory() >= 1);
  });

  it('stores JSON config values', () => {
    setConfig('translate.enabled', true);
    assert.equal(getConfig('translate.enabled'), true);
    assert.equal(getAllConfig()['translate.enabled'], true);
  });

  it('has an empty translation cache initially', () => {
    assert.equal(countTranslationCache(), 0);
  });
});

describe('clearCaches', () => {
  it('clears feed items but keeps config', () => {
    setConfig('keep.me', 1);
    saveItems('mixed:wipe', [sample], 3600);
    assert.ok(getActiveItems('mixed:wipe').length >= 1);
    const n = clearFeedCache();
    assert.ok(n >= 1);
    assert.equal(getActiveItems('mixed:wipe').length, 0);
    assert.equal(getConfig('keep.me'), 1);
    assert.deepEqual(clearCaches(), { feed: 0, translations: 0 });
  });
});
