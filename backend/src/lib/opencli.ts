// OpenCLI 调用封装：跑子进程拿 JSON
import { execFile } from 'child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { promisify } from 'util';
import { cached } from './cache.js';
import { logger, timed } from './logger.js';
import { configuredOpenCliPath } from './runtimeConfig.js';

const execFileAsync = promisify(execFile);

/** 小红书：同一时刻只跑一条 opencli，调用之间至少隔 5s，避免「频繁请求」 */
let xhsGate: Promise<void> = Promise.resolve();
const XHS_GAP_MS = 5000;

function withXhsGate<T>(fn: () => Promise<T>): Promise<T> {
  const run = xhsGate.then(async () => {
    const started = Date.now();
    try {
      return await fn();
    } finally {
      const wait = XHS_GAP_MS - (Date.now() - started);
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
    }
  });
  xhsGate = run.then(() => undefined, () => undefined);
  return run;
}

/**
 * 解析 opencli 可执行路径。
 *
 * 查找顺序（命中即返回）：
 *   1. 环境变量 OPENCLI_BIN（绝对路径，测试/排错用）
 *   2. $HOME/.opencli/node_modules/@jackwener/opencli/dist/src/main.js  ← 标准 npm 提取位置
 *   3. $HOME/.opencli/node_modules/@jackwener/opencli/dist/cli.js       ← 旧版兼容
 *   4. 'opencli'（fallback：依赖 PATH 里有 bin 链接或 alias）
 *
 * 结果在第一次解析后缓存，避免每次 spawn 都走文件系统。
 */
let _resolvedBin: string | null = null;
let _resolvedSource: 'env' | 'home' | 'home-fallback' | 'path' | null = null;

export function resetOpenCliBin(): void {
  _resolvedBin = null;
  _resolvedSource = null;
}

export function resolveOpenCliBin(): string {
  if (_resolvedBin) return _resolvedBin;

  // 1) 设置页 opencli.path / 环境变量 OPENCLI_BIN
  const fromCfg = configuredOpenCliPath();
  if (fromCfg && existsSync(fromCfg)) {
    _resolvedBin = fromCfg;
    _resolvedSource = 'env';
    return _resolvedBin;
  }

  // 2-3) 用户目录下的 npm 提取位置（@jackwener/opencli@1.x 的 main 入口）
  const home = homedir();
  const candidates = [
    join(home, '.opencli', 'node_modules', '@jackwener', 'opencli', 'dist', 'src', 'main.js'),
    join(home, '.opencli', 'node_modules', '@jackwener', 'opencli', 'dist', 'cli.js'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      _resolvedBin = p;
      _resolvedSource = p.endsWith('main.js') ? 'home' : 'home-fallback';
      return _resolvedBin;
    }
  }

  // 4) 最后兜底：让 execFile 走 PATH（用户如果建了 bin 链接就能用）
  _resolvedBin = 'opencli';
  _resolvedSource = 'path';
  logger.warn('opencli not found in known home locations; falling back to PATH lookup', {
    env: fromCfg || null,
    tried: candidates,
  }, 'opencli');
  return _resolvedBin;
}

function logResolveOnce() {
  if (!_resolvedSource) return;
  const src = _resolvedSource;
  _resolvedSource = null;  // 只记一次
  logger.info(`opencli bin resolved: ${resolveOpenCliBin()} (source=${src})`, {}, 'opencli');
}

export interface OpenCliResult<T = any> {
  ok: boolean;
  data?: T[];
  error?: string;
  raw?: string;
}

/**
 * 静音策略说明：
 * - 所有 OpenCLI 调用都尝试带 `--window background`（后台浏览器窗口）
 * - 不支持这参数的命令（如 hackernews/top）会自动降级
 * - 需要音频静默的视频平台列表（用于未来扩展，比如环境变量禁用）
 */
const MUTED_PLATFORMS = new Set([
  'bilibili', 'youtube', 'xiaoyuzhou', 'xiaohongshu',
  'douyin', 'tiktok',
]);

/**
 * 是否启用静音/后台窗口策略
 * 设 false 可以跳过 --window 注入（debug 用）
 */
const ENABLE_MUTED_WINDOW = process.env.DISABLE_MUTED_WINDOW !== '1';

