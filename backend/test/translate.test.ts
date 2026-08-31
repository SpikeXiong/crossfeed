import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'crossfeed-tr-'));
process.env.CROSSFEED_DATA_DIR = dir;
process.env.CROSSFEED_DB_PATH = join(dir, 't.db');

const { configurePersistence, closeDb } = await import('../src/lib/persistence.js');
configurePersistence({ dataDir: dir, dbPath: join(dir, 't.db') });
const { isChineseText, detectLangCode, isUnusableTranslation } = await import('../src/lib/translate.js');
const { translateEnabled, translateProvider } = await import('../src/lib/runtimeConfig.js');

after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

describe('translate defaults', () => {
  it('is off and uses free provider when unset', () => {
    assert.equal(translateEnabled(), false);
    assert.equal(translateProvider(), 'free');
  });
});

describe('isChineseText', () => {
  it('treats mostly-Chinese as Chinese', () => {
    assert.equal(isChineseText('这是一条中文标题'), true);
    assert.equal(isChineseText('Hello world this is English'), false);
  });

  it('does not treat Japanese or Korean as Chinese', () => {
    assert.equal(isChineseText('如恵留くん'), false);
    assert.equal(isChineseText('#CDTVライブライブ'), false);
    assert.equal(isChineseText('풀사이즈'), false);
  });
});

describe('detectLangCode', () => {
  it('detects ja / en / zh', () => {
    assert.equal(detectLangCode('#CDTVライブライブ'), 'ja');
    assert.equal(detectLangCode('Trending in Japan'), 'en');
    assert.equal(detectLangCode('今天天气不错'), 'zh');
  });
});

describe('isUnusableTranslation', () => {
  it('rejects MyMemory auto-language errors', () => {
    assert.equal(
      isUnusableTranslation("'AUTO' IS AN INVALID SOURCE LANGUAGE . EXAMPLE: LANGPAIR=EN|IT"),
      true,
    );
    assert.equal(isUnusableTranslation('热门话题'), false);
  });
});
