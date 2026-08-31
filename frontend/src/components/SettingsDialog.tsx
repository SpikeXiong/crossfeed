import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Languages, KeyRound, Database, ScrollText, Trash2, RefreshCw, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { PLATFORM_LIST } from "@/lib/platforms";

type AuthRow = {
  id: string;
  loggedIn: boolean | null;
  public?: boolean;
  error?: string;
};

const TABS = [
  { id: 'translate', label: '翻译', icon: Languages },
  { id: 'platforms', label: '平台', icon: KeyRound },
  { id: 'source', label: '数据源', icon: Database },
  { id: 'logs', label: '日志', icon: ScrollText },
] as const;

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('platforms');
  const [config, setConfig] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [translateCacheCount, setTranslateCacheCount] = useState<number | null>(null);
  const [auth, setAuth] = useState<AuthRow[] | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [opencliProbe, setOpencliProbe] = useState<{
    ok?: boolean; bin?: string; adaptersDir?: string; required?: Array<{ key: string; available: boolean }>; error?: string;
  } | null>(null);
  const [probing, setProbing] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch('/api/config').then(r => r.json()).then(d => {
      if (d.ok) setConfig(d.config || {});
    }).catch(() => {});
    fetch('/api/translate/stats').then(r => r.json()).then(d => {
      if (d.ok) setTranslateCacheCount(d.total);
    }).catch(() => {});
    probeAuth();
  }, [open]);

  async function probeAuth() {
    setAuthLoading(true);
    try {
      const r = await fetch('/api/platforms/status');
      const d = await r.json();
      if (d.ok && Array.isArray(d.platforms)) setAuth(d.platforms);
    } catch {
      setAuth(null);
    } finally {
      setAuthLoading(false);
    }
  }

  async function saveOne(key: string, value: any) {
    setConfig(prev => ({ ...prev, [key]: value }));
    setSaving(true);
    try {
      await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value }),
      });
    } finally {
      setSaving(false);
    }
  }

  async function clearTranslateCache() {
    if (!confirm('清空所有翻译缓存?')) return;
    const r = await fetch('/api/translate/cache', { method: 'DELETE' });
    const d = await r.json();
    if (d.ok) {
      setTranslateCacheCount(0);
      alert(`已清空 ${d.cleared} 条翻译缓存`);
    }
  }

  async function probeOpenCli() {
    setProbing(true);
    try {
      const r = await fetch('/api/opencli/status');
      setOpencliProbe(await r.json());
    } catch (e) {
      setOpencliProbe({ ok: false, error: String(e) });
    } finally {
      setProbing(false);
    }
  }

  const provider = config['translate.provider'] === 'openai' ? 'openai' : 'free';
  const defaultLimit = config['feed.perSource'] ?? 12;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl bg-card text-card-foreground">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
            设置
            {saving && <span className="text-[10px] font-mono font-normal text-muted-foreground">保存中…</span>}
          </DialogTitle>
          <DialogDescription className="text-[11px] text-muted-foreground">
            翻译默认关闭。站点登录和数据源只能在跑后端的这台机器上改（请用 localhost 打开）。
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1">
          {TABS.map(t => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "shrink-0 inline-flex items-center gap-1.5 px-3 py-2 sm:px-2.5 sm:py-0.5 min-h-[40px] sm:min-h-0 rounded-full text-[13px] sm:text-[11px] font-medium border transition-colors",
                  active
                    ? "bg-secondary border-border text-foreground"
                    : "bg-transparent border-transparent text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                )}
              >
                <Icon className="h-3 w-3" />
                {t.label}
              </button>
            );
          })}
        </div>

        {tab === 'translate' && (
          <div className="space-y-3 mt-1">
            <div className="rounded-xl border border-border/60 bg-card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[13px] font-medium">启用翻译</div>
                  <div className="text-[11px] text-muted-foreground">默认关闭。打开后才会请求翻译接口。</div>
                </div>
                <Switch
                  checked={!!config['translate.enabled']}
                  onCheckedChange={(v) => saveOne('translate.enabled', v)}
                />
              </div>
            </div>

            <div className="rounded-xl border border-border/60 bg-card p-4 space-y-3">
              <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-muted-foreground">接口</div>
              <div className="flex items-center gap-1.5">
                {([
                  { id: 'free', label: '免费翻译 API' },
                  { id: 'openai', label: 'OpenAI 兼容' },
                ] as const).map(o => (
                  <button
                    key={o.id}
                    onClick={() => saveOne('translate.provider', o.id)}
                    className={cn(
                      "shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors",
                      provider === o.id
                        ? "bg-secondary border-border text-foreground"
                        : "bg-transparent border-transparent text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>

              {provider === 'free' && (
                <div className="space-y-3">
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    免费接口无需 Key。MyMemory 有每日额度；Google gtx 为非官方接口；LibreTranslate 可填自建地址。
                  </p>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {([
                      { id: 'mymemory', label: 'MyMemory' },
                      { id: 'google', label: 'Google gtx' },
                      { id: 'libre', label: 'LibreTranslate' },
                    ] as const).map(o => (
                      <button
                        key={o.id}
                        onClick={() => saveOne('translate.free.engine', o.id)}
                        className={cn(
                          "shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors",
                          (config['translate.free.engine'] || 'mymemory') === o.id
                            ? "bg-secondary border-border text-foreground"
                            : "bg-transparent border-transparent text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                        )}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                  {(config['translate.free.engine'] === 'libre') && (
                    <Field label="LibreTranslate URL">
                      <Input
                        placeholder="https://libretranslate.com"
                        value={config['translate.free.libreUrl'] || ''}
                        onChange={(e) => setConfig(prev => ({ ...prev, 'translate.free.libreUrl': e.target.value }))}
                        onBlur={(e) => saveOne('translate.free.libreUrl', e.target.value)}
                        className="text-xs"
                      />
                    </Field>
                  )}
                </div>
              )}

              {provider === 'openai' && (
                <div className="space-y-3">
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    任意 OpenAI 兼容接口：Base URL 指向 <code className="font-mono">/v1</code>，走 <code className="font-mono">/chat/completions</code>。MiniMax、DeepSeek、OpenAI 都可以。
                  </p>
                  <Field label="Base URL">
                    <Input
                      placeholder="https://api.openai.com/v1"
                      value={config['translate.openai.baseUrl'] || config['translate.baseUrl'] || ''}
                      onChange={(e) => setConfig(prev => ({ ...prev, 'translate.openai.baseUrl': e.target.value }))}
                      onBlur={(e) => e.target.value && saveOne('translate.openai.baseUrl', e.target.value)}
                      className="text-xs"
                    />
                  </Field>
                  <Field label="API Key">
                    <Input
                      type="password"
                      placeholder="sk-..."
                      value={config['translate.openai.apiKey'] || config['translate.apiKey'] || ''}
                      onChange={(e) => setConfig(prev => ({ ...prev, 'translate.openai.apiKey': e.target.value }))}
                      onBlur={(e) => e.target.value && saveOne('translate.openai.apiKey', e.target.value)}
                      className="text-xs font-mono"
                    />
                  </Field>
                  <Field label="Model">
                    <Input
                      placeholder="gpt-4o-mini"
                      value={config['translate.openai.model'] || config['translate.model'] || ''}
                      onChange={(e) => setConfig(prev => ({ ...prev, 'translate.openai.model': e.target.value }))}
                      onBlur={(e) => e.target.value && saveOne('translate.openai.model', e.target.value)}
                      className="text-xs"
                    />
                  </Field>
                </div>
              )}

              <Field label="目标语言">
                <Input
                  placeholder="zh"
                  value={config['translate.target'] || 'zh'}
                  onChange={(e) => setConfig(prev => ({ ...prev, 'translate.target': e.target.value }))}
                  onBlur={(e) => e.target.value && saveOne('translate.target', e.target.value)}
                  className="text-xs"
                />
              </Field>
            </div>

            <div className="rounded-xl border border-border/60 bg-card p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[13px] font-medium">翻译缓存</div>
                <div className="text-[11px] font-mono text-muted-foreground">
                  {translateCacheCount === null ? '...' : `${translateCacheCount} 条`}
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={clearTranslateCache} disabled={translateCacheCount === 0}>
                清空缓存
              </Button>
            </div>
          </div>
        )}

        {tab === 'platforms' && (
          <div className="space-y-2 mt-1">
            <div className="flex items-start justify-between gap-2 px-0.5 flex-col sm:flex-row sm:items-center">
              <p className="text-[11px] text-muted-foreground">
                打开主页须在本机 Chrome 登录，OpenCLI 用这台机器的 cookie。局域网手机只能看信息流，不能改站点。
              </p>
              <button
                onClick={probeAuth}
                disabled={authLoading}
                className="shrink-0 px-3 py-2 sm:px-2 sm:py-0.5 min-h-[40px] sm:min-h-0 rounded-full text-[13px] sm:text-[11px] font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/50 inline-flex items-center gap-1"
              >
                <RefreshCw className={cn("h-3 w-3", authLoading && "animate-spin")} />
                {authLoading ? '检查中' : '重新检查'}
              </button>
            </div>
            {PLATFORM_LIST.map(p => {
              const row = auth?.find(a => a.id === p.id);
              const loggedIn = p.public ? null : row?.loggedIn;
              const limitKey = `feed.limit.${p.id}`;
              const limitVal = config[limitKey] ?? defaultLimit;
              return (
                <div key={p.id} className="rounded-xl border border-border/60 bg-card p-3 flex items-center gap-3">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: p.color }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className="text-[13px] font-medium">{p.label}</div>
                      <AuthChip publicSite={p.public} loggedIn={loggedIn} loading={authLoading && !auth} error={row?.error} />
                    </div>
                    <a
                      href={p.homeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors mt-0.5"
                    >
                      {p.homeUrl.replace(/^https?:\/\//, '')}
                      <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  </div>
                  <div className="shrink-0 text-right space-y-1">
                    <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-muted-foreground">条数</div>
                    <Input
                      type="number"
                      min={1}
                      max={50}
                      value={limitVal}
                      onChange={(e) => setConfig(prev => ({ ...prev, [limitKey]: parseInt(e.target.value) || 0 }))}
                      onBlur={(e) => saveOne(limitKey, Math.min(50, Math.max(1, parseInt(e.target.value) || defaultLimit)))}
                      className="text-xs w-16 h-8 text-center"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab === 'source' && (
          <div className="space-y-3 mt-1">
            <div className="rounded-xl border border-border/60 bg-card p-4 space-y-3">
              <div className="text-[13px] font-medium">缓存与条数</div>
              <Field label="Feed TTL (秒)">
                <Input
                  type="number"
                  placeholder="18000"
                  value={config['feed.ttl'] ?? 18000}
                  onChange={(e) => setConfig(prev => ({ ...prev, 'feed.ttl': parseInt(e.target.value) || 0 }))}
                  onBlur={(e) => e.target.value && saveOne('feed.ttl', parseInt(e.target.value))}
                  className="text-xs"
                />
              </Field>
              <Field label="每页条数">
                <Input
                  type="number"
                  placeholder="30"
                  value={config['feed.perPage'] ?? 30}
                  onChange={(e) => setConfig(prev => ({ ...prev, 'feed.perPage': parseInt(e.target.value) || 0 }))}
                  onBlur={(e) => e.target.value && saveOne('feed.perPage', parseInt(e.target.value))}
                  className="text-xs"
                />
              </Field>
              <Field label="每平台默认条数">
                <Input
                  type="number"
                  placeholder="12"
                  value={config['feed.perSource'] ?? 12}
                  onChange={(e) => setConfig(prev => ({ ...prev, 'feed.perSource': parseInt(e.target.value) || 0 }))}
                  onBlur={(e) => e.target.value && saveOne('feed.perSource', Math.min(50, Math.max(1, parseInt(e.target.value) || 12)))}
                  className="text-xs"
                />
              </Field>
              <Field label="YouTube / X 最长保留天数">
                <Input
                  type="number"
                  placeholder="14"
                  value={config['feed.maxAgeDays'] ?? 14}
                  onChange={(e) => setConfig(prev => ({ ...prev, 'feed.maxAgeDays': parseInt(e.target.value) || 0 }))}
                  onBlur={(e) => e.target.value && saveOne('feed.maxAgeDays', Math.min(365, Math.max(1, parseInt(e.target.value) || 14)))}
                  className="text-xs"
                />
              </Field>
              <p className="text-[11px] text-muted-foreground">超过这个天数的 YouTube 视频和 X 推文会被丢掉。热榜话题不受限。</p>
            </div>

            <div className="rounded-xl border border-border/60 bg-card p-4 space-y-3">
              <div className="text-[13px] font-medium">OpenCLI 路径</div>
              <Field label="可执行文件">
                <Input
                  placeholder="opencli (PATH 中)"
                  value={config['opencli.path'] || ''}
                  onChange={(e) => setConfig(prev => ({ ...prev, 'opencli.path': e.target.value }))}
                  onBlur={(e) => e.target.value && saveOne('opencli.path', e.target.value)}
                  className="text-xs font-mono"
                />
              </Field>
              <Button size="sm" variant="outline" onClick={probeOpenCli} disabled={probing}>
                {probing ? '探测中…' : '探测已装 Adapter'}
              </Button>
              {opencliProbe && (
                <div className="text-[10px] font-mono space-y-1 text-muted-foreground">
                  <div>bin: {opencliProbe.bin || '—'}</div>
                  <div>adapters: {opencliProbe.adaptersDir || '—'}</div>
                  {opencliProbe.error && <div className="text-amber-300">{opencliProbe.error}</div>}
                  {opencliProbe.required?.map(r => (
                    <div key={r.key} className={r.available ? 'text-emerald-400' : 'text-amber-400'}>
                      {r.available ? 'ok' : 'missing'} {r.key}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-border/60 bg-card p-4 space-y-3">
              <div className="text-[13px] font-medium">数据获取</div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs">文字平台跳过 enrichment</div>
                  <div className="text-[10px] text-muted-foreground">HN / 微博 / 知乎不查封面。</div>
                </div>
                <Switch
                  checked={config['feed.skipTextPlatformEnrichment'] !== false}
                  onCheckedChange={(v) => saveOne('feed.skipTextPlatformEnrichment', v)}
                />
              </div>
            </div>
          </div>
        )}

        {tab === 'logs' && (
          <div className="mt-1">
            <LogsTab />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AuthChip({ publicSite, loggedIn, loading, error }: {
  publicSite: boolean; loggedIn: boolean | null; loading: boolean; error?: string;
}) {
  if (publicSite) {
    return <span className="text-[10px] font-mono text-muted-foreground">公开 · 无需登录</span>;
  }
  if (loading) {
    return <span className="text-[10px] font-mono text-muted-foreground">检查中…</span>;
  }
  if (error && loggedIn == null) {
    return <span className="text-[10px] font-mono text-amber-300">探测失败</span>;
  }
  if (loggedIn) {
    return <span className="text-[10px] font-mono text-emerald-400">已登录</span>;
  }
  return <span className="text-[10px] font-mono text-amber-300">未登录</span>;
}

function LogsTab() {
  const [logs, setLogs] = useState<Array<{ ts: number; level: string; msg: string; src?: string; meta?: any }>>([]);
  const [level, setLevel] = useState<'all' | 'info' | 'warn' | 'error'>('all');
  const [autoRefresh, setAutoRefresh] = useState(true);

  async function load() {
    try {
      const r = await fetch(`/api/logs?limit=200&level=${level}`);
      const d = await r.json();
      if (d.ok) setLogs(d.logs);
    } catch { /* ignore */ }
  }

  useEffect(() => {
    load();
    if (!autoRefresh) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [level, autoRefresh]);

  async function clearLogs() {
    if (!confirm('清空后端日志 buffer?')) return;
    await fetch('/api/logs', { method: 'DELETE' });
    setLogs([]);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value as any)}
          className="text-xs bg-secondary border border-border rounded-full px-2 py-1"
        >
          <option value="all">全部</option>
          <option value="info">info+</option>
          <option value="warn">warn+</option>
          <option value="error">error</option>
        </select>
        <label className="text-[11px] text-muted-foreground flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
            className="accent-primary"
          />
          自动刷新(3s)
        </label>
        <Button size="sm" variant="outline" onClick={load}>
          <RefreshCw className="h-3 w-3" />
          刷新
        </Button>
        <Button size="sm" variant="outline" onClick={clearLogs}>
          <Trash2 className="h-3 w-3" />
          清空
        </Button>
        <span className="text-[10px] text-muted-foreground ml-auto font-mono">
          {logs.length} 条
        </span>
      </div>

      <div className="rounded-xl border border-border/60 bg-black/40 p-2 h-96 overflow-y-auto font-mono text-[10px] leading-relaxed">
        {logs.length === 0 ? (
          <div className="text-muted-foreground p-4 text-center">暂无日志</div>
        ) : (
          logs.slice().reverse().map((e, i) => (
            <div key={i} className={cn(
              "px-2 py-0.5 hover:bg-white/5 border-b border-white/5",
              e.level === 'error' ? 'text-red-300' :
              e.level === 'warn'  ? 'text-amber-300' :
              e.level === 'debug' ? 'text-zinc-500' : 'text-zinc-300'
            )}>
              <span className="text-zinc-500">
                {new Date(e.ts).toLocaleTimeString('zh-CN', { hour12: false })}
              </span>
              {' '}
              <span className={cn(
                e.level === 'error' ? 'text-red-400' :
                e.level === 'warn'  ? 'text-amber-400' :
                'text-blue-400'
              )}>
                {e.level.toUpperCase().padEnd(5)}
              </span>
              {' '}
              {e.src && <span className="text-purple-400">[{e.src.padEnd(8)}]</span>}
              {' '}
              <span>{e.msg}</span>
              {e.meta && Object.keys(e.meta).length > 0 && (
                <span className="text-zinc-500 ml-1">{JSON.stringify(e.meta)}</span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}
