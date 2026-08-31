// 字段归一化：把各平台的 OpenCLI 输出转成统一的 FeedItem
// 设计原则：宁缺毋滥，没的字段就留空

export type FeedItem = {
  id: string;          // 唯一 ID（平台-原ID）
  platform: string;    // bilibili / hackernews / twitter / youtube / xiaohongshu ...
  type: 'video' | 'article' | 'tweet' | 'short' | 'audio' | 'unknown';
  title: string;
  author?: string;
  content?: string;    // 文本内容（推文正文/文章摘要）
  url: string;
  thumbnail?: string;
  mediaUrl?: string;
  metrics: {
    views?: number;
    likes?: number;
    comments?: number;
    shares?: number;
    score?: number;
    play?: number;
    danmaku?: number;
  };
  publishedAt?: string;
  /** 实时热榜（微博热搜、X trending 话题），没有单条原帖时间 */
  live?: boolean;
  // 用于异步补抓缩略图的 ID（bilibili bvid / youtube videoId / 小红书 note-id）
  refId?: string;
  aiSummary?: string;
  aiStance?: 'optimistic' | 'critical' | 'neutral' | 'mixed';
  aiRelevance?: number;
  rank?: number | string;
  label?: string;
};

export function toStr(v: any): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

/** 解析播放量/热度：支持 4.2万、1.5亿、1.2M、1.5K、逗号分隔 */
export function toNum(v: any): number | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : undefined;
  const s = String(v).trim().replace(/,/g, '');
  if (!s) return undefined;
  const m = s.match(/^([\d.]+)\s*([万亿kKmMbB])?/);
  if (m) {
    let n = parseFloat(m[1]);
    if (!Number.isFinite(n)) return undefined;
    const unit = m[2];
    if (unit === '万') n *= 10_000;
    else if (unit === '亿') n *= 100_000_000;
    else if (unit === 'k' || unit === 'K') n *= 1_000;
    else if (unit === 'm' || unit === 'M') n *= 1_000_000;
    else if (unit === 'b' || unit === 'B') n *= 1_000_000_000;
    return Number.isFinite(n) ? Math.round(n) : undefined;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/** 把「08月27日 22:22」这类中文日期转成 ISO；已是合法日期则原样规范化 */
export function parseFlexibleDate(s?: string): string | undefined {
  if (!s) return undefined;
  const direct = new Date(s);
  if (!isNaN(direct.getTime())) return direct.toISOString();
  const cn = s.match(/(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})/);
  if (cn) {
    const year = new Date().getFullYear();
    const dt = new Date(year, parseInt(cn[1], 10) - 1, parseInt(cn[2], 10), parseInt(cn[3], 10), parseInt(cn[4], 10));
    if (!isNaN(dt.getTime())) return dt.toISOString();
  }
  return parseRelativeTime(s);
}

/** 协议相对 / http 封面升到 https，避免卡片图被 mixed-content 拦掉 */
function toHttpsUrl(v: any): string | undefined {
  const s = toStr(v);
  if (!s) return undefined;
  if (s.startsWith('//')) return `https:${s}`;
  if (s.startsWith('http://')) return `https://${s.slice('http://'.length)}`;
  return s;
}

/** unix 秒或毫秒 → ISO */
export function fromUnixSeconds(v: any): string | undefined {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < 1_000_000_000) return undefined;
  const ms = n < 1e12 ? n * 1000 : n;
  const d = new Date(ms);
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** 小红书 note id（Mongo ObjectID）前 8 hex = 发布时间 unix 秒 */
export function fromXhsNoteId(id?: string): string | undefined {
  const hex = String(id || '').trim();
  const m = hex.match(/^([0-9a-f]{8})[0-9a-f]{16}$/i) || hex.match(/^([0-9a-f]{8})$/i);
  if (!m) return undefined;
  return fromUnixSeconds(parseInt(m[1], 16));
}

/** Twitter snowflake → 发帖时间 */
export function fromTwitterSnowflake(id?: string | number): string | undefined {
  try {
    const n = BigInt(String(id || ''));
    if (n <= 0n) return undefined;
    const ms = Number((n >> 22n) + 1288834974657n);
    const d = new Date(ms);
    return isNaN(d.getTime()) ? undefined : d.toISOString();
  } catch {
    return undefined;
  }
}

