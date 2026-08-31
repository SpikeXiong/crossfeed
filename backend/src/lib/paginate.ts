import type { FeedItem } from './normalize.js';

/** 稳定可复现的洗牌（同一 seed 出同一顺序） */
export function seededShuffle<T>(arr: T[], seed: number): T[] {
  const a = [...arr];
  let s = seed === 0 ? 1 : seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function sortItems(items: FeedItem[], sort: string, seed: number = 0): FeedItem[] {
  if (sort === 'time') {
    return [...items].sort((a, b) => {
      const ta = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      const tb = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
      const na = Number.isFinite(ta) ? ta : 0;
      const nb = Number.isFinite(tb) ? tb : 0;
      return nb - na;
    });
  }
  if (sort === 'engagement') {
    const heat = (it: FeedItem) => {
      const m = it.metrics;
      return (m.views || 0) + (m.likes || 0) * 5 + (m.comments || 0) * 3 + (m.score || 0) * 2;
    };
    return [...items].sort((a, b) => heat(b) - heat(a));
  }
  return seededShuffle(items, seed);
}

export function paginate<T>(
  items: T[],
  page: number,
  perPage: number,
  opts: { shuffle?: boolean } = {},
): { items: T[]; hasMore: boolean; total: number } {
  if (items.length === 0) {
    return { items: [], hasMore: false, total: 0 };
  }
  const safePage = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
  const safePer = Number.isFinite(perPage) && perPage >= 1 ? Math.floor(perPage) : 1;
  const totalBuckets = Math.max(1, Math.ceil(items.length / safePer));
  if (safePage > totalBuckets) {
    return { items: [], hasMore: false, total: items.length };
  }
  const start = (safePage - 1) * safePer;
  const slice = items.slice(start, start + safePer);
  const out = opts.shuffle === false ? slice : seededShuffle(slice, safePage);
  return {
    items: out,
    hasMore: safePage < totalBuckets,
    total: items.length,
  };
}
