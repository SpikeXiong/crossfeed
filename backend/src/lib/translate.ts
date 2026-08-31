// 标题翻译：默认关闭。可选免费 API，或任意 OpenAI 兼容 chat/completions。
import { callMinimaxCached } from './minimax.js';
import { logger } from './logger.js';
import { getSharedDb } from './persistence.js';
import {
  translateEnabled,
  translateProvider,
  freeTranslateEngine,
  libreTranslateUrl,
  openaiSettings,
} from './runtimeConfig.js';

export type DetectedLang = 'zh' | 'ja' | 'ko' | 'en' | 'und';

function getDb() {
  return getSharedDb();
}

function hashKey(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
  }
  return String(h >>> 0);
}

/** MyMemory 不支持 auto；日文假名/韩文不能当中文跳过。 */
export function detectLangCode(text: string): DetectedLang {
  if (!text) return 'und';
  let han = 0;
  let kana = 0;
  let hangul = 0;
  let latin = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0) || 0;
    if (c >= 0x3040 && c <= 0x30ff) kana++;
    else if (c >= 0xac00 && c <= 0xd7af) hangul++;
    else if (c >= 0x4e00 && c <= 0x9fff) han++;
    else if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) latin++;
  }
  if (kana > 0) return 'ja';
  if (hangul > 0) return 'ko';
  if (han > 0 && han / text.length > 0.3) return 'zh';
  if (latin >= 3 && latin >= han) return 'en';
  if (han > latin) return 'zh';
  return 'und';
}

export function isChineseText(s: string): boolean {
  return detectLangCode(s) === 'zh';
}

export function isUnusableTranslation(dst: string, src?: string): boolean {
  if (!dst || typeof dst !== 'string') return true;
  const t = dst.trim();
  if (!t) return true;
  const u = t.toUpperCase();
  if (u.includes('INVALID SOURCE LANGUAGE')) return true;
  if (u.includes('LANGPAIR=')) return true;
  if (u.includes('MYMEMORY WARNING')) return true;
  if (u.includes('PLEASE SELECT TWO DISTINCT LANGUAGES')) return true;
  if (src && t === src) return false;
  return false;
}

let purgedBadCache = false;
function purgeBadTranslationCache(): void {
  if (purgedBadCache) return;
  purgedBadCache = true;
  try {
    getDb().prepare(`
      DELETE FROM translation_cache
      WHERE dst LIKE '%INVALID SOURCE LANGUAGE%'
         OR dst LIKE '%LANGPAIR=%'
         OR dst LIKE '%MYMEMORY WARNING%'
    `).run();
  } catch {
    // ignore
  }
}

export function getCachedTranslation(text: string, target: string = 'zh'): string | null {
  try {
    purgeBadTranslationCache();
    const db = getDb();
    const row = db.prepare(`
      SELECT dst FROM translation_cache WHERE src_hash = ? AND target = ?
    `).get(hashKey(text), target) as any;
    const dst = row?.dst;
    if (!dst) return null;
    if (isUnusableTranslation(dst, text)) {
      db.prepare('DELETE FROM translation_cache WHERE src_hash = ? AND target = ?')
        .run(hashKey(text), target);
      return null;
    }
    return dst;
  } catch {
    return null;
  }
}

function saveTranslation(text: string, dst: string, target: string = 'zh'): void {
  if (isUnusableTranslation(dst, text)) return;
  try {
    const db = getDb();
    db.prepare(`
      INSERT OR REPLACE INTO translation_cache (src_hash, target, src, dst, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(hashKey(text), target, text.slice(0, 2000), dst, Date.now());
  } catch (e) {
    console.error('[translate] save failed:', e);
  }
}

function targetLang(target: string): string {
  return target === 'zh' || target === 'zh-CN' ? 'zh-CN' : target;
}

function mymemorySource(text: string): string {
  const code = detectLangCode(text);
  if (code === 'zh') return 'zh-CN';
  if (code === 'und') throw new Error('MyMemory needs an explicit source language');
  return code;
}

async function translateViaMyMemory(text: string, target: string): Promise<string> {
  const sl = mymemorySource(text);
  const tl = targetLang(target);
  const pair = `${sl}|${tl}`;
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 500))}&langpair=${encodeURIComponent(pair)}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`MyMemory HTTP ${resp.status}`);
  const data: any = await resp.json();
  const status = Number(data?.responseStatus);
  const dst = data?.responseData?.translatedText;
  if (status && status !== 200) {
    throw new Error(`MyMemory status ${status}: ${String(dst || data?.responseDetails || '').slice(0, 120)}`);
  }
  if (!dst || typeof dst !== 'string') throw new Error('MyMemory empty');
  if (isUnusableTranslation(dst, text)) throw new Error(`MyMemory unusable: ${dst.slice(0, 80)}`);
  return dst.trim();
}

async function translateViaGoogleGtx(text: string, target: string): Promise<string> {
  const tl = targetLang(target);
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(tl)}&dt=t&q=${encodeURIComponent(text.slice(0, 1000))}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Google translate HTTP ${resp.status}`);
  const data: any = await resp.json();
  const chunks = Array.isArray(data?.[0]) ? data[0] : [];
  const dst = chunks.map((c: any) => (Array.isArray(c) ? c[0] : '')).join('');
  if (!dst) throw new Error('Google translate empty');
  if (isUnusableTranslation(dst, text)) throw new Error('Google translate unusable');
  return dst.trim();
}

async function translateViaLibre(text: string, target: string): Promise<string> {
  const base = libreTranslateUrl() || 'https://libretranslate.com';
  const tl = targetLang(target);
  const detected = detectLangCode(text);
  const source = detected === 'und' ? 'auto' : detected === 'zh' ? 'zh' : detected;
  const resp = await fetch(`${base.replace(/\/$/, '')}/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      q: text.slice(0, 1000),
      source,
      target: tl.startsWith('zh') ? 'zh' : tl,
      format: 'text',
    }),
  });
  if (!resp.ok) throw new Error(`LibreTranslate HTTP ${resp.status}`);
  const data: any = await resp.json();
  const dst = data?.translatedText;
  if (!dst || typeof dst !== 'string') throw new Error('LibreTranslate empty');
  if (isUnusableTranslation(dst, text)) throw new Error('LibreTranslate unusable');
  return dst.trim();
}

type FreeFn = (text: string, target: string) => Promise<string>;

async function translateFree(text: string, target: string): Promise<string> {
  const engine = freeTranslateEngine();
  const google: FreeFn = translateViaGoogleGtx;
  const mymemory: FreeFn = translateViaMyMemory;
  const libre: FreeFn = translateViaLibre;
  const order: FreeFn[] = engine === 'google'
    ? [google, mymemory, libre]
    : engine === 'libre'
      ? [libre, google, mymemory]
      : [mymemory, google, libre];
  let lastErr: unknown;
  for (const fn of order) {
    try {
      return await fn(text, target);
    } catch (e) {
      lastErr = e;
      logger.debug('translate engine miss', { err: String(e) }, 'translate');
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr || 'translate failed'));
}

async function translateViaOpenAI(text: string, target: string): Promise<string> {
  const { apiKey } = openaiSettings();
  if (!apiKey) throw new Error('未配置 OpenAI 兼容接口的 API Key');
  const targetLabel = target === 'zh' || target === 'zh-CN' ? '简体中文' : target;
  const prompt = `把下面的${detectSourceLang(text)}文本翻译成${targetLabel}。
要求：
1. 保留原意，语气贴合原平台风格（推特口语、新闻正式、技术文章严谨）
2. 不需要解释，直接给译文
3. 专有名词（产品名、人名、API 名）保留英文
4. 长度尽量与原文相当

原文：
${text.slice(0, 1000)}`.trim();
  return callMinimaxCached(prompt, {
    maxTokens: 800,
    temperature: 0.3,
    system: '你是翻译助手。只输出译文，不要解释。',
  });
}

export async function translateText(text: string, target: string = 'zh'): Promise<string> {
  if (!text || text.length < 4) return text;
  if (!translateEnabled()) return text;
  if (target === 'zh' && isChineseText(text)) return text;
  const cached = getCachedTranslation(text, target);
  if (cached) {
    logger.debug('translate cache hit', { len: text.length }, 'translate');
    return cached;
  }
  const start = Date.now();
  const provider = translateProvider();
  try {
    const translated = provider === 'openai'
      ? await translateViaOpenAI(text, target)
      : await translateFree(text, target);
    if (isUnusableTranslation(translated, text)) return text;
    logger.info('translate done', { len: text.length, ms: Date.now() - start, provider }, 'translate');
    saveTranslation(text, translated, target);
    return translated;
  } catch (e) {
    logger.warn('translate failed, keep original', { err: String(e) }, 'translate');
    return text;
  }
}

function detectSourceLang(text: string): string {
  const code = detectLangCode(text);
  if (code === 'zh') return '中文';
  if (code === 'ja') return '日文';
  if (code === 'ko') return '韩文';
  return '外文';
}
