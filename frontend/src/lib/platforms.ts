export const PLATFORM_LIST = [
  { id: 'bilibili', label: '哔哩哔哩', short: 'B站', color: '#FB7299', homeUrl: 'https://www.bilibili.com', public: false },
  { id: 'hackernews', label: 'Hacker News', short: 'HN', color: '#FF6600', homeUrl: 'https://news.ycombinator.com', public: true },
  { id: 'twitter', label: 'X / Twitter', short: 'X', color: '#E7E9EA', homeUrl: 'https://x.com', public: false },
  { id: 'youtube', label: 'YouTube', short: 'YouTube', color: '#FF0000', homeUrl: 'https://www.youtube.com', public: false },
  { id: 'xiaohongshu', label: '小红书', short: '小红书', color: '#FF2442', homeUrl: 'https://www.xiaohongshu.com', public: false },
  { id: 'weibo', label: '微博', short: '微博', color: '#E6162D', homeUrl: 'https://weibo.com', public: false },
  { id: 'zhihu', label: '知乎', short: '知乎', color: '#0084FF', homeUrl: 'https://www.zhihu.com', public: false },
  { id: 'douyin', label: '抖音', short: '抖音', color: '#FE2C55', homeUrl: 'https://www.douyin.com', public: false },
] as const;

export type PlatformId = (typeof PLATFORM_LIST)[number]['id'];
