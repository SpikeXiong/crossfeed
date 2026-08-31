import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeItem, toNum, parseFlexibleDate, parseRelativeTime, fromXhsNoteId, fromTwitterSnowflake, isFreshEnough } from '../src/lib/normalize.js';
import { isChineseText } from '../src/lib/translate.js';

describe('toNum', () => {
  it('parses plain integers and comma-separated values', () => {
    assert.equal(toNum(1234), 1234);
    assert.equal(toNum('1,234,567'), 1234567);
  });

  it('parses Chinese units', () => {
    assert.equal(toNum('4.2万'), 42000);
    assert.equal(toNum('1.5亿'), 150000000);
  });

  it('parses western units without stripping the suffix first', () => {
    assert.equal(toNum('1.2M views'), 1_200_000);
    assert.equal(toNum('1.5K'), 1500);
    assert.equal(toNum('2.3B'), 2_300_000_000);
  });

  it('returns undefined for empty / non-numeric', () => {
    assert.equal(toNum(undefined), undefined);
    assert.equal(toNum(''), undefined);
    assert.equal(toNum('abc'), undefined);
  });
});

describe('parseFlexibleDate', () => {
  it('normalizes ISO dates', () => {
    const iso = parseFlexibleDate('2024-08-27T14:22:00.000Z');
    assert.ok(iso);
    assert.equal(new Date(iso!).toISOString(), '2024-08-27T14:22:00.000Z');
  });

  it('parses 微博-style 08月27日 22:22', () => {
    const iso = parseFlexibleDate('08月27日 22:22');
    assert.ok(iso);
    const d = new Date(iso!);
    assert.equal(d.getMonth(), 7);
    assert.equal(d.getDate(), 27);
    assert.equal(d.getHours(), 22);
    assert.equal(d.getMinutes(), 22);
    assert.ok(!isNaN(d.getTime()));
  });
});

describe('parseRelativeTime', () => {
  const now = Date.parse('2026-08-31T12:00:00.000Z');

  it('parses Chinese relative times', () => {
    const iso = parseRelativeTime('3周前', now);
    assert.ok(iso);
    assert.equal(now - new Date(iso!).getTime(), 3 * 7 * 86_400_000);
  });

  it('parses English relative times including Streamed prefix', () => {
    const iso = parseRelativeTime('Streamed 2 years ago', now);
    assert.ok(iso);
    assert.equal(now - new Date(iso!).getTime(), 2 * 365 * 86_400_000);
  });
});

describe('fromXhsNoteId / snowflake / freshness', () => {
  it('decodes Xiaohongshu ObjectID timestamp', () => {
    const ts = 1700000000;
    const id = ts.toString(16).padStart(8, '0') + 'aaaaaaaaaaaaaaaa';
    const iso = fromXhsNoteId(id);
    assert.equal(iso, new Date(ts * 1000).toISOString());
  });

  it('decodes Twitter snowflake', () => {
    const ms = 1700000000000;
    const snowflake = (((BigInt(ms) - 1288834974657n) << 22n)).toString();
    const iso = fromTwitterSnowflake(snowflake);
    assert.ok(iso);
    assert.equal(new Date(iso!).getTime(), ms);
  });

  it('drops stale youtube-like dates', () => {
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
    const recent = new Date(Date.now() - 2 * 86_400_000).toISOString();
    assert.equal(isFreshEnough(old, 14), false);
    assert.equal(isFreshEnough(recent, 14), true);
    assert.equal(isFreshEnough(undefined, 14), true);
  });
});

