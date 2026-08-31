// 批量预取：缩略图 + AI 解读
// 设计：一次拉完所有内容，后台并发补全
import { FeedItem } from './normalize.js';
import { callOpenCli } from './opencli.js';
import { curateItem, detectStance } from './minimax.js';

// 把 opencli 的 [{field, value}] 数组转成对象
function fieldsToObject(arr: any[]): Record<string, any> {
  const obj: Record<string, any> = {};
  for (const item of arr || []) {
    if (item && typeof item === 'object' && 'field' in item) {
      obj[item.field] = item.value;
    }
  }
  return obj;
}

// 单条缩略图补抓
async function fetchOneThumbnail(item: FeedItem): Promise<string | null> {
  if (!item.refId) return null;
  if (item.thumbnail) return item.thumbnail;  // 已有

  // 登录态平台：persistent session 让 cookie 跨调用保持
  // 注：douyin video 用 persistent；小红书封面只从 feed/search 拿，不走 note-cover
  const session = ['douyin', 'jike'].includes(item.platform)
    ? 'persistent' : 'ephemeral';

  try {
    let res;
    if (item.platform === 'bilibili') {
      res = await callOpenCli('bilibili', 'video', [item.refId], { siteSession: session as any });
      const obj = fieldsToObject(res.data || []);
      return obj.thumbnail || null;
    }
    if (item.platform === 'youtube') {
      res = await callOpenCli('youtube', 'video', [item.refId], { siteSession: session as any });
      const data = res.data?.[0];
      if (data && 'field' in data) {
        return fieldsToObject(res.data || []).thumbnail || null;
      }
      return data?.thumbnail || null;
    }
    if (item.platform === 'xiaohongshu') {
      // 封面必须来自 feed/search 原始字段。note-cover 会对每条笔记新开浏览器
      // 打公开页，默认并发 12，日志里会在几秒内打出十几次，触发小红书「频繁请求」。
      return null;
    }
    if (item.platform === 'jike') {
      res = await callOpenCli('jike', 'post', [item.refId], { siteSession: session as any });
      const post = res.data?.[0] as any;
      return post?.pictures?.[0]?.url || null;
    }
    if (item.platform === 'douyin' && item.type === 'short') {
      // 用 douyin video 命令（公开 detail API），不用 stats（创作者后台接口，对公开视频永远返 EMPTY）
      res = await callOpenCli('douyin', 'video', [item.refId], { siteSession: 'persistent' });
      const v = res.data?.[0] as any;
      return v?.cover || null;
    }
  } catch (e) {
    // ignore
  }
  return null;
}

// 批量并发补缩略图（限并发避免拖死）
// skipPlatforms: 这些平台根本不会有图，跳过不浪费请求
async function enrichThumbnails(items: FeedItem[], concurrency = 4, skipPlatforms?: Set<string>): Promise<void> {
  const targets = items.filter(i =>
    !i.thumbnail && i.refId &&
    ['bilibili', 'youtube', 'jike', 'douyin'].includes(i.platform) &&
    !(skipPlatforms && skipPlatforms.has(i.platform))
  );
  if (targets.length === 0) return;

  // 简单的并发控制
  const queue = [...targets];
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (!item) break;
      const url = await fetchOneThumbnail(item);
      if (url) item.thumbnail = url;
    }
  });
  await Promise.all(workers);
}