const CN_UNIT_MS: Record<string, number> = {
  秒: 1000,
  分钟: 60_000,
  小时: 3_600_000,
  天: 86_400_000,
  周: 7 * 86_400_000,
  个月: 30 * 86_400_000,
  月: 30 * 86_400_000,
  年: 365 * 86_400_000,
};

const EN_UNIT_MS: Record<string, number> = {
  second: 1000, seconds: 1000,
  minute: 60_000, minutes: 60_000,
  hour: 3_600_000, hours: 3_600_000,
  day: 86_400_000, days: 86_400_000,
  week: 7 * 86_400_000, weeks: 7 * 86_400_000,
  month: 30 * 86_400_000, months: 30 * 86_400_000,
  year: 365 * 86_400_000, years: 365 * 86_400_000,
};

/**
 * 「3周前」「2 hours ago」「Streamed 5 days ago」「刚刚」等相对时间 → ISO
 */
export function parseRelativeTime(s?: string, nowMs: number = Date.now()): string | undefined {
  if (!s) return undefined;
  const t = s.trim();
  if (!t) return undefined;
  if (t === '刚刚' || /^just now$/i.test(t) || t === '今天') return new Date(nowMs).toISOString();
  if (t === '昨天') return new Date(nowMs - 86_400_000).toISOString();
  if (t === '前天') return new Date(nowMs - 2 * 86_400_000).toISOString();

  const cn = t.match(/(\d+)\s*(秒|分钟|小时|天|周|个月|月|年)前/);
  if (cn) {
    const n = parseInt(cn[1], 10);
    const unitMs = CN_UNIT_MS[cn[2]];
    if (unitMs) return new Date(nowMs - n * unitMs).toISOString();
  }

  const cleaned = t.replace(/^(streamed|premiered|published|uploaded)\s+/i, '');
  const en = cleaned.match(/(\d+)\s*(seconds?|minutes?|hours?|days?|weeks?|months?|years?)\s+ago/i);
  if (en) {
    const n = parseInt(en[1], 10);
    const unitMs = EN_UNIT_MS[en[2].toLowerCase()];
    if (unitMs) return new Date(nowMs - n * unitMs).toISOString();
  }

  const d = new Date(t);
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** 条目是否新于 maxAgeDays。无时间的条目默认保留。 */
export function isFreshEnough(iso: string | undefined, maxAgeDays: number, nowMs: number = Date.now()): boolean {
  if (!iso || !(maxAgeDays > 0)) return true;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return true;
  return nowMs - t <= maxAgeDays * 86_400_000;
}

function youtubeIdFromUrl(url?: string): string | undefined {
  if (!url) return undefined;
  const m =
    url.match(/[?&]v=([\w-]+)/) ||
    url.match(/\/shorts\/([\w-]+)/) ||
    url.match(/youtu\.be\/([\w-]+)/);
  return m?.[1];
}

function stableFallbackId(platform: string, raw: any): string {
  const seed = toStr(raw.url) || toStr(raw.title) || toStr(raw.word) || toStr(raw.text) || '';
  if (!seed) return `${platform}-${Math.random().toString(36).slice(2)}`;
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) + h) ^ seed.charCodeAt(i);
  return `${platform}-${(h >>> 0).toString(36)}`;
}

function normalizeBilibili(raw: any): FeedItem {
  // search / hot 两种格式的 bvid 来源不同：
  //   - hot:  { bvid: "BVxxx", ... }
  //   - search: { url: "https://www.bilibili.com/video/BVxxx", ... }（无 bvid 字段）
  let bvid = toStr(raw.bvid);
  if (!bvid) {
    const url = toStr(raw.url);
    if (url) {
      const m = url.match(/\/video\/(BV[\w]+)/);
      if (m) bvid = m[1];
    }
  }
  return {
    id: `bilibili-${bvid || stableFallbackId('bilibili', raw).slice('bilibili-'.length)}`,
    platform: 'bilibili',
    type: 'video',
    title: toStr(raw.title) || '(无标题)',
    author: toStr(raw.author),
    url: toStr(raw.url) || `https://www.bilibili.com/video/${bvid}`,
    thumbnail: toHttpsUrl(raw.pic || raw.cover || raw.thumbnail),
    content: toStr(raw.desc),
    publishedAt: fromUnixSeconds(raw.pubdate) || parseRelativeTime(toStr(raw.published || raw.time)),
    refId: bvid,
    metrics: {
      views: toNum(raw.play ?? raw.score),
      danmaku: toNum(raw.danmaku),
    },
  };
}

