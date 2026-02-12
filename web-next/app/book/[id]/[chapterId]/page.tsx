// app/book/[id]/[chapterId]/page.tsx

import { Metadata } from 'next';
import ReaderClient from '@/components/ReaderClient'; // 👈 引入刚才搬家的组件

// 定义参数类型
type Props = {
  params: Promise<{
    id: string;
    chapterId: string;
  }>;
};

// 🔥 1. 这里是专门给爬虫看的 SEO 代码 (Server Side)
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  // Next.js 15 写法，需要 await params
  const { id: bookId, chapterId } = await params;

  try {
    // 并行请求数据，速度很快
    const [chapterRes, bookRes] = await Promise.all([
      fetch(`https://jiutianxiaoshuo.com/api/chapters/${chapterId}`),
      fetch(`https://jiutianxiaoshuo.com/api/books/${bookId}`)
    ]);

    if (!chapterRes.ok || !bookRes.ok) {
        return { title: '九天小说 - 在线阅读' };
    }

    const chapter = await chapterRes.json();
    const book = await bookRes.json();

    // 生成完美的标题：第123章 逆天邪神 - 小说名
    const finalTitle = `${chapter.title.startsWith('第') ? chapter.title : `第${chapter.chapter_number}章 ${chapter.title}`} - ${book.title} - 九天小说`;
    
    // 生成描述
    const description = `正在阅读《${book.title}》${finalTitle}。作者：${book.author || '未知'}...`;

    return {
      title: finalTitle,
      description: description,
      openGraph: {
        title: finalTitle,
        description: description,
        type: 'article',
        url: `https://jiutianxiaoshuo.com/book/${bookId}/${chapterId}`,
        siteName: '九天小说',
      },
    };

  } catch (error) {
    console.error('SEO Metadata Error:', error);
    return { title: '九天小说 - 在线阅读' };
  }
}

// 🔥 2. 这里是给用户看的页面 (加载刚才的 Client Component)
export default async function Page(props: any) {
    // 直接把页面渲染权交给 ReaderClient，用户体验完全不变
    return <ReaderClient />;
}