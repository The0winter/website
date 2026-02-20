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

async function getBook(id: string): Promise<Book | null> {
  try {
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

async function getChapters(id: string): Promise<Chapter[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/books/${id}/chapters`, { 
      next: { revalidate: 60 } 
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

  // 并行请求书籍和章节数据
  const [book, rawChapters] = await Promise.all([
    getBook(id),
    getChapters(id)
  ]);

  if (!book) {
    notFound();
  }

  // 按照章节标题去重，保留列表中第一次出现的该标题章节
  const uniqueChaptersMap = new Map();
  rawChapters.forEach((chapter) => {
    const cleanTitle = chapter.title ? chapter.title.trim() : ''; 
    
    if (cleanTitle && !uniqueChaptersMap.has(cleanTitle)) {
      uniqueChaptersMap.set(cleanTitle, chapter);
    }
  });
  
  // 转换回数组，这就是干净的章节列表了
  const chapters = Array.from(uniqueChaptersMap.values());

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
    numberOfPages: chapters.length || undefined,
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <BookDetailClient initialBookData={{ book, chapters }} />
    </>
  );
}