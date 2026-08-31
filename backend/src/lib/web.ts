// 生产模式：后端直接托管 frontend/dist，一个进程一个端口。
import { createReadStream, existsSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative, sep } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type { Hono } from 'hono';
import { getMimeType } from 'hono/utils/mime';

export function resolveWebRoot(): string | null {
  const fromEnv = process.env.WEB_ROOT?.trim();
  const candidates = [
    fromEnv,
    join(dirname(fileURLToPath(import.meta.url)), '../../frontend/dist'),
    join(process.cwd(), 'frontend/dist'),
    join(process.cwd(), '../frontend/dist'),
  ].filter((p): p is string => !!p);
  for (const dir of candidates) {
    if (existsSync(join(dir, 'index.html'))) return dir;
  }
  return null;
}

export function resolveStaticFile(webRoot: string, urlPath: string): string {
  const index = join(webRoot, 'index.html');
  let decoded = urlPath.split('?')[0] || '/';
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    return index;
  }
  const rel = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const file = normalize(join(webRoot, rel));
  const escaped = relative(webRoot, file);
  if (!escaped || escaped.startsWith('..') || isAbsolute(escaped) || escaped.split(sep).includes('..')) {
    return index;
  }
  try {
    const st = statSync(file);
    if (st.isFile()) return file;
    if (st.isDirectory()) {
      const nested = join(file, 'index.html');
      if (existsSync(nested)) return nested;
    }
  } catch {
    /* SPA fallback */
  }
  return index;
}

function isHashedAsset(file: string, webRoot: string): boolean {
  const rel = relative(webRoot, file).split(sep).join('/');
  return rel.startsWith('assets/');
}

export function mountWeb(app: Hono, webRoot: string): void {
  const index = join(webRoot, 'index.html');
  app.use('*', async (c, next) => {
    if (c.req.path.startsWith('/api')) return next();
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return next();
    const file = resolveStaticFile(webRoot, c.req.path);
    if (!existsSync(file)) return next();
    const mime = getMimeType(file) || 'application/octet-stream';
    c.header('Content-Type', mime);
    if (file === index) c.header('Cache-Control', 'no-cache');
    else if (isHashedAsset(file, webRoot)) {
      c.header('Cache-Control', 'public, max-age=31536000, immutable');
    }
    if (c.req.method === 'HEAD') {
      return c.body(null, 200);
    }
    return c.body(Readable.toWeb(createReadStream(file)) as unknown as ReadableStream, 200);
  });
}
