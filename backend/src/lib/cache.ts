// 简单的内存缓存（避免重复请求同一资源）
// 注意：重启服务后失效。生产环境应该用 Redis。

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<any>>();
const inflight = new Map<string, Promise<any>>();

// 定期清理过期缓存
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt < now) cache.delete(key);
  }
}, 60_000).unref?.();

export async function cached<T>(
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>
): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) {
    return hit.value;
  }
  const pending = inflight.get(key) as Promise<T> | undefined;
  if (pending) return pending;

  const p = loader()
    .then((value) => {
      cache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
      return value;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, p);
  return p;
}

export function clearCache(pattern?: string): number {
  if (!pattern) {
    const n = cache.size;
    cache.clear();
    inflight.clear();
    return n;
  }
  let n = 0;
  for (const key of cache.keys()) {
    if (key.includes(pattern)) {
      cache.delete(key);
      n++;
    }
  }
  return n;
}