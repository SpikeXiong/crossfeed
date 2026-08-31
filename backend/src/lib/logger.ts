// 结构化日志 + 内存 ring buffer
// 写 stdout(开发方便看)+ 内存保留最近 500 条(供 /api/logs 查)

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  ts: number;
  level: LogLevel;
  msg: string;
  meta?: Record<string, any>;
  src?: string;   // 哪个模块打的(feed/opencli/translate/...)
}

const BUFFER_SIZE = 500;
const buffer: LogEntry[] = [];

// ANSI 颜色
const COLORS: Record<LogLevel, string> = {
  debug: '\x1b[90m',  // gray
  info:  '\x1b[36m',  // cyan
  warn:  '\x1b[33m',  // yellow
  error: '\x1b[31m',  // red
};
const RESET = '\x1b[0m';

function push(entry: LogEntry) {
  buffer.push(entry);
  if (buffer.length > BUFFER_SIZE) buffer.shift();
}

function fmtConsole(e: LogEntry): string {
  const t = new Date(e.ts).toISOString().slice(11, 23);  // HH:MM:SS.mmm
  const color = COLORS[e.level];
  const tag = e.src ? `[${e.src}]` : '';
  const meta = e.meta && Object.keys(e.meta).length
    ? ' ' + JSON.stringify(e.meta)
    : '';
  return `${color}${t} ${e.level.toUpperCase().padEnd(5)}${RESET} ${tag} ${e.msg}${meta}`;
}

export function log(level: LogLevel, msg: string, meta?: Record<string, any>, src?: string) {
  const e: LogEntry = { ts: Date.now(), level, msg, meta, src };
  push(e);
  // 写 stdout
  const line = fmtConsole(e);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

// 便利函数
export const logger = {
  debug: (msg: string, meta?: any, src?: string) => log('debug', msg, meta, src),
  info:  (msg: string, meta?: any, src?: string) => log('info', msg, meta, src),
  warn:  (msg: string, meta?: any, src?: string) => log('warn', msg, meta, src),
  error: (msg: string, meta?: any, src?: string) => log('error', msg, meta, src),
};

// 时间测量 helper
export async function timed<T>(src: string, op: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    const ms = Date.now() - start;
    logger.info(`${op} done`, { ms }, src);
    return result;
  } catch (e: any) {
    const ms = Date.now() - start;
    logger.error(`${op} failed: ${e?.message || e}`, { ms }, src);
    throw e;
  }
}

// 读 buffer
export function getLogBuffer(opts: {
  limit?: number;
  level?: LogLevel | 'all';
  since?: number;     // ms timestamp
  src?: string;
} = {}): LogEntry[] {
  const { limit = 200, level = 'all', since = 0, src } = opts;
  const levelRank: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
  const minRank = level === 'all' ? 0 : (levelRank[level as LogLevel] ?? 0);

  return buffer
    .filter(e => levelRank[e.level] >= minRank && e.ts >= since && (!src || e.src === src))
    .slice(-limit);
}

export function clearLogBuffer() {
  buffer.length = 0;
}
