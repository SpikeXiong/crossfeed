import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ENV_KEYS, env, envFlag } from '../src/lib/env.js';

function setEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe('env', () => {
  it('reads only CROSSFEED_* keys', () => {
    const prev = process.env.CROSSFEED_HOST;
    const prevHost = process.env.HOST;
    try {
      process.env.CROSSFEED_HOST = '0.0.0.0';
      process.env.HOST = '127.0.0.1';
      assert.equal(env('host', '10.0.0.1'), '0.0.0.0');
      assert.equal(ENV_KEYS.host, 'CROSSFEED_HOST');
    } finally {
      setEnv('CROSSFEED_HOST', prev);
      setEnv('HOST', prevHost);
    }
  });

  it('ignores HOST when CROSSFEED_HOST is unset', () => {
    const prev = process.env.CROSSFEED_HOST;
    const prevHost = process.env.HOST;
    try {
      delete process.env.CROSSFEED_HOST;
      process.env.HOST = '127.0.0.1';
      assert.equal(env('host', '0.0.0.0'), '0.0.0.0');
    } finally {
      setEnv('CROSSFEED_HOST', prev);
      setEnv('HOST', prevHost);
    }
  });

  it('reads LLM keys, not MINIMAX_*', () => {
    const prevLlm = process.env.CROSSFEED_LLM_API_KEY;
    const prevMini = process.env.MINIMAX_API_KEY;
    try {
      delete process.env.CROSSFEED_LLM_API_KEY;
      process.env.MINIMAX_API_KEY = 'legacy-key';
      assert.equal(env('llmApiKey'), '');
      process.env.CROSSFEED_LLM_API_KEY = 'llm-key';
      assert.equal(env('llmApiKey'), 'llm-key');
    } finally {
      setEnv('CROSSFEED_LLM_API_KEY', prevLlm);
      setEnv('MINIMAX_API_KEY', prevMini);
    }
  });

  it('parses CROSSFEED_OPENCLI_MUTED as a flag', () => {
    const prev = process.env.CROSSFEED_OPENCLI_MUTED;
    try {
      delete process.env.CROSSFEED_OPENCLI_MUTED;
      assert.equal(envFlag('opencliMuted', true), true);
      process.env.CROSSFEED_OPENCLI_MUTED = '0';
      assert.equal(envFlag('opencliMuted', true), false);
      process.env.CROSSFEED_OPENCLI_MUTED = '1';
      assert.equal(envFlag('opencliMuted', true), true);
    } finally {
      setEnv('CROSSFEED_OPENCLI_MUTED', prev);
    }
  });
});
