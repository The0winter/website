// app/book/[id]/page.tsx
import BookDetailClient from '@/components/BookDetailClient';
import Link from 'next/link';

// 1. 在服务端直接获取数据
async function getBookData(id: string) {
  // 注意：如果是服务端 fetching，建议用完整的 URL，或者直接调用数据库逻辑（如果可以直接连库）
  // 这里假设你用 API 方式
  try {
    const res = await fetch(`https://website-production-6edf.up.railway.app/api/books/${id}`, {
      cache: 'no-store', // 保证每次都获取最新数据
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.error(e);
    return null;
  }
}

async function getChaptersData(id: string) {
  try {
    // ✅ 修正：路由地址改为 /api/books/${id}/chapters
    const res = await fetch(`https://website-production-6edf.up.railway.app/api/books/${id}/chapters`, {
      cache: 'no-store',
    });
    
    if (!res.ok) {
        console.error(`Fetch failed: ${res.status} ${res.statusText}`);
        return [];
    }
    
    const data = await res.json();
    // 简单检查一下数据是不是数组，防止报错
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error("获取章节失败:", e);
    return [];
  }
}

// 2. 页面入口
export default async function BookPage({ params }: { params: { id: string } }) {
  // Next.js 15 需要 await params
  const { id } = await params;

  // 并行获取书和章节信息，速度更快
  const [book, chapters] = await Promise.all([
    getBookData(id),
    getChaptersData(id)
  ]);

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

  // 3. 把数据传给客户端组件进行渲染
  return <BookDetailClient book={book} chapters={chapters} />;
}