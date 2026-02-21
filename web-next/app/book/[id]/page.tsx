import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import BookDetailClient from '@/components/BookDetailClient';
import type { Book, Chapter } from '@/lib/api';
import { getApiBaseUrl } from '@/utils/api'; // 新增：引入我们写的智能地址判断工具

type Props = {
  params: Promise<{ id: string }>;
};

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '') || 'https://jiutianxiaoshuo.com';

// 新增：专门为图片提供公网前缀，确保用户的浏览器和搜索引擎爬虫能正确加载封面图
const PUBLIC_IMAGE_HOST = process.env.NEXT_PUBLIC_API_URL
  ?.trim()
  .replace(/\/api\/?$/, '')
  .replace(/\/+$/, '') || 'https://jiutianxiaoshuo.com';

// 新增辅助函数：处理封面图片地址，将其转化为完整的公网 URL
function normalizeCoverImage(coverImage?: string): string {
  if (!coverImage) return '';
  if (coverImage.startsWith('http') || coverImage.startsWith('data:')) {
    return coverImage;
  }
  return `${PUBLIC_IMAGE_HOST}${coverImage.startsWith('/') ? '' : '/'}${coverImage}`;
}

async function getBook(id: string): Promise<Book | null> {
  try {
    const baseUrl = getApiBaseUrl(); // 动态获取：服务端走内网，客户端走公网
    const res = await fetch(`${baseUrl}/books/${id}`, { 
      next: { revalidate: 60 } 
    });
    if (!res.ok) return null;
    
    const book: Book = await res.json();
    
    // 规范化封面地址，防止传给前端和 SEO 的图片路径是相对路径
    book.cover_image = normalizeCoverImage(book.cover_image);
    // 兼容部分字段拼写差异
    if ((book as any).coverImage) {
      (book as any).coverImage = normalizeCoverImage((book as any).coverImage);
    }
    
    return book;
  } catch (error) {
    console.error('Fetch Book Error:', error);
    return null;
  }
}

async function getChapters(id: string): Promise<Chapter[]> {
  try {
    const baseUrl = getApiBaseUrl(); // 动态获取：服务端走内网，客户端走公网
    const res = await fetch(`${baseUrl}/books/${id}/chapters`, { 
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
    image: book.cover_image, // 这里已经是我们转换过的绝对路径图片了，SEO 满分
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