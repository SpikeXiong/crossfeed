/**
 * YouTube trending / 热门 — innertube bootstrap on /feed/trending.
 * Returns the same columns as youtube/search so Crossfeed can reuse normalizeYouTube.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'youtube',
  name: 'hot',
  access: 'read',
  description: 'YouTube 热门 / Trending',
  domain: 'www.youtube.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Max videos (max 50)' },
  ],
  columns: ['rank', 'title', 'channel', 'views', 'duration', 'published', 'url', 'thumbnail', 'video_id'],
  func: async (page, kwargs) => {
    const limit = Math.min(Number(kwargs.limit) || 20, 50);
    await page.goto('https://www.youtube.com/feed/trending');
    await page.wait(3);
    const data = await page.evaluate(`
      (async () => {
        const root = window.ytInitialData;
        if (!root) return { error: 'YouTube data not found' };
        const videos = [];
        const seen = new Set();
        const walk = (node) => {
          if (!node || typeof node !== 'object' || videos.length >= ${limit}) return;
          const v = node.videoRenderer;
          if (v && v.videoId && !seen.has(v.videoId)) {
            seen.add(v.videoId);
            const thumbs = v.thumbnail?.thumbnails || [];
            const thumbnail = thumbs.length
              ? thumbs[thumbs.length - 1].url
              : ('https://i.ytimg.com/vi/' + v.videoId + '/hqdefault.jpg');
            videos.push({
              rank: videos.length + 1,
              title: v.title?.runs?.[0]?.text || v.title?.simpleText || '',
              channel: v.ownerText?.runs?.[0]?.text || v.shortBylineText?.runs?.[0]?.text || '',
              views: v.viewCountText?.simpleText || v.shortViewCountText?.simpleText || '',
              duration: v.lengthText?.simpleText || '',
              published: v.publishedTimeText?.simpleText || '',
              url: 'https://www.youtube.com/watch?v=' + v.videoId,
              video_id: v.videoId,
              thumbnail,
            });
          }
          if (Array.isArray(node)) {
            for (const child of node) walk(child);
            return;
          }
          for (const key of Object.keys(node)) {
            if (key === 'videoRenderer') continue;
            walk(node[key]);
          }
        };
        walk(root);
        return videos;
      })()
    `);
    if (!Array.isArray(data)) return [];
    return data.slice(0, limit);
  },
});
