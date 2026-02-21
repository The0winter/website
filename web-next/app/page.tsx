import type { Metadata } from 'next';
import HomePageClient from '@/components/HomePageClient';
import type { Book } from '@/lib/api';
import { getApiBaseUrl } from '@/utils/api'; // 引入我们写的智能地址判断工具

const REVALIDATE_SECONDS = 3600;

// 专门为图片提供公网前缀，确保用户的浏览器能正确加载图片，避免访问到内网 127.0.0.1
const PUBLIC_IMAGE_HOST = process.env.NEXT_PUBLIC_API_URL
  ?.trim()
  .replace(/\/api\/?$/, '')
  .replace(/\/+$/, '') || 'https://jiutianxiaoshuo.com';

export const metadata: Metadata = {
  title: '九天小说站 - 热门小说 - 无弹窗 - 免费在线阅读 - 笔趣阁',
  description: '九天小说站首页，提供热门推荐、排行榜与最近更新小说，支持免费在线阅读。',
  keywords: ['九天小说', '小说', '免费小说', '小说推荐', '排行榜', '最近更新'],
};

function buildBooksUrl(params?: Record<string, string>): string {
  const query = new URLSearchParams(params ?? {});
  const baseUrl = getApiBaseUrl(); // 动态获取 API 路径：服务端 SSR 时走本地 5000 端口，绕开 Cloudflare 防火墙
  return query.toString() ? `${baseUrl}/books?${query.toString()}` : `${baseUrl}/books`;
}

function normalizeBookForHome(book: Book): Book {
  const source = book as Book & { cover_image?: string; coverImage?: string };
  let normalizedCover = source.cover_image || source.coverImage || '';

  // 核心修复：如果封面存在，且不是以 http 或 data:base64 开头，说明是相对路径 
  if (normalizedCover && !normalizedCover.startsWith('http') && !normalizedCover.startsWith('data:')) {
    // 拼上公网域名 PUBLIC_IMAGE_HOST，保证传递给前端组件的图片地址绝对可用
    normalizedCover = `${PUBLIC_IMAGE_HOST}${normalizedCover.startsWith('/') ? '' : '/'}${normalizedCover}`;
  }

  return {
    ...source,
    cover_image: normalizedCover,
    coverImage: normalizedCover,
  } as Book;
}

async function fetchBooks(params?: Record<string, string>): Promise<Book[]> {
  try {
    const res = await fetch(buildBooksUrl(params), {
      next: { revalidate: REVALIDATE_SECONDS },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as Book[];
    if (!Array.isArray(data)) return [];
    return data.map(normalizeBookForHome);
  } catch (error) {
    console.error('Home SSR fetch books failed:', error);
    return [];
  }
}

export default async function Page() {
  // 并行拉取首页所需的各个板块数据，极大提高 SSR 渲染速度 [cite: 35]
  const [allBooks, featuredBooks, weekRankBooks, dayRankBooks, recentBooks] = await Promise.all([
    fetchBooks(),
    fetchBooks({ orderBy: 'views', order: 'desc', limit: '3' }),
    fetchBooks({ orderBy: 'weekly_views', order: 'desc', limit: '5' }),
    fetchBooks({ orderBy: 'daily_views', order: 'desc', limit: '5' }),
    fetchBooks({ orderBy: 'updatedAt', order: 'desc', limit: '12' }),
  ]);

  const seoRecommendedBooks = (featuredBooks.length > 0 ? featuredBooks : allBooks).slice(0, 12);
  const seoRecentBooks = (recentBooks.length > 0 ? recentBooks : allBooks).slice(0, 12);

  return (
    <>
      {/* 专门给搜索引擎爬虫看的纯 HTML 结构 [cite: 38] */}
      <section className="sr-only" aria-label="推荐书籍与最近更新">
        <h2>推荐书籍</h2>
        <ul>
          {seoRecommendedBooks.map((book) => (
            <li key={`rec-${book.id}`}>
              <a href={`/book/${book.id}`}>{book.title}</a>
            </li>
          ))}
        </ul>

        <h2>最近更新</h2>
        <ul>
          {seoRecentBooks.map((book) => (
            <li key={`recent-${book.id}`}>
              <a href={`/book/${book.id}`}>{book.title}</a>
            </li>
          ))}
        </ul>
      </section>

      {/* 客户端水合组件，负责炫酷的 UI 交互  */}
      <HomePageClient
        initialBooks={allBooks}
        initialFeaturedBooks={featuredBooks}
        initialWeekRankBooks={weekRankBooks}
        initialDayRankBooks={dayRankBooks}
      />
    </>
  );
}