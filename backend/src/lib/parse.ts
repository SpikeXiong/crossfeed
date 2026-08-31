/** 安全 parseInt：非法输入回 fallback，可选夹紧到 [min, max] */
export function parseIntSafe(
  v: string | undefined | null,
  fallback: number,
  min?: number,
  max?: number,
): number {
  const n = parseInt(v ?? '', 10);
  if (!Number.isFinite(n)) return fallback;
  let x = n;
  if (min !== undefined) x = Math.max(min, x);
  if (max !== undefined) x = Math.min(max, x);
  return x;
}
