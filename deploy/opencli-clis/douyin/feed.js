/**
 * Douyin 推荐视频（具体作品，不是热搜话题）。
 *
 * 首页是竖屏播放器，热搜侧栏很容易被误抓成话题。
 * 这里走已经验证过的搜索结果页 DOM 抽取，关键词用「推荐」。
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import {
  MAX_SEARCH_LIMIT,
  RENDER_TIMEOUT_MS,
  parseSearchLimit,
  projectSearchCards,
  WAIT_AND_EXTRACT_JS,
  unwrapEvaluateResult,
} from './search.js';

const FEED_QUERY = '推荐';

cli({
  site: 'douyin',
  name: 'feed',
  access: 'read',
  description: '抖音推荐视频',
  domain: 'www.douyin.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'limit', type: 'int', default: 20, help: `Number of videos (1-${MAX_SEARCH_LIMIT})` },
  ],
  columns: ['rank', 'desc', 'author', 'url', 'cover', 'plays', 'likes', 'comments', 'shares', 'published'],
  func: async (page, kwargs) => {
    const limit = parseSearchLimit(kwargs.limit ?? 20);
    await page.goto(`https://www.douyin.com/search/${encodeURIComponent(FEED_QUERY)}?type=video`);
    let result;
    try {
      result = unwrapEvaluateResult(await page.evaluate(WAIT_AND_EXTRACT_JS(RENDER_TIMEOUT_MS)));
    } catch (error) {
      throw new CommandExecutionError(`Douyin feed extraction failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!result || typeof result !== 'object') {
      throw new CommandExecutionError('Douyin feed: unexpected evaluator payload shape');
    }
    if (result.state === 'login_wall') {
      throw new AuthRequiredError(
        'www.douyin.com',
        'Douyin feed requires login at https://www.douyin.com',
      );
    }
    if (result.state === 'empty' || result.state === 'timeout' || !Array.isArray(result.cards) || result.cards.length === 0) {
      throw new EmptyResultError('douyin feed', 'No Douyin recommend videos found. Open https://www.douyin.com and confirm login.');
    }
    const projected = projectSearchCards(result.cards, limit);
    if (projected.rows.length === 0) {
      throw new EmptyResultError('douyin feed', 'No Douyin recommend videos found.');
    }
    return projected.rows;
  },
});
