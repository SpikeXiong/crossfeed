/**
 * One-shot cookie scan for Crossfeed settings.
 * Reads the Chrome cookie jar (HttpOnly included via CDP) — no per-site page loads.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';

const SITES = [
  { id: 'bilibili', url: 'https://www.bilibili.com', all: ['SESSDATA', 'DedeUserID'] },
  { id: 'weibo', url: 'https://weibo.com', all: ['SUB', 'SUBP'] },
  { id: 'twitter', url: 'https://x.com', all: ['auth_token', 'ct0'] },
  { id: 'youtube', url: 'https://www.youtube.com', any: ['SID', 'SAPISID', '__Secure-1PSID', 'LOGIN_INFO'] },
  { id: 'xiaohongshu', url: 'https://www.xiaohongshu.com', any: ['web_session', 'a1'] },
  { id: 'zhihu', url: 'https://www.zhihu.com', any: ['z_c0'] },
  { id: 'douyin', url: 'https://www.douyin.com', any: ['sessionid', 'sid_guard', 'uid_tt'] },
];

cli({
  site: 'crossfeed',
  name: 'auth-scan',
  access: 'read',
  description: 'Check login cookies for Crossfeed platforms',
  domain: 'www.bilibili.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [],
  columns: ['id', 'logged_in'],
  func: async (page) => {
    const rows = [];
    for (const site of SITES) {
      const cookies = await page.getCookies({ url: site.url });
      const names = new Set((cookies || []).map((c) => c.name).filter(Boolean));
      let loggedIn = false;
      if (site.all) loggedIn = site.all.every((n) => names.has(n));
      else if (site.any) loggedIn = site.any.some((n) => names.has(n));
      rows.push({ id: site.id, logged_in: loggedIn });
    }
    return rows;
  },
});
