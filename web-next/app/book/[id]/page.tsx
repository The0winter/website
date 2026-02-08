// app/book/[id]/page.tsx
import { Metadata } from 'next'; // 1. 引入 Metadata 类型
import BookDetailClient from '@/components/BookDetailClient';
import Link from 'next/link';

// 定义 Props 类型，适配 Next.js 15+ 的异步 params
type Props = {
  params: Promise<{ id: string }>;
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
  // 等待 params 解析 (Next.js 15 标准写法)
  const { id } = await params;
  const book = await getBookData(id);

  if (!book) {
    return {
      title: '未找到该书籍 - 九天小说',
    };
  }

  return {
    // 核心修改：模仿 69书吧 的标题策略
    // 格式：书名 + 核心词 + 重复书名 + 长尾词 + 站名
    title: `${book.title} 无弹窗_${book.title}最新章节全文阅读_九天小说`,
    
    // 描述：包含作者、分类、状态等丰富信息
    description: `${book.title}是作者${book.author}创作的一部${book.category}小说。九天小说提供${book.title}最新章节全文免费阅读，无弹窗，更新快。`,
    
    // 关键词：虽然 Google 权重低，但对中文搜索引擎仍有帮助
    keywords: [book.title, book.author, '无弹窗', '笔趣阁', '小说', '全文阅读', '九天小说', book.category],
  };
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