// 启动时读 backend/.env.local（不覆盖已经在环境里的值）。
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

loadEnvLocal();
