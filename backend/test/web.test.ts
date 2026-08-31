import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveStaticFile } from '../src/lib/web.js';

const dir = mkdtempSync(join(tmpdir(), 'crossfeed-web-'));
mkdirSync(join(dir, 'assets'));
writeFileSync(join(dir, 'index.html'), '<html></html>');
writeFileSync(join(dir, 'assets', 'app.js'), 'ok');

describe('resolveStaticFile', () => {
  it('serves index at /', () => {
    assert.equal(resolveStaticFile(dir, '/'), join(dir, 'index.html'));
  });
  it('serves hashed assets', () => {
    assert.equal(resolveStaticFile(dir, '/assets/app.js'), join(dir, 'assets', 'app.js'));
  });
  it('falls back to index for unknown paths', () => {
    assert.equal(resolveStaticFile(dir, '/feed'), join(dir, 'index.html'));
  });
  it('does not escape the web root', () => {
    assert.equal(resolveStaticFile(dir, '/../secret'), join(dir, 'index.html'));
    assert.equal(resolveStaticFile(dir, '/assets/../../etc/passwd'), join(dir, 'index.html'));
  });
});

process.on('exit', () => {
  rmSync(dir, { recursive: true, force: true });
});