function normalizeHackerNews(raw: any): FeedItem {
  return {
    id: `hackernews-${raw.id}`,
    platform: 'hackernews',
    type: 'article',
    title: toStr(raw.title) || '(无标题)',
    author: toStr(raw.author),
    url: toStr(raw.url) || `https://news.ycombinator.com/item?id=${raw.id}`,
    publishedAt: fromUnixSeconds(raw.time || raw.created_at),
    metrics: {
      score: toNum(raw.score),
      comments: toNum(raw.comments),
    },
  };
}

function normalizeTwitter(raw: any): FeedItem {
  // trending 热榜：{ rank, topic, category }，没有单条推文
  if (raw.topic && !raw.text && !raw.id) {
    const topic = toStr(raw.topic) || '(热搜)';
    return {
      id: `twitter-trend-${raw.rank || stableFallbackId('twitter', raw).slice('twitter-'.length)}`,
      platform: 'twitter',
      type: 'article',
      title: topic,
      author: toStr(raw.category),
      url: `https://x.com/search?q=${encodeURIComponent(topic)}&src=trend_click&f=live`,
      live: true,
      metrics: {},
      rank: raw.rank,
    };
  }
  return {
    id: `twitter-${raw.id}`,
    platform: 'twitter',
    type: 'tweet',
    title: (toStr(raw.text) || '').slice(0, 80) || '(推文)',
    author: toStr(raw.author),
    content: toStr(raw.text),
    url: toStr(raw.url) || `https://x.com/i/status/${raw.id}`,
    thumbnail: toStr(raw.media_posters?.[0]) || toStr(raw.card?.image_url),
    mediaUrl: toStr(raw.media_urls?.[0]),
    metrics: {
      likes: toNum(raw.likes),
      views: toNum(raw.views),
      comments: toNum(raw.replies || raw.comments),
      shares: toNum(raw.retweets || raw.reposts),
    },
    publishedAt: parseFlexibleDate(toStr(raw.created_at)) || fromTwitterSnowflake(raw.id),
  };
}

function normalizeYouTube(raw: any): FeedItem {
  const url = toStr(raw.url);
  const videoId = toStr(raw.id || raw.videoId || raw.video_id) || youtubeIdFromUrl(url);

  return {
    id: `youtube-${videoId || stableFallbackId('youtube', raw).slice('youtube-'.length)}`,
    platform: 'youtube',
    type: 'video',
    title: toStr(raw.title) || '(无标题)',
    author: toStr(raw.channel || raw.author),
    url: url || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : ''),
    thumbnail: toHttpsUrl(raw.thumbnail) || (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : undefined),
    refId: videoId,
    publishedAt: parseRelativeTime(toStr(raw.published || raw.publishDate || raw.uploadDate)),
    metrics: {
      views: toNum(raw.views),
      likes: toNum(raw.likes),
    },
  };
}

// 微博：feed / search 是具体微博；hot 才是热搜话题
function normalizeWeibo(raw: any): FeedItem {
  const isHot = raw.word != null && raw.text == null && raw.title == null;
  if (isHot) {
    const word = toStr(raw.word) || '(微博热搜)';
    return {
      id: `weibo-${raw.rank || raw.word || stableFallbackId('weibo', raw).slice('weibo-'.length)}`,
      platform: 'weibo',
      type: 'article',
      title: word.slice(0, 60),
      author: toStr(raw.category),
      url: toStr(raw.url) || `https://s.weibo.com/weibo?q=${encodeURIComponent(raw.word)}`,
      publishedAt: fromUnixSeconds(raw.onboard_time),
      live: true,
      metrics: { score: toNum(raw.hot_value) },
      ...(raw.rank ? { rank: raw.rank } : {}),
      ...(raw.label ? { label: raw.label } : {}),
    };
  }
  const body = toStr(raw.text || raw.title);
  return {
    id: `weibo-${raw.id || raw.mblogid || raw.rank || stableFallbackId('weibo', raw).slice('weibo-'.length)}`,
    platform: 'weibo',
    type: 'tweet',
    title: body?.slice(0, 80) || '(微博)',
    author: toStr(raw.author),
    url: toStr(raw.url) || '',
    content: body,
    publishedAt: parseFlexibleDate(toStr(raw.time)) || fromUnixSeconds(raw.time || raw.onboard_time),
    metrics: {
      likes: toNum(raw.likes),
      comments: toNum(raw.comments),
      shares: toNum(raw.reposts),
      score: toNum(raw.hot_value),
    },
    ...(raw.rank ? { rank: raw.rank } : {}),
    ...(raw.label ? { label: raw.label } : {}),
  };
}

