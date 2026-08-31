// 全平台登录探测：一次 opencli 扫 cookie，Hacker News 为公开源。
import { callOpenCli } from './opencli.js';
import { logger } from './logger.js';

export type PlatformAuthState = {
  id: string;
  label: string;
  homeUrl: string;
  public: boolean;
  loggedIn: boolean | null;
  error?: string;
};

export const PLATFORM_HOMES: Array<{ id: string; label: string; homeUrl: string; public?: boolean }> = [
  { id: 'bilibili', label: '哔哩哔哩', homeUrl: 'https://www.bilibili.com' },
  { id: 'hackernews', label: 'Hacker News', homeUrl: 'https://news.ycombinator.com', public: true },
  { id: 'twitter', label: 'X / Twitter', homeUrl: 'https://x.com' },
  { id: 'youtube', label: 'YouTube', homeUrl: 'https://www.youtube.com' },
  { id: 'xiaohongshu', label: '小红书', homeUrl: 'https://www.xiaohongshu.com' },
  { id: 'weibo', label: '微博', homeUrl: 'https://weibo.com' },
  { id: 'zhihu', label: '知乎', homeUrl: 'https://www.zhihu.com' },
  { id: 'douyin', label: '抖音', homeUrl: 'https://www.douyin.com' },
];

function emptyStates(): PlatformAuthState[] {
  return PLATFORM_HOMES.map(p => ({
    id: p.id,
    label: p.label,
    homeUrl: p.homeUrl,
    public: !!p.public,
    loggedIn: p.public ? null : null,
  }));
}

export async function scanPlatformAuth(): Promise<PlatformAuthState[]> {
  const states = emptyStates();
  const byId = new Map(states.map(s => [s.id, s]));
  try {
    const r = await callOpenCli('crossfeed', 'auth-scan', [], {
      timeoutMs: 25000,
      cacheTtlSec: 0,
      siteSession: 'persistent',
    });
    if (!r.ok) {
      logger.warn('auth-scan failed', { err: r.error }, 'auth');
      for (const s of states) {
        if (!s.public) s.error = r.error || '探测失败';
      }
      return states;
    }
    for (const row of r.data || []) {
      const id = String((row as any).id || '');
      const s = byId.get(id);
      if (!s || s.public) continue;
      const v = (row as any).logged_in;
      s.loggedIn = v === true || v === 'true' || v === 1;
    }
    for (const s of states) {
      if (!s.public && s.loggedIn == null) s.loggedIn = false;
    }
  } catch (e: any) {
    logger.warn('auth-scan exception', { err: String(e) }, 'auth');
    for (const s of states) {
      if (!s.public) s.error = e?.message || String(e);
    }
  }
  return states;
}
