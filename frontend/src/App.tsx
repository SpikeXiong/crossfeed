import { useEffect, useState, useCallback, useRef, lazy, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, RefreshCw, X, ExternalLink, Copy, Check, Languages, Settings as SettingsIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
// SettingsDialog 体积大（包含 Tabs + Switch + Dialog 等 Radix 组件 + 日志查看面板）
// 改成 lazy：首屏 bundle 减少 ~30KB（gzip ~10KB），点开时再加载
const SettingsDialog = lazy(() =>
  import("@/components/SettingsDialog").then(m => ({ default: m.SettingsDialog }))
);

type FeedItem = {
  id: string;
  platform: string;
  type: string;
  title: string;
  author?: string;
  content?: string;
  url: string;
  thumbnail?: string;
  refId?: string;
  metrics: Record<string, number | undefined>;
  publishedAt?: string;
  live?: boolean;
  // 平台附加字段
  rank?: number | string;     // 微博热搜排名
  label?: string;             // 微博标签(新/爆/热)
};

const PLATFORM_META: Record<string, {
  label: string;
  short: string;
  color: string;     // HSL
  gradient: string;  // tailwind class
  initial: string;   // 1-2 字符作为占位
}> = {
  bilibili:    { label: '哔哩哔哩',   short: 'B站',    color: '330 81% 60%', gradient: 'from-[#3a1d2e] via-[#5a2742] to-[#1f0e1a]', initial: 'B' },
  hackernews:  { label: 'Hacker News', short: 'HN',     color: '24 100% 50%', gradient: 'from-[#3a2410] via-[#52321a] to-[#1f1408]', initial: 'HN' },
  twitter:     { label: 'X',          short: 'X',       color: '0 0% 91%',    gradient: 'from-[#1f2126] via-[#2a2d35] to-[#13141a]', initial: 'X' },
  youtube:     { label: 'YouTube',    short: 'YouTube', color: '0 100% 50%',  gradient: 'from-[#3a1414] via-[#5a1f1f] to-[#1f0a0a]', initial: 'Y' },
  xiaohongshu: { label: '小红书',     short: '小红书',  color: '350 100% 57%',gradient: 'from-[#3a1820] via-[#5a2530] to-[#1f0c12]', initial: 'R' },
  weibo:       { label: '微博',       short: '微博',    color: '0 76% 51%',   gradient: 'from-[#3a2c10] via-[#5a421a] to-[#1f1808]', initial: 'W' },
  zhihu:       { label: '知乎',       short: '知乎',    color: '210 100% 50%',gradient: 'from-[#102236] via-[#1a324a] to-[#08121d]', initial: 'Z' },
  douyin:      { label: '抖音',       short: '抖音',    color: '345 99% 58%', gradient: 'from-[#1f2430] via-[#2e3540] to-[#0e121a]', initial: 'D' },
};

const ALL_PLATFORMS = ['bilibili', 'hackernews', 'twitter', 'youtube', 'xiaohongshu', 'weibo', 'zhihu', 'douyin'];
const PREVIEWABLE_PLATFORMS = new Set(['xiaohongshu', 'douyin']);
const THEMES = [
  { id: 'mixed' as const, label: '综合' },
  { id: 'tech' as const, label: '科技' },
  { id: 'society' as const, label: '社会' },
];

function sortFeedItems(list: FeedItem[], sort: 'shuffle' | 'time' | 'engagement'): FeedItem[] {
  if (sort === 'time') {
    return [...list].sort((a, b) => {
      const ta = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      const tb = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
      return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
    });
  }
  if (sort === 'engagement') {
    const heat = (it: FeedItem) => {
      const m = it.metrics;
      return (m.views || 0) + (m.likes || 0) * 5 + (m.comments || 0) * 3 + (m.score || 0) * 2;
    };
    return [...list].sort((a, b) => heat(b) - heat(a));
  }
  return list;
}

function formatNum(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

// 纯文字平台：按平台类型给不同的占位视觉
function TextPlaceholder({ item, meta }: { item: FeedItem; meta: typeof PLATFORM_META[string] }) {
  const score = item.metrics.score;
  const comments = item.metrics.comments;
  const views = item.metrics.views;
  const likes = item.metrics.likes;

  // Hacker News: 标题 + 大数字 score（HN 是文字新闻站，标题是核心信息）
  if (item.platform === 'hackernews') {
    return (
      <div className={cn("h-full w-full bg-gradient-to-br flex flex-col items-center justify-center text-white/85 px-6", meta.gradient)}>
        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/40 mb-2">Hacker News</div>
        <div className="font-serif text-[15px] leading-relaxed text-white/90 text-center line-clamp-3">
          {item.title}
        </div>
        <div className="mt-3 flex items-center gap-3 text-[11px] font-mono text-white/55">
          {score !== undefined && <span style={{ color: `hsl(${meta.color})` }}>▲ {score}</span>}
          {comments !== undefined && <span>◌ {formatNum(comments)}</span>}
          {views !== undefined && <span>▶ {formatNum(views)}</span>}
        </div>
      </div>
    );
  }

  // 微博热搜: 排名 + 标签(新/爆/热) + 热搜词 + 热度
  if (item.platform === 'weibo' && item.live) {
    const hot = item.metrics.score;
    const rank = item.rank;
    const label = item.label;
    return (
      <div className={cn("h-full w-full bg-gradient-to-br relative flex flex-col items-center justify-center text-white/85 px-6", meta.gradient)}>
        <div className="flex items-center gap-2 mb-2">
          {rank !== undefined && (
            <span className="text-2xl font-serif italic leading-none" style={{ color: `hsl(${meta.color})` }}>
              #{rank}
            </span>
          )}
          <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/40">微博热搜</span>
          {label && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ background: `hsl(${meta.color})`, color: '#000' }}>
              {label}
            </span>
          )}
        </div>
        <div className="font-serif text-[15px] leading-relaxed text-white/90 text-center line-clamp-3">
          {item.title}
        </div>
        <div className="mt-3 flex items-center gap-3 text-[11px] font-mono text-white/55">
          {hot !== undefined && <span>🔥 {formatNum(hot)}</span>}
          <span>实时热搜</span>
        </div>
      </div>
    );
  }

  if (item.platform === 'weibo') {
    return (
      <div className={cn("h-full w-full bg-gradient-to-br flex flex-col items-center justify-center text-white/90 px-6", meta.gradient)}>
        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/40 mb-2">微博</div>
        <div className="text-[15px] leading-relaxed text-white/85 text-center line-clamp-4 font-serif italic">
          "{item.title}"
        </div>
        <div className="mt-3 flex items-center gap-3 text-[11px] font-mono text-white/55">
          {item.author && <span>@{item.author}</span>}
          {likes !== undefined && <span>♥ {formatNum(likes)}</span>}
        </div>
      </div>
    );
  }

  // 知乎: 问题标题 + 热度 + 回答数（Q&A 站本来就没封面）
  if (item.platform === 'zhihu') {
    return (
      <div className={cn("h-full w-full bg-gradient-to-br flex flex-col items-center justify-center text-white/85 px-6", meta.gradient)}>
        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/40 mb-2">知乎 · 热榜</div>
        <div className="font-serif text-[15px] leading-relaxed text-white/90 text-center line-clamp-3">
          {item.title}
        </div>
        <div className="mt-3 flex items-center gap-3 text-[11px] font-mono text-white/55">
          {score !== undefined && <span>🔥 {score} 热度</span>}
          {comments !== undefined && <span>💬 {formatNum(comments)} 回答</span>}
        </div>
      </div>
    );
  }

  // Twitter / X: 热榜话题
  if (item.platform === 'twitter' && (item.live || item.type === 'article')) {
    const rank = item.rank;
    return (
      <div className={cn("h-full w-full bg-gradient-to-br relative flex flex-col items-center justify-center text-white/85 px-6", meta.gradient)}>
        <div className="flex items-center gap-2 mb-2">
          {rank !== undefined && (
            <span className="text-2xl font-serif italic leading-none" style={{ color: `hsl(${meta.color})` }}>
              #{rank}
            </span>
          )}
          <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/40">X · 热搜</span>
        </div>
        <div className="font-serif text-[15px] leading-relaxed text-white/90 text-center line-clamp-3">
          {item.title}
        </div>
        <div className="mt-3 flex items-center gap-3 text-[11px] font-mono text-white/55">
          {item.author && <span>{item.author}</span>}
          <span>实时热搜</span>
        </div>
      </div>
    );
  }

  // Twitter / X: 文字 tweet（无图时显示 quote 效果）
  if (item.platform === 'twitter') {
    return (
      <div className={cn("h-full w-full bg-gradient-to-br flex flex-col items-center justify-center text-white/90 px-6", meta.gradient)}>
        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/40 mb-2">𝕏 · from X</div>
        <div className="text-[15px] leading-relaxed text-white/85 text-center line-clamp-4 font-serif italic">
          "{item.title}"
        </div>
        <div className="mt-3 flex items-center gap-3 text-[11px] font-mono text-white/55">
          {item.author && <span>@{item.author}</span>}
          {likes !== undefined && <span>♥ {formatNum(likes)}</span>}
        </div>
      </div>
    );
  }

  // 小红书: 显示标题/正文片段（note 详情做占位，比空 monogram 信息量大）
  if (item.platform === 'xiaohongshu') {
    const snippet = (item.title || item.content || '').slice(0, 50);
    return (
      <div className={cn("h-full w-full bg-gradient-to-br flex flex-col items-center justify-center text-white/85 px-6", meta.gradient)}>
        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/40 mb-3">小红书 · NOTE</div>
        <div className="font-serif text-[15px] leading-relaxed text-white/90 text-center line-clamp-3">
          {snippet}
        </div>
        <div className="mt-3 mx-auto" style={{ width: '24px', height: '1px', background: `hsl(${meta.color})`, opacity: 0.5 }} />
        {item.author && (
          <div className="mt-2 text-[10px] font-mono text-white/50">@{item.author}</div>
        )}
      </div>
    );
  }

  // 抖音(现在主要是 hashtag hot 话题): 大字话题名 + 浏览数
  if (item.platform === 'douyin' && item.type === 'article') {
    return (
      <div className={cn("h-full w-full bg-gradient-to-br flex flex-col items-center justify-center text-white/85 px-6", meta.gradient)}>
        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/40 mb-2">抖音 · 热点话题</div>
        <div className="text-3xl font-serif text-white/90 text-center line-clamp-2 tracking-tight">
          {item.title}
        </div>
        <div className="mt-3 flex items-center gap-2 text-[11px] font-mono text-white/55">
          <span className="text-2xl opacity-40">#</span>
          {views ? <span>{formatNum(views)} 浏览</span> : <span>正在热搜</span>}
        </div>
      </div>
    );
  }

  // 抖音视频（type='short'）：opencli search/stats 都不返回封面，stats 还要创作者登录
  // 用首句描述 + 作者 + 互动数据当信息卡片占位
  if (item.platform === 'douyin') {
    const snippet = (item.title || item.content || '').slice(0, 60);
    return (
      <div className={cn("h-full w-full bg-gradient-to-br flex flex-col items-center justify-center text-white/85 px-6", meta.gradient)}>
        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/40 mb-3">抖音 · 热门视频</div>
        <div className="text-[14px] leading-relaxed text-white/90 text-center line-clamp-3 font-serif">
          {snippet}
        </div>
        <div className="mt-2 mx-auto" style={{ width: '24px', height: '1px', background: `hsl(${meta.color})`, opacity: 0.5 }} />
        {item.author && (
          <div className="mt-2 text-[10px] font-mono text-white/50">@{item.author}</div>
        )}
        <div className="mt-3 flex items-center gap-3 text-[11px] font-mono text-white/55">
          {likes !== undefined && <span>♥ {formatNum(likes)}</span>}
          {comments !== undefined && <span>💬 {formatNum(comments)}</span>}
          {views !== undefined && <span>▶ {formatNum(views)}</span>}
        </div>
      </div>
    );
  }

  // 默认: 平台首字母大字 + 小字标注
  return (
    <div className={cn("h-full w-full bg-gradient-to-br flex flex-col items-center justify-center text-white/85 px-4", meta.gradient)}>
      <div className="text-7xl font-semibold tracking-tighter opacity-25 leading-none">
        {meta.initial}
      </div>
      <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/40 mt-2">{meta.label}</div>
    </div>
  );
}