// 知乎热榜（hot 返回的是问题）
function normalizeZhihu(raw: any): FeedItem {
  return {
    id: `zhihu-${raw.url || raw.rank || stableFallbackId('zhihu', raw).slice('zhihu-'.length)}`,
    platform: 'zhihu',
    type: 'article',
    title: toStr(raw.title) || '(知乎热榜)',
    url: toStr(raw.url),
    content: toStr(raw.excerpt || raw.content),
    thumbnail: toHttpsUrl(raw.thumbnail || raw.image),
    publishedAt: fromUnixSeconds(raw.created || raw.created_time || raw.updated_time),
    metrics: {
      score: toNum(raw.heat),
      comments: toNum(raw.answers),
    },
  };
}

// 小红书：feed（登录态，有封面）/ search（公开，仅 xsec_token）
function normalizeXiaohongshu(raw: any): FeedItem {
  const noteId = raw.note_id || raw.id;
  // search 返回的 url 是 /search_result/{id}?xsec_token=...&xsec_source=
  // 改成 /explore/{id} 走详情页路径，配合 token 平台会直出 web 内容
  let url = toStr(raw.url);
  if (url) {
    url = url.replace('/search_result/', '/explore/');
    // 强制带 xsec_source=pc_feed（OpenCLI 的 search 不会填这个，但小红书 web 直开要求）
    if (/[?&]xsec_source=(&|$)/.test(url) || !/[?&]xsec_source=/.test(url)) {
      url = url.replace(/([?&])xsec_source=(?:[^&]*)/, '$1xsec_source=pc_feed');
      if (!/[?&]xsec_source=/.test(url)) {
        url += (url.includes('?') ? '&' : '?') + 'xsec_source=pc_feed';
      }
    }
  } else {
    url = `https://www.xiaohongshu.com/explore/${noteId}?xsec_source=pc_feed`;
  }
  // feed/search 现在会带 cover（Pinia urlDefault / DOM img）。
  // 不要再走 note-cover 补抓，避免小红书频繁请求。
  const thumbnail = toStr(
    raw.cover?.urlDefault ||
    raw.cover?.urlPre ||
    raw.cover?.url ||
    raw.cover ||
    raw.image ||
    raw.image_list?.[0]?.url ||
    raw.image_list?.[0]
  );
  return {
    id: `xiaohongshu-${noteId || stableFallbackId('xiaohongshu', raw).slice('xiaohongshu-'.length)}`,
    platform: 'xiaohongshu',
    type: 'article',
    title: toStr(raw.title) || toStr(raw.desc)?.slice(0, 80) || '(小红书)',
    content: toStr(raw.desc || raw.content || raw.note_desc),
    author: toStr(raw.user?.nickname || raw.author || raw.nickname),
    url,
    thumbnail,
    // refId 用完整 URL（带 xsec_token），打开笔记详情用
    refId: url,
    publishedAt: parseFlexibleDate(toStr(raw.published_at) || toStr(raw.publish_time) || toStr(raw.time))
      || fromXhsNoteId(String(noteId || ''))
      || fromXhsNoteId((url || '').match(/\/(?:explore|search_result|note)\/([0-9a-f]{24})/i)?.[1]),
    metrics: {
      likes: toNum(raw.liked_count || raw.likes),
      comments: toNum(raw.comment_count || raw.comments),
    },
  };
}

// 即刻（类似 X / Twitter）
function normalizeJike(raw: any): FeedItem {
  return {
    id: `jike-${raw.id || stableFallbackId('jike', raw).slice('jike-'.length)}`,
    platform: 'jike',
    type: 'tweet',
    title: (toStr(raw.content) || toStr(raw.text) || '').slice(0, 80) || '(即刻动态)',
    content: toStr(raw.content) || toStr(raw.text),
    author: toStr(raw.user?.nickname || raw.author),
    url: toStr(raw.url) || `https://m.okjike.com/originalPosts/${raw.id}`,
    thumbnail: toStr(raw.pictures?.[0]?.url || raw.thumbnail),
    metrics: {
      likes: toNum(raw.likeCount || raw.likes),
      comments: toNum(raw.commentCount || raw.comments),
    },
    publishedAt: toStr(raw.createdAt || raw.created_at),
  };
}

