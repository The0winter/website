'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BookOpen, List, Bookmark, BookmarkCheck, Loader2, Star, User as UserIcon, Pencil, X, ArrowUpDown, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react';
import { booksApi } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { Virtuoso } from 'react-virtuoso';

// --- 组件：星星显示 ---
const StarRating = ({ rating, size = 5, interactive = false, onRate }: { rating: number, size?: number, interactive?: boolean, onRate?: (r: number) => void }) => {
  const [hoverRating, setHoverRating] = useState(0);

  return (
    <div className="flex space-x-1" onMouseLeave={() => interactive && setHoverRating(0)}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          onClick={() => interactive && onRate && onRate(star)}
          onMouseEnter={() => interactive && setHoverRating(star)}
          className={`
            ${size === 4 ? 'w-3 h-3' : size === 6 ? 'w-5 h-5' : 'w-4 h-4'} 
            ${interactive ? 'cursor-pointer transition-transform hover:scale-110' : ''}
            ${star <= (hoverRating || Math.round(rating)) ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'}
          `}
        />
      ))}
    </div>
  );
};

// --- 类型定义 ---
interface Book {
  id: string;
  title: string;
  description: string;
  cover_image: string;
  author_id: any; 
  author?: string;
  status: string;
  category: string;
  rating?: number;       
  numReviews?: number;   
  lastUpdated?: string; 
  views?: number;
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
    id?: string;
    username: string;
    avatar?: string;
  };
  createdAt: string;
}

interface BookDetailClientProps {
  book: Book;
  initialChapters?: Chapter[]; 
}

