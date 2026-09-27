import { safeFetch as fetch, type CatalogPage } from '@/lib/request';
import type { Metadata } from 'next';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import BookDetailClient from '@/components/BookDetailClient';
import type {MilestoneData} from '@/components/BookMilestones';
import { formatRelativeUpdate } from '@/lib/relative-update';
import type { Book, Chapter } from '@/lib/api';
import { getApiBaseUrl } from '@/utils/api'; // 新增：引入我们写的智能地址判断工具
import {bookDescription, bookPageTitle, publicMetadata} from '@/lib/seo';

type Props = {
  params: Promise<{ id: string }>;
};

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '') || 'http://127.0.0.1:3000';

// 新增：专门为图片提供公网前缀，确保用户的浏览器和搜索引擎爬虫能正确加载封面图
const PUBLIC_IMAGE_HOST = process.env.NEXT_PUBLIC_API_URL
  ?.trim()
  .replace(/\/api\/?$/, '')
  .replace(/\/+$/, '') || SITE_URL;

// 新增辅助函数：处理封面图片地址，将其转化为完整的公网 URL
function normalizeCoverImage(coverImage?: string): string {
  if (!coverImage) return '';
  if (coverImage.startsWith('http') || coverImage.startsWith('data:')) {
    return coverImage;
  }
  return `${PUBLIC_IMAGE_HOST}${coverImage.startsWith('/') ? '' : '/'}${coverImage}`;
}

type DetailData = {book: Book; chapters: Chapter[]; catalog: CatalogPage<Chapter> | null; totalWords: number | null; milestones: MilestoneData | null};

const getDetail = cache(async (id: string): Promise<DetailData | null> => {
  if (!/^[a-f0-9]{24}$/i.test(id)) return null;
  try {
    const baseUrl = getApiBaseUrl(); // 动态获取：服务端走内网，客户端走公网
    const res = await fetch(`${baseUrl}/books/${id}/detail`, {
      cache: 'no-store'
    });
    if (res.status===404) return null;
    if (!res.ok) throw new Error('作品服务暂不可用');
    
    const detail: DetailData = await res.json();
    const {book} = detail;
    
    // 规范化封面地址，防止传给前端和 SEO 的图片路径是相对路径
    book.cover_image = normalizeCoverImage(book.cover_image);
    // 兼容部分字段拼写差异
    if (book.coverImage) {
      book.coverImage = normalizeCoverImage(book.coverImage);
    }
    
    return detail;
  } catch (error) {
    throw error;
  }
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const detail = await getDetail(id);
  if (!detail) notFound();
  const {book} = detail;

  const metadata = publicMetadata(bookPageTitle(book), bookDescription(book), `/book/${id}`);
  
  return {
    ...metadata,
    openGraph: {
      ...metadata.openGraph,
      images: book.cover_image ? [book.cover_image] : [],
      type: 'book',
    },
  };
}

export default async function BookDetailPage({ params }: Props) {
  const { id } = await params;
  
  // Metadata and the page share one request-scoped read.
  const detail = await getDetail(id);
  if (!detail) notFound();
  const {book, chapters, catalog, totalWords, milestones} = detail;
  const firstChapter = catalog ?? undefined;

  // Render only the visible preview; the client fills the complete catalog in the background.
  // Compute once on the server to keep relative-time boundaries stable during hydration.
  const updatedLabel = formatRelativeUpdate(book.lastUpdated);

  const description = bookDescription(book);
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
    url: `${SITE_URL}/book/${id}`,
    inLanguage: 'zh-CN',
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, String.fromCharCode(92) + 'u003c') }}
      />
      <BookDetailClient key={book.id} initialBookData={{ book, chapters, summary: { totalWords, updatedLabel } }} initialMilestones={milestones} initialCatalog={firstChapter} initialFirstChapterId={firstChapter?.rows[0]?.id} />
    </>
  );
}
