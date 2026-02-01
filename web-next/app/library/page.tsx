'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
// 🔥 1. 新增 AlertTriangle (警告图标) 和 X (关闭图标)
import { Bookmark, BookOpen, Eye, Trash2, AlertTriangle, X } from 'lucide-react';
import { bookmarksApi, booksApi, Book } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

export default function Library() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [bookmarkedBooks, setBookmarkedBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);

  // 🔥 2. 新增状态：用来记录当前正准备删除哪本书
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  // --- 认证检查 ---
  useEffect(() => {
    if (authLoading) return;
    if (!user) router.push('/login');
  }, [user, authLoading, router]);

  // --- 加载书架数据 ---
  useEffect(() => {
    if (user) {
      fetchBookmarkedBooks();
    } else if (!authLoading) {
      setLoading(false);
    }
  }, [user, authLoading]);

  const fetchBookmarkedBooks = async () => {
    try {
      setLoading(true);
      const bookmarks = await bookmarksApi.getByUserId(user!.id);
      
      if (bookmarks && bookmarks.length > 0) {
        const bookPromises = bookmarks.map((bookmark) => {
          if (!bookmark || !bookmark.bookId) return Promise.resolve(null);

          let bookId: string;
          if (typeof bookmark.bookId === 'object') {
                const bookObj = bookmark.bookId as any; 
                bookId = bookObj._id || bookObj.id || String(bookObj);
          } else {
                bookId = String(bookmark.bookId);
          }

          if (!bookId || bookId === 'null') return Promise.resolve(null);
          return booksApi.getById(bookId);
        });

        const books = (await Promise.all(bookPromises)).filter((book): book is Book => book !== null);
        setBookmarkedBooks(books);
      } else {
        setBookmarkedBooks([]); 
      }
    } catch (error) {
      console.error('Error fetching bookmarked books:', error);
    } finally {
      setLoading(false);
    }
  };

  // 🔥 3. 第一步：点击垃圾桶，只是打开弹窗，不删
  const openDeleteModal = (e: React.MouseEvent, bookId: string) => {
    e.preventDefault(); 
    e.stopPropagation();
    setDeleteTargetId(bookId); // 把要删的 ID 存起来，弹窗显示
  };

  // 🔥 4. 第二步：用户在弹窗里点了“确认”，才真的删
  const executeDelete = async () => {
    if (!deleteTargetId || !user) return;

    // 先存个临时变量，方便后面处理
    const bookId = deleteTargetId;
    
    try {
        // 乐观更新：先从界面删掉
        setBookmarkedBooks(prev => prev.filter(b => b.id !== bookId));
        // 关闭弹窗
        setDeleteTargetId(null);

        // 发请求
        const res = await fetch(`https://website-production-6edf.up.railway.app/api/users/${user.id}/bookmarks/${bookId}`, {
            method: 'DELETE'
        });

        if (!res.ok) {
            throw new Error('删除失败');
        }
    } catch (error) {
        console.error('移除失败:', error);
        alert('移除失败，请刷新页面重试'); // 如果真的出错了，再弹丑的也没事
        fetchBookmarkedBooks(); // 滚回原状
    }
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <BookOpen className="h-12 w-12 text-blue-600 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 relative"> {/* relative 用于定位弹窗 */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center space-x-3 mb-8">
          <Bookmark className="h-8 w-8 text-blue-600" />
          <h1 className="text-3xl font-bold text-gray-900">我的书架</h1>
          <span className="text-sm text-gray-500 bg-gray-200 px-2 py-1 rounded-full">
            {bookmarkedBooks.length}
          </span>
        </div>

        {bookmarkedBooks.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg shadow-md">
            <Bookmark className="h-16 w-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-gray-900 mb-2">书架是空的</h3>
            <p className="text-gray-600 mb-4">
              去发现一些好书并加入书架吧！
            </p>
            <Link
              href="/"
              className="inline-block bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 font-medium"
            >
              浏览小说
            </Link>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {bookmarkedBooks.map((book) => (
              <div
                key={book.id}
                className="group relative bg-white rounded-lg shadow-md overflow-hidden hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1"
              >
                {/* 🗑️ 这里的点击只触发 openDeleteModal */}
                <button
                    onClick={(e) => openDeleteModal(e, book.id)}
                    className="absolute top-2 right-2 z-10 p-2 bg-black/60 hover:bg-red-600 text-white rounded-full opacity-0 group-hover:opacity-100 transition-all duration-200 shadow-lg backdrop-blur-sm"
                    title="移出书架"
                >
                    <Trash2 size={16} />
                </button>

                <Link href={`/book/${book.id}`} className="block h-full flex flex-col">
                    {book.cover_image ? (
                      <div className="relative h-64 overflow-hidden">
                        <img
                            src={book.cover_image}
                            alt={book.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition duration-500"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                      </div>
                    ) : (
                      <div className="w-full h-64 bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center">
                        <BookOpen className="h-16 w-16 text-white" />
                      </div>
                    )}
                    
                    <div className="p-4 flex-1 flex flex-col">
                      <h3 className="font-bold text-lg text-gray-900 mb-1 line-clamp-1 group-hover:text-blue-600 transition-colors">
                        {book.title}
                      </h3>
                      <p className="text-sm text-gray-600 mb-2">
                        作者: {book.author || '未知'}
                      </p>
                      <p className="text-sm text-gray-700 line-clamp-2 mb-3 flex-1">{book.description}</p>
                      
                      <div className="flex items-center justify-between text-xs text-gray-500 mt-auto pt-3 border-t border-gray-100">
                        <span className="flex items-center space-x-1">
                          <Eye className="h-3 w-3" />
                          <span>{(book.views || 0).toLocaleString()}</span>
                        </span>
                        <span className="px-2 py-1 bg-gray-100 rounded text-xs text-gray-600">
                          {book.category || '未分类'}
                        </span>
                      </div>
                    </div>
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 🔥🔥🔥 5. 全新的自定义弹窗 UI 🔥🔥🔥 */}
      {deleteTargetId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* 黑色半透明背景遮罩 */}
            <div 
                className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
                onClick={() => setDeleteTargetId(null)} // 点击背景关闭
            ></div>

            {/* 弹窗主体 */}
            <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 transform transition-all scale-100">
                {/* 关闭按钮 */}
                <button 
                    onClick={() => setDeleteTargetId(null)}
                    className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
                >
                    <X size={20} />
                </button>

                <div className="flex flex-col items-center text-center">
                    {/* 警告图标 */}
                    <div className="w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center mb-4">
                        <AlertTriangle size={24} />
                    </div>

                    <h3 className="text-xl font-bold text-gray-900 mb-2">
                        确定要移出书架吗？
                    </h3>
                    <p className="text-gray-500 mb-6">
                        这本书将从你的收藏列表中移除，但你可以随时再次添加回来。
                    </p>

                    <div className="flex gap-3 w-full">
                        <button 
                            onClick={() => setDeleteTargetId(null)}
                            className="flex-1 py-2.5 px-4 bg-gray-100 text-gray-700 font-semibold rounded-xl hover:bg-gray-200 transition-colors"
                        >
                            取消
                        </button>
                        <button 
                            onClick={executeDelete}
                            className="flex-1 py-2.5 px-4 bg-red-600 text-white font-semibold rounded-xl hover:bg-red-700 shadow-lg shadow-red-200 transition-colors"
                        >
                            确认移出
                        </button>
                    </div>
                </div>
            </div>
        </div>
      )}
    </div>
  );
}