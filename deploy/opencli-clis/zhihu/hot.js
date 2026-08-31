import { cli } from '@jackwener/opencli/registry';
cli({
    site: 'zhihu',
    name: 'hot',
    access: 'read',
    description: '知乎热榜',
    domain: 'www.zhihu.com',
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Number of items to return' },
    ],
    columns: ['rank', 'title', 'heat', 'answers', 'url', 'thumbnail', 'excerpt', 'created'],
    pipeline: [
        { navigate: 'https://www.zhihu.com' },
        { evaluate: `(async () => {
  const res = await fetch('https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit=50', {
    credentials: 'include'
  });
  const text = await res.text();
  const d = JSON.parse(
    text.replace(/("id"\\s*:\\s*)(\\d{16,})/g, '$1"$2"')
  );
  return (d?.data || []).map((item) => {
    const t = item.target || {};
    const questionId = t.id == null ? '' : String(t.id);
    const thumb = (item.children && item.children[0] && item.children[0].thumbnail) || t.image_url || '';
    return {
      title: t.title,
      url: 'https://www.zhihu.com/question/' + questionId,
      answer_count: t.answer_count,
      follower_count: t.follower_count,
      heat: item.detail_text || '',
      thumbnail: thumb,
      excerpt: t.excerpt || t.excerpt_new || '',
      created: t.created || t.created_time || t.updated_time || '',
    };
  });
})()
` },
        { map: {
                rank: '${{ index + 1 }}',
                title: '${{ item.title }}',
                heat: '${{ item.heat }}',
                answers: '${{ item.answer_count }}',
                url: '${{ item.url }}',
                thumbnail: '${{ item.thumbnail }}',
                excerpt: '${{ item.excerpt }}',
                created: '${{ item.created }}',
            } },
        { limit: '${{ args.limit }}' },
    ],
});
