import { MetadataRoute } from 'next'

// 定义一下你 API 返回的数据格式
type Book = {
  _id: string; // 或者 id
  updatedAt: string;
}

// 辅助函数：去你的后端拿前 1000 本热门书（不要一次拿几十万本，会超时）
async function getActiveBooks(): Promise<Book[]> {
  try {
    // 这里换成你真实的获取书籍列表的 API
    // 建议后端专门写一个接口：/api/sitemap-books，只返回 id 和 update_time，速度快
    const res = await fetch('https://jiutianxiaoshuo.com/api/books?limit=1000&sort=popular', {
        next: { revalidate: 3600 } // 1小时更新一次
    });
    if (!res.ok) return [];
    return await res.json();
  } catch (error) {
    console.error('Sitemap Error:', error);
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = 'https://jiutianxiaoshuo.com';

  // 1. 获取动态书籍数据
  const books = await getActiveBooks();

  // 2. 生成书籍 URL 列表
  const bookUrls = books.map((book) => ({
    url: `${baseUrl}/book/${book._id}`,
    lastModified: new Date(book.updatedAt),
    changeFrequency: 'daily' as const, // 告诉爬虫这页面每天都可能更新章节
    priority: 0.7, // 权重 (0-1)，详情页一般给 0.6 - 0.8
  }));

  // 3. 定义静态页面 (首页、分类页等)
  const staticRoutes = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'always' as const,
      priority: 1, // 首页权重最高
    },
    // 如果你有分类页，也可以加在这里
    // { url: `${baseUrl}/category/xuanhuan`, ... }
  ];

  // 4. 合并返回
  return [...staticRoutes, ...bookUrls];
}