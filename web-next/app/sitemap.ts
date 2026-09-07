import { getApiBaseUrl } from '@/utils/api';
import { safeFetch as fetch } from '@/lib/request';
import { MetadataRoute } from 'next'

// 定义数据格式
type Book = {
  _id: string;
  updatedAt: string;
}

// 辅助函数
async function getActiveBooks(): Promise<Book[]> {
  try {
    const res = await fetch(`${getApiBaseUrl()}/books/sitemap-pool`, {
      next: { revalidate: 3600 } 
    });
    
    if (!res.ok) {
      console.error('Sitemap API Error:', res.statusText);
      return []; 
    }
    
    const rawBooks: Book[] = await res.json();

    // 🛡️ 防线 1：API 数据去重
    // 使用 Map，以 _id 为键。如果 API 返回了两个相同的 ID，后面的会覆盖前面的，保证唯一。
    const uniqueBooksMap = new Map<string, Book>();
    rawBooks.forEach(book => {
      if (book._id) { // 确保 ID 存在
        uniqueBooksMap.set(book._id, book);
      }
    });

    // 转回数组
    return Array.from(uniqueBooksMap.values());

  } catch (error) {
    console.error('Sitemap Fetch Failed:', error);
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://127.0.0.1:3000';

  const books = await getActiveBooks();

  // 🛡️ 防线 2：Sitemap 大小限制保护
  // Google 和百度规定单个 sitemap.xml 不能超过 50,000 条 URL。
  // 如果你的书超过了 49,998 本（预留 2 条给静态页），为了防止报错，我们只取前 49000 本。
  // (以后书多了你需要做 Sitemap 分页，但现在先这样保护)
  const safeBooks = books.slice(0, 49000);

  const bookUrls = safeBooks.map((book) => ({
    url: `${baseUrl}/book/${book._id}`,
    lastModified: new Date(book.updatedAt),
    changeFrequency: 'daily' as const,
    priority: 0.8,
  }));

  const staticRoutes = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'always' as const,
      priority: 1,
    },
    {
      url: `${baseUrl}/rank`,
      lastModified: new Date(),
      changeFrequency: 'daily' as const,
      priority: 0.9,
    },
  ];

  return [...staticRoutes, ...bookUrls];
}