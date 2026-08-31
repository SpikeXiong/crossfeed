import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isLoopbackHost,
  isLoopbackAddr,
  isLocalAdminRequest,
  sanitizeConfig,
  PUBLIC_WRITE_KEYS,
} from '../src/lib/localAdmin.js';

describe('isLoopbackHost', () => {
  it('accepts localhost variants', () => {
    assert.equal(isLoopbackHost('localhost'), true);
    assert.equal(isLoopbackHost('127.0.0.1'), true);
    assert.equal(isLoopbackHost('::1'), true);
    assert.equal(isLoopbackHost('[::1]'), true);
  });
  it('rejects LAN hostnames', () => {
    assert.equal(isLoopbackHost('192.168.31.103'), false);
    assert.equal(isLoopbackHost('10.0.0.2'), false);
    assert.equal(isLoopbackHost('crossfeed.local'), false);
  });
});

describe('isLocalAdminRequest', () => {
  it('uses Origin, not the proxied loopback socket', () => {
    assert.equal(isLocalAdminRequest({
      origin: 'http://192.168.31.103:3000',
      remoteAddress: '127.0.0.1',
    }), false);
    assert.equal(isLocalAdminRequest({
      origin: 'http://localhost:3000',
      remoteAddress: '127.0.0.1',
    }), true);
    assert.equal(isLocalAdminRequest({
      origin: 'http://127.0.0.1:3000',
      remoteAddress: '::1',
    }), true);
  });
  it('falls back to socket address when there is no Origin (curl)', () => {
    assert.equal(isLocalAdminRequest({ remoteAddress: '127.0.0.1' }), true);
    assert.equal(isLocalAdminRequest({ remoteAddress: '::ffff:127.0.0.1' }), true);
    assert.equal(isLocalAdminRequest({ remoteAddress: '192.168.31.8' }), false);
  });
});

describe('sanitizeConfig', () => {
  it('strips site keys for non-admin', () => {
    const cfg = {
      'feed.theme': 'mixed',
      'translate.enabled': true,
      'feed.perPage': 30,
      'feed.limit.douyin': 12,
      'opencli.path': '/usr/bin/opencli',
      'translate.openai.key': 'sk-secret',
    };
    assert.deepEqual(sanitizeConfig(cfg, false), {
      'feed.theme': 'mixed',
      'translate.enabled': true,
      'feed.perPage': 30,
    });
    assert.equal(sanitizeConfig(cfg, true), cfg);
  });
  it('theme and translate stay publicly writable', () => {
    assert.equal(PUBLIC_WRITE_KEYS.has('feed.theme'), true);
    assert.equal(PUBLIC_WRITE_KEYS.has('translate.enabled'), true);
    assert.equal(PUBLIC_WRITE_KEYS.has('feed.limit.weibo'), false);
    assert.equal(PUBLIC_WRITE_KEYS.has('opencli.path'), false);
  });
});

describe('isLoopbackAddr', () => {
  it('maps ipv4-mapped ipv6', () => {
    assert.equal(isLoopbackAddr('::ffff:127.0.0.1'), true);
    assert.equal(isLoopbackAddr('10.0.0.1'), false);
  });
});
