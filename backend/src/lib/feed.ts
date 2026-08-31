// 平台抓取编排：每个平台一组命令，结果归一化后混在一起
import { callOpenCli } from './opencli.js';
import { normalizeItem, FeedItem, isFreshEnough } from './normalize.js';
import { perSourceLimit, maxAgeDays, recencySinceDate } from './runtimeConfig.js';

export interface SourceConfig {
  platform: string;
  command: string;
  args?: string[];
  extra?: string[];
  needsAuth?: boolean;
  weight?: number;
}

interface PullArgs {
  sources: SourceConfig[];
  perSourceLimit?: number;
  totalLimit?: number;
}

const PERSISTENT_SOURCES = new Set(['xiaohongshu', 'douyin', 'twitter', 'weibo', 'zhihu']);
const RECENCY_PLATFORMS = new Set(['youtube', 'twitter', 'weibo']);

async function pullOne(source: SourceConfig, limit: number): Promise<FeedItem[]> {
  const session = PERSISTENT_SOURCES.has(source.platform) ? 'persistent' : 'ephemeral';
  const extra = [...(source.extra || []), '--limit', String(limit)];
  const res = await callOpenCli(source.platform, source.command, source.args || [], {
    extraArgs: extra,
    siteSession: session as any,
    timeoutMs: source.platform === 'douyin' ? 45_000 : undefined,
  });
  if (!res.ok || !res.data) {
    if (!source.needsAuth) {
      console.warn(`[${source.platform}/${source.command}] failed:`, res.error?.slice(0, 100));
    }
    return [];
  }
  const items: FeedItem[] = [];
  const ageDays = RECENCY_PLATFORMS.has(source.platform) ? maxAgeDays(source.platform) : 0;
  for (const raw of res.data.slice(0, limit)) {
    const item = normalizeItem(source.platform, raw);
    if (!item) continue;
    if (ageDays > 0 && !item.live && !isFreshEnough(item.publishedAt, ageDays)) continue;
    items.push(item);
  }
  return items;
}

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function stampLiveDates(items: FeedItem[]): void {
  const fetchedAt = new Date().toISOString();
  for (const it of items) {
    if (it.live && !it.publishedAt) it.publishedAt = fetchedAt;
  }
}

export async function pullMixedFeed(args: PullArgs): Promise<{
  items: FeedItem[];
  errors: Record<string, string>;
}> {
  const { sources, totalLimit = 150 } = args;

  const results = await Promise.allSettled(
    sources.map(s => pullOne(s, args.perSourceLimit ?? perSourceLimit(s.platform)))
  );

  const allItems: FeedItem[] = [];
  const errors: Record<string, string> = {};

  results.forEach((r, i) => {
    const key = `${sources[i].platform}/${sources[i].command}`;
    if (r.status === 'fulfilled') {
      allItems.push(...r.value);
    } else {
      errors[key] = String(r.reason);
    }
  });

  stampLiveDates(allItems);
  const shuffled = shuffleArray(allItems).slice(0, totalLimit);
  return { items: shuffled, errors };
}

export async function pullMixedFeedStreaming(
  args: PullArgs,
  onBatch: (key: string, items: FeedItem[], err?: string) => void | Promise<void>,
  signal?: { aborted: boolean },
): Promise<{ totalItems: number; errors: Record<string, string> }> {
  const { sources } = args;

  const tasks = sources.map(async (s) => {
    if (signal?.aborted) return { key: `${s.platform}/${s.command}`, items: [] as FeedItem[], err: 'aborted' };
    try {
      const items = await pullOne(s, args.perSourceLimit ?? perSourceLimit(s.platform));
      stampLiveDates(items);
      if (signal?.aborted) return { key: `${s.platform}/${s.command}`, items, err: 'aborted' };
      await onBatch(`${s.platform}/${s.command}`, items);
      return { key: `${s.platform}/${s.command}`, items, err: undefined as string | undefined };
    } catch (e: any) {
      const err = String(e?.message || e);
      if (!s.needsAuth) {
        console.warn(`[${s.platform}/${s.command}] streaming pull failed:`, err.slice(0, 100));
      }
      await onBatch(`${s.platform}/${s.command}`, [], err);
      return { key: `${s.platform}/${s.command}`, items: [] as FeedItem[], err };
    }
  });

  const results = await Promise.allSettled(tasks);
  const totalItems = results.reduce((n, r) => {
    if (r.status !== 'fulfilled') return n;
    return n + r.value.items.length;
  }, 0);
  const errors: Record<string, string> = {};
  results.forEach((r) => {
    if (r.status === 'fulfilled' && r.value.err) {
      errors[r.value.key] = r.value.err;
    }
  });
  return { totalItems, errors };
}

