import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import ReaderClient from '@/components/ReaderClient';
import type { Book, Chapter } from '@/lib/api';
import { getApiBaseUrl } from '@/utils/api'; // 新增：引入我们的智能请求地址工具

type Props = {
  params: Promise<{
    id: string;
    chapterId: string;
  }>;
};

type ReaderData = {
  book: Book | null;
  chapter: Chapter | null;
};

// 专门用于给搜索引擎爬虫生成绝对路径的公网域名
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '') || 'https://jiutianxiaoshuo.com';

const getReaderData = cache(async (bookId: string, chapterId: string): Promise<ReaderData> => {
  const baseUrl = getApiBaseUrl(); // 动态获取：服务端走本地 5000 端口，客户端走公网

  try {
    const [bookRes, chapterRes] = await Promise.all([
      fetch(`${baseUrl}/books/${bookId}`, { cache: 'no-store' }),
      fetch(`${baseUrl}/chapters/${chapterId}`, { cache: 'no-store' }),
    ]);

    if (!bookRes.ok || !chapterRes.ok) {
      return { book: null, chapter: null };
    }

    const [book, chapter] = await Promise.all([
      bookRes.json() as Promise<Book>,
      chapterRes.json() as Promise<Chapter>,
    ]);

    return { book, chapter };
  } catch (error) {
    console.error('Reader SSR fetch failed:', error);
    return { book: null, chapter: null };
  }
});

function getChapterTitle(chapter: Chapter): string {
  if (!chapter?.title) return '\u7AE0\u8282\u9605\u8BFB'; // 章节阅读
  if (chapter.title.startsWith('\u7B2C')) return chapter.title; // 第
  return `\u7B2C${chapter.chapter_number}\u7AE0 ${chapter.title}`; // 第X章
}

function getDescription(book: Book, chapter: Chapter): string {
  const title = getChapterTitle(chapter);
  const plainContent = (chapter.content || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const excerpt = plainContent.slice(0, 90);
  return excerpt
    ? `${book.title} ${title}在线阅读。${excerpt}...`
    : `${book.title} ${title}在线阅读。作者：${book.author || '未知'}`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id: bookId, chapterId } = await params;
  const { book, chapter } = await getReaderData(bookId, chapterId);

  if (!book || !chapter) {
    return {
      title: '章节未找到 - 九天小说站',
      description: '你访问的章节不存在或已下线。',
    };
  }

  const chapterTitle = getChapterTitle(chapter);
  const fullTitle = `${chapterTitle} - ${book.title} - 九天小说站`;
  const description = getDescription(book, chapter);
  const canonicalUrl = `${SITE_URL}/book/${bookId}/${chapterId}`;

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
      siteName: '九天小说站',
      type: 'article',
      locale: 'zh_CN',
    },
  };
}

export default async function Page({ params }: Props) {
  const { id: bookId, chapterId } = await params;
  const { book, chapter } = await getReaderData(bookId, chapterId);

  if (!book || !chapter) {
    notFound();
  }

  const chapterTitle = getChapterTitle(chapter);
  const description = getDescription(book, chapter);
  const chapterUrl = `${SITE_URL}/book/${bookId}/${chapterId}`;

  const chapterJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: chapterTitle,
    description,
    author: {
      '@type': 'Person',
      name: book.author || '未知作者',
    },
    isPartOf: {
      '@type': 'Book',
      name: book.title,
      url: `${SITE_URL}/book/${bookId}`,
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
        name: '首页',
        item: SITE_URL,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: book.title,
        item: `${SITE_URL}/book/${bookId}`,
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