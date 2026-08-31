import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { cached, clearCache } from '../src/lib/cache.js';

describe('cached', () => {
  beforeEach(() => {
    clearCache();
  });

  it('returns cached value within TTL', async () => {
    let n = 0;
    const a = await cached('k', 60, async () => ++n);
    const b = await cached('k', 60, async () => ++n);
    assert.equal(a, 1);
    assert.equal(b, 1);
    assert.equal(n, 1);
  });

  it('coalesces concurrent loaders (no stampede)', async () => {
    let n = 0;
    const loader = async () => {
      n += 1;
      await new Promise(r => setTimeout(r, 30));
      return n;
    };
    const [a, b, c] = await Promise.all([
      cached('same', 60, loader),
      cached('same', 60, loader),
      cached('same', 60, loader),
    ]);
    assert.equal(a, 1);
    assert.equal(b, 1);
    assert.equal(c, 1);
    assert.equal(n, 1);
  });

  it('does not cache a thrown loader', async () => {
    await assert.rejects(() => cached('boom', 60, async () => { throw new Error('x'); }));
    const v = await cached('boom', 60, async () => 42);
    assert.equal(v, 42);
  });
});