export type FeedTheme = 'mixed' | 'tech' | 'society';

export const FEED_THEMES: Record<FeedTheme, { label: string; youtube: string; twitter: string; douyin: string; weibo: string }> = {
  mixed: { label: '综合', youtube: '', twitter: '', douyin: '', weibo: '' },
  tech: { label: '科技', youtube: 'technology', twitter: 'tech', douyin: '科技', weibo: '科技' },
  society: { label: '社会', youtube: 'world news', twitter: 'world', douyin: '社会', weibo: '社会' },
};

function youtubeSearchExtra(): string[] {
  return ['--upload', 'week'];
}

function twitterSearchQuery(q: string): string {
  const since = recencySinceDate(maxAgeDays('twitter'));
  const base = (q || '').trim();
  if (!base) return `since:${since}`;
  if (/\bsince:\d{4}-\d{2}-\d{2}\b/.test(base)) return base;
  return `${base} since:${since}`;
}

export function sourcesForTheme(theme: string = 'mixed'): SourceConfig[] {
  const key: FeedTheme = theme === 'tech' || theme === 'society' ? theme : 'mixed';
  const t = FEED_THEMES[key];
  const youtube: SourceConfig = key === 'mixed'
    ? { platform: 'youtube', command: 'hot', weight: 1 }
    : { platform: 'youtube', command: 'search', args: [t.youtube], extra: youtubeSearchExtra(), weight: 1 };
  const twitter: SourceConfig = key === 'mixed'
    ? { platform: 'twitter', command: 'timeline', extra: ['--type', 'for-you'], needsAuth: true }
    : { platform: 'twitter', command: 'search', args: [twitterSearchQuery(t.twitter)], extra: ['--product', 'live'], needsAuth: true };
  const douyin: SourceConfig = key === 'mixed'
    ? { platform: 'douyin', command: 'feed', needsAuth: true }
    : { platform: 'douyin', command: 'search', args: [t.douyin], needsAuth: true };
  const weibo: SourceConfig = key === 'mixed'
    ? { platform: 'weibo', command: 'feed', extra: ['--type', 'for-you'], needsAuth: true }
    : { platform: 'weibo', command: 'search', args: [t.weibo], needsAuth: true };

  return [
    { platform: 'bilibili', command: 'hot', weight: 2 },
    weibo,
    { platform: 'zhihu', command: 'hot' },
    douyin,
    { platform: 'xiaohongshu', command: 'feed', needsAuth: true },
    { platform: 'hackernews', command: 'top' },
    youtube,
    twitter,
  ];
}

export const DEFAULT_SOURCES: SourceConfig[] = sourcesForTheme('mixed');

export const SINGLE_SOURCES: Record<string, SourceConfig> = {
  bilibili: { platform: 'bilibili', command: 'hot' },
  hackernews: { platform: 'hackernews', command: 'top' },
  weibo: { platform: 'weibo', command: 'feed', extra: ['--type', 'for-you'], needsAuth: true },
  zhihu: { platform: 'zhihu', command: 'hot' },
  douyin: { platform: 'douyin', command: 'feed', needsAuth: true },
  youtube: { platform: 'youtube', command: 'hot' },
  twitter: { platform: 'twitter', command: 'timeline', extra: ['--type', 'for-you'], needsAuth: true },
  xiaohongshu: { platform: 'xiaohongshu', command: 'feed', needsAuth: true },
  xiaohongshu_search: { platform: 'xiaohongshu', command: 'search', args: ['热门'] },
  jike: { platform: 'jike', command: 'feed', needsAuth: true },
};

export function buildSearchSources(q: string): SourceConfig[] {
  const kw = q || '热门';
  return [
    { platform: 'bilibili', command: 'search', args: [kw] },
    { platform: 'weibo', command: 'search', args: [kw] },
    { platform: 'zhihu', command: 'search', args: [kw] },
    { platform: 'hackernews', command: 'search', args: [kw] },
    { platform: 'youtube', command: 'search', args: [kw], extra: youtubeSearchExtra() },
    { platform: 'twitter', command: 'search', args: [twitterSearchQuery(kw)], extra: ['--product', 'live'] },
    { platform: 'douyin', command: 'search', args: [kw] },
    { platform: 'xiaohongshu', command: 'search', args: [kw] },
  ];
}
