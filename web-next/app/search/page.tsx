'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Search, BookOpen, User, Clock, AlertCircle } from 'lucide-react';
import { booksApi, Book } from '@/lib/api'; // ✅ 确保路径正确

// 提取核心搜索内容组件
function SearchContent() {
  const searchParams = useSearchParams();
  const query = searchParams.get('q') || ''; // 获取 URL 里的 ?q=xxx
  const router = useRouter();

  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // 监听 query 变化，重新触发搜索
  useEffect(() => {
    if (!query) {
      setBooks([]);
      setLoading(false);
      return;
    }

    const fetchBooks = async () => {
      setLoading(true);
      setError('');
      try {
        // ⚠️ 注意：如果你的后端 API 支持直接搜索 (例如 /books?search=xxx)，
        // 你可以在 api.ts 里加一个 search 方法并在这里调用。
        // 目前我们先获取所有书，然后在前端过滤 (适用于数据量不大的情况)
        const allBooks = await booksApi.getAll();
        
        const filtered = allBooks.filter(book => 
          book.title.toLowerCase().includes(query.toLowerCase()) || 
          (book.author && book.author.toLowerCase().includes(query.toLowerCase())) ||
          (typeof book.author_id === 'object' && book.author_id?.username?.toLowerCase().includes(query.toLowerCase()))
        );

        setBooks(filtered);
      } catch (err) {
        console.error('Search error:', err);
        setError('搜索服务暂时不可用，请稍后再试');
      } finally {
        setLoading(false);
      }
    };

    fetchBooks();
  }, [query]);

  // 如果没有输入关键词
  if (!query) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-500">
        <Search className="w-16 h-16 mb-4 opacity-20" />
        <p className="text-lg">请输入关键词开始搜索</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* 顶部结果提示 */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          "{query}" 的搜索结果
        </h1>
        <p className="text-gray-500 text-sm">
          找到 {books.length} 本相关书籍
        </p>
      </div>

      {/* 加载状态 */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse flex p-4 border rounded-lg bg-white h-40">
              <div className="w-24 bg-gray-200 rounded mr-4"></div>
              <div className="flex-1 space-y-3 py-2">
                <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                <div className="h-20 bg-gray-200 rounded w-full"></div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 错误提示 */}
      {error && (
        <div className="flex items-center p-4 bg-red-50 text-red-700 rounded-lg">
          <AlertCircle className="w-5 h-5 mr-2" />
          {error}
        </div>
      )}

      {/* 无结果 */}
      {!loading && !error && books.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 bg-gray-50 rounded-xl border border-dashed border-gray-300">
          <BookOpen className="w-12 h-12 text-gray-300 mb-3" />
          <h3 className="text-lg font-medium text-gray-900">未找到相关书籍</h3>
          <p className="text-gray-500 mt-1">换个关键词试试？或者去<Link href="/" className="text-blue-600 hover:underline">首页</Link>看看</p>
        </div>
      )}

      {/* 结果列表 */}
      <div className="grid grid-cols-1 gap-6">
        {books.map((book) => (
          <Link 
            href={`/book/${book.id}`} 
            key={book.id}
            className="group block bg-white border border-gray-200 rounded-xl overflow-hidden hover:shadow-md transition-all hover:border-blue-300"
          >
            <div className="flex p-4 sm:p-6">
              {/* 封面图 */}
              <div className="flex-shrink-0 w-24 h-32 sm:w-32 sm:h-44 bg-gray-100 rounded-lg overflow-hidden shadow-sm mr-6 relative">
                {book.cover_image ? (
                  <img 
                    src={book.cover_image} 
                    alt={book.title || '小说封面'} 
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gray-100 text-gray-400">
                    <BookOpen className="w-8 h-8" />
                  </div>
                )}
                {/* 连载状态角标 */}
                {book.status && (
                  <div className={`absolute top-0 right-0 px-2 py-1 text-xs text-white rounded-bl-lg font-medium
                    ${book.status === 'completed' ? 'bg-green-500' : 'bg-blue-500'}`}
                  >
                    {book.status === 'completed' ? '完结' : '连载'}
                  </div>
                )}
              </div>

              {/* 书籍信息 */}
              <div className="flex-1 flex flex-col justify-between min-w-0">
                <div>
                  <div className="flex justify-between items-start">
                    <h2 className="text-xl font-bold text-gray-900 truncate group-hover:text-blue-600 transition-colors">
                      {book.title}
                    </h2>
                    {book.category && (
                      <span className="hidden sm:inline-block px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 whitespace-nowrap ml-2">
                        {book.category}
                      </span>
                    )}
                  </div>
                  
                  <div className="mt-1 flex items-center text-sm text-gray-500 mb-3">
                    <User className="w-4 h-4 mr-1" />
                    <span className="mr-4">
                      {/* 处理 author 可能是对象也可能是字符串的情况 */}
                      {typeof book.author_id === 'object' ? book.author_id?.username : (book.author || '佚名')}
                    </span>
                    {book.updated_at && ( // 假设api有updated_at，如果没有可用created_at
                      <>
                        <Clock className="w-4 h-4 mr-1 ml-2" />
                        <span>最近更新</span>
                      </>
                    )}
                  </div>

                  <p className="text-gray-600 text-sm line-clamp-3 mb-4">
                    {book.description || '暂无简介'}
                  </p>
                </div>
                
                {/* 底部标签或统计 */}
                <div className="flex items-center gap-2">
                   <span className="text-xs px-2 py-1 bg-gray-100 rounded text-gray-500">
                     {book.category || '综合'}
                   </span>
                   {/* 如果有阅读量 */}
                   {book.views !== undefined && (
                     <span className="text-xs text-gray-400">
                       {book.views} 次阅读
                     </span>
                   )}
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

// 主页面组件必须包裹 Suspense 否则 build 会报错
export default function SearchPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4"></div>
          <p className="text-gray-500">正在准备搜索...</p>
        </div>
      </div>
    }>
      <div className="min-h-screen bg-gray-50">
        <SearchContent />
      </div>
    </Suspense>
  );
}