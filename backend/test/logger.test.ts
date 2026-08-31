import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { logger, getLogBuffer, clearLogBuffer } from '../src/lib/logger.js';

describe('logger ring buffer', () => {
  beforeEach(() => clearLogBuffer());

  it('stores entries and filters by level / src', () => {
    logger.debug('d', {}, 'a');
    logger.info('i', {}, 'a');
    logger.warn('w', {}, 'b');
    logger.error('e', {}, 'b');

    assert.equal(getLogBuffer({ level: 'all' }).length, 4);
    assert.equal(getLogBuffer({ level: 'warn' }).length, 2);
    assert.equal(getLogBuffer({ level: 'error' }).length, 1);
    assert.equal(getLogBuffer({ src: 'a' }).length, 2);
    assert.equal(getLogBuffer({ level: 'info', src: 'b' }).length, 2);
  });

  it('treats unknown level as all', () => {
    logger.info('i');
    assert.equal(getLogBuffer({ level: 'nope' as any }).length, 1);
  });

  it('clears the buffer', () => {
    logger.info('i');
    clearLogBuffer();
    assert.equal(getLogBuffer().length, 0);
  });
});