// 批量并发 AI 解读（带限流保护）
// 设计：低并发 + 请求间隔 + 429 智能退避 + 连续失败降级
// 防 hang 双保险：
//   - A 全局上限：429 总数到 MAX_GLOBAL_429 直接清空队列 + break（5 × 5s = 25s 兜底）
//   - B 单 item 上限：单 item 429 重试 MAX_PER_ITEM_429 次后跳过（不放回队列），其他 item 不受影响
async function enrichAi(items: FeedItem[], opts: { concurrency?: number; minIntervalMs?: number } = {}): Promise<void> {
  const { concurrency = 2, minIntervalMs = 400 } = opts;  // RPM 友好默认值
  const targets = items.filter(i => !i.aiSummary);
  if (targets.length === 0) return;

  const MAX_GLOBAL_429 = 5;     // A: 全局最大 429 次数
  const MAX_PER_ITEM_429 = 3;   // B: 单 item 最大 429 次数

  let consecutive429 = 0;
  let degraded = false;  // 降级模式：连续 429 后切到单条慢速
  let global429Count = 0;       // A: 全局 429 累计
  const itemRetries = new WeakMap<FeedItem, number>();  // B: 单 item 429 次数

  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

  const queue = [...targets];
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (!item) break;

      // 限流：如果已经降级，每个请求之间强制等 1.5s
      if (degraded) await sleep(1500);
      else if (minIntervalMs > 0) await sleep(minIntervalMs);

      try {
        const [commentaryRes, stanceRes] = await Promise.allSettled([
          curateItem({
            title: item.title,
            author: item.author,
            platform: item.platform,
            content: item.content,
          }),
          detectStance({ title: item.title, content: item.content }),
        ]);

        if (commentaryRes.status === 'fulfilled') {
          item.aiSummary = commentaryRes.value;
        }
        if (stanceRes.status === 'fulfilled') {
          item.aiStance = stanceRes.value;
        }

        // 任一是 429 限流
        const rateLimited =
          (commentaryRes.status === 'rejected' && (commentaryRes.reason as any)?.isRateLimit) ||
          (stanceRes.status === 'rejected' && (stanceRes.reason as any)?.isRateLimit);

        if (rateLimited) {
          consecutive429++;
          global429Count++;
          if (consecutive429 >= 2) {
            degraded = true;
            console.warn('[enrichAi] 进入降级模式：连续 429');
          }

          // A: 全局上限 — 直接放弃所有剩余 item
          if (global429Count >= MAX_GLOBAL_429) {
            console.warn(`[enrichAi] 全局 429 达 ${MAX_GLOBAL_429} 次, 放弃剩余 ${queue.length + 1} 条 (含本条)`);
            queue.length = 0;
            break;
          }

          // B: 单 item 上限 — 当前 item 跳过后续重试
          const perItem = (itemRetries.get(item) || 0) + 1;
          itemRetries.set(item, perItem);
          if (perItem >= MAX_PER_ITEM_429) {
            console.warn(`[enrichAi] item ${item.id} 429 达 ${MAX_PER_ITEM_429} 次, 跳过该 item`);
            // 不放回队列,继续处理其他 item
            continue;
          }

          // 把 item 放回队列尾部，等会儿重试
          queue.push(item);
          const backoff = degraded ? 5000 : Math.min(2000 + consecutive429 * 1000, 10000);
          console.log(`[enrichAi] 429 限流，${backoff}ms 后重试 (item ${perItem}/${MAX_PER_ITEM_429}, global ${global429Count}/${MAX_GLOBAL_429})`);
          await sleep(backoff);
        } else if (commentaryRes.status === 'rejected') {
          // 其他错误（如网络），跳过
          console.warn('[enrichAi] error:', (commentaryRes.reason as any)?.message);
        } else {
          // 成功
          consecutive429 = 0;
        }
      } catch (e: any) {
        console.warn('[enrichAi] unexpected:', e?.message);
      }
    }
  });
  await Promise.all(workers);
}

// 同步：补全部缩略图
async function enrichThumbnailsOnly(items: FeedItem[], concurrency = 6, skipPlatforms?: Set<string>): Promise<void> {
  return enrichThumbnails(items, concurrency, skipPlatforms);
}

// 同步：补 AI（限前 N 条）
async function enrichAiOnly(items: FeedItem[], opts: { concurrency?: number; minIntervalMs?: number } = {}): Promise<void> {
  return enrichAi(items, opts);
}

// 单独导出，供路由灵活组合
export { fetchOneThumbnail, enrichThumbnailsOnly, enrichAiOnly, enrichAi };
export async function enrichFeed(
  items: FeedItem[],
  opts: { thumbnail?: boolean; ai?: boolean; thumbConcurrency?: number; aiConcurrency?: number; minIntervalMs?: number } = {}
): Promise<void> {
  const { thumbnail = true, ai = true, thumbConcurrency = 6, aiConcurrency = 5, minIntervalMs = 400 } = opts;

  // 先并发跑缩略图和AI（两者独立）
  await Promise.all([
    thumbnail ? enrichThumbnails(items, thumbConcurrency) : Promise.resolve(),
    ai ? enrichAi(items, { concurrency: aiConcurrency, minIntervalMs }) : Promise.resolve(),
  ]);
}

// 流式版本：先返回基础数据 + 缩略图（快），AI 慢但分批发出
// 用法：onProgress 会在每次单条 AI 完成时被调用，可用于 SSE 推送
export async function enrichFeedStreaming(
  items: FeedItem[],
  onProgress: (item: FeedItem) => void,
  opts: { aiConcurrency?: number } = {}
): Promise<void> {
  const { aiConcurrency = 5 } = opts;

  // 缩略图先并发跑完
  await enrichThumbnails(items, 8);

  // AI 一条完成就回调一条
  const queue = items.filter(i => !i.aiSummary);
  const workers = Array.from({ length: aiConcurrency }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (!item) break;
      try {
        const [commentary, stance] = await Promise.all([
          curateItem({
            title: item.title,
            author: item.author,
            platform: item.platform,
            content: item.content,
          }),
          detectStance({ title: item.title, content: item.content }),
        ]);
        item.aiSummary = commentary;
        item.aiStance = stance;
        onProgress(item);
      } catch {
        // ignore
      }
    }
  });
  await Promise.all(workers);
}