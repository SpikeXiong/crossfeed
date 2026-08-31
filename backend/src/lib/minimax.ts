// MiniMax-M3 调用封装
// 国内 token plan 用法（按官方文档调整 base URL 和鉴权方式）

import { cached } from './cache.js';
import { minimaxSettings } from './runtimeConfig.js';

export async function callMinimax(prompt: string, opts: {
  maxTokens?: number;
  temperature?: number;
  system?: string;
} = {}): Promise<string> {
  const { maxTokens = 500, temperature = 0.5, system } = opts;
  const { baseUrl, apiKey, model } = minimaxSettings();

  if (!apiKey) {
    throw new Error('未配置 OpenAI 兼容接口的 API Key');
  }

  // 防御：如果用户没配置 reasoning_enabled（某些模型默认开思考），强制关
  const reasoningOff = {
    ...(model.includes('MiniMax') || model.includes('minimax') || model.includes('r1') || model.includes('qwq')
      ? { reasoning: { enabled: false } }
      : {}),
  };

  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: system || '你是一个简洁的翻译助手。只输出译文，不要解释。'
          },
          { role: 'user', content: prompt },
        ],
        max_tokens: maxTokens,
        temperature,
        ...reasoningOff,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error('[MiniMax] HTTP error:', resp.status, text.slice(0, 200));
      // 429 等限流：抛错让上层重试；其他错误返回兜底文本
      if (resp.status === 429 || resp.status === 503) {
        const err: any = new Error(`AI rate limit (${resp.status}): ${text.slice(0, 100)}`);
        err.status = resp.status;
        err.isRateLimit = true;
        throw err;
      }
      return `[AI 暂时不可用 (HTTP ${resp.status})]`;
    }

    const data: any = await resp.json();
    let raw = data?.choices?.[0]?.message?.content?.trim() || '[空响应]';
    // 兜底：剥掉 <think>...</think>（含跨行）
    raw = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    return raw || '[空响应]';
  } catch (e: any) {
    // 限流错误抛出去，让上层重试
    if (e?.isRateLimit) throw e;
    console.error('[MiniMax] call failed:', e?.message);
    return `[AI 错误: ${e?.message || 'unknown'}]`;
  }
}

// 内部 fetcher（带缓存）
async function _callMinimaxInner(prompt: string, opts: any): Promise<string> {
  return callMinimax(prompt, opts);
}

// 带缓存的调用：相同 prompt 不重复请求（24 小时 TTL）
export async function callMinimaxCached(prompt: string, opts: any = {}): Promise<string> {
  const { model } = minimaxSettings();
  const key = `llm:${model}:${String(opts.system || '').slice(0, 40)}:${prompt.slice(0, 200)}`;
  return cached(key, 86400, () => _callMinimaxInner(prompt, opts));
}

// 为单条内容生成"反茧房陪读"
export async function curateItem(item: {
  title: string;
  author?: string;
  platform: string;
  content?: string;
}): Promise<string> {
  const prompt = `
为下面这条内容写一句"反茧房陪读"，帮读者快速判断要不要花时间看。

平台：${item.platform}
作者：${item.author || '未知'}
标题：${item.title}
${item.content ? `内容：${item.content.slice(0, 200)}` : ''}

要求：
1. 1-2 句话，先说"在讨论什么"，再说"为什么值得/不值得看"
2. 避免套话（不要"这篇文章"、"这条推文"开头）
3. 直接给洞察，不要"作为AI..."这种废话
`.trim();

  return callMinimaxCached(prompt, {
    maxTokens: 200,
    system: '你是一个简洁的"反茧房陪读员"，专精信息解读。回答用中文，控制在 1-3 句话内。',
  });
}

// 立场分析
export async function detectStance(item: {
  title: string;
  content?: string;
}): Promise<'optimistic' | 'critical' | 'neutral' | 'mixed'> {
  const prompt = `
判断下面内容的立场（只能选一个词回复）：
- optimistic（乐观/支持）
- critical（批判/质疑）
- neutral（中性陈述）
- mixed（矛盾/复杂）

标题：${item.title}
${item.content ? `内容：${item.content.slice(0, 300)}` : ''}

只回一个词。`.trim();

  const resp = await callMinimaxCached(prompt, {
    maxTokens: 10,
    temperature: 0,
    system: '只回复一个立场词。',
  });
  const cleaned = resp
    .replace(/<think>[\s\S]*?<\/think>/gi, '')   // 防御：剥思考
    .trim()
    .toLowerCase()
    .replace(/[。.,!?！？\s]/g, '');             // 剥标点/空白
  if (cleaned.includes('optimistic')) return 'optimistic';
  if (cleaned.includes('critical')) return 'critical';
  if (cleaned.includes('mixed')) return 'mixed';
  return 'neutral';
}