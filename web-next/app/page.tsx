import type { Metadata } from 'next';
import HomePageClient from '@/components/HomePageClient';
import type { Book } from '@/lib/api';

const REVALIDATE_SECONDS = 3600;
const API_HOST = process.env.NEXT_PUBLIC_API_URL?.trim().replace(/\/+$/, '') || 'http://127.0.0.1:5000';
const API_BASE_URL = API_HOST.endsWith('/api') ? API_HOST : `${API_HOST}/api`;

export const metadata: Metadata = {
  title: '九天小说站 - 热门小说 - 无弹窗 - 免费在线阅读 - 笔趣阁',
  description: '九天小说站首页，提供热门推荐、排行榜与最近更新小说，支持免费在线阅读。',
  keywords: ['九天小说', '小说', '免费小说', '小说推荐', '排行榜', '最近更新'],
};

function buildBooksUrl(params?: Record<string, string>): string {
  const query = new URLSearchParams(params ?? {});
  return query.toString() ? `${API_BASE_URL}/books?${query.toString()}` : `${API_BASE_URL}/books`;
}

function normalizeBookForHome(book: Book): Book {
  const source = book as Book & { cover_image?: string; coverImage?: string };
  const normalizedCover = source.cover_image || source.coverImage || '';
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

      <HomePageClient
        initialBooks={allBooks}
        initialFeaturedBooks={featuredBooks}
        initialWeekRankBooks={weekRankBooks}
        initialDayRankBooks={dayRankBooks}
      />
    </>
  );
}