// 抖音：热榜话题 / 搜索视频。热搜 sentence_id 不是 hashtag cid，不能拼 /hashtag/{id}。
function douyinTopicSearchUrl(name?: string): string {
  const q = (name || '').trim();
  if (!q) return 'https://www.douyin.com/hot';
  return `https://www.douyin.com/search/${encodeURIComponent(q)}`;
}

function douyinAbsoluteUrl(href: string): string {
  if (href.startsWith('http')) return href;
  if (href.startsWith('//')) return `https:${href}`;
  if (href.startsWith('/')) return `https://www.douyin.com${href}`;
  return href;
}

function normalizeDouyin(raw: any): FeedItem {
  // 热榜 / 话题：{ name, id, view_count } —— 无视频无封面
  if (raw.name && raw.view_count !== undefined && !raw.desc) {
    const name = toStr(raw.name) || '(抖音话题)';
    const given = toStr(raw.url);
    const keepGiven = given && /\/(?:hot|search)\//.test(given) && !/\/hashtag\//.test(given);
    return {
      id: `douyin-hashtag-${raw.id || stableFallbackId('douyin', raw).slice('douyin-'.length)}`,
      platform: 'douyin',
      type: 'article',
      title: name,
      url: keepGiven ? douyinAbsoluteUrl(given) : douyinTopicSearchUrl(name),
      refId: toStr(raw.id),
      live: true,
      metrics: {
        views: toNum(raw.view_count),
      },
    };
  }

  // search 格式：{ rank, desc, author, url, cover, plays, likes, comments, shares }
  const url = toStr(raw.url);
  const videoId = url?.match(/\/video\/(\d+)/)?.[1];

  return {
    id: `douyin-${videoId || raw.rank || stableFallbackId('douyin', raw).slice('douyin-'.length)}`,
    platform: 'douyin',
    type: 'short',
    title: toStr(raw.desc)?.slice(0, 80) || '(抖音视频)',
    content: toStr(raw.desc),
    author: toStr(raw.author),
    url: url,
    refId: videoId,
    thumbnail: toHttpsUrl(raw.cover || raw.thumbnail),
    publishedAt: parseRelativeTime(toStr(raw.published || raw.time))
      || fromUnixSeconds(raw.published || raw.time || raw.create_time),
    metrics: {
      views: toNum(raw.plays),
      likes: toNum(raw.likes),
      comments: toNum(raw.comments),
      shares: toNum(raw.shares),
    },
  };
}

const NORMALIZERS: Record<string, (raw: any) => FeedItem> = {
  bilibili: normalizeBilibili,
  hackernews: normalizeHackerNews,
  twitter: normalizeTwitter,
  youtube: normalizeYouTube,
  weibo: normalizeWeibo,
  zhihu: normalizeZhihu,
  xiaohongshu: normalizeXiaohongshu,
  jike: normalizeJike,
  douyin: normalizeDouyin,
};

export function normalizeItem(platform: string, raw: any): FeedItem | null {
  const fn = NORMALIZERS[platform];
  if (!fn) {
    return {
      id: `${platform}-${raw.id || raw.url || stableFallbackId(platform, raw).slice(platform.length + 1)}`,
      platform,
      type: 'unknown',
      title: toStr(raw.title) || toStr(raw.text)?.slice(0, 80) || '(无标题)',
      author: toStr(raw.author),
      content: toStr(raw.text),
      url: toStr(raw.url) || '',
      thumbnail: toStr(raw.thumbnail || raw.media_posters?.[0]),
      mediaUrl: toStr(raw.media_urls?.[0] || raw.video),
      metrics: {},
    };
  }
  try {
    const item = fn(raw);
    if (item?.publishedAt) {
      item.publishedAt = parseFlexibleDate(item.publishedAt) || item.publishedAt;
    }
    return item;
  } catch (e) {
    console.error(`normalize ${platform} failed:`, e, raw);
    return null;
  }
}