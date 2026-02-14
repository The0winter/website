import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import BookDetailClient from '@/components/BookDetailClient';
import type { Book, Chapter } from '@/lib/api';

type Props = {
  params: Promise<{ id: string }>;
};

const API_HOST = process.env.NEXT_PUBLIC_API_URL?.trim().replace(/\/+$/, '') || 'http://127.0.0.1:5000';
const API_BASE_URL = API_HOST.endsWith('/api') ? API_HOST : `${API_HOST}/api`;
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '') || 'https://jiutianxiaoshuo.com';

// 🔥 1. 拆分：只获取书籍详情（轻量级，速度快）
async function getBook(id: string): Promise<Book | null> {
  try {
    // 建议加上 revalidate 缓存，比如 60 秒更新一次，不用每次都查库
    const res = await fetch(`${API_BASE_URL}/books/${id}`, { 
      next: { revalidate: 60 } 
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (error) {
    console.error('Fetch Book Error:', error);
    return null;
  }
}

// 🔥 2. 拆分：单独获取章节列表（重量级，速度慢）
async function getChapters(id: string): Promise<Chapter[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/books/${id}/chapters`, { 
      next: { revalidate: 60 } // 章节列表也缓存一下
    });
    if (!res.ok) return [];
    return await res.json();
  } catch (error) {
    console.error('Fetch Chapters Error:', error);
    return [];
  }
}

function buildDescription(book: Book): string {
  const raw = (book.description || '').replace(/[\r\n\t]+/g, ' ').trim();
  if (raw) return raw.length > 120 ? `${raw.slice(0, 120)}...` : raw;
  return `${book.title} online reading`;
}

// 🔥 3. 优化：Metadata 此时只等待 getBook，不再等待几千个章节！
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  // 只请求书的信息，瞬间就能完成
  const book = await getBook(id);

  if (!book) {
    return {
      title: 'Book Not Found',
    };
  }

  const description = buildDescription(book);
  const canonicalUrl = `${SITE_URL}/book/${id}`;

  return {
    title: `${book.title} - Jiutian Novel`,
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

  // 🔥 4. 并行请求：虽然这里还是会等章节，但因为 Metadata 已经解除了阻塞，
  // 浏览器会更快收到响应头 (TTFB)，感觉上会变快。
  const [book, chapters] = await Promise.all([
    getBook(id),
    getChapters(id)
  ]);

  if (!book) {
    notFound();
  }

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
    image: book.cover_image,
    url: `${SITE_URL}/book/${book.id}`,
    // 章节数作为非关键信息，如果 chapters 还没加载完，这里甚至可以不填
    numberOfPages: chapters.length || undefined, 
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {/* 🚀 进阶优化建议：
         如果章节特别多（比如>2000章），建议不要在这里 await getChapters。
         而是把 chapters 传 undefined 进去，然后在 BookDetailClient 里用 useEffect 
         去异步加载章节，或者用 Next.js 的 <Suspense> 
      */}
      <BookDetailClient initialBookData={{ book, chapters }} />
    </>
  );
}