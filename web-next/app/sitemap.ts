import { MetadataRoute } from 'next'

// 定义数据格式
type Book = {
  _id: string;
  updatedAt: string;
}

// 辅助函数
async function getActiveBooks(): Promise<Book[]> {
  try {
    // ⚠️ 注意：这里的 API 地址通常可以用内网地址或者裸域名，不用非得加 www，只要能通就行
    // 加上 cache: 'no-store' 或者 revalidate 防止缓存太久导致新书不出来
    const res = await fetch('https://jiutianxiaoshuo.com/api/books/sitemap-pool', {
      next: { revalidate: 3600 } 
    });
    
    if (!res.ok) {
      console.error('Sitemap API Error:', res.statusText);
      return []; 
    }
    return await res.json();
  } catch (error) {
    console.error('Sitemap Fetch Failed:', error);
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // ✅ 核心修改：这里必须和你在百度后台添加的域名一模一样！
  const baseUrl = 'https://www.jiutianxiaoshuo.com';

  const books = await getActiveBooks();

  const bookUrls = books.map((book) => ({
    url: `${baseUrl}/book/${book._id}`,
    lastModified: new Date(book.updatedAt),
    changeFrequency: 'daily' as const,
    priority: 0.8, // 提高一点权重，书籍详情页是核心流量入口
  }));

  const staticRoutes = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'always' as const,
      priority: 1,
    },
    // 建议加上排行榜或书库页，这些页面权重也很高
    {
      url: `${baseUrl}/rank`,
      lastModified: new Date(),
      changeFrequency: 'daily' as const,
      priority: 0.9,
    },
  ];

  return [...staticRoutes, ...bookUrls];
}