describe('normalizeItem', () => {
  it('extracts bilibili bvid from search URL', () => {
    const item = normalizeItem('bilibili', {
      title: '测试视频',
      url: 'https://www.bilibili.com/video/BV1xx411c7mD',
      play: '4.2万',
      pic: '//i0.hdslb.com/bfs/archive/cover.jpg',
      pubdate: 1725000000,
    });
    assert.ok(item);
    assert.equal(item!.id, 'bilibili-BV1xx411c7mD');
    assert.equal(item!.refId, 'BV1xx411c7mD');
    assert.equal(item!.metrics.views, 42000);
    assert.equal(item!.thumbnail, 'https://i0.hdslb.com/bfs/archive/cover.jpg');
    assert.equal(item!.publishedAt, new Date(1725000000 * 1000).toISOString());
  });

  it('parses youtube views with M suffix', () => {
    const item = normalizeItem('youtube', {
      title: 'AI news',
      url: 'https://www.youtube.com/watch?v=abc123xyz',
      views: '1.2M views',
    });
    assert.ok(item);
    assert.equal(item!.refId, 'abc123xyz');
    assert.equal(item!.metrics.views, 1_200_000);
    assert.equal(item!.thumbnail, 'https://i.ytimg.com/vi/abc123xyz/hqdefault.jpg');
  });

  it('parses youtube english relative published time', () => {
    const item = normalizeItem('youtube', {
      title: 'old hit',
      url: 'https://www.youtube.com/watch?v=oldvid1',
      published: '3 years ago',
    });
    assert.ok(item!.publishedAt);
    const age = Date.now() - new Date(item!.publishedAt!).getTime();
    assert.ok(age > 2 * 365 * 86_400_000);
  });

  it('maps twitter timeline tweets as posts', () => {
    const item = normalizeItem('twitter', {
      id: '1234567890',
      author: 'alice',
      text: 'hello from the timeline',
      likes: 12,
      replies: 3,
      retweets: 2,
      url: 'https://x.com/alice/status/1234567890',
      created_at: '2026-08-31T12:00:00.000Z',
    });
    assert.equal(item!.type, 'tweet');
    assert.equal(item!.live, undefined);
    assert.equal(item!.title, 'hello from the timeline');
    assert.equal(item!.metrics.comments, 3);
    assert.equal(item!.metrics.shares, 2);
  });

  it('maps weibo feed posts as tweets', () => {
    const item = normalizeItem('weibo', {
      id: 'Mabc',
      author: '用户',
      text: '一条真实微博',
      likes: 8,
      comments: 2,
      reposts: 1,
      time: '10分钟前',
      url: 'https://weibo.com/1/Mabc',
    });
    assert.equal(item!.type, 'tweet');
    assert.equal(item!.live, undefined);
    assert.equal(item!.title, '一条真实微博');
    assert.equal(item!.metrics.likes, 8);
  });

  it('maps hackernews unix time', () => {
    const item = normalizeItem('hackernews', {
      id: 42,
      title: 'Show HN',
      url: 'https://example.com',
      time: 1725000000,
      score: 10,
    });
    assert.equal(item!.publishedAt, new Date(1725000000 * 1000).toISOString());
  });

  it('extracts youtube shorts id and prefers adapter thumbnail', () => {
    const item = normalizeItem('youtube', {
      title: 'short',
      url: 'https://www.youtube.com/shorts/SHORTID1',
      thumbnail: 'https://i.ytimg.com/vi/SHORTID1/maxresdefault.jpg',
    });
    assert.equal(item!.refId, 'SHORTID1');
    assert.equal(item!.thumbnail, 'https://i.ytimg.com/vi/SHORTID1/maxresdefault.jpg');
  });

  it('parses zhihu heat with 万', () => {
    const item = normalizeItem('zhihu', {
      title: '如何看待 AI',
      url: 'https://www.zhihu.com/question/1',
      heat: '128万',
      answers: 42,
    });
    assert.ok(item);
    assert.equal(item!.metrics.score, 1_280_000);
    assert.equal(item!.metrics.comments, 42);
  });

  it('parses weibo search date and keeps rank/label', () => {
    const item = normalizeItem('weibo', {
      title: '某热搜正文很长很长',
      word: '某热搜',
      time: '08月27日 22:22',
      rank: 3,
      label: '爆',
      url: 'https://s.weibo.com/weibo?q=x',
    });
    assert.ok(item);
    assert.equal(item!.rank, 3);
    assert.equal(item!.label, '爆');
    assert.ok(item!.publishedAt);
    assert.ok(!isNaN(new Date(item!.publishedAt!).getTime()));
  });

  it('rewrites xiaohongshu search_result URL to explore + xsec_source', () => {
    const item = normalizeItem('xiaohongshu', {
      note_id: 'n1',
      title: '笔记',
      url: 'https://www.xiaohongshu.com/search_result/n1?xsec_token=tok&xsec_source=',
    });
    assert.ok(item);
    assert.match(item!.url, /\/explore\/n1/);
    assert.match(item!.url, /xsec_source=pc_feed/);
  });

  it('uses xiaohongshu cover.urlDefault without note-cover', () => {
    const item = normalizeItem('xiaohongshu', {
      id: 'n2',
      title: '有封面',
      url: 'https://www.xiaohongshu.com/explore/n2?xsec_token=tok&xsec_source=pc_feed',
      cover: { urlDefault: 'https://sns-img-qc.xhscdn.com/cover.jpg', url: 'https://sns-img-qc.xhscdn.com/raw.jpg' },
    });
    assert.equal(item!.thumbnail, 'https://sns-img-qc.xhscdn.com/cover.jpg');
  });

  it('uses a flattened xiaohongshu cover string', () => {
    const item = normalizeItem('xiaohongshu', {
      id: 'n3',
      title: '扁平封面',
      url: 'https://www.xiaohongshu.com/explore/n3?xsec_token=tok&xsec_source=pc_feed',
      cover: 'https://sns-img-qc.xhscdn.com/flat.jpg',
    });
    assert.equal(item!.thumbnail, 'https://sns-img-qc.xhscdn.com/flat.jpg');
  });

  it('maps douyin search cover from the list card', () => {
    const item = normalizeItem('douyin', {
      desc: '一条视频',
      author: 'u',
      url: 'https://www.douyin.com/video/7123456789',
      plays: '8.8万',
      likes: 12,
      cover: 'https://p3-pc-sign.douyinpic.com/cover.jpg',
    });
    assert.equal(item!.type, 'short');
    assert.equal(item!.thumbnail, 'https://p3-pc-sign.douyinpic.com/cover.jpg');
  });

  it('maps zhihu hot thumbnail and excerpt', () => {
    const item = normalizeItem('zhihu', {
      title: '如何看待 AI',
      url: 'https://www.zhihu.com/question/1',
      heat: '128万',
      answers: 42,
      thumbnail: 'https://pic1.zhimg.com/cover.jpg',
      excerpt: '摘要',
    });
    assert.equal(item!.thumbnail, 'https://pic1.zhimg.com/cover.jpg');
    assert.equal(item!.content, '摘要');
  });

  it('distinguishes douyin hashtag vs video', () => {
    const tag = normalizeItem('douyin', { name: '热门话题', id: 'h1', view_count: '100万' });
    assert.equal(tag!.type, 'article');
    assert.equal(tag!.metrics.views, 1_000_000);
    assert.equal(tag!.url, 'https://www.douyin.com/search/%E7%83%AD%E9%97%A8%E8%AF%9D%E9%A2%98');

    const fromHot = normalizeItem('douyin', {
      name: '热门话题',
      id: '7523001',
      view_count: '100万',
      url: 'https://www.douyin.com/hot/7523001',
    });
    assert.equal(fromHot!.url, 'https://www.douyin.com/hot/7523001');

    const badHashtag = normalizeItem('douyin', {
      name: '热门话题',
      id: '7523001',
      view_count: '100万',
      url: 'https://www.douyin.com/hashtag/7523001',
    });
    assert.equal(badHashtag!.url, 'https://www.douyin.com/search/%E7%83%AD%E9%97%A8%E8%AF%9D%E9%A2%98');

    const video = normalizeItem('douyin', {
      desc: '一条视频',
      author: 'u',
      url: 'https://www.douyin.com/video/7123456789',
      plays: '8.8万',
      likes: 12,
    });
    assert.equal(video!.type, 'short');
    assert.equal(video!.refId, '7123456789');
    assert.equal(video!.metrics.views, 88000);
  });

  it('uses a stable fallback id for the same raw item', () => {
    const a = normalizeItem('unknown-site', { title: 'same', url: 'https://ex.com/a' });
    const b = normalizeItem('unknown-site', { title: 'same', url: 'https://ex.com/a' });
    assert.equal(a!.id, b!.id);
  });
});

describe('isChineseText', () => {
  it('treats mostly-Chinese as Chinese', () => {
    assert.equal(isChineseText('这是一条中文标题'), true);
    assert.equal(isChineseText('Hello world this is English'), false);
    assert.equal(isChineseText(''), false);
  });
});
