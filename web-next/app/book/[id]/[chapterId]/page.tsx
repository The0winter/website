import { cache } from 'react';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import ReaderClient from '@/components/ReaderClient';
import type { Book, Chapter } from '@/lib/api';

type Props = {
  params: Promise<{
    id: string;
    chapterId: string;
  }>;
};

type ReaderData = {
  book: Book | null;
  chapter: Chapter | null;
  origin: string;
};

const DEFAULT_ORIGIN = 'http://127.0.0.1:5000';

const getSiteOrigin = cache(async () => {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (configured) {
    const normalized = configured.replace(/\/+$/, '');
    return normalized.endsWith('/api') ? normalized.slice(0, -4) : normalized;
  }

  const headerStore = await headers();
  const host = headerStore.get('x-forwarded-host') ?? headerStore.get('host');
  if (!host) return DEFAULT_ORIGIN;

  const proto =
    headerStore.get('x-forwarded-proto') ??
    (host.includes('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https');

  return `${proto}://${host}`;
});

const getReaderData = cache(async (bookId: string, chapterId: string): Promise<ReaderData> => {
  const origin = await getSiteOrigin();

  try {
    const [bookRes, chapterRes] = await Promise.all([
      fetch(`${origin}/api/books/${bookId}`, { cache: 'no-store' }),
      fetch(`${origin}/api/chapters/${chapterId}`, { cache: 'no-store' }),
    ]);

    if (!bookRes.ok || !chapterRes.ok) {
      return { book: null, chapter: null, origin };
    }

    const [book, chapter] = await Promise.all([
      bookRes.json() as Promise<Book>,
      chapterRes.json() as Promise<Chapter>,
    ]);

    return { book, chapter, origin };
  } catch (error) {
    console.error('Reader SSR fetch failed:', error);
    return { book: null, chapter: null, origin };
  }
});

function getChapterTitle(chapter: Chapter): string {
  if (!chapter?.title) return '\u7AE0\u8282\u9605\u8BFB';
  if (chapter.title.startsWith('\u7B2C')) return chapter.title;
  return `\u7B2C${chapter.chapter_number}\u7AE0 ${chapter.title}`;
}

function getDescription(book: Book, chapter: Chapter): string {
  const title = getChapterTitle(chapter);
  const plainContent = (chapter.content || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const excerpt = plainContent.slice(0, 90);
  return excerpt
    ? `${book.title} ${title}\u5728\u7EBF\u9605\u8BFB\u3002${excerpt}...`
    : `${book.title} ${title}\u5728\u7EBF\u9605\u8BFB\u3002\u4F5C\u8005\uff1A${book.author || '\u672A\u77E5'}`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id: bookId, chapterId } = await params;
  const { book, chapter, origin } = await getReaderData(bookId, chapterId);

  if (!book || !chapter) {
    return {
      title: '\u7AE0\u8282\u672A\u627E\u5230 - \u4E5D\u5929\u5C0F\u8BF4\u7AD9',
      description: '\u4F60\u8BBF\u95EE\u7684\u7AE0\u8282\u4E0D\u5B58\u5728\u6216\u5DF2\u4E0B\u7EBF\u3002',
    };
  }

  const chapterTitle = getChapterTitle(chapter);
  const fullTitle = `${chapterTitle} - ${book.title} - \u4E5D\u5929\u5C0F\u8BF4\u7AD9`;
  const description = getDescription(book, chapter);
  const canonicalUrl = `${origin}/book/${bookId}/${chapterId}`;

  return {
    title: fullTitle,
    description,
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      title: fullTitle,
      description,
      url: canonicalUrl,
      siteName: '\u4E5D\u5929\u5C0F\u8BF4\u7AD9',
      type: 'article',
      locale: 'zh_CN',
    },
  };
}

export default async function Page({ params }: Props) {
  const { id: bookId, chapterId } = await params;
  const { book, chapter, origin } = await getReaderData(bookId, chapterId);

  if (!book || !chapter) {
    notFound();
  }

  const chapterTitle = getChapterTitle(chapter);
  const description = getDescription(book, chapter);
  const chapterUrl = `${origin}/book/${bookId}/${chapterId}`;

  const chapterJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: chapterTitle,
    description,
    author: {
      '@type': 'Person',
      name: book.author || '\u672A\u77E5\u4F5C\u8005',
    },
    isPartOf: {
      '@type': 'Book',
      name: book.title,
      url: `${origin}/book/${bookId}`,
    },
    mainEntityOfPage: chapterUrl,
    inLanguage: 'zh-CN',
  };

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: '\u9996\u9875',
        item: origin,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: book.title,
        item: `${origin}/book/${bookId}`,
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: chapterTitle,
        item: chapterUrl,
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(chapterJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <ReaderClient initialBook={book} initialChapter={chapter} />
    </>
  );
}
