import { Metadata } from 'next'; // 1. 引入 Metadata 类型
import BookDetailClient from '@/components/BookDetailClient';
import Link from 'next/link';

// 1.必须显式定义这个类型
type Props = {
  params: Promise<{
    id: string;        // 对应文件夹 [id]
    chapterId: string; // 对应文件夹 [chapterId]
  }>;
};
// 1. 在服务端只获取书籍详情
// Next.js 会自动对同一个请求去重，所以 generateMetadata 和 BookPage 调用两次也不会导致两次网络请求
async function getBookData(id: string) {
  try {
    const res = await fetch(`https://jiutianxiaoshuo.com/api/books/${id}`, {
      // 生产环境建议适当缓存，但在开发或强实时性要求下 no-store 也可以
      cache: 'no-store', 
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.error(e);
    return null;
  }
}

// 2. 新增：动态生成 SEO 标题和元数据
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id: bookId, chapterId } = await params;

  try {
    // 1. 并行请求书籍和章节信息 (服务器端请求，速度很快)
    const [chapterRes, bookRes] = await Promise.all([
      fetch(`https://jiutianxiaoshuo.com/api/chapters/${chapterId}`),
      fetch(`https://jiutianxiaoshuo.com/api/books/${bookId}`)
    ]);

    // 如果请求失败，返回兜底标题
    if (!chapterRes.ok || !bookRes.ok) {
        return { title: '九天小说 - 在线阅读' };
    }

    const chapter = await chapterRes.json();
    const book = await bookRes.json();

    // 2. 拼接完美的 SEO 标题
    // 格式：第123章 重生 - 逆天邪神 - 九天小说
    const finalTitle = `${chapter.title.startsWith('第') ? chapter.title : `第${chapter.chapter_number}章 ${chapter.title}`} - ${book.title} - 九天小说`;

    // 3. 生成 SEO 描述 (Meta Description)
    // 搜索引擎非常看重这个，用于在搜索结果里显示摘要
    const description = `正在阅读《${book.title}》${finalTitle}。作者：${book.author || '未知'}。${book.description ? book.description.slice(0, 80) : ''}...`;

    return {
      title: finalTitle,
      description: description,
      // 额外赠送：OpenGraph (让分享到微信/推特时的卡片更好看)
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

// 3. 页面入口
export default async function BookPage({ params }: Props) {
  const { id } = await params;

  // ✅ 只获取书，不获取章节
  const book = await getBookData(id);

  // 如果没找到书，显示 404
  if (!book) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">未找到该书籍</h2>
          <Link href="/" className="text-blue-600 hover:underline">
            返回首页
          </Link>
        </div>
      </div>
    );
  }

  // ✅ 传给客户端 initialChapters 为空数组，让客户端自己去加载
  return <BookDetailClient book={book} initialChapters={[]} />;
}