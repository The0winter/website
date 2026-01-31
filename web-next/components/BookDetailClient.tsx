// src/components/BookDetailClient.tsx
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BookOpen, List, Bookmark, BookmarkCheck } from 'lucide-react';
import { bookmarksApi, booksApi } from '@/lib/api'; 
import { useAuth } from '@/contexts/AuthContext';
// 👇 关键改变：引入 react-virtuoso
import { Virtuoso } from 'react-virtuoso';

// --- 接口定义 (保持不变) ---
interface Book {
  id: string;
  title: string;
  description: string;
  cover_image: string;
  author_id: any; 
  author?: string;
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

  // --- 初始化与逻辑 (保持不变) ---
  useEffect(() => {
    if (user && book.id) {
      checkBookmark();
    }
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
      router.push('/login');
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

  // --- 数据统计 (保持不变) ---
  const totalWords = chapters.reduce((sum, chapter) => sum + (chapter.content?.length || 0), 0);
  const wordCount = totalWords > 0 ? totalWords.toLocaleString() : '0';

  const getCategoryDisplay = (category?: string) => {
    if (!category) return '';
    const parts = category.split('>');
    return parts[parts.length - 1].trim();
  };
  const categoryDisplay = getCategoryDisplay(book.category);
  const statusText = book.status === 'completed' ? '已完结' : '连载中';

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

  // 👇 数据预处理：将一维数组切分为 "每行3个" 的二维数组
  const COLUMN_COUNT = 3;
  const rows = useMemo(() => {
    const result = [];
    for (let i = 0; i < chapters.length; i += COLUMN_COUNT) {
      result.push(chapters.slice(i, i + COLUMN_COUNT));
    }
    return result;
  }, [chapters]);

  // --- 渲染部分 ---
  return (
    <div className="min-h-screen bg-gray-50 pb-12">
      <div className="h-[20px]"></div> 

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        
        {/* === 第一部分：书籍核心信息 === */}
        <div className="bg-white rounded-lg shadow-sm p-6 md:p-8">
            <div className="flex flex-col md:flex-row gap-6 md:gap-8">
              <div className="flex-shrink-0">
                {book.cover_image ? (
                  <img src={book.cover_image} alt={book.title} className="w-48 h-64 object-cover rounded-lg shadow-md" />
                ) : (
                  <div className="w-48 h-64 bg-gradient-to-br from-blue-500 to-blue-700 rounded-lg shadow-md flex items-center justify-center">
                    <BookOpen className="h-16 w-16 text-white" />
                  </div>
                )}
              </div>
              <div className="flex-1 flex flex-col">
                <h1 className="text-3xl font-bold text-gray-900 mb-3">{book.title}</h1>
                <div className="mb-4">
                  <Link href={`/author/${getAuthorId()}`} className="text-gray-600 hover:text-blue-600 font-medium text-lg">
                    {getAuthorName()}
                  </Link>
                </div>
                <div className="flex flex-wrap items-center gap-6 mb-8 text-sm text-gray-600">
                  <div className="flex flex-col"><span className="text-gray-400 text-xs mb-1">状态</span><span className="text-gray-900 font-medium">{statusText}</span></div>
                  {categoryDisplay && <div className="flex flex-col"><span className="text-gray-400 text-xs mb-1">分类</span><span className="text-gray-900 font-medium">{categoryDisplay}</span></div>}
                  <div className="flex flex-col"><span className="text-gray-400 text-xs mb-1">总字数</span><span className="text-blue-600 font-bold">{wordCount}</span></div>
                </div>
                <div className="flex flex-wrap gap-4 mt-auto">
                  {chapters.length > 0 ? (
                    <Link href={`/read/${book.id}`} className="bg-blue-600 text-white px-8 py-3 rounded-md hover:bg-blue-700 font-semibold transition-colors shadow-sm">开始阅读</Link>
                  ) : (
                    <button disabled className="bg-gray-400 text-white px-8 py-3 rounded-md cursor-not-allowed font-semibold">暂无章节</button>
                  )}
                  <button onClick={toggleBookmark} className={`flex items-center space-x-2 px-8 py-3 rounded-md font-semibold border transition-colors ${isBookmarked ? 'bg-blue-50 border-blue-600 text-blue-600' : 'bg-white border-gray-300 text-gray-700 hover:border-blue-600'}`}>
                    {isBookmarked ? <BookmarkCheck className="h-5 w-5" /> : <Bookmark className="h-5 w-5" />}
                    <span>{isBookmarked ? '已在书架' : '加入书架'}</span>
                  </button>
                </div>
              </div>
            </div>
        </div>

        {/* === 第二部分：作品简介 === */}
        <div className="bg-white rounded-lg shadow-sm p-6 md:p-8">
          <h2 className="text-xl font-bold text-gray-900 mb-4 border-l-4 border-blue-600 pl-3">作品简介</h2>
          <div className="text-gray-700 leading-8 text-base">
            <p className="whitespace-pre-wrap">{book.description || '暂无简介'}</p>
          </div>
        </div>

        {/* === 第三部分：目录 (react-virtuoso 版) === */}
        <div className="bg-white rounded-lg shadow-sm">
          <div className="p-6 md:p-8">
            <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center space-x-2 border-l-4 border-blue-600 pl-3">
              <List className="h-5 w-5" />
              <span>目录 ({chapters.length}章)</span>
            </h2>

            {chapters.length === 0 ? (
              <p className="text-gray-600">暂无章节</p>
            ) : (
              // 👇 虚拟列表容器
              <div className="border rounded-md bg-gray-50/50">
                <Virtuoso
                  style={{ height: '600px' }} // 列表高度
                  totalCount={rows.length}    // 告诉它有多少行数据
                  data={rows}
                  // 渲染每一行
                  itemContent={(index, rowChapters) => (
                    <div className="px-1 pb-2 h-[60px]"> {/* 固定行高容器 */}
                      <div className="grid grid-cols-3 gap-3 h-full">
                        {rowChapters.map((chapter) => (
                          <Link
                            key={chapter.id}
                            href={`/read/${book.id}?chapterId=${chapter.id}`}
                            className="group flex items-center p-2 bg-gray-50 hover:bg-blue-50 rounded border border-transparent hover:border-blue-200 transition-all text-sm h-full"
                          >
                            <span className="text-gray-700 font-medium truncate group-hover:text-blue-600 w-full">
                              {chapter.title.trim().startsWith('第') 
                                ? chapter.title 
                                : `第${chapter.chapter_number}章 ${chapter.title}`}
                            </span>
                          </Link>
                        ))}
                        {/* 占位符，防止最后一行缺元素导致对不齐 */}
                        {[...Array(COLUMN_COUNT - rowChapters.length)].map((_, i) => (
                          <div key={`empty-${i}`} className="invisible" />
                        ))}
                      </div>
                    </div>
                  )}
                />
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}