// app/book/[id]/page.tsx
import BookDetailClient from '@/components/BookDetailClient';
import Link from 'next/link';

// 1. 在服务端只获取书籍详情 (速度极快)
async function getBookData(id: string) {
  try {
    const res = await fetch(`https://jiutianxiaoshuo.com/api/books/${id}`, {
      cache: 'no-store', // 保证每次都获取最新数据
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.error(e);
    return null;
  }
}

// 2. 页面入口 (只保留这一个 export default)
export default async function BookPage({ params }: { params: { id: string } }) {
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