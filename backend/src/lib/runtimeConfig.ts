// 运行时配置：app_config（设置页）优先，环境变量兜底。
// 给后续 App 用：同一套 /api/config + /api/runtime，不读前端 localStorage。
import { getConfig } from './persistence.js';
import { parseIntSafe } from './parse.js';
import { env } from './env.js';

const PLATFORMS = ['bilibili', 'hackernews', 'twitter', 'youtube', 'xiaohongshu', 'weibo', 'zhihu', 'douyin'] as const;
export type PlatformId = (typeof PLATFORMS)[number];
export const ALL_PLATFORM_IDS: readonly string[] = PLATFORMS;

const DEFAULT_PER_SOURCE = 12;

function pick<T>(key: string, fallback: T): T {
  const v = getConfig<T>(key);
  return v == null ? fallback : v;
}

export function feedTtlSec(): number {
  return parseIntSafe(String(pick('feed.ttl', env('feedTtl', '18000'))), 18000, 60);
}

export function defaultPerPage(): number {
  return parseIntSafe(String(pick('feed.perPage', 30)), 30, 6, 60);
}

export function defaultPerSource(): number {
  return parseIntSafe(String(pick('feed.perSource', DEFAULT_PER_SOURCE)), DEFAULT_PER_SOURCE, 1, 50);
}

export function perSourceLimit(platform?: string): number {
  const fallback = defaultPerSource();
  if (!platform) return fallback;
  const key = `feed.limit.${platform}`;
  const v = getConfig<number>(key);
  if (v == null) return fallback;
  return parseIntSafe(String(v), fallback, 1, 50);
}

/** YouTube / X 内容超过这个天数就丢掉，避免搜到几年前的帖 */
export function maxAgeDays(platform?: string): number {
  const global = parseIntSafe(String(pick('feed.maxAgeDays', 14)), 14, 1, 365);
  if (!platform) return global;
  const v = getConfig<number>(`feed.maxAgeDays.${platform}`);
  if (v == null) return global;
  return parseIntSafe(String(v), global, 1, 365);
}

export function enrichConcurrency(): number {
  return parseIntSafe(String(pick('feed.enrichConcurrency', 3)), 3, 1, 32);
}

export function skipTextEnrichment(): boolean {
  return pick<boolean>('feed.skipTextPlatformEnrichment', true) !== false;
}

export function configuredOpenCliPath(): string | null {
  const fromCfg = pick<string>('opencli.path', '');
  if (fromCfg && fromCfg.trim()) return fromCfg.trim();
  const fromEnv = env('opencliBin');
  return fromEnv || null;
}

export type TranslateProvider = 'free' | 'openai';
export type FreeTranslateEngine = 'mymemory' | 'google' | 'libre';

export function translateEnabled(): boolean {
  return pick<boolean>('translate.enabled', false) === true;
}

export function translateProvider(): TranslateProvider {
  const p = pick<string>('translate.provider', 'free');
  return p === 'openai' ? 'openai' : 'free';
}

export function freeTranslateEngine(): FreeTranslateEngine {
  const e = pick<string>('translate.free.engine', 'mymemory');
  if (e === 'google' || e === 'libre') return e;
  return 'mymemory';
}

export function libreTranslateUrl(): string {
  return (pick('translate.free.libreUrl', '') || '').trim();
}

/** OpenAI 兼容（含 MiniMax / DeepSeek / 任意 /v1/chat/completions） */
export function openaiSettings(): {
  baseUrl: string;
  apiKey: string;
  model: string;
  target: string;
} {
  const fromEnv = env('llmBaseUrl');
  const fromKey = env('llmApiKey');
  const fromModel = env('llmModel');
  return {
    baseUrl: pick('translate.openai.baseUrl', fromEnv || 'https://api.openai.com/v1'),
    apiKey: pick('translate.openai.apiKey', fromKey || ''),
    model: pick('translate.openai.model', fromModel || 'gpt-4o-mini'),
    target: pick('translate.target', 'zh'),
  };
}

/** @deprecated 用 openaiSettings；保留给 minimax.ts */
export function minimaxSettings() {
  return openaiSettings();
}

export function defaultTheme(): string {
  const t = pick<string>('feed.theme', 'mixed');
  return t === 'tech' || t === 'society' ? t : 'mixed';
}

export function recencySinceDate(days?: number): string {
  const d = new Date(Date.now() - (days ?? maxAgeDays()) * 86_400_000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
