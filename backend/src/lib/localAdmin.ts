// 站点 / 登录 / OpenCLI 等只能在「跑后端的这台机器」上改。
// 手机走局域网 IP 时，Vite 会把 /api 转到 127.0.0.1，连接 IP 会变成回环，
// 所以必须以浏览器 Origin 为准，不能只看 socket.remoteAddress。

export function isLoopbackHost(host: string | undefined | null): boolean {
  if (!host) return false;
  const h = host.replace(/^\[/, '').replace(/\]$/, '').split('%')[0].toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0:0:0:0:0:0:0:1';
}

export function isLoopbackAddr(addr: string | undefined | null): boolean {
  if (!addr) return false;
  const a = addr.replace(/^::ffff:/i, '').replace(/^\[/, '').replace(/\]$/, '');
  return a === '127.0.0.1' || a === '::1' || a === 'localhost' || a === '0:0:0:0:0:0:0:1';
}

export function hostnameFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/** 顶栏主题 / 翻译开关：局域网也可以改。其余配置算本机管理项。 */
export const PUBLIC_WRITE_KEYS = new Set([
  'feed.theme',
  'translate.enabled',
]);

export const PUBLIC_READ_KEYS = new Set([
  'feed.theme',
  'translate.enabled',
  'feed.perPage',
]);

export function isLocalAdminRequest(opts: {
  origin?: string | null;
  referer?: string | null;
  remoteAddress?: string | null;
}): boolean {
  const from = opts.origin || opts.referer || '';
  if (from) {
    const host = hostnameFromUrl(from);
    if (host) return isLoopbackHost(host);
  }
  return isLoopbackAddr(opts.remoteAddress);
}

export function sanitizeConfig(
  config: Record<string, unknown>,
  localAdmin: boolean,
): Record<string, unknown> {
  if (localAdmin) return config;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    if (PUBLIC_READ_KEYS.has(k)) out[k] = v;
  }
  return out;
}