async function fetchOpenCli(
  site: string,
  command: string,
  args: string[],
  timeoutMs: number,
  options: { siteSession?: 'ephemeral' | 'persistent' } = {},
): Promise<{ ok: boolean; data?: any[]; raw?: string; error?: string }> {
  // 参数顺序很关键：opencli 的 CLI 格式是
  //   opencli <site> <command> [args...] [common options like -f json]
  // 比如 `opencli douyin search 热门` —— "热门"是 command 的必填参数
  // 不能把 -f json 放在 command 前面（OpenCLI 会解析错），也不能放在 args 前面
  //
  // 正确顺序：site command args... common_opts
  // 我们用 `-f json --window background` 作为 common opts
  //
  // --site-session: persistent 让 XHS 等需要登录的平台能跨调用保持 cookie
  //                ephemeral (默认) 每次新窗口,无状态

  const siteSession = options.siteSession || 'ephemeral';
  const wantsMuted = ENABLE_MUTED_WINDOW;
  void wantsMuted;

  // 第一次尝试：带 --window background + site-session
  const commonOpts = ['-f', 'json', '--window', 'background', '--site-session', siteSession];
  const tryArgs = [...args, ...commonOpts];
  try {
    const { stdout } = await spawnOpenCli([site, command, ...tryArgs], timeoutMs);
    return parseOutput(stdout);
  } catch (e1: any) {
    const msg = e1?.message || '';
    const isUnknownOption =
      msg.includes('--window') ||
      msg.includes('background') ||
      msg.includes('unknown option') ||
      msg.includes("unknown argument");

    if (!isUnknownOption) {
      return { ok: false, error: msg, raw: e1?.stdout };
    }

    // 降级：不带 --window,只带 site-session
    try {
      const { stdout } = await spawnOpenCli([site, command, ...args, '-f', 'json', '--site-session', siteSession], timeoutMs);
      return parseOutput(stdout);
    } catch (e2: any) {
      // 最终降级：什么都不加
      try {
        const { stdout } = await spawnOpenCli([site, command, ...args, '-f', 'json'], timeoutMs);
        return parseOutput(stdout);
      } catch (e3: any) {
        return { ok: false, error: e3?.message || String(e3), raw: e3?.stdout };
      }
    }
  }
}

/** .js 入口用 node 启；PATH 里的 bin 直接 exec */
async function spawnOpenCli(argv: string[], timeoutMs: number) {
  const bin = resolveOpenCliBin();
  const opts = { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024, env: process.env };
  if (bin.endsWith('.js') || bin.endsWith('.mjs') || bin.endsWith('.cjs')) {
    return execFileAsync(process.execPath, [bin, ...argv], opts);
  }
  return execFileAsync(bin, argv, opts);
}

export const REQUIRED_OPENCLI_COMMANDS = [
  'bilibili/hot', 'bilibili/search',
  'weibo/feed', 'weibo/search',
  'zhihu/hot', 'zhihu/search',
  'douyin/feed', 'douyin/search',
  'xiaohongshu/feed', 'xiaohongshu/search',
  'hackernews/top', 'hackernews/search',
  'youtube/hot', 'youtube/search',
  'twitter/timeline', 'twitter/search',
  'crossfeed/auth-scan',
];

export function adaptersHome(): string {
  return join(homedir(), '.opencli', 'clis');
}

export async function probeOpenCli(): Promise<{
  ok: boolean;
  bin: string;
  source: string | null;
  adaptersDir: string;
  commands: string[];
  required: Array<{ key: string; available: boolean }>;
  error?: string;
}> {
  resetOpenCliBin();
  const bin = resolveOpenCliBin();
  const source = _resolvedSource;
  const adaptersDir = adaptersHome();
  try {
    const { stdout } = await spawnOpenCli(['list', '-f', 'json'], 20000);
    const cleaned = stdout
      .split('\n')
      .filter(l => !l.startsWith('(node:') && !l.includes('Update available'))
      .join('\n')
      .trim();
    const parsed = JSON.parse(cleaned);
    const rows = Array.isArray(parsed) ? parsed : [];
    const commands = rows.map((x: any) => `${x.site}/${x.name || x.command}`).filter(Boolean);
    const have = new Set(commands);
    return {
      ok: true,
      bin,
      source,
      adaptersDir,
      commands,
      required: REQUIRED_OPENCLI_COMMANDS.map(key => ({ key, available: have.has(key) })),
    };
  } catch (e: any) {
    return {
      ok: false,
      bin,
      source,
      adaptersDir,
      commands: [],
      required: REQUIRED_OPENCLI_COMMANDS.map(key => ({ key, available: false })),
      error: e?.message || String(e),
    };
  }
}

function parseOutput(stdout: string): { ok: boolean; data: any[]; raw: string; error?: string } {
  const cleaned = stdout
    .split('\n')
    .filter(l => !l.startsWith('(node:') && !l.includes('EnvHttpProxyAgent') && !l.includes('Update available'))
    .join('\n')
    .trim();

  if (!cleaned) return { ok: false, data: [], raw: '' };

  try {
    const parsed = JSON.parse(cleaned);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return { ok: true, data: arr, raw: cleaned };
  } catch (e: any) {
    return { ok: false, data: [], raw: cleaned, error: 'JSON parse failed: ' + e.message };
  }
}

export async function callOpenCli(
  site: string,
  command: string,
  args: string[] = [],
  options: { timeoutMs?: number; cacheTtlSec?: number; extraArgs?: string[]; siteSession?: 'ephemeral' | 'persistent' } = {}
): Promise<OpenCliResult> {
  const { timeoutMs = 30000, cacheTtlSec = 300, extraArgs = [], siteSession = 'ephemeral' } = options;
  const allArgs = [...args, ...extraArgs];
  const run = async () => {
    logResolveOnce();
    logger.info(`opencli ${site} ${command} ${allArgs.slice(0, 2).join(' ')}...`, { site, command, siteSession }, 'opencli');
    const exec = () => timed('opencli', `${site}.${command}`, () => fetchOpenCli(site, command, allArgs, timeoutMs, { siteSession }));
    if (site === 'xiaohongshu') return withXhsGate(exec);
    return exec();
  };
  if (cacheTtlSec <= 0) return run();
  const cacheKey = `opencli:${site}:${command}:${allArgs.join('|')}:${siteSession}`;
  return cached(cacheKey, cacheTtlSec, run);
}