function timeAgo(iso?: string, live?: boolean): string {
  if (!iso) return live ? '实时' : '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;

  // >= 1 天：显示具体日期（用户要求"每条都要有日期"）
  // 今天/昨天用相对标签 + 时间；更早用 YYYY-MM-DD
  const now = new Date();
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (sameDay(d, now)) return `今天 ${hh}:${mm}`;
  if (sameDay(d, yesterday)) return `昨天 ${hh}:${mm}`;
  if (now.getFullYear() === d.getFullYear()) {
    return `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isChineseTitle(s: string): boolean {
  if (!s) return true;
  if (/[\u3040-\u30ff]/.test(s)) return false;
  if (/[\uac00-\ud7af]/.test(s)) return false;
  let cn = 0;
  for (const ch of s) { if (/[\u4e00-\u9fa5]/.test(ch)) cn++; }
  return cn / s.length > 0.3;
}

function isBadTranslation(dst: string): boolean {
  const u = dst.toUpperCase();
  return u.includes('INVALID SOURCE LANGUAGE') || u.includes('LANGPAIR=') || u.includes('MYMEMORY WARNING');
}

function CardItem({ item, onPreview, translatedTitle }: { item: FeedItem; onPreview: (it: FeedItem) => void; translatedTitle?: string }) {
  const meta = PLATFORM_META[item.platform] || {
    label: item.platform, short: item.platform, color: '0 0% 50%',
    gradient: 'from-zinc-800 via-zinc-900 to-black', initial: item.platform[0]?.toUpperCase() || '?',
  };
  const canPreview = PREVIEWABLE_PLATFORMS.has(item.platform);
  const [imgFailed, setImgFailed] = useState(false);
  const showImage = item.thumbnail && !imgFailed;
  const displayTitle = (translatedTitle && !isBadTranslation(translatedTitle))
    ? translatedTitle
    : item.title;

  return (
    <motion.a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        "group block rounded-xl border bg-card text-card-foreground overflow-hidden",
        "border-border/60 hover:border-border card-hover no-underline active:opacity-90"
      )}
    >
      {/* 媒体区：16:10 缩略图 / 平台定制占位 */}
      <div className="relative aspect-[16/10] overflow-hidden bg-secondary">
        {showImage ? (
          <img
            src={item.thumbnail}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className="h-full w-full object-cover transition-transform duration-500 [@media(hover:hover)]:group-hover:scale-105"
          />
        ) : (
          <TextPlaceholder item={item} meta={meta} />
        )}
        {/* 底部暗蒙版，保证 chip 可读 */}
        <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/50 to-transparent pointer-events-none" />

        {/* 平台 chip */}
        <Badge variant="glass" className="absolute top-2.5 left-2.5">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: `hsl(${meta.color})` }} />
          {meta.short}
        </Badge>

        {/* 反嵌入平台预览按钮 */}
        {canPreview && (
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onPreview(item); }}
            className="absolute top-2.5 right-2.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
            title="被 App 拦截时点这里看内容预览"
          >
            <Badge variant="glass" className="cursor-pointer hover:bg-black/60">
              预览
            </Badge>
          </button>
        )}

        {/* 时间 chip：原帖时间；实时热榜显示「实时」 */}
        {(item.publishedAt || item.live) && (
          <span className="absolute bottom-2 right-2.5 text-[10px] font-medium text-white/85 bg-black/55 backdrop-blur-md px-1.5 py-0.5 rounded border border-white/10">
            {item.live && !item.publishedAt ? '实时' : timeAgo(item.publishedAt, item.live)}
          </span>
        )}
      </div>

      {/* 文字区 */}
      <CardContent className="p-3 sm:p-4 space-y-1.5">
        <h3 className="text-[15px] font-semibold leading-snug line-clamp-2 text-foreground">
          {displayTitle}
        </h3>
        {translatedTitle && !isBadTranslation(translatedTitle) && translatedTitle !== item.title && (
          <p className="text-[11px] text-muted-foreground/60 line-clamp-1 italic">
            {item.title}
          </p>
        )}
        {item.content && (
          <p className="text-[13px] leading-relaxed text-muted-foreground line-clamp-2">
            {item.content}
          </p>
        )}
        <div className="flex items-center justify-between pt-2 text-[11px] text-muted-foreground font-mono">
          <span className="truncate max-w-[55%]">
            {item.author ? item.author : '匿名'}
          </span>
          <div className="flex items-center gap-2.5 shrink-0">
            {item.metrics.views && <span>▶ {formatNum(item.metrics.views)}</span>}
            {item.metrics.likes && <span>♥ {formatNum(item.metrics.likes)}</span>}
            {item.metrics.score && <span>▲ {formatNum(item.metrics.score)}</span>}
            {item.metrics.comments && <span>◌ {formatNum(item.metrics.comments)}</span>}
          </div>
        </div>
      </CardContent>
    </motion.a>
  );
}

function SkeletonCardItem() {
  return (
    <Card className="overflow-hidden border-border/60">
      <Skeleton className="aspect-[16/10] w-full rounded-none" />
      <CardContent className="p-4 space-y-2">
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-7/12" />
        <Skeleton className="h-3 w-1/2 mt-1" />
      </CardContent>
    </Card>
  );
}

function PreviewModal({ item, onClose }: { item: FeedItem; onClose: () => void }) {
  const meta = PLATFORM_META[item.platform] || { label: item.platform, short: item.platform, color: '0 0% 50%', gradient: 'from-zinc-800 to-black', initial: '?' };
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(item.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = item.url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/90 backdrop-blur-xl flex items-end sm:items-center justify-center p-0 sm:p-8"
    >
      <motion.div
        initial={{ scale: 0.96, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.96, y: 20 }}
        transition={{ type: 'spring', damping: 26, stiffness: 280 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-2xl h-[100dvh] max-h-[100dvh] sm:h-auto sm:max-h-[85vh] bg-card border-0 sm:border border-border rounded-none sm:rounded-2xl overflow-hidden flex flex-col pb-[env(safe-area-inset-bottom)]"
      >
        <div className="relative aspect-[16/10] shrink-0 overflow-hidden">
          {item.thumbnail ? (
            <img src={item.thumbnail} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
          ) : (
            <div className={cn("h-full w-full bg-gradient-to-br flex items-center justify-center", meta.gradient)}>
              <span className="text-5xl font-semibold text-white/40">{meta.initial}</span>
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-card via-transparent to-black/40 pointer-events-none" />
          <Button size="icon" variant="ghost" onClick={onClose} className="absolute top-3 right-3 h-10 w-10 sm:h-8 sm:w-8 rounded-full bg-black/55 hover:bg-black/75 text-white">
            <X className="h-4 w-4" />
          </Button>
          <Badge variant="glass" className="absolute top-3 left-3">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: `hsl(${meta.color})` }} />
            {meta.label}
          </Badge>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 pt-2 pb-5 -mt-6 relative">
          <h2 className="text-lg sm:text-xl font-semibold leading-tight text-foreground tracking-tight">{item.title}</h2>
          {item.author && (
            <p className="mt-2 text-sm text-muted-foreground">
              by <span className="text-foreground">{item.author}</span>
              <span className="text-muted-foreground/70"> · {timeAgo(item.publishedAt, item.live)}</span>
            </p>
          )}
          {item.content && (
            <div className="mt-4">
              <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-mono mb-1.5">内容预览</div>
              <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">{item.content}</p>
            </div>
          )}
          {(item.metrics.views || item.metrics.likes || item.metrics.comments || item.metrics.score) && (
            <div className="mt-4 flex gap-4 text-[11px] text-muted-foreground font-mono">
              {item.metrics.views && <span>▶ {formatNum(item.metrics.views)} 播放</span>}
              {item.metrics.likes && <span>♥ {formatNum(item.metrics.likes)} 赞</span>}
              {item.metrics.comments && <span>◌ {formatNum(item.metrics.comments)} 评论</span>}
              {item.metrics.score && <span>▲ {formatNum(item.metrics.score)} 分</span>}
            </div>
          )}
          <div className="mt-4 px-3 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-200/85">
            <div className="font-medium text-amber-100/90 mb-0.5">该平台有时会拦截站外访问</div>
            <div className="text-amber-200/70 leading-relaxed">我们已在链接里自动带上 xsec_token，多数情况能直开。如被拦截，复制链接到 App 内粘贴打开。</div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild>
              <a href={item.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                在浏览器打开
              </a>
            </Button>
            <Button variant="outline" onClick={copyLink}>
              {copied ? <><Check className="mr-1.5 h-3.5 w-3.5" />已复制</> : <><Copy className="mr-1.5 h-3.5 w-3.5" />复制链接</>}
            </Button>
            <Button variant="ghost" onClick={onClose}>关闭</Button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default function App() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);  // 首批到达后仍在接收
  const [mode, setMode] = useState<'mixed' | 'search'>('mixed');
  const [query, setQuery] = useState('');
  const [pendingQuery, setPendingQuery] = useState('');  // 输入框受控值，onChange 才改
  // loadPage 依赖的"已提交"查询 —— 只有按回车 / 点搜索 / 点历史项时才改
  // 这样输入过程中不会触发流式拉取
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(new Set(ALL_PLATFORMS));
  const [previewItem, setPreviewItem] = useState<FeedItem | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lastUpdated, setLastUpdated] = useState<number>(0);
  const [fromCache, setFromCache] = useState<boolean>(false);
  const [searchHistory, setSearchHistory] = useState<Array<{ query: string; last_used_at: number; result_count: number }>>([]);
  const [showHistory, setShowHistory] = useState(false);
  // 翻译开关 + 缓存（id → 译文）
  const [translateEnabled, setTranslateEnabled] = useState<boolean>(false);
  const [translations, setTranslations] = useState<Record<string, string>>({});
  // 设置面板（仅本机 localhost；局域网手机不能改站点）
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [localAdmin, setLocalAdmin] = useState(() => {
    if (typeof window === 'undefined') return false;
    const h = window.location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<EventSource | null>(null);
  const translationsRef = useRef(translations);
  useEffect(() => { translationsRef.current = translations; }, [translations]);
  const itemsRef = useRef<FeedItem[]>([]);
  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => () => { streamRef.current?.close(); }, []);

  // 加载持久化配置
  useEffect(() => {
    fetch('/api/config').then(r => r.json()).then(d => {
      if (d.ok) {
        if (typeof d.localAdmin === 'boolean') setLocalAdmin(d.localAdmin);
        const c = d.config || {};
        if (typeof c['translate.enabled'] === 'boolean') setTranslateEnabled(c['translate.enabled']);
        if (c['feed.theme'] === 'tech' || c['feed.theme'] === 'society' || c['feed.theme'] === 'mixed') {
          setTheme(c['feed.theme']);
        }
        if (typeof c['feed.perPage'] === 'number') setPerPage(c['feed.perPage']);
      }
    }).catch(() => {});
    fetch('/api/runtime').then(r => r.json()).then(d => {
      if (d.ok && d.feed?.perPage) setPerPage(d.feed.perPage);
      if (d.ok && (d.feed?.theme === 'tech' || d.feed?.theme === 'society' || d.feed?.theme === 'mixed')) {
        setTheme(d.feed.theme);
      }
      if (typeof d.localAdmin === 'boolean') setLocalAdmin(d.localAdmin);
    }).catch(() => {});
  }, []);

  const translateOne = useCallback(async (id: string, text: string) => {
    if (!text || isChineseTitle(text)) return;
    const prev = translationsRef.current[id];
    if (prev && !isBadTranslation(prev)) return;
    try {
      const r = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, target: 'zh' }),
      });
      const data = await r.json();
      if (data.ok && data.dst && data.dst !== text && !isBadTranslation(data.dst)) {
        setTranslations(prev => ({ ...prev, [id]: data.dst }));
      }
    } catch (e) {
      console.warn('translate failed', id, e);
    }
  }, []);

  useEffect(() => {
    if (!translateEnabled) return;
    const targets = items.filter(i =>
      !isChineseTitle(i.title) && (!translations[i.id] || isBadTranslation(translations[i.id]))
    );
    // 限制并发 3 个，避免 burst
    let cancelled = false;
    (async () => {
      for (let i = 0; i < targets.length; i += 3) {
        if (cancelled) return;
        const batch = targets.slice(i, i + 3);
        await Promise.all(batch.map(it => translateOne(it.id, it.title)));
      }
    })();
    return () => { cancelled = true; };
  }, [translateEnabled, items, translateOne]);

  // 拉取最近搜索历史
  const loadSearchHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/search/history?limit=8');
      const data = await res.json();
      if (data.ok) setSearchHistory(data.history || []);
    } catch (e) {
      console.error('loadSearchHistory failed', e);
    }
  }, []);

  useEffect(() => { loadSearchHistory(); }, [loadSearchHistory]);

  // 提交搜索时刷新历史
  function refreshHistorySoon() {
    setTimeout(() => loadSearchHistory(), 800);
  }

  // 分页 + 无限滚动状态
  const [page, setPage] = useState(1);
  const [remotePage, setRemotePage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sort, setSort] = useState<'shuffle' | 'time' | 'engagement'>('shuffle');
  const [theme, setTheme] = useState<'mixed' | 'tech' | 'society'>('mixed');
  const [perPage, setPerPage] = useState(30);
  const [sourceProg, setSourceProg] = useState<Array<{ key: string; status: 'pending' | 'ok' | 'err'; count?: number }>>([]);
  const [enriching, setEnriching] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // pendingQuery 实时变化不触发 loadPage：用 ref 拿到最新值
  const pendingQueryRef = useRef(pendingQuery);
  useEffect(() => { pendingQueryRef.current = pendingQuery; }, [pendingQuery]);

  // 拉取一页内容（追加）
  // 无限滚动：永远拿新内容，每页用 pageNum 作 seed 让后端洗出不同顺序
  // 第一页（append=false 且不 force）走 SSE 流式：每平台完成一条就 emit，渐进式渲染
  // force refresh / 加载更多页走老 fetch：cache hit 立即返，无需流式
  const loadPage = useCallback(async (pageNum: number, append: boolean, force = false) => {
    const params = new URLSearchParams();
    const effectiveQ = pendingQueryRef.current.trim();
    if (mode === 'search' && effectiveQ) {
      params.set('mode', 'search');
      params.set('q', effectiveQ);
    } else {
      params.set('mode', 'mixed');
    }
    params.set('platforms', Array.from(selectedPlatforms).join(','));
    params.set('page', String(pageNum));
    params.set('perPage', String(perPage));
    params.set('sort', sort);
    params.set('theme', theme);
    if (force) params.set('fresh', '1');

    // 第一页（含强制刷新）走 SSE，才能看到分源进度
    const useStream = !append && pageNum === 1 && typeof EventSource !== 'undefined';

    if (useStream) {
      await loadPageStream(params);
    } else {
      await loadPageFetch(params, append, force, pageNum);
    }
  }, [mode, selectedPlatforms, sort, theme, perPage]);

  // SSE 流式拉取：每平台完成就 emit 一批，渐进式 setItems
  const loadPageStream = useCallback(async (params: URLSearchParams) => {
    if (streamRef.current) {
      try { streamRef.current.close(); } catch { /* ignore */ }
      streamRef.current = null;
    }
    setLoading(true);
    setStreaming(false);
    setHasMore(false);
    setPage(1);
    setRemotePage(1);
    setItems([]);
    setErrors({});
    setSourceProg([]);
    setEnriching(false);
    const es = new EventSource(`/api/feed/stream?${params.toString()}`);
    streamRef.current = es;
    let firstBatchAt = 0;
    let aborted = false;
    let finished = false;
    const cleanup = () => {
      try { es.close(); } catch { /* ignore */ }
      if (streamRef.current === es) streamRef.current = null;
    };

    es.addEventListener('meta', (e) => {
      if (aborted) return;
      try {
        const meta = JSON.parse((e as MessageEvent).data);
        setFromCache(!!meta.fromCache);
        if (Array.isArray(meta.sources) && !meta.fromCache) {
          setSourceProg(meta.sources.map((s: string) => ({ key: s, status: 'pending' as const })));
        }
      } catch {}
    });

    es.addEventListener('batch', (e) => {
      if (aborted) return;
      try {
        const { items: newItems, source, err } = JSON.parse((e as MessageEvent).data);
        if (!firstBatchAt) {
          firstBatchAt = Date.now();
          // 第一批到了就关 loading，用户立刻能看到内容
          setLoading(false);
          setStreaming(true);
        }
        if (source && source !== 'cache') {
          setSourceProg(prev => {
            const next = prev.length ? [...prev] : [];
            const plat = String(source).split('/')[0];
            const idx = next.findIndex(p => p.key === plat || p.key === source);
            const row = { key: plat, status: err ? 'err' as const : 'ok' as const, count: newItems?.length || 0 };
            if (idx >= 0) next[idx] = row;
            else next.push(row);
            return next;
          });
        }
        if (err) {
          setErrors(prev => ({ ...prev, [source]: err }));
        }
        if (newItems && newItems.length > 0) {
          setItems(prev => {
            const seen = new Set(prev.map(i => i.id));
            const unique = newItems.filter((i: FeedItem) => !seen.has(i.id));
            const merged = [...prev, ...unique];
            return sort === 'shuffle' ? merged : sortFeedItems(merged, sort);
          });
        }
      } catch (err) {
        console.error('SSE batch parse error', err);
      }
    });

    es.addEventListener('done', (e) => {
      if (aborted) return;
      try {
        const d = JSON.parse((e as MessageEvent).data);
        setLastUpdated(Date.now());
        if (d.fromCache != null) setFromCache(!!d.fromCache);
        if (d.errors) setErrors(prev => ({ ...prev, ...d.errors }));
        if (typeof d.hasMore === 'boolean') setHasMore(d.hasMore);
        else if (typeof d.total === 'number') setHasMore(d.total > perPage);
        setRemotePage(1);
        setPage(1);
        if (mode === 'search' && pendingQueryRef.current) refreshHistorySoon();
      } catch {}
      setLoading(false);
      setStreaming(false);
      setEnriching(true);
      finished = true;
      // 不在这里关连接 —— 后端 done(items 部分) 后会进 enrichment 阶段推 thumbnail
      // 由 enrichDone 事件统一关；标记 finished 避免 error 事件误触发整页重拉
    });

    // 缩略图实时 patch：每收到一条就 update 对应 item 的 thumbnail
    es.addEventListener('thumbnail', (e) => {
      if (aborted) return;
      try {
        const { id, thumbnail } = JSON.parse((e as MessageEvent).data);
        if (!id || !thumbnail) return;
        setItems(prev => prev.map(i => i.id === id ? { ...i, thumbnail } : i));
      } catch (err) {
        console.warn('SSE thumbnail parse error', err);
      }
    });

    // enrichment 完成：关连接
    es.addEventListener('enrichDone', () => {
      if (aborted) return;
      finished = true;
      setStreaming(false);
      setEnriching(false);
      cleanup();
    });

    es.addEventListener('error', (e) => {
      if (aborted || finished) {
        setStreaming(false);
        cleanup();
        return;
      }
      finished = true;
      console.warn('SSE error, falling back to fetch', e);
      cleanup();
      setStreaming(false);
      const p = new URLSearchParams(params.toString());
      loadPageFetch(p, false, false, 1);
    });

    // 组件卸载或下一次 loadPage 时关闭
    return () => { aborted = true; cleanup(); };
  }, [mode, sort, perPage]);

  // 老 fetch 路径：force refresh / 加载更多 / 不支持 SSE
  const loadPageFetch = useCallback(async (
    params: URLSearchParams,
    append: boolean,
    force: boolean,
    pageNum: number,
  ) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    try {
      const res = await fetch(`/api/feed?${params.toString()}`, {
        cache: force ? 'no-store' : 'default',
      });
      const data = await res.json();
      if (data.ok) {
        const newItems: FeedItem[] = data.items || [];
        setItems(prev => {
          const seen = new Set(prev.map(i => i.id));
          const unique = newItems.filter(i => !seen.has(i.id));
          return append ? [...prev, ...unique] : unique;
        });
        setErrors(data.errors || {});
        setLastUpdated(Date.now());
        setFromCache(!!data.fromCache);
        // 用后端实际返回值（93 条 / perPage=30 → page 4 hasMore=false，page 5+ 返回空）
        // 不再硬编码 true，避免无限循环触发空请求
        if (data.pagination) {
          setHasMore(!!data.pagination.hasMore);
        } else {
          setHasMore(newItems.length >= perPage);
        }
        if (mode === 'search' && pendingQueryRef.current && pageNum === 1) refreshHistorySoon();
      }
    } catch (e) {
      console.error('loadPage failed', e);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [mode, perPage]);

  // 第一页：filters/sort/mode 变化时重置
  useEffect(() => {
    setPage(1);
    setRemotePage(1);
    setHasMore(true);
    loadPage(1, false);
  }, [loadPage]);

  const visibleCount = Math.min(items.length, Math.max(page, 1) * perPage);
  const canRevealMore = items.length > visibleCount;
  const canPageMore = canRevealMore || hasMore;

  const buildFeedParams = useCallback((pageNum: number, force = false) => {
    const params = new URLSearchParams();
    const effectiveQ = pendingQueryRef.current.trim();
    if (mode === 'search' && effectiveQ) {
      params.set('mode', 'search');
      params.set('q', effectiveQ);
    } else {
      params.set('mode', 'mixed');
    }
    params.set('platforms', Array.from(selectedPlatforms).join(','));
    params.set('page', String(pageNum));
    params.set('perPage', String(perPage));
    params.set('sort', sort);
    params.set('theme', theme);
    if (force) params.set('fresh', '1');
    return params;
  }, [mode, selectedPlatforms, sort, theme, perPage]);

  const appendFromApi = useCallback(async (startPage: number, force: boolean) => {
    if (loadingMore || loading) return;
    setLoadingMore(true);
    try {
      let apiPage = startPage;
      let useFresh = force;
      for (let hop = 0; hop < 8; hop++) {
        const res = await fetch(`/api/feed?${buildFeedParams(apiPage, useFresh).toString()}`, {
          cache: useFresh ? 'no-store' : 'default',
        });
        const data = await res.json();
        if (!data.ok) break;
        const incoming: FeedItem[] = data.items || [];
        const seen = new Set(itemsRef.current.map(i => i.id));
        const unique = incoming.filter(i => !seen.has(i.id));
        if (unique.length > 0) {
          setItems(prev => [...prev, ...unique]);
          setPage(p => p + 1);
        }
        setRemotePage(apiPage);
        setHasMore(!!data.pagination?.hasMore);
        setFromCache(!!data.fromCache);
        setLastUpdated(Date.now());
        if (data.errors) setErrors(data.errors);
        useFresh = false;
        if (unique.length > 0) break;
        if (!data.pagination?.hasMore) {
          setHasMore(false);
          break;
        }
        apiPage += 1;
      }
    } catch (e) {
      console.error('appendFromApi failed', e);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, loading, buildFeedParams]);

  const loadMore = useCallback(() => {
    if (loadingMore || loading) return;
    if (items.length > page * perPage) {
      setPage(p => p + 1);
      return;
    }
    if (hasMore) {
      void appendFromApi(remotePage + 1, false);
      return;
    }
    void appendFromApi(1, true);
  }, [loadingMore, loading, hasMore, page, items.length, perPage, remotePage, appendFromApi]);

  const loadMoreRef = useRef(loadMore);
  useEffect(() => { loadMoreRef.current = loadMore; }, [loadMore]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !canPageMore || loading || loadingMore) return;
    const observer = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting) loadMoreRef.current();
    }, { rootMargin: '400px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [canPageMore, loading, loadingMore, items.length, page]);

  // 提交搜索：直接调 loadPage，不依赖 useEffect 触发
  // （重复搜同一 query 时 setMode('search') 是 no-op，useEffect 不会重跑，必须手动调）
  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setShowHistory(false);
    if (!pendingQuery.trim()) {
      setPage(1);
      setRemotePage(1);
      setHasMore(true);
      setItems([]);
      // mode 从 search→mixed 会触发 useEffect 重拉；已是 mixed 才手动拉
      if (mode === 'mixed') loadPage(1, false);
      else setMode('mixed');
      return;
    }
    setQuery(pendingQuery);
    setPage(1);
    setRemotePage(1);
    setHasMore(true);
    setItems([]);
    // 立刻同步触发拉取，不等 useEffect（mode 已是 search 时 useEffect 不重跑）
    if (mode === 'search') loadPage(1, false);
    else setMode('search');
  }

  function applyHistory(q: string) {
    setPendingQuery(q);
    setQuery(q);
    setShowHistory(false);
    setPage(1);
    setRemotePage(1);
    setHasMore(true);
    setItems([]);
    if (mode === 'search') loadPage(1, false);
    else setMode('search');
  }

  async function deleteHistoryItem(q: string, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await fetch(`/api/search/history?query=${encodeURIComponent(q)}`, { method: 'DELETE' });
      setSearchHistory(prev => prev.filter(h => h.query !== q));
    } catch (err) {
      console.error('delete history failed', err);
    }
  }

  function togglePlatform(p: string) {
    setSelectedPlatforms(prev => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  const platformCounts = items.reduce<Record<string, number>>((acc, it) => {
    acc[it.platform] = (acc[it.platform] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-background sm:bg-background/80 backdrop-blur-none sm:backdrop-blur-xl border-b border-border pt-[env(safe-area-inset-top)] overflow-x-hidden pr-[env(safe-area-inset-right)]">
        <div className="container max-w-[1600px] py-2 sm:py-2.5 flex flex-col gap-2">
          {/* Row 1: logo + search + refresh */}
          <div className="flex items-center gap-2 sm:gap-2.5">
            <a href="/" className="flex items-center gap-2 shrink-0">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="shrink-0">
                <defs>
                  <linearGradient id="logoGrad" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#0A84FF" />
                    <stop offset="50%" stopColor="#BF5AF2" />
                    <stop offset="100%" stopColor="#FF375F" />
                  </linearGradient>
                </defs>
                <rect x="2" y="2" width="9" height="9" rx="2.5" fill="url(#logoGrad)" opacity="0.95" />
                <rect x="13" y="2" width="9" height="9" rx="2.5" fill="url(#logoGrad)" opacity="0.6" />
                <rect x="2" y="13" width="9" height="9" rx="2.5" fill="url(#logoGrad)" opacity="0.6" />
                <rect x="13" y="13" width="9" height="9" rx="2.5" fill="url(#logoGrad)" opacity="0.95" />
              </svg>
              <span className="hidden lg:inline text-[13px] font-semibold tracking-tight">Crossfeed</span>
            </a>

            <form onSubmit={handleSearch} className="flex-1 min-w-0 max-w-2xl relative">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  ref={inputRef}
                  type="search"
                  value={pendingQuery}
                  onChange={(e) => { setPendingQuery(e.target.value); setShowHistory(false); }}
                  onFocus={() => setShowHistory(true)}
                  onBlur={() => setTimeout(() => setShowHistory(false), 200)}
                  placeholder="搜索话题…"
                  className="pl-8 pr-12 h-10 sm:h-8 text-base sm:text-xs"
                />
                {pendingQuery && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => { setPendingQuery(''); setMode('mixed'); setShowHistory(false); }}
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 sm:h-6 sm:w-6 rounded-full"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>

              {/* 搜索历史下拉 */}
              {showHistory && searchHistory.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1.5 z-50 bg-zinc-950/95 backdrop-blur-xl border border-zinc-800 rounded-xl shadow-2xl overflow-hidden text-zinc-100">
                  <div className="px-3 py-2 text-[10px] font-mono uppercase tracking-[0.15em] text-zinc-500 flex items-center justify-between bg-zinc-950">
                    <span>最近搜索</span>
                    <span>{searchHistory.length} 条</span>
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    {searchHistory.map(h => (
                      <button
                        key={h.query}
                        type="button"
                        onMouseDown={(e) => { e.preventDefault(); applyHistory(h.query); }}
                        className="w-full flex items-center gap-2 px-3 py-2.5 sm:py-1.5 text-sm sm:text-xs hover:bg-zinc-800/80 text-left group transition-colors"
                      >
                        <Search className="h-3 w-3 text-zinc-500 shrink-0" />
                        <span className="flex-1 truncate text-zinc-100">{h.query}</span>
                        <span className="text-[10px] text-zinc-500 font-mono">{h.result_count} 条</span>
                        <span
                          role="button"
                          tabIndex={-1}
                          onMouseDown={(e) => deleteHistoryItem(h.query, e as any)}
                          className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 ml-1 p-1.5 sm:p-0.5 rounded hover:bg-red-500/20 text-zinc-500 hover:text-red-400 transition-all"
                          aria-label="删除"
                        >
                          <X className="h-3.5 w-3.5 sm:h-3 sm:w-3" />
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </form>

            <div className="flex items-center gap-2 shrink-0">
              {fromCache && !loading && (
                <span className="hidden xl:inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  缓存
                </span>
              )}
              <Button
                size="icon"
                variant="default"
                onClick={() => {
                  setPage(1);
                  setRemotePage(1);
                  loadPage(1, false, true);
                }}
                disabled={loading}
                className="h-10 w-10 sm:h-8 sm:w-8 rounded-full"
                title="从源站拉新（走 SSE，可看分源进度）"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              </Button>
            </div>
          </div>

          {/* Row 1.5: 主题 + 排序；设置固定在右侧，避免横向溢出露白 */}
          <div className="flex items-center gap-1 min-w-0">
            <div className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-muted-foreground shrink-0">主题</span>
            {THEMES.map(o => (
              <button
                key={o.id}
                onClick={() => {
                  setTheme(o.id);
                  fetch('/api/config', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 'feed.theme': o.id }),
                  }).catch(() => {});
                }}
                className={cn(
                  "shrink-0 px-3 py-1.5 sm:px-2 sm:py-0.5 min-h-[36px] sm:min-h-0 rounded-full text-[13px] sm:text-[11px] font-medium border transition-colors",
                  theme === o.id
                    ? "bg-secondary border-border text-foreground"
                    : "bg-transparent border-transparent text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                )}
              >
                {o.label}
              </button>
            ))}
            <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-muted-foreground shrink-0 ml-2">排序</span>
            {([
              { v: 'shuffle' as const, label: '随机' },
              { v: 'time' as const, label: '最新' },
              { v: 'engagement' as const, label: '最热' },
            ]).map(o => (
              <button
                key={o.v}
                onClick={() => setSort(o.v)}
                className={cn(
                  "shrink-0 px-3 py-1.5 sm:px-2 sm:py-0.5 min-h-[36px] sm:min-h-0 rounded-full text-[13px] sm:text-[11px] font-medium border transition-colors",
                  sort === o.v
                    ? "bg-secondary border-border text-foreground"
                    : "bg-transparent border-transparent text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                )}
              >
                {o.label}
              </button>
            ))}
            {/* 翻译开关 */}
            <button
              onClick={() => setTranslateEnabled(v => {
                const next = !v;
                fetch('/api/config', {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ 'translate.enabled': next }),
                }).catch(() => {});
                return next;
              })}
              title={translateEnabled ? '已开启中文标题翻译' : '点击翻译英文标题为中文'}
              className={cn(
                "shrink-0 px-3 py-1.5 sm:px-2 sm:py-0.5 min-h-[36px] sm:min-h-0 rounded-full text-[13px] sm:text-[11px] font-medium border transition-colors",
                translateEnabled
                  ? "border-blue-500/40 text-blue-300 bg-blue-500/10"
                  : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary/50"
              )}
            >
              <Languages className="inline h-3 w-3 mr-0.5" />
              {translateEnabled ? '中文' : '译'}
            </button>
            </div>
            {localAdmin && (
            <button
              onClick={() => setSettingsOpen(true)}
              title="设置（仅本机）"
              className="shrink-0 w-9 h-9 sm:w-7 sm:h-7 rounded-full appearance-none border-0 bg-background hover:bg-secondary text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors"
            >
              <SettingsIcon className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
            </button>
            )}
          </div>

          {/* Row 2: platform filters */}
          <div className="flex items-center gap-1 min-w-0 overflow-x-auto overflow-y-hidden no-scrollbar overscroll-x-contain pb-0.5">
            {ALL_PLATFORMS.map(p => {
              const meta = PLATFORM_META[p];
              const active = selectedPlatforms.has(p);
              const count = platformCounts[p] || 0;
              return (
                <button
                  key={p}
                  onClick={() => togglePlatform(p)}
                  title={meta.label}
                  className={cn(
                    "shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 sm:px-2.5 sm:py-0.5 min-h-[36px] sm:min-h-0 rounded-full text-[13px] sm:text-[11px] font-medium border transition-colors",
                    active
                      ? "bg-secondary border-border text-foreground"
                      : "bg-transparent border-transparent text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                  )}
                >
                  <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: `hsl(${meta.color})`, opacity: active ? 1 : 0.4 }} />
                  <span className="whitespace-nowrap">{meta.short}</span>
                  {count > 0 && <span className="text-muted-foreground/60 font-mono">{count}</span>}
                </button>
              );
            })}
            {selectedPlatforms.size < ALL_PLATFORMS.length && (
              <button onClick={() => setSelectedPlatforms(new Set(ALL_PLATFORMS))} className="shrink-0 text-[13px] sm:text-[11px] text-muted-foreground hover:text-foreground px-2 min-h-[36px] sm:min-h-0 transition-colors whitespace-nowrap">
                全选
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="container max-w-[1600px] py-4 sm:py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="flex items-baseline justify-between mb-4 text-xs text-muted-foreground">
          <div>
            {loading ? '加载中…' : streaming
              ? <><span className="text-foreground font-medium">{items.length}</span> 条 · <span className="text-foreground/50">继续补充中…</span></>
              : items.length > 0
                ? <><span className="text-foreground font-medium">{items.length}</span> 条 · <span className="text-foreground font-medium">{Object.keys(platformCounts).length}</span> 源</>
                : '没有内容'}
          </div>
          {lastUpdated > 0 && !loading && !streaming && !enriching && (
            <span className="hidden sm:inline text-muted-foreground/70">{Math.round((Date.now() - lastUpdated) / 1000)}s 前</span>
          )}
        </div>

        {(streaming || enriching || sourceProg.some(s => s.status === 'pending')) && (
          <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[11px] font-mono text-muted-foreground">
            {sourceProg.map(s => (
              <span
                key={s.key}
                className={cn(
                  "px-1.5 py-0.5 rounded border",
                  s.status === 'ok' ? "border-emerald-500/30 text-emerald-300/80" :
                  s.status === 'err' ? "border-amber-500/30 text-amber-300/80" :
                  "border-border text-muted-foreground"
                )}
              >
                {s.key}{s.status === 'ok' && s.count != null ? ` ${s.count}` : s.status === 'pending' ? ' …' : ' 失败'}
              </span>
            ))}
            {enriching && <span className="text-muted-foreground/70">补图中</span>}
          </div>
        )}

        {Object.keys(errors).length > 0 && (
          <div className="mb-4 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-200/80">
            部分源失败：{Object.keys(errors).join(', ')}
          </div>
        )}

        {items.length > 0 ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3 sm:gap-4">
              {items.slice(0, visibleCount).map(item => (
              <CardItem
                key={item.id}
                item={item}
                onPreview={setPreviewItem}
                translatedTitle={translateEnabled ? translations[item.id] : undefined}
              />
            ))}
            </div>

            {/* 无限滚动：计数 + sentinel */}
            <div className="text-center text-[10px] font-mono text-muted-foreground/50 mt-2">
              已加载 {visibleCount} 条
            </div>

            {/* 无限滚动 sentinel */}
            <div ref={sentinelRef} className="py-8 text-center text-xs text-muted-foreground">
              {loadingMore ? (
                <div className="flex items-center justify-center gap-2">
                  <RefreshCw className="h-3 w-3 animate-spin" />
                  加载更多…
                </div>
              ) : canPageMore ? (
                <button type="button" onClick={loadMore} className="hover:text-foreground transition-colors">
                  ↓ 滚动或点击加载更多
                </button>
              ) : (
                <button
                  type="button"
                  onClick={loadMore}
                  className="hover:text-foreground transition-colors inline-flex items-center gap-1.5"
                  title="在现有列表后面追加源站新内容，不会清空当前条目"
                >
                  <RefreshCw className="h-3 w-3" />
                  已显示 {visibleCount} 条 · 点击追加新内容
                </button>
              )}
            </div>
          </>
        ) : !loading ? (
          <div className="py-24 text-center">
            <div className="text-5xl mb-3 opacity-50">📭</div>
            <p className="text-foreground text-sm">没有匹配的内容</p>
            <p className="text-muted-foreground text-xs mt-1.5">换个关键词，或多选几个平台</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3 sm:gap-4">
            {Array.from({ length: 8 }).map((_, i) => <SkeletonCardItem key={i} />)}
          </div>
        )}
      </main>

      <AnimatePresence>
        {previewItem && <PreviewModal item={previewItem} onClose={() => setPreviewItem(null)} />}
      </AnimatePresence>

      {localAdmin && (
      <Suspense fallback={null}>
        <SettingsDialog
          open={settingsOpen}
          onOpenChange={(v) => {
            setSettingsOpen(v);
            if (!v) {
              fetch('/api/config').then(r => r.json()).then(d => {
                if (d.ok && typeof d.config?.['translate.enabled'] === 'boolean') {
                  setTranslateEnabled(d.config['translate.enabled']);
                }
              }).catch(() => {});
            }
          }}
        />
      </Suspense>
      )}
    </div>
  );
}
