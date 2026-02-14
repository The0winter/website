import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import BookDetailClient from '@/components/BookDetailClient';
import type { Book, Chapter } from '@/lib/api';

type Props = {
  params: Promise<{ id: string }>;
};

type BookPageData = {
  book: Book;
  chapters: Chapter[];
};

const API_HOST = process.env.NEXT_PUBLIC_API_URL?.trim().replace(/\/+$/, '') || 'http://127.0.0.1:5000';
const API_BASE_URL = API_HOST.endsWith('/api') ? API_HOST : `${API_HOST}/api`;
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '') || 'https://jiutianxiaoshuo.com';

async function getBookPageData(id: string): Promise<BookPageData | null> {

  try {
    const [bookRes, chaptersRes] = await Promise.all([
      fetch(`${API_BASE_URL}/books/${id}`, { cache: 'no-store' }),
      fetch(`${API_BASE_URL}/books/${id}/chapters`, { cache: 'no-store' }),
    ]);

    if (!bookRes.ok || !chaptersRes.ok) return null;

    const [book, chaptersRaw] = await Promise.all([
      bookRes.json() as Promise<Book>,
      chaptersRes.json() as Promise<Chapter[]>,
    ]);

    const chapters = Array.isArray(chaptersRaw) ? chaptersRaw : [];
    return { book, chapters };
  } catch (error) {
    console.error('Book detail SSR fetch error:', error);
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
  const data = await getBookPageData(id);

  if (!data) {
    return {
      title: 'Book Not Found - Jiutian Novel',
      description: 'The book does not exist or is unavailable.',
    };
  }

  const { book } = data;
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
      siteName: 'Jiutian Novel',
      images: book.cover_image ? [book.cover_image] : [],
      locale: 'zh_CN',
      type: 'book',
    },
  };
}

export default async function BookDetailPage({ params }: Props) {
  const { id } = await params;
  const data = await getBookPageData(id);

  if (!data) {
    notFound();
  }

  const { book, chapters } = data;
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
    inLanguage: 'zh-CN',
    genre: book.category || 'Novel',
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
