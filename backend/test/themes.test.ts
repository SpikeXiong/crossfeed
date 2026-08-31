import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sourcesForTheme, FEED_THEMES, buildSearchSources } from '../src/lib/feed.js';

describe('sourcesForTheme', () => {
  it('uses each platform home feed in 综合', () => {
    const src = sourcesForTheme('mixed');
    assert.equal(src.find(s => s.platform === 'bilibili')?.command, 'hot');
    assert.equal(src.find(s => s.platform === 'weibo')?.command, 'feed');
    assert.equal(src.find(s => s.platform === 'zhihu')?.command, 'hot');
    assert.equal(src.find(s => s.platform === 'douyin')?.command, 'feed');
    assert.equal(src.find(s => s.platform === 'hackernews')?.command, 'top');
    assert.equal(src.find(s => s.platform === 'youtube')?.command, 'hot');
    assert.equal(src.find(s => s.platform === 'twitter')?.command, 'timeline');
    assert.equal(src.find(s => s.platform === 'xiaohongshu')?.command, 'feed');
  });

  it('switches search args per theme for youtube/twitter/douyin/weibo', () => {
    assert.deepEqual(sourcesForTheme('tech').find(s => s.platform === 'douyin')?.args, ['科技']);
    assert.deepEqual(sourcesForTheme('tech').find(s => s.platform === 'weibo')?.args, ['科技']);
    const tw = sourcesForTheme('society').find(s => s.platform === 'twitter');
    assert.equal(tw?.command, 'search');
    assert.ok(String(tw?.args?.[0] || '').startsWith('world since:'));
    assert.deepEqual(tw?.extra, ['--product', 'live']);
    const yt = sourcesForTheme('tech').find(s => s.platform === 'youtube');
    assert.equal(yt?.command, 'search');
    assert.deepEqual(yt?.extra, ['--upload', 'week']);
  });

  it('lists three themes', () => {
    assert.deepEqual(Object.keys(FEED_THEMES), ['mixed', 'tech', 'society']);
  });
});

describe('buildSearchSources', () => {
  it('pins YouTube to this week and X to live + since', () => {
    const src = buildSearchSources('openai');
    const yt = src.find(s => s.platform === 'youtube');
    const tw = src.find(s => s.platform === 'twitter');
    assert.deepEqual(yt?.extra, ['--upload', 'week']);
    assert.ok(String(tw?.args?.[0] || '').includes('since:'));
    assert.deepEqual(tw?.extra, ['--product', 'live']);
  });
});
