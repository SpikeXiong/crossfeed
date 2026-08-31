/**
 * Douyin 热点榜。
 *
 * 热搜条目的 sentence_id 不能当 hashtag cid 用（/hashtag/{id} 会显示不存在）。
 * 链接一律走关键词搜索，和微博热搜点进去搜这个词一样。
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

function unwrap(payload) {
  if (payload && !Array.isArray(payload) && typeof payload === 'object' && 'session' in payload && 'data' in payload) {
    return payload.data;
  }
  return payload;
}

function searchUrl(name) {
  return `https://www.douyin.com/search/${encodeURIComponent(name)}`;
}

cli({
  site: 'douyin',
  name: 'hot',
  access: 'read',
  description: '抖音热点榜',
  domain: 'www.douyin.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Number of topics (1-50)' },
  ],
  columns: ['rank', 'name', 'id', 'view_count', 'url'],
  func: async (page, kwargs) => {
    const limit = Number(kwargs.limit ?? 20);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new ArgumentError(`--limit must be 1-50, got ${JSON.stringify(kwargs.limit)}`);
    }
    await page.goto('https://www.douyin.com/hot');
    const payload = unwrap(await page.evaluate(`
      new Promise((resolve) => {
        const cleanTitle = (text) => {
          const lines = String(text || '').split(/\\n+/).map((s) => s.trim()).filter(Boolean);
          for (const line of lines) {
            if (/^\\d{1,2}$/.test(line)) continue;
            if (/^\\d+(?:\\.\\d+)?[万亿]?$/.test(line)) continue;
            if (/^(热|新|爆|荐|直播)$/.test(line)) continue;
            if (line.length < 2) continue;
            return line.replace(/^\\d{1,2}\\s+/, '').slice(0, 80);
          }
          return '';
        };
        const collect = () => {
          const text = (document.body && document.body.innerText) || '';
          if (/登录后查看|请先登录|登录抖音/.test(text)) return { state: 'login_wall' };
          const items = [];
          const seen = new Set();
          const links = document.querySelectorAll('a[href*="/hot/"], a[href*="/search/"]');
          for (const a of links) {
            const href = a.getAttribute('href') || '';
            if (/\\/video\\//.test(href)) continue;
            const title = cleanTitle(a.innerText);
            if (!title) continue;
            if (seen.has(title)) continue;
            seen.add(title);
            const heat = (a.innerText.match(/(\\d+(?:\\.\\d+)?[万亿])/ ) || [])[1] || '';
            const idMatch = href.match(/\\/(?:hot|search)\\/([^/?#]+)/);
            items.push({
              rank: items.length + 1,
              name: title,
              id: idMatch ? decodeURIComponent(idMatch[1]) : title,
              view_count: heat,
            });
          }
          if (items.length > 0) return { state: 'ok', items };
          return null;
        };
        const found = collect();
        if (found) return resolve(found);
        const observer = new MutationObserver(() => {
          const s = collect();
          if (s) { observer.disconnect(); resolve(s); }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => {
          observer.disconnect();
          resolve(collect() || { state: 'timeout' });
        }, 12000);
      })
    `));

    const data = payload && payload.data ? payload.data : payload;
    if (!data || typeof data !== 'object') {
      throw new CommandExecutionError('Douyin hot: unexpected evaluator payload');
    }
    if (data.state === 'login_wall') {
      throw new AuthRequiredError('www.douyin.com', 'Douyin hot list requires login at https://www.douyin.com');
    }
    if (data.state !== 'ok' || !Array.isArray(data.items) || data.items.length === 0) {
      throw new EmptyResultError('douyin hot', 'No Douyin hot topics found. Open https://www.douyin.com/hot and confirm login.');
    }
    return data.items.slice(0, limit).map((row, i) => {
      const name = String(row.name || '').trim();
      return {
        rank: i + 1,
        name,
        id: String(row.id || name || i),
        view_count: row.view_count || '',
        url: searchUrl(name),
      };
    }).filter((row) => row.name);
  },
});
