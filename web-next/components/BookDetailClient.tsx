// src/components/BookDetailClient.tsx
'use client'; // 👈 这一行非常重要，允许使用 hooks

import { useState, useEffect } from 'react';
import Link from 'next/link'; // ✅ 替换 react-router-dom
import { useRouter } from 'next/navigation'; // ✅ 替换 useNavigate
import { BookOpen, List, Bookmark, BookmarkCheck } from 'lucide-react';
import { bookmarksApi, booksApi } from '@/lib/api'; // 确保路径正确
import { useAuth } from '@/contexts/AuthContext';

// 定义接口 (根据你的后端返回结构调整)
interface Book {
  id: string;
  title: string;
  description: string;
  cover_image: string;
  author_id: any; // 或者具体的 Author 接口
  author?: string; // 兼容旧数据
  status: string;
  category: string;
}

interface Chapter {
  id: string;
  title: string;
  chapter_number: number;
  published_at: string;
  content?: string;
}

interface BookDetailClientProps {
  book: Book;
  chapters: Chapter[];
}

export default function BookDetailClient({ book, chapters }: BookDetailClientProps) {
  const { user } = useAuth();
  const router = useRouter();
  const [isBookmarked, setIsBookmarked] = useState(false);

  // 初始化检查收藏状态
  useEffect(() => {
    if (user && book.id) {
      checkBookmark();
    }
    // 增加浏览量可以放在这里，也可以放在服务端
    booksApi.incrementViews(book.id).catch(console.error);
  }, [user, book.id]);

  const checkBookmark = async () => {
    try {
      const bookmarked = await bookmarksApi.check(user!.id, book.id);
      setIsBookmarked(bookmarked);
    } catch (error) {
      console.error('Error checking bookmark:', error);
    }
  };

  const toggleBookmark = async () => {
    if (!user) {
      router.push('/login'); // ✅ 使用 router.push
      return;
    }

    try {
      if (isBookmarked) {
        await bookmarksApi.delete(user.id, book.id);
        setIsBookmarked(false);
      } else {
        await bookmarksApi.create(user.id, book.id);
        setIsBookmarked(true);
      }
    } catch (error) {
      console.error('Error toggling bookmark:', error);
    }
  };

  // 计算总字数
  const totalWords = chapters.reduce((sum, chapter) => sum + (chapter.content?.length || 0), 0);
  const wordCount = totalWords > 0 ? totalWords.toLocaleString() : '0';

  // 提取分类
  const getCategoryDisplay = (category?: string) => {
    if (!category) return '';
    const parts = category.split('>');
    return parts[parts.length - 1].trim();
  };
  const categoryDisplay = getCategoryDisplay(book.category);
  const statusText = book.status === 'completed' ? '已完结' : '连载中';

  // 获取作者名 helper
  const getAuthorName = () => {
    if (typeof book.author_id === 'object' && book.author_id?.username) {
      return book.author_id.username;
    }
    return book.author || '未知作者';
  };
  
  const getAuthorId = () => {
     if (typeof book.author_id === 'object') {
        return book.author_id?.id || book.author_id?._id;
     }
     return book.author_id;
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-12">
      {/* 顶部占位，防止导航栏遮挡 */}
      <div className="h-[20px]"></div> 

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 上半部分：书籍信息卡片 (完全保留你的布局) */}
        <div className="bg-white rounded-lg shadow-sm mb-6">
          <div className="p-6 md:p-8">
            <div className="flex flex-col md:flex-row gap-6 md:gap-8">
              {/* 左侧：封面 */}
              <div className="flex-shrink-0">
                {book.cover_image ? (
                  <img
                    src={book.cover_image}
                    alt={book.title}
                    className="w-48 h-64 object-cover rounded-lg shadow-md"
                  />
                ) : (
                  <div className="w-48 h-64 bg-gradient-to-br from-blue-500 to-blue-700 rounded-lg shadow-md flex items-center justify-center">
                    <BookOpen className="h-16 w-16 text-white" />
                  </div>
                )}
              </div>

              {/* 右侧：书籍信息 */}
              <div className="flex-1 flex flex-col">
                <h1 className="text-3xl font-bold text-gray-900 mb-3">
                  {book.title}
                </h1>

                <div className="mb-4">
                  <Link
                    href={`/author/${getAuthorId()}`} // ✅ href
                    className="text-gray-600 hover:text-blue-600 transition-colors"
                  >
                    {getAuthorName()}
                  </Link>
                </div>

                <div className="flex flex-wrap items-center gap-3 mb-5 text-sm text-gray-600">
                  <span className="text-gray-700">{statusText}</span>
                  <span className="text-gray-400">|</span>
                  {categoryDisplay && (
                    <>
                      <span className="text-gray-700">{categoryDisplay}</span>
                      <span className="text-gray-400">|</span>
                    </>
                  )}
                  <span className="text-gray-700">
                    字数：<span className="font-semibold text-blue-600">{wordCount}</span>
                  </span>
                </div>

                <div className="mb-6">
                  <p 
                    className="text-gray-700 leading-relaxed"
                    style={{
                      display: '-webkit-box',
                      WebkitLineClamp: 4,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {book.description || '暂无简介'}
                  </p>
                </div>

                {/* 按钮组 */}
                <div className="flex flex-wrap gap-4 mt-auto">
                  {chapters.length > 0 ? (
                    <Link
                      href={`/read/${book.id}`} // ✅ 注意：这里可能需要根据你的阅读页路由调整，比如 /read/[bookId]/[chapterId]
                      className="bg-blue-600 text-white px-8 py-3 rounded-md hover:bg-blue-700 font-semibold transition-colors"
                    >
                      开始阅读
                    </Link>
                  ) : (
                    <button disabled className="bg-gray-400 text-white px-8 py-3 rounded-md cursor-not-allowed font-semibold">
                      暂无章节
                    </button>
                  )}
                  <button
                    onClick={toggleBookmark}
                    className={`flex items-center space-x-2 px-8 py-3 rounded-md font-semibold border-2 transition-colors ${
                      isBookmarked
                        ? 'bg-blue-50 border-blue-600 text-blue-600'
                        : 'bg-white border-gray-300 text-gray-700 hover:border-blue-600 hover:text-blue-600'
                    }`}
                  >
                    {isBookmarked ? <BookmarkCheck className="h-5 w-5" /> : <Bookmark className="h-5 w-5" />}
                    <span>{isBookmarked ? '已加入书架' : '加入书架'}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 下半部分：目录 */}
        <div className="bg-white rounded-lg shadow-sm">
          <div className="p-6 md:p-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-6 flex items-center space-x-2">
              <List className="h-6 w-6" />
              <span>目录</span>
            </h2>

            {chapters.length === 0 ? (
              <p className="text-gray-600">暂无章节</p>
            ) : (
              <div className="space-y-2">
                {chapters.map((chapter) => (
                  <Link
                    key={chapter.id}
                    href={`/read/${book.id}?chapterId=${chapter.id}`} // ✅ href
                    className="block p-4 bg-gray-50 hover:bg-blue-50 rounded-md border border-gray-200 hover:border-blue-300 transition"
                  >
                    <div className="flex justify-between items-center">
                      <div>
                        <span className="font-semibold text-gray-900">
                          {/* 👇 同样的智能逻辑 */}
                          {chapter.title.trim().startsWith('第') 
                              ? chapter.title 
                              : `第${chapter.chapter_number}章 ${chapter.title}`}
                        </span>
                      </div>
                      <span className="text-sm text-gray-500">
                        {chapter.published_at ? new Date(chapter.published_at).toLocaleDateString() : 'N/A'}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}