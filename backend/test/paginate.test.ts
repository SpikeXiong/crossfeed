import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { paginate, sortItems, seededShuffle } from '../src/lib/paginate.js';
import type { FeedItem } from '../src/lib/normalize.js';
import { parseIntSafe } from '../src/lib/parse.js';

function item(partial: Partial<FeedItem> & { id: string }): FeedItem {
  return {
    platform: 'test',
    type: 'article',
    title: partial.id,
    url: `https://ex.com/${partial.id}`,
    metrics: {},
    ...partial,
  };
}

describe('seededShuffle', () => {
  it('is deterministic for the same seed', () => {
    const src = [1, 2, 3, 4, 5, 6, 7, 8];
    assert.deepEqual(seededShuffle(src, 7), seededShuffle(src, 7));
    assert.notDeepEqual(seededShuffle(src, 7), seededShuffle(src, 8));
    assert.deepEqual(src, [1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('sortItems', () => {
  const items = [
    item({ id: 'a', publishedAt: '2024-01-01T00:00:00.000Z', metrics: { views: 10, likes: 1 } }),
    item({ id: 'b', publishedAt: '2024-06-01T00:00:00.000Z', metrics: { views: 1, likes: 20 } }),
    item({ id: 'c', publishedAt: '2024-03-01T00:00:00.000Z', metrics: { views: 100 } }),
  ];

  it('sorts by time descending', () => {
    assert.deepEqual(sortItems(items, 'time').map(i => i.id), ['b', 'c', 'a']);
  });

  it('sorts by engagement (likes weighted)', () => {
    // a: 10+5=15, b: 1+100=101, c: 100
    assert.deepEqual(sortItems(items, 'engagement').map(i => i.id), ['b', 'c', 'a']);
  });
});

describe('paginate', () => {
  const items = Array.from({ length: 10 }, (_, i) => `i${i}`);

  it('returns non-overlapping buckets and hasMore', () => {
    const p1 = paginate(items, 1, 4, { shuffle: false });
    const p2 = paginate(items, 2, 4, { shuffle: false });
    const p3 = paginate(items, 3, 4, { shuffle: false });
    const p4 = paginate(items, 4, 4, { shuffle: false });
    assert.deepEqual(p1.items, ['i0', 'i1', 'i2', 'i3']);
    assert.equal(p1.hasMore, true);
    assert.deepEqual(p2.items, ['i4', 'i5', 'i6', 'i7']);
    assert.deepEqual(p3.items, ['i8', 'i9']);
    assert.equal(p3.hasMore, false);
    assert.deepEqual(p4.items, []);
    assert.equal(p4.hasMore, false);
  });

  it('does not shuffle when sort is time/engagement', () => {
    const timed = [
      item({ id: 'new', publishedAt: '2024-06-01T00:00:00.000Z' }),
      item({ id: 'mid', publishedAt: '2024-03-01T00:00:00.000Z' }),
      item({ id: 'old', publishedAt: '2024-01-01T00:00:00.000Z' }),
    ];
    const sorted = sortItems(timed, 'time');
    const page = paginate(sorted, 1, 3, { shuffle: false });
    assert.deepEqual(page.items.map(i => i.id), ['new', 'mid', 'old']);
  });

  it('treats NaN page as page 1', () => {
    const p = paginate(items, Number.NaN, 4, { shuffle: false });
    assert.deepEqual(p.items, ['i0', 'i1', 'i2', 'i3']);
  });
});

describe('parseIntSafe', () => {
  it('falls back on garbage and clamps', () => {
    assert.equal(parseIntSafe('abc', 7), 7);
    assert.equal(parseIntSafe(undefined, 3), 3);
    assert.equal(parseIntSafe('0', 1, 1), 1);
    assert.equal(parseIntSafe('999', 24, 6, 60), 60);
    assert.equal(parseIntSafe('12', 24, 6, 60), 12);
  });
});