export default function BookDetailClient({ book: initialBook, initialChapters = [] }: BookDetailClientProps) {
  const { user } = useAuth(); 
  const router = useRouter();
  
  const [book, setBook] = useState(initialBook);
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [loading, setLoading] = useState(false);

  // --- 章节相关状态 ---
  const [chapters, setChapters] = useState<Chapter[]>([]); 
  const [loadingChapters, setLoadingChapters] = useState(true);
  
  // 🔥 目录交互状态
  const [isReversed, setIsReversed] = useState(true); // 默认倒序 (最新章节在前)
  const [showAllChapters, setShowAllChapters] = useState(false); // 是否显示全部章节弹窗

  // 🔥 简介展开状态 (新增)
  const [isDescExpanded, setIsDescExpanded] = useState(false);

  // --- 评论相关状态 ---
  const [reviews, setReviews] = useState<Review[]>([]);
  const [myRating, setMyRating] = useState(0);
  const [myContent, setMyContent] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [showReviewForm, setShowReviewForm] = useState(false);

  // --- 初始化逻辑 ---
  useEffect(() => {
    if (book.id) {
        booksApi.incrementViews(book.id).catch(console.error);
    }

    const userId = (user as any)?.id || (user as any)?._id;

    if (userId && book.id) {
      const checkBookmarkStatus = async () => {
        try {
          const res = await fetch(`https://jiutianxiaoshuo.com/api/users/${userId}/bookmarks`);
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

    const fetchReviews = async () => {
      try {
        const res = await fetch(`https://jiutianxiaoshuo.com/api/books/${book.id}/reviews`);
        if (res.ok) {
          const data = await res.json();
          setReviews(data);
        }
      } catch (e) {
        console.error("获取评论失败", e);
      }
    };

    const fetchChapters = async () => {
      try {
        setLoadingChapters(true);
        const res = await fetch(`https://jiutianxiaoshuo.com/api/books/${book.id}/chapters`);
        if (res.ok) {
            const data = await res.json();
            setChapters(data);
        }
      } catch (err) {
        console.error("获取章节失败", err);
      } finally {
        setLoadingChapters(false);
      }
    };

    if (book.id) {
      fetchReviews();
      fetchChapters(); 
    }

  }, [user, book.id]);

  // --- 逻辑：章节排序与切片 ---
  const sortedChapters = useMemo(() => {
    let list = [...chapters];
    list.sort((a, b) => a.chapter_number - b.chapter_number);
    return isReversed ? list.reverse() : list;
  }, [chapters, isReversed]);

  // 页面预览显示的章节 (电脑端显示30章，手机端显示8章)
  const previewChapters = useMemo(() => {
    return sortedChapters.slice(0, 30);
  }, [sortedChapters]);

  // 弹窗内虚拟列表需要的行数据 (3列布局)
  const modalRows = useMemo(() => {
    const result = [];
    const COLUMN_COUNT = 3; 
    for (let i = 0; i < sortedChapters.length; i += COLUMN_COUNT) {
      result.push(sortedChapters.slice(i, i + COLUMN_COUNT));
    }
    return result;
  }, [sortedChapters]);


  // --- 逻辑：计算评分分布 ---
  const ratingDistribution = useMemo(() => {
    const counts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    const total = reviews.length;
    if (total === 0) return { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };

    reviews.forEach(r => {
        const rInt = Math.round(r.rating);
        if (rInt >= 1 && rInt <= 5) {
            counts[rInt as 1|2|3|4|5]++;
        }
    });

    return {
        5: (counts[5] / total) * 100,
        4: (counts[4] / total) * 100,
        3: (counts[3] / total) * 100,
        2: (counts[2] / total) * 100,
        1: (counts[1] / total) * 100,
    };
  }, [reviews]);

  // --- 逻辑：计算“我的评论” ---
  const myReview = useMemo(() => {
    if (!user || reviews.length === 0) return null;
    const userId = (user as any).id || (user as any)._id;
    return reviews.find(r => r.user._id === userId || r.user.id === userId);
  }, [reviews, user]);

  // --- 逻辑：评论排序 ---
  const sortedReviews = useMemo(() => {
    if (!myReview) return reviews;
    const others = reviews.filter(r => r._id !== myReview._id);
    return [myReview, ...others];
  }, [reviews, myReview]);

  // --- 操作：收藏 ---
  const handleToggleBookmark = async () => {
    if (!user) {
      router.push('/login');
      return;
    }
    if (loading) return; 

    const userId = (user as any).id || (user as any)._id;
    setLoading(true);
    try {
      if (isBookmarked) {
        const res = await fetch(`https://jiutianxiaoshuo.com/api/users/${userId}/bookmarks/${book.id}`, { method: 'DELETE' });
        if (res.ok) setIsBookmarked(false);
      } else {
        const res = await fetch(`https://jiutianxiaoshuo.com/api/users/${userId}/bookmarks`, {
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

  // --- 操作：评论相关 ---
  const handleEditClick = () => {
    if (myReview) {
        setMyRating(myReview.rating);
        setMyContent(myReview.content);
        setShowReviewForm(true);
    }
  };

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return router.push('/login');
    if (submittingReview) return;

    const userId = (user as any).id || (user as any)._id;
    setSubmittingReview(true);
    
    try {
      const res = await fetch(`https://jiutianxiaoshuo.com/api/books/${book.id}/reviews`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId 
        },
        body: JSON.stringify({ rating: myRating, content: myContent })
      });

      const data = await res.json();
      
      if (!res.ok) {
        alert(data.message || '评论失败');
      } else {
        const otherReviews = reviews.filter(r => {
             const rUserId = r.user._id || r.user.id;
             return rUserId !== userId;
        });
        setReviews([data, ...otherReviews]);
        setShowReviewForm(false); 
        alert('评价发布成功！');
      }
    } catch (error) {
      console.error(error);
      alert('网络错误');
    } finally {
      setSubmittingReview(false);
    }
  };

  // --- 显示辅助 ---
  const totalWords = chapters.reduce((sum, chapter) => sum + (chapter.content?.length || 0), 0);
  const wordCount = totalWords > 10000 ? `${(totalWords / 10000).toFixed(2)}万字` : `${totalWords}字`;
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
  const displayRating = book.rating ? (book.rating * 2).toFixed(1) : '0.0';

  return (
    <div className="min-h-screen bg-gray-50 pb-12">
      <div className="h-[10px] md:h-[20px]"></div> 

      {/* ⚠️ 移动端：减少边距 padding (px-3 py-4) */}
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 md:py-8 space-y-3 md:space-y-6">
        
        {/* === 第一部分：书籍核心信息 (响应式重构) === */}
        <div className="bg-white rounded-lg shadow-sm p-4 md:p-8">
            <div className="flex flex-row gap-4 md:gap-8">
              
              {/* 左侧封面：手机端 w-24, 电脑端 w-48 */}
              <div className="flex-shrink-0">
                {book.cover_image ? (
                  <img src={book.cover_image} alt={book.title} className="w-24 h-32 md:w-48 md:h-64 object-cover rounded shadow-md" />
                ) : (
                  <div className="w-24 h-32 md:w-48 md:h-64 bg-gradient-to-br from-blue-500 to-blue-700 rounded shadow-md flex items-center justify-center">
                    <BookOpen className="h-8 w-8 md:h-16 md:w-16 text-white" />
                  </div>
                )}
              </div>

              {/* 右侧信息 */}
              <div className="flex-1 flex flex-col justify-between md:justify-start">
                 {/* 标题：手机端 sm, 电脑端 3xl */}
                 <h1 className="text-lg md:text-3xl font-bold text-gray-900 mb-1 md:mb-4 line-clamp-2">{book.title}</h1>

                 {/* 信息列表：手机端 xs, 电脑端 sm */}
                 <div className="flex flex-col space-y-1 md:space-y-2 mb-2 md:mb-8 text-xs md:text-sm text-gray-600">
                     <div className="flex items-center">
                        <span className="text-gray-500 w-12 md:w-16">作者:</span>
                        <Link href={`/author/${getAuthorId()}`} className="text-blue-600 hover:text-blue-800 font-medium md:text-base">
                            {getAuthorName()}
                        </Link>
                     </div>
                     <div className="flex items-center">
                        <span className="text-gray-500 w-12 md:w-16">分类:</span>
                        <span className="text-gray-900">{categoryDisplay || '综合'}</span>
                     </div>
                     <div className="flex items-center">
                        <span className="text-gray-500 w-12 md:w-16">状态:</span>
                        <span className="text-gray-900">{statusText} | {wordCount}</span>
                     </div>
                     <div className="flex items-center md:hidden">
                        <span className="text-gray-500 w-12">更新:</span>
                        <span className="text-gray-900">{book.lastUpdated ? new Date(book.lastUpdated).toLocaleDateString() : '近期'}</span>
                     </div>
                     
                     {/* 电脑端才显示的额外信息 */}
                     <div className="hidden md:flex items-center">
                        <span className="text-gray-500 w-16">阅读量:</span>
                        <span className="text-gray-900 font-medium">{(book.views || 0).toLocaleString()}</span>
                     </div>
                     <div className="hidden md:flex items-center">
                        <span className="text-gray-500 w-16">更新时间:</span>
                        <span className="text-gray-900">{book.lastUpdated ? new Date(book.lastUpdated).toLocaleDateString() : '近期'}</span>
                     </div>
                 </div>

                 {/* 电脑端的大按钮组 (手机端隐藏) */}
                 <div className="hidden md:flex flex-wrap gap-4 mt-auto">
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
                        {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : isBookmarked ? <BookmarkCheck className="h-5 w-5" /> : <Bookmark className="h-5 w-5" />}
                        <span>{isBookmarked ? '已在书架' : '加入书架'}</span>
                    </button>
                </div>
              </div>

              {/* 电脑端评分栏 (手机端隐藏) */}
              <div className="hidden md:block w-[280px] border-l border-gray-100 pl-6 pt-2">
                 <div className="flex items-end space-x-2 mb-2">
                    <span className="text-gray-500 text-xs">书友评分</span>
                 </div>
                 <div className="flex items-center space-x-3 mb-3">
                    <strong className="text-4xl font-bold text-gray-900">{displayRating}</strong>
                    <div className="flex flex-col">
                        <StarRating rating={book.rating || 0} size={6} />
                        <span className="text-xs text-blue-600 mt-1 hover:underline cursor-pointer">{book.numReviews || 0} 人评价</span>
                    </div>
                 </div>
                 {/* 评分条省略... */}
                 <div className="mt-4 pt-4 border-t border-gray-100 text-right">
                     <span className="text-xs text-gray-400">评分来自真实用户</span>
                 </div>
              </div>
            </div>

            {/* 🔥 手机端按钮组 (移到封面下方) */}
            <div className="flex md:hidden gap-3 mt-4">
                 <Link 
                    href={chapters.length > 0 ? `/read/${book.id}` : '#'} 
                    className={`flex-1 py-2.5 rounded text-center text-sm font-bold text-white shadow-sm ${chapters.length > 0 ? 'bg-blue-600' : 'bg-gray-400'}`}
                 >
                    开始阅读
                 </Link>
                 <button 
                    onClick={handleToggleBookmark}
                    className={`flex-1 py-2.5 rounded text-center text-sm font-bold border ${isBookmarked ? 'border-gray-300 bg-gray-100 text-gray-600' : 'border-blue-600 text-blue-600 bg-white'}`}
                 >
                    {isBookmarked ? '已在书架' : '加入书架'}
                 </button>
            </div>
        </div>

        {/* === 第二部分：作品简介 (支持折叠) === */}
        <div className="bg-white rounded-lg shadow-sm p-4 md:p-8">
          <div className="flex justify-between items-center mb-2 md:mb-4">
               <h2 className="text-base md:text-xl font-bold text-gray-900 border-l-4 border-blue-600 pl-3">作品简介</h2>
          </div>
          
          <div className="relative">
              {/* 电脑端不折叠 (md:line-clamp-none)，手机端根据状态折叠 */}
              <div className={`text-gray-700 leading-6 text-sm whitespace-pre-wrap ${!isDescExpanded ? 'line-clamp-3 md:line-clamp-none' : ''}`}>
                 {book.description || '暂无简介'}
              </div>
              
              {/* 手机端展开按钮 (md:hidden) */}
              <button 
                 onClick={() => setIsDescExpanded(!isDescExpanded)}
                 className="md:hidden w-full mt-2 pt-2 border-t border-gray-50 flex items-center justify-center text-gray-400 text-xs"
              >
                 {isDescExpanded ? (
                     <><ChevronUp className="w-3 h-3 mr-1"/> 收起</>
                 ) : (
                     <><ChevronDown className="w-3 h-3 mr-1"/> 展开更多</>
                 )}
              </button>
          </div>
        </div>

        {/* === 🔥 第三部分：目录 (新版：精简+弹窗) === */}
        <div className="bg-white rounded-lg shadow-sm">
          <div className="p-4 md:p-8">
            <div className="flex justify-between items-center mb-3 md:mb-6">
                <h2 className="text-base md:text-xl font-bold text-gray-900 flex items-center space-x-2 border-l-4 border-blue-600 pl-3">
                    <span>目录</span>
                    <span className="text-xs md:text-sm font-normal text-gray-500 ml-2">{book.status === 'completed' ? '已完结' : '连载中'} · 共{chapters.length}章</span>
                </h2>
                
                <button 
                    onClick={() => setIsReversed(!isReversed)} 
                    className="flex items-center space-x-1 text-xs md:text-sm text-gray-600 hover:text-blue-600 transition-colors"
                >
                    <ArrowUpDown className="w-3 h-3 md:w-4 md:h-4" />
                    <span>{isReversed ? '倒序' : '正序'}</span>
                </button>
            </div>

            {loadingChapters ? (
               <div className="py-6 md:py-10 text-center text-gray-500 flex flex-col items-center">
                  <Loader2 className="w-6 h-6 md:w-8 md:h-8 animate-spin mb-2 text-blue-500" />
                  <p className="text-xs md:text-sm">加载目录...</p>
               </div>
            ) : chapters.length === 0 ? (
              <p className="text-gray-600 text-sm">暂无章节</p>
            ) : (
              <div>
                {/* 1. 目录列表 (手机端隐藏第8章以后的，电脑端显示30章) */}
                {/* grid-cols-2 (手机双列) md:grid-cols-3 (电脑三列) */}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 md:gap-3">
                    {previewChapters.map((chapter, index) => (
                        <Link
                            key={chapter.id}
                            href={`/read/${book.id}?chapterId=${chapter.id}`}
                            // 🔥 核心逻辑：index >= 8 时，手机端隐藏 (hidden)，电脑端显示 (md:flex)
                            className={`group items-center p-2 bg-gray-50 hover:bg-blue-50 rounded border border-transparent hover:border-blue-200 transition-all text-xs md:text-sm 
                                ${index >= 8 ? 'hidden md:flex' : 'flex'}`}
                        >
                            <span className="text-gray-700 truncate group-hover:text-blue-600 w-full">
                                {chapter.title.trim().startsWith('第') ? chapter.title : `第${chapter.chapter_number}章 ${chapter.title}`}
                            </span>
                        </Link>
                    ))}
                </div>

                {/* 2. 底部“查看全部”按钮 (样式优化) */}
                <div className="mt-4 md:mt-6 text-center">
                    <button 
                        onClick={() => setShowAllChapters(true)}
                        className="w-full md:w-auto bg-gray-100 md:bg-gray-100 text-gray-700 md:px-12 py-3 rounded-lg md:rounded-full hover:bg-gray-200 transition-colors font-medium text-sm flex items-center justify-center mx-auto space-x-2"
                    >
                        <span>查看完整目录 ({chapters.length}章)</span>
                        <ChevronRight className="w-4 h-4" />
                    </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* === 第四部分：书友评价区 (保留原样，微调间距) === */}
        <div id="reviews-section" className="bg-white rounded-lg shadow-sm p-4 md:p-8">
            <div className="flex items-center justify-between mb-4 md:mb-6">
                <h2 className="text-base md:text-xl font-bold text-gray-900 flex items-center space-x-2 border-l-4 border-blue-600 pl-3">
                    <span>书友评价 ({reviews.length})</span>
                </h2>
                
                {!showReviewForm && !myReview && (
                     <button 
                        onClick={() => {
                            if (!user) router.push('/login');
                            else setShowReviewForm(true);
                        }}
                        className="text-xs md:text-sm text-blue-600 hover:bg-blue-50 px-3 py-1 rounded transition-colors border border-blue-600"
                     >
                        写书评
                     </button>
                )}
            </div>
            {/* ... 评论内容保持不变，复用已有逻辑 ... */}
             {/* B. 评论表单 */}
             {showReviewForm && (
                <div className="mb-8 p-4 md:p-6 bg-gray-50 rounded-lg border border-blue-100 shadow-inner animation-fade-in relative">
                    <button onClick={() => setShowReviewForm(false)} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"><X className="w-5 h-5"/></button>
                    <form onSubmit={handleSubmitReview}>
                        <div className="flex items-center space-x-2 mb-4">
                            <span className="text-sm font-bold text-gray-700">评价:</span>
                            <div className="flex items-center space-x-2">
                                <StarRating rating={myRating} interactive={true} onRate={setMyRating} size={6} />
                                <span className="text-sm text-yellow-600 font-medium ml-2">{myRating * 2} 分</span>
                            </div>
                        </div>
                        <textarea
                            value={myContent}
                            onChange={(e) => setMyContent(e.target.value)}
                            placeholder="写下你的短评..."
                            className="w-full p-3 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:outline-none min-h-[120px] bg-white placeholder-gray-500 text-gray-900 text-sm"
                            required
                        />
                        <div className="mt-3 flex justify-end">
                            <button 
                                type="submit" 
                                disabled={submittingReview}
                                className="bg-green-600 text-white px-6 py-2 rounded text-sm hover:bg-green-700 disabled:opacity-50 transition-colors"
                            >
                                {submittingReview ? '保存中...' : '发表评论'}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* C. 评论列表 */}
            <div className="space-y-6 md:space-y-8">
                {reviews.length === 0 ? (
                    <div className="text-gray-500 text-sm text-center py-4">还没有人评价，快来抢沙发！</div>
                ) : (
                    sortedReviews.map((review) => {
                        const userId = (user as any)?.id || (user as any)?._id;
                        const isMyReview = userId && (review.user._id === userId || review.user.id === userId);
                        if (isMyReview && showReviewForm) return null;

                        return (
                            <div key={review._id} className={`border-t border-gray-100 pt-4 ${isMyReview ? 'bg-blue-50/30 -mx-4 px-4 pb-4 rounded' : ''}`}>
                                <div className="flex items-start space-x-3">
                                    <div className="flex-shrink-0 pt-1">
                                        {review.user?.avatar ? (
                                            <img src={review.user.avatar} alt={review.user.username} className="w-8 h-8 rounded-sm object-cover" />
                                        ) : (
                                            <div className="w-8 h-8 rounded-sm bg-gray-200 flex items-center justify-center">
                                                <UserIcon className="w-5 h-5 text-gray-500" />
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex-1">
                                        <div className="flex items-center space-x-2 mb-1">
                                            <span className="text-blue-600 text-sm hover:bg-blue-600 hover:text-white px-1 rounded cursor-pointer transition-colors">
                                                {review.user?.username || '书友'} {isMyReview && '(我)'}
                                            </span>
                                            <StarRating rating={review.rating} size={4} />
                                            <span className="text-xs text-gray-400">
                                                {new Date(review.createdAt).toISOString().split('T')[0]}
                                            </span>
                                            
                                            {isMyReview && (
                                                <button 
                                                    onClick={handleEditClick}
                                                    className="ml-auto text-xs text-gray-400 hover:text-blue-600 flex items-center space-x-1"
                                                >
                                                    <Pencil className="w-3 h-3" /> <span>修改</span>
                                                </button>
                                            )}
                                        </div>
                                        <p className="text-gray-700 text-sm leading-relaxed">{review.content}</p>
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>

      </div>

      {/* === 🔥 全屏目录弹窗 (复用原有逻辑) === */}
      {showAllChapters && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 sm:p-6" onClick={() => setShowAllChapters(false)}>
            <div 
                className="bg-white w-full max-w-5xl h-[85vh] rounded-xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200"
                onClick={e => e.stopPropagation()} 
            >
                <div className="flex items-center justify-between p-4 md:p-5 border-b border-gray-100 bg-gray-50">
                    <div>
                        <h3 className="text-lg md:text-xl font-bold text-gray-900">全部目录</h3>
                        <p className="text-xs md:text-sm text-gray-500 mt-1">共 {chapters.length} 章</p>
                    </div>
                    <div className="flex items-center space-x-4">
                        <button 
                            onClick={() => setIsReversed(!isReversed)} 
                            className="flex items-center space-x-1 text-xs md:text-sm bg-white border px-3 py-1.5 rounded-md text-gray-700 hover:bg-gray-50 hover:border-blue-400 transition-colors"
                        >
                            <ArrowUpDown className="w-4 h-4" />
                            <span>{isReversed ? '倒序' : '正序'}</span>
                        </button>
                        <button 
                            onClick={() => setShowAllChapters(false)}
                            className="p-2 hover:bg-gray-200 rounded-full transition-colors text-gray-500 hover:text-gray-800"
                        >
                            <X className="w-6 h-6" />
                        </button>
                    </div>
                </div>

                <div className="flex-1 bg-white p-2">
                    <Virtuoso
                        style={{ height: '100%' }}
                        totalCount={modalRows.length}
                        data={modalRows}
                        itemContent={(index, rowChapters) => (
                            <div className="px-3 pb-3">
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                    {rowChapters.map((chapter) => (
                                        <Link
                                            key={chapter.id}
                                            href={`/read/${book.id}?chapterId=${chapter.id}`}
                                            className="group flex items-center p-3 bg-gray-50 hover:bg-blue-50 rounded border border-transparent hover:border-blue-200 transition-all text-sm"
                                        >
                                            <span className="text-gray-700 truncate group-hover:text-blue-600 w-full font-medium">
                                                {chapter.title.trim().startsWith('第') ? chapter.title : `第${chapter.chapter_number}章 ${chapter.title}`}
                                            </span>
                                        </Link>
                                    ))}
                                    {[...Array(3 - rowChapters.length)].map((_, i) => (
                                        <div key={`empty-${i}`} className="invisible" />
                                    ))}
                                </div>
                            </div>
                        )}
                    />
                </div>
            </div>
        </div>
      )}

    </div>
  );
}