'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BookOpen, List, Bookmark, BookmarkCheck, Loader2 } from 'lucide-react';
import { booksApi } from '@/lib/api'; 
import { useAuth } from '@/contexts/AuthContext';
// 👇 完美保留你的虚拟列表组件
import { Virtuoso } from 'react-virtuoso';

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
  
  // 状态管理
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [loading, setLoading] = useState(false); // 防止连点

  // --- 初始化与逻辑 ---
  useEffect(() => {
    // 1. 增加阅读数
    if (book.id) {
        booksApi.incrementViews(book.id).catch(console.error);
    }

    // 2. 检查收藏状态 (直接调用后端，不依赖 api.ts)
    if (user && book.id) {
      const checkBookmarkStatus = async () => {
        try {
          // 对应后端 index.txt 第 52 行
          const res = await fetch(`https://website-production-6edf.up.railway.app/api/users/${user.id}/bookmarks`);
          if (res.ok) {
            const bookmarks = await res.json();
            // 兼容性查找：有的 bookId 是对象，有的是字符串
            const exists = bookmarks.some((b: any) => {
                const bId = typeof b.bookId === 'object' ? b.bookId?._id : b.bookId;
                return bId === book.id;
            });
            setIsBookmarked(exists);
          }
        } catch (error) {
          console.error('检查书架失败:', error);
        }
      };
      checkBookmarkStatus();
    }
  }, [user, book.id]);

  // --- 核心修复：点击收藏/取消 ---
  const handleToggleBookmark = async () => {
    if (!user) {
      router.push('/login');
      return;
    }
    if (loading) return; // 防止重复点击

    setLoading(true);
    try {
      if (isBookmarked) {
        // 🔥 执行删除：对应后端 index.txt 第 54 行 DELETE 接口
        const res = await fetch(`https://website-production-6edf.up.railway.app/api/users/${user.id}/bookmarks/${book.id}`, {
            method: 'DELETE'
        });
        
        if (res.ok) {
            setIsBookmarked(false);
        } else {
            console.error('删除失败，服务器返回:', res.status);
            if (res.status === 404) alert('服务器还没更新！请先 push 后端代码。');
        }
      } else {
        // 🔥 执行添加：对应后端 index.txt 第 53 行 POST 接口
        const res = await fetch(`https://website-production-6edf.up.railway.app/api/users/${user.id}/bookmarks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bookId: book.id })
        });
        
        if (res.ok) setIsBookmarked(true);
      }
    } catch (error) {
      console.error('操作失败:', error);
    } finally {
      setLoading(false);
    }
  };

  // --- 数据显示处理 ---
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
    if (typeof book.author_id === 'object' && book.author_id?.username) return book.author_id.username;
    return book.author || '未知作者';
  };
  
  const getAuthorId = () => {
     if (typeof book.author_id === 'object') return book.author_id?.id || book.author_id?._id;
     return book.author_id;
  };

  // 👇 保留 Virtuoso 的数据处理
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
                  
                  {/* 🔥 修复后的按钮：绑定了 handleToggleBookmark */}
                  <button 
                    onClick={handleToggleBookmark} 
                    disabled={loading}
                    className={`flex items-center space-x-2 px-8 py-3 rounded-md font-semibold border transition-colors ${
                        isBookmarked 
                        ? 'bg-blue-50 border-blue-600 text-blue-600' 
                        : 'bg-white border-gray-300 text-gray-700 hover:border-blue-600'
                    }`}
                  >
                    {loading ? (
                        <Loader2 className="h-5 w-5 animate-spin" /> 
                    ) : isBookmarked ? (
                        <BookmarkCheck className="h-5 w-5" /> 
                    ) : (
                        <Bookmark className="h-5 w-5" />
                    )}
                    <span>
                        {loading ? '处理中...' : (isBookmarked ? '已在书架' : '加入书架')}
                    </span>
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

        {/* = 第三部分：目录 (保持 Virtuoso) = */}
        <div className="bg-white rounded-lg shadow-sm">
          <div className="p-6 md:p-8">
            <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center space-x-2 border-l-4 border-blue-600 pl-3">
              <List className="h-5 w-5" />
              <span>目录 ({chapters.length}章)</span>
            </h2>

            {chapters.length === 0 ? (
              <p className="text-gray-600">暂无章节</p>
            ) : (
              <div className="border rounded-md bg-gray-50/50">
                <Virtuoso
                  style={{ height: '600px' }} 
                  totalCount={rows.length}
                  data={rows}
                  itemContent={(index, rowChapters) => (
                    <div className="px-1 pb-2 h-[60px]">
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