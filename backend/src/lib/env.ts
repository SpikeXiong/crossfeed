// 启动时读 backend/.env.local。只认 CROSSFEED_*，没有旧名兼容。
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ENV_KEYS = {
  host: 'CROSSFEED_HOST',
  port: 'CROSSFEED_PORT',
  corsOrigins: 'CROSSFEED_CORS_ORIGINS',
  webRoot: 'CROSSFEED_WEB_ROOT',
  opencliBin: 'CROSSFEED_OPENCLI_BIN',
  feedTtl: 'CROSSFEED_FEED_TTL_SECONDS',
  dataDir: 'CROSSFEED_DATA_DIR',
  dbPath: 'CROSSFEED_DB_PATH',
  llmApiKey: 'CROSSFEED_LLM_API_KEY',
  llmBaseUrl: 'CROSSFEED_LLM_BASE_URL',
  llmModel: 'CROSSFEED_LLM_MODEL',
  opencliMuted: 'CROSSFEED_OPENCLI_MUTED',
} as const;

export type EnvName = keyof typeof ENV_KEYS;

function candidates(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  return [
    join(process.cwd(), 'backend/.env.local'),
    join(process.cwd(), '.env.local'),
    join(here, '../../.env.local'),
    join(here, '../.env.local'),
  ];
}

export function loadEnvLocal(): string | null {
  for (const file of candidates()) {
    if (!existsSync(file)) continue;
    const text = readFileSync(file, 'utf8');
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
      if (process.env[key] !== undefined) continue;
      let val = line.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
    return file;
  }
  return null;
}

export function env(name: EnvName, fallback = ''): string {
  const v = process.env[ENV_KEYS[name]];
  if (v == null || String(v).trim() === '') return fallback;
  return String(v).trim();
}

/** 开/关。未设置时用 defaultValue。`0` / `false` / `off` / `no` 为关。 */
export function envFlag(name: EnvName, defaultValue: boolean): boolean {
  const raw = process.env[ENV_KEYS[name]];
  if (raw == null || String(raw).trim() === '') return defaultValue;
  const s = String(raw).trim().toLowerCase();
  return s !== '0' && s !== 'false' && s !== 'off' && s !== 'no';
}

loadEnvLocal();
