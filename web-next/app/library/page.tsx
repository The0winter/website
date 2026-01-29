'use client'; // 👈 必须加这一行

import { useEffect, useState } from 'react';
import Link from 'next/link'; // ✅ 替换 react-router-dom
import { useRouter } from 'next/navigation'; // ✅ 替换 useNavigate
import { Bookmark, BookOpen, Eye } from 'lucide-react';
import { bookmarksApi, booksApi, Book } from '@/lib/api'; // ✅ 使用 @ 别名引用，防止路径错误
import { useAuth } from '@/contexts/AuthContext'; // ✅ 使用 @ 别名

export default function Library() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter(); // ✅ 替换 useNavigate
  const [bookmarkedBooks, setBookmarkedBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 如果认证还在加载中，不做任何操作
    if (authLoading) return;
    // 如果用户没登录，跳回登录页
    if (!user) {
       router.push('/login');
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    if (user) {
      fetchBookmarkedBooks();
    } else {
      // 如果 user 还没加载出来，先不 loading false，等 user 出来
      // 这里的逻辑稍微复杂，为了简单起见，只要 auth 加载完了发现没用户，useEffect 上面那个会跳走
      // 这里只负责有用户时拉数据
      if (!user) setLoading(false);
    }
  }, [user, authLoading]);

  // 如果认证还在加载中，显示加载状态
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <BookOpen className="h-12 w-12 text-blue-600 animate-pulse" />
        <span className="ml-2 text-gray-600">Loading library...</span>
      </div>
    );
  }

  const fetchBookmarkedBooks = async () => {
    try {
      setLoading(true);
      const bookmarks = await bookmarksApi.getByUserId(user!.id);
      
      if (bookmarks && bookmarks.length > 0) {
        const bookPromises = bookmarks.map((bookmark) => {
          // ✅ 保留你原本的逻辑：检查数据有效性
          if (!bookmark || !bookmark.bookId) {
             return Promise.resolve(null);
          }

          let bookId: string;
          
          // ✅ 保留你原本的逻辑：兼容 populate 对象和 ID 字符串
          if (typeof bookmark.bookId === 'object') {
                const bookObj = bookmark.bookId as any; 
                bookId = bookObj._id || bookObj.id || String(bookObj);
          } else {
                bookId = String(bookmark.bookId);
          }

          if (!bookId || bookId === 'null' || bookId === 'undefined') {
             return Promise.resolve(null);
          }

          return booksApi.getById(bookId);
        });

        const books = (await Promise.all(bookPromises)).filter((book): book is Book => book !== null);
        setBookmarkedBooks(books);
      }
    } catch (error) {
      console.error('Error fetching bookmarked books:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <BookOpen className="h-12 w-12 text-blue-600 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center space-x-3 mb-8">
          <Bookmark className="h-8 w-8 text-blue-600" />
          <h1 className="text-3xl font-bold text-gray-900">我的书架</h1>
        </div>

        {bookmarkedBooks.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg shadow-md">
            <Bookmark className="h-16 w-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-gray-900 mb-2">书架是空的</h3>
            <p className="text-gray-600 mb-4">
              去发现一些好书并加入书架吧！
            </p>
            <Link
              href="/" // ✅ to -> href
              className="inline-block bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 font-medium"
            >
              浏览小说
            </Link>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {bookmarkedBooks.map((book) => (
              <Link
                key={book.id}
                href={`/book/${book.id}`} // ✅ to -> href
                className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-xl transition group"
              >
                {book.cover_image ? (
                  <img
                    src={book.cover_image}
                    alt={book.title}
                    className="w-full h-64 object-cover group-hover:scale-105 transition"
                  />
                ) : (
                  <div className="w-full h-64 bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center">
                    <BookOpen className="h-16 w-16 text-white" />
                  </div>
                )}
                <div className="p-4">
                  <h3 className="font-bold text-lg text-gray-900 mb-1 line-clamp-1">
                    {book.title}
                  </h3>
                  {/* 👇👇👇 最强壮的作者名显示逻辑 👇👇👇 */}
                  <p className="text-sm text-gray-600 mb-2">
                    {/* 👇 直接读取 author 字段即可，因为它现在是个字符串了 */}
                    作者: {book.author || '未知'}
                  </p>
                  {/* 👆👆👆 替换结束 👆👆👆 */}
                  <p className="text-sm text-gray-700 line-clamp-2 mb-3">{book.description}</p>
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span className="flex items-center space-x-1">
                      <Eye className="h-3 w-3" />
                      <span>{(book.views || 0).toLocaleString()}</span>
                    </span>
                    <span className="px-2 py-1 bg-gray-100 rounded text-xs">
                      {book.category || '未分类'}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}