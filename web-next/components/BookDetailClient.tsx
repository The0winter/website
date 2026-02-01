'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
// 👇 新增 Star 图标
import { BookOpen, List, Bookmark, BookmarkCheck, Loader2, Star, User as UserIcon } from 'lucide-react';
import { booksApi } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { Virtuoso } from 'react-virtuoso';

// 简单的星星显示组件
const StarRating = ({ rating, size = 5 }: { rating: number, size?: number }) => {
  return (
    <div className="flex space-x-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={`${size === 4 ? 'w-4 h-4' : 'w-5 h-5'} ${
            star <= Math.round(rating) ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'
          }`}
        />
      ))}
    </div>
  );
};

interface Book {
  id: string;
  title: string;
  description: string;
  cover_image: string;
  author_id: any; 
  author?: string;
  status: string;
  category: string;
  rating?: number;       // 新增
  numReviews?: number;   // 新增
}

interface Chapter {
  id: string;
  title: string;
  chapter_number: number;
  published_at: string;
  content?: string;
}

interface Review {
  _id: string;
  rating: number;
  content: string;
  user: {
    _id: string;
    username: string;
    avatar?: string;
  };
  createdAt: string;
}

interface BookDetailClientProps {
  book: Book;
  chapters: Chapter[];
}

export default function BookDetailClient({ book: initialBook, chapters }: BookDetailClientProps) {
  const { user, token } = useAuth(); // 获取 token 用于请求
  const router = useRouter();
  
  // 使用本地 state 存储 book，因为评分后 rating 会变
  const [book, setBook] = useState(initialBook);
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [loading, setLoading] = useState(false);

  // --- 评论相关状态 ---
  const [reviews, setReviews] = useState<Review[]>([]);
  const [myRating, setMyRating] = useState(5);
  const [myContent, setMyContent] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  // --- 初始化与逻辑 ---
  useEffect(() => {
    // 1. 增加阅读数
    if (book.id) {
        booksApi.incrementViews(book.id).catch(console.error);
    }

    // 2. 检查收藏状态
    if (user && book.id) {
      const checkBookmarkStatus = async () => {
        try {
          const res = await fetch(`https://website-production-6edf.up.railway.app/api/users/${user.id}/bookmarks`);
          if (res.ok) {
            const bookmarks = await res.json();
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

    // 3. 🔥 获取评论列表
    const fetchReviews = async () => {
      try {
        const res = await fetch(`https://website-production-6edf.up.railway.app/api/books/${book.id}/reviews`);
        if (res.ok) {
          const data = await res.json();
          setReviews(data);
          
          if (user) {
            // 注意：后端返回的 review.user 是对象，里面有 _id
            const myReview = data.find((r: any) => r.user._id === user.id || r.user.id === user.id);
            if (myReview) {
              setMyRating(myReview.rating); // 回显星星
              setMyContent(myReview.content); // 回显内容
              setIsEditing(true); // 标记为修改模式
            }
          }

        }
      } catch (e) {
        console.error("获取评论失败", e);
      }
    };
    if (book.id) fetchReviews();

  }, [user, book.id]);

  // --- 核心修复：点击收藏/取消 ---
  const handleToggleBookmark = async () => {
    if (!user) {
      router.push('/login');
      return;
    }
    if (loading) return; 

    setLoading(true);
    try {
      if (isBookmarked) {
        const res = await fetch(`https://website-production-6edf.up.railway.app/api/users/${user.id}/bookmarks/${book.id}`, {
            method: 'DELETE'
        });
        if (res.ok) setIsBookmarked(false);
      } else {
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

  // --- 🔥 提交评论 ---
  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return router.push('/login');
    if (submittingReview) return;

    setSubmittingReview(true);
    try {
      const res = await fetch(`https://website-production-6edf.up.railway.app/api/books/${book.id}/reviews`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id // 假设你需要带 token
        },
        body: JSON.stringify({ rating: myRating, content: myContent })
      });

      const data = await res.json();
      
      if (!res.ok) {
        alert(data.message || '评论失败');
      } else {
        // 评论成功：
        // 1. 把新评论加到列表顶部
        setReviews([data, ...reviews]);
        // 2. 清空输入框
        setMyContent('');
        // 3. 更新界面上的平均分 (可选，简单做个估算或者重新 fetch book)
        alert('评论发布成功！');
      }
    } catch (error) {
      console.error(error);
      alert('网络错误');
    } finally {
      setSubmittingReview(false);
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

  const COLUMN_COUNT = 3;
  const rows = useMemo(() => {
    const result = [];
    for (let i = 0; i < chapters.length; i += COLUMN_COUNT) {
      result.push(chapters.slice(i, i + COLUMN_COUNT));
    }
    return result;
  }, [chapters]);

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
                <div className="flex justify-between items-start">
                    <h1 className="text-3xl font-bold text-gray-900 mb-3">{book.title}</h1>
                    {/* 🔥 头部评分展示 */}
                    <div className="text-right">
                        <div className="flex items-center space-x-1 justify-end">
                            <span className="text-2xl font-bold text-yellow-500">{book.rating || '0.0'}</span>
                            <span className="text-xs text-gray-400">分</span>
                        </div>
                        <div className="text-xs text-gray-400">{book.numReviews || 0} 人评价</div>
                    </div>
                </div>
  
               <div className="mb-4">
                  <Link href={`/author/${getAuthorId()}`} className="text-gray-600 hover:text-blue-600 font-medium text-lg">
                    {getAuthorName()}
                  </Link>
                </div>
        
                <div className="flex flex-wrap items-center gap-6 mb-8 text-sm text-gray-600">
                  <div className="flex flex-col"><span className="text-gray-400 text-xs mb-1">状态</span><span className="text-gray-900 font-medium">{statusText}</span></div>
                  {categoryDisplay && <div className="flex flex-col"><span className="text-gray-400 text-xs mb-1">分类</span><span className="text-gray-900 font-medium">{categoryDisplay}</span></div>}
                  <div className="flex flex-col"><span className="text-gray-400 text-xs mb-1">总字数</span><span className="text-blue-600 font-bold">{wordCount}</span></div>
                  {/* 🔥 显示星星 */}
                  <div className="flex flex-col">
                    <span className="text-gray-400 text-xs mb-1">评分</span>
                    <StarRating rating={book.rating || 0} />
                  </div>
                </div>

                <div className="flex flex-wrap gap-4 mt-auto">
                  {chapters.length > 0 ? (
                    <Link href={`/read/${book.id}`} className="bg-blue-600 text-white px-8 py-3 rounded-md hover:bg-blue-700 font-semibold transition-colors shadow-sm">开始阅读</Link>
                  ) : (
                    <button disabled className="bg-gray-400 text-white px-8 py-3 rounded-md cursor-not-allowed font-semibold">暂无章节</button>
                  )}
    
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

        {/* === 🔥 第三部分：书友评价区 (Douban Style) === */}
        <div className="bg-white rounded-lg shadow-sm p-6 md:p-8">
            <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center space-x-2 border-l-4 border-blue-600 pl-3">
                <span>书友评价 ({reviews.length})</span>
            </h2>

            {/* 评价输入框 */}
            <div className="mb-8 p-4 bg-gray-50 rounded-lg border border-gray-100">
                {!user ? (
                    <div className="text-center py-4">
                        <p className="text-gray-500 mb-2">登录后可以发表评价</p>
                        <Link href="/login" className="text-blue-600 font-medium hover:underline">去登录</Link>
                    </div>
                ) : (
                    <form onSubmit={handleSubmitReview}>
                        <div className="flex items-center space-x-4 mb-3">
                            <span className="text-sm font-medium text-gray-700">点击打分:</span>
                            <div className="flex space-x-1 cursor-pointer">
                                {[1, 2, 3, 4, 5].map((star) => (
                                    <Star 
                                        key={star} 
                                        className={`w-6 h-6 hover:scale-110 transition-transform ${star <= myRating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'}`}
                                        onClick={() => setMyRating(star)}
                                    />
                                ))}
                            </div>
                            <span className="text-sm text-gray-500 ml-2">{myRating} 分</span>
                        </div>
                        <textarea
                            value={myContent}
                            onChange={(e) => setMyContent(e.target.value)}
                            placeholder="写下你的短评..."
                            className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:outline-none min-h-[80px]"
                            required
                        />
                        <div className="mt-3 flex justify-end">
                            <button 
                                type="submit" 
                                disabled={submittingReview}
                                className="..."
                            >
                                {submittingReview ? '提交中...' : (isEditing ? '修改评价' : '发布评价')}
                            </button>
                        </div>
                    </form>
                )}
            </div>

            {/* 评论列表 */}
            <div className="space-y-6">
                {reviews.length === 0 ? (
                    <p className="text-gray-500 text-center py-4">还没有人评价，快来抢沙发！</p>
                ) : (
                    reviews.map((review) => (
                        <div key={review._id} className="border-b border-gray-100 pb-6 last:border-0 last:pb-0">
                            <div className="flex items-start space-x-3">
                                {/* 头像 */}
                                <div className="flex-shrink-0">
                                    {review.user?.avatar ? (
                                        <img src={review.user.avatar} alt={review.user.username} className="w-10 h-10 rounded-full object-cover" />
                                    ) : (
                                        <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center">
                                            <UserIcon className="w-6 h-6 text-gray-500" />
                                        </div>
                                    )}
                                </div>
                                <div className="flex-1">
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="font-medium text-gray-900">{review.user?.username || '书友'}</span>
                                        <span className="text-xs text-gray-400">{new Date(review.createdAt).toLocaleDateString()}</span>
                                    </div>
                                    <div className="flex items-center mb-2">
                                        <StarRating rating={review.rating} size={4} />
                                    </div>
                                    <p className="text-gray-700 text-sm leading-relaxed">{review.content}</p>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>

        {/* = 第四部分：目录 (保持 Virtuoso) = */}
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
                               {chapter.title.trim().startsWith('第') ? chapter.title : `第${chapter.chapter_number}章 ${chapter.title}`}
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