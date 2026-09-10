import { safeFetch as fetch, type CatalogPage } from '@/lib/request';
import type { Metadata } from 'next';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import BookDetailClient from '@/components/BookDetailClient';
import type { Book, Chapter } from '@/lib/api';
import { getApiBaseUrl } from '@/utils/api'; // 新增：引入我们写的智能地址判断工具

type Props = {
  params: Promise<{ id: string }>;
};

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '') || 'http://127.0.0.1:3000';

// 新增：专门为图片提供公网前缀，确保用户的浏览器和搜索引擎爬虫能正确加载封面图
const PUBLIC_IMAGE_HOST = process.env.NEXT_PUBLIC_API_URL
  ?.trim()
  .replace(/\/api\/?$/, '')
  .replace(/\/+$/, '') || 'http://127.0.0.1:3000';

// 新增辅助函数：处理封面图片地址，将其转化为完整的公网 URL
function normalizeCoverImage(coverImage?: string): string {
  if (!coverImage) return '';
  if (coverImage.startsWith('http') || coverImage.startsWith('data:')) {
    return coverImage;
  }
  return `${PUBLIC_IMAGE_HOST}${coverImage.startsWith('/') ? '' : '/'}${coverImage}`;
}

const getBook = cache(async (id: string): Promise<Book | null> => {
  try {
    const baseUrl = getApiBaseUrl(); // 动态获取：服务端走内网，客户端走公网
    const res = await fetch(`${baseUrl}/books/${id}`, { 
      next: { revalidate: 60 } 
    });
    if (res.status===404) return null;
    if (!res.ok) throw new Error('作品服务暂不可用');
    
    const book: Book = await res.json();
    
    // 规范化封面地址，防止传给前端和 SEO 的图片路径是相对路径
    book.cover_image = normalizeCoverImage(book.cover_image);
    // 兼容部分字段拼写差异
    if (book.coverImage) {
      book.coverImage = normalizeCoverImage(book.coverImage);
    }
    
    return book;
  } catch (error) {
    throw error;
  }
});

async function getChapters(id: string, order: 'asc' | 'desc' = 'desc', limit = 30): Promise<CatalogPage<Chapter> | undefined> {
  try {
    const baseUrl = getApiBaseUrl(); // 动态获取：服务端走内网，客户端走公网
    const res = await fetch(`${baseUrl}/books/${id}/chapters?order=${order}&page=1&limit=${limit}`, {
      cache: 'no-store'
    });
    if (!res.ok) return undefined;
    const header = res.headers.get('X-Total-Count');
    const count = header === null ? NaN : Number(header);
    return { rows: await res.json(), total: Number.isSafeInteger(count) && count >= 0 ? count : null, pageSize: limit };
  } catch (error) {
    console.error('首批目录读取失败', error);
    return undefined;
  }
}

async function getTotalWords(id: string): Promise<number | null> {
  try {
    const res = await fetch(`${getApiBaseUrl()}/books/${id}/statistics`, { cache: 'no-store' });
    if (!res.ok) throw new Error('作品统计暂不可用');
    const { totalWords } = await res.json();
    if (!Number.isSafeInteger(totalWords) || totalWords < 0) throw new Error('作品统计无效');
    return totalWords;
  } catch (error) {
    console.error('作品统计读取失败', error);
    // Keep the book readable without displaying an incomplete or false zero count.
    return null;
  }
}

function buildDescription(book: Book): string {
  const raw = (book.description || '').replace(/[\r\n\t]+/g, ' ').trim();
  if (raw) return raw.length > 120 ? `${raw.slice(0, 120)}...` : raw;
  return `${book.title} online reading`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const book = await getBook(id);

  if (!book) {
    return {
      title: 'Book Not Found',
    };
  }

  const description = buildDescription(book);
  const canonicalUrl = `${SITE_URL}/book/${id}`;
  
  return {
    title: `${book.title} - 九天小说站`,
    description,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      title: book.title,
      description,
      url: canonicalUrl,
      images: book.cover_image ? [book.cover_image] : [],
      type: 'book',
    },
  };
}

export default async function BookDetailPage({ params }: Props) {
  const { id } = await params;
  
  // 并行请求书籍和章节数据
  const [book, catalog, firstChapter, totalWords] = await Promise.all([
    getBook(id),
    getChapters(id),
    getChapters(id, 'asc', 1),
    getTotalWords(id),
  ]);
  
  if (!book) {
    notFound();
  }

  // Render only the visible preview; the client fills the complete catalog in the background.
  const chapters = catalog?.rows ?? [];
  // Format once on the server so hydration cannot change the date's locale or timezone.
  const updatedAt = new Date(book.lastUpdated ?? '');
  const updatedDate = Number.isNaN(updatedAt.getTime()) ? '近期' : new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric', day: 'numeric',
  }).format(updatedAt);

  const description = buildDescription(book);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Book',
    name: book.title,
    author: {
      '@type': 'Person',
      name: book.author || 'Unknown author',
    },
    description,
    image: book.cover_image, // 这里已经是我们转换过的绝对路径图片了，SEO 满分
    url: `${SITE_URL}/book/${book.id}`,
    numberOfPages: catalog?.total || undefined,
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, String.fromCharCode(92) + 'u003c') }}
      />
      <BookDetailClient key={book.id} initialBookData={{ book, chapters, summary: { totalWords, updatedDate } }} initialCatalog={catalog} initialFirstChapterId={firstChapter?.rows[0]?.id} />
    </>
  );
}
