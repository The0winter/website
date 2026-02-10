// web-next/app/book/[id]/page.tsx

import React from 'react';
import { Metadata, ResolvingMetadata } from 'next';
import { notFound } from 'next/navigation';
import BookDetailClient from '@/components/BookDetailClient';

// 定义 API 地址
const API_BASE_URL = 'http://127.0.0.1:5000/api';

// ✅ 修正：详情页只有 id，没有 chapterId
type Props = {
  params: Promise<{ id: string }>;
};

// 1. 辅助函数：获取书籍数据
async function getBook(id: string) {
  try {
    // 加上 no-store 或 revalidate 都可以，保证数据新鲜
    const res = await fetch(`${API_BASE_URL}/books/${id}`, { 
        cache: 'no-store' 
    });
    
    if (!res.ok) return null;
    return await res.json();
  } catch (error) {
    console.error('Fetch Book Error:', error);
    return null;
  }
}

// 2. 生成 SEO 头部信息 (只包含书名和作者，不再去找章节)
export async function generateMetadata(
  { params }: Props,
  parent: ResolvingMetadata
): Promise<Metadata> {
  const { id } = await params;
  const book = await getBook(id);

  if (!book) {
    return { title: '书籍未找到 - 九天小说' };
  }

  const previousImages = (await parent).openGraph?.images || [];

  return {
    title: `${book.title} - ${book.author || '未知'} - 九天小说`,
    description: book.description ? book.description.slice(0, 150) + '...' : `在线阅读《${book.title}》，作者：${book.author}。`,
    openGraph: {
      title: book.title,
      description: book.description?.slice(0, 100),
      url: `https://jiutianxiaoshuo.com/book/${id}`,
      siteName: '九天小说',
      images: book.cover_image ? [book.cover_image, ...previousImages] : previousImages,
      locale: 'zh_CN',
      type: 'book',
    },
  };
}

// 3. 页面主入口
export default async function BookDetailPage({ params }: Props) {
  const { id } = await params;
  const book = await getBook(id);

  if (!book) {
    // 如果找不到书，返回 404 页面
    notFound(); 
  }

  // 🔥 方案一核心：构建结构化数据 (JSON-LD)
  // 这段数据是隐形的，只有 Google 爬虫能看到
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Book',
    'name': book.title,
    'author': {
      '@type': 'Person',
      'name': book.author || '未知作者'
    },
    'description': book.description,
    'image': book.cover_image,
    'url': `https://jiutianxiaoshuo.com/book/${book.id}`,
    'inLanguage': 'zh-CN',
    'genre': book.category || '小说',
    'dateModified': book.updatedAt,
    // 🌟 星级评分 (如果有数据，Google 就会显示星星)
    ...(book.rating && book.numReviews ? {
      'aggregateRating': {
        '@type': 'AggregateRating',
        'ratingValue': book.rating,       
        'ratingCount': book.numReviews,
        'bestRating': '5',
        'worstRating': '1'
      }
    } : {})
  };

  // 🍞 面包屑导航 Schema
  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    'itemListElement': [
      {
        '@type': 'ListItem',
        'position': 1,
        'name': '首页',
        'item': 'https://jiutianxiaoshuo.com'
      },
      {
        '@type': 'ListItem',
        'position': 2,
        'name': book.title, // 显示书名
        'item': `https://jiutianxiaoshuo.com/book/${book.id}`
      }
    ]
  };

  return (
    <>
      {/* 👇 注入 SEO 数据 (不会影响页面显示) 👇 */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />

      {/* 👇 你的原有组件，完全保持不变 👇 */}
      {/* 这里的 initialChapters={[]} 和你原来的一模一样，交给客户端去加载章节列表 */}
      <BookDetailClient book={book} initialChapters={[]} />
    </>
  );
}