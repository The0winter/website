'use client';
import {LoadingLogo, LoadingText} from './BrandLoading';
import BookCover from '@/components/BookCover';
import UserAvatar from './UserAvatar';
import { safeFetch as fetch, type CatalogPage } from '@/lib/request';


import { useState, useEffect, useMemo, useRef, useSyncExternalStore, useId } from 'react';
import Link from './PrefetchLink';
import HomeLink from 'next/link';
import Image from 'next/image';
import ReadingEntryLink from './ReadingEntryLink';
import RecordBookVisit from './RecordBookVisit';
import BookCatalogSheet from './BookCatalogSheet';
import {BookMilestoneEntry, BookMilestoneSheet, useBookMilestones, type MilestoneData} from './BookMilestones';
import {useBookCatalog} from '@/lib/useBookCatalog';
import {formatChapterTitle} from '@/lib/catalog-title';
import {formatRating, ratingLabel} from '@/lib/rating';
import {useReviewReactions} from '@/lib/useReviewReactions';
import {beginChapterEntry} from '@/lib/chapter-entry';
import {lastReadChapter, serverLastReadChapter, subscribeReadingSession} from '@/lib/reading-session';
import {openBookCatalog, closeBookCatalog, bookCatalogOpen, serverCatalogClosed, subscribeBookNavigation} from '@/lib/book-navigation';
import { useRouter } from 'next/navigation';
import { BookOpen, Bookmark, BookmarkCheck, Loader2, Star, Heart, HeartCrack, X, ChevronRight, ChevronDown, ChevronUp, PenLine, ChevronLeft } from 'lucide-react';
import BookArticles from './BookArticles';
import './book-detail.css';
import { useAuth } from '@/contexts/AuthContext';

// --- 组件：星星显示 ---
const StarRating = ({ rating, size = 5, interactive = false, onRate }: { rating: number, size?: number, interactive?: boolean, onRate?: (r: number) => void }) => {
  const [hoverRating, setHoverRating] = useState(0);

  return (
    <div className={`flex shrink-0 ${size === 4 ? 'book-review-stars' : 'space-x-1'}`} role={interactive ? 'group' : 'img'} aria-label={interactive ? '选择评分，最低 2 分，最高 10 分' : ratingLabel(rating)} onMouseLeave={() => interactive && setHoverRating(0)}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          role={interactive ? 'button' : undefined}
          aria-label={interactive ? `${star * 2} 分（${star} 星）` : undefined}
          aria-pressed={interactive ? rating === star : undefined}
          aria-hidden={!interactive || undefined}
          tabIndex={interactive ? 0 : undefined}
          onKeyDown={(event) => {if(interactive && (event.key==='Enter'||event.key===' ')){event.preventDefault();onRate?.(star);}}}
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
  writeVersion?: number;
  id: string;
  title: string;
  description: string;
  cover_image?: string;
  author_profile_id?: string;
  author_id?: string | {_id?:string;id?:string;username?:string} | null; 
  author?: string;
  status?: string;
  category?: string;
  rating?: number;       
  numReviews?: number;   
  numRatings?: number;
  ratingSummary?: {readerCount: number; baselineCount: number};
  statisticsSeed?: {rating: number; ratingWeight: number; ratingSample?: {votes: number[]}};
  lastUpdated?: string; 
  views?: number;
}

interface Chapter {
  word_count?: number;
  id: string;
  title: string;
  chapter_number: number;
  published_at?: string;
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
  initialBookData: {
    book: Book;
    chapters: Chapter[];
    summary: { totalWords: number | null; updatedLabel: string };
  };
  initialCatalog?: CatalogPage<Chapter>;
  initialFirstChapterId?: string;
  initialMilestones: MilestoneData | null;
}

function ReviewEditor({review, submitting, onSubmit}: {review: Review | null; submitting: boolean; onSubmit: (rating: number, content: string) => Promise<void>}) {
  // Mount only when the personal review is ready, so a late response cannot overwrite a draft.
  const [rating, setRating] = useState(review?.rating || 0);
  const [content, setContent] = useState(review?.content || '');
  return <form onSubmit={event => {event.preventDefault(); void onSubmit(rating, content);}}>
    <div className="flex flex-wrap items-center gap-2 mb-4">
      <span className="text-sm font-bold text-gray-700">评价:</span>
      <div className="flex items-center space-x-2"><StarRating rating={rating} interactive onRate={setRating} size={6}/></div>
    </div>
    <label className="block text-sm text-gray-500 mb-2" htmlFor="book-review-content">短评（选填，可以只提交评分）</label>
    <textarea id="book-review-content" value={content} onChange={event => setContent(event.target.value)} placeholder="写下你的短评..."
      className="w-full p-3 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:outline-none min-h-[120px] bg-white placeholder-gray-500 text-gray-900 text-sm" maxLength={4000}/>
    <div className="mt-3 flex justify-end">
      <button type="submit" disabled={submitting || !rating} className="bg-green-600 text-white px-6 py-2 rounded text-sm hover:bg-green-700 disabled:opacity-50 transition-colors">
        {submitting ? '保存中...' : content.trim() ? '发表评论' : '提交评分'}
      </button>
    </div>
  </form>;
}

function BookDescription({description}: {description: string}) {
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const text = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    const element = text.current;
    if (!element) return;
    let active = true, frame = 0;
    const measure = () => {
      if (!active || !element.clientWidth) return;
      // Compare to the collapsed four-line height even while expanded.
      const lineHeight = parseFloat(getComputedStyle(element).lineHeight);
      setOverflowing(element.scrollHeight > lineHeight * 4 + 1);
    };
    const schedule = () => {cancelAnimationFrame(frame); frame = requestAnimationFrame(measure);};
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    void document.fonts.ready.then(schedule);
    schedule();
    return () => {active = false; observer.disconnect(); cancelAnimationFrame(frame);};
  }, [description]);
  return <div className="relative">
    <div ref={text} id={id} className={`book-description text-gray-600 leading-relaxed text-sm whitespace-pre-wrap ${!expanded ? 'line-clamp-4' : ''}`}>{description || '暂无简介'}</div>
    {overflowing && <button aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(!expanded)} className="flex w-full mt-1.5 items-center justify-center text-blue-500 bg-blue-50/50 rounded py-1 text-xs font-medium active:bg-blue-100 transition-colors">
      {expanded ? <><ChevronUp className="w-3 h-3 mr-1"/> 收起简介</> : <><ChevronDown className="w-3 h-3 mr-1"/> 展开简介</>}
    </button>}
  </div>;
}

export default function BookDetailClient({ initialBookData, initialCatalog, initialFirstChapterId, initialMilestones }: BookDetailClientProps) {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [bookData,setBookData] = useState(initialBookData);
  const book = bookData.book;
  const recentChapterId = useSyncExternalStore(subscribeReadingSession, () => lastReadChapter(book.id), serverLastReadChapter);
  
  const [isBookmarked, setIsBookmarked] = useState(false);
  const milestones = useBookMilestones(book.id, initialMilestones);
  const [loading, setLoading] = useState(false);

  // 🔥 目录交互状态
  const showAllChapters = useSyncExternalStore(subscribeBookNavigation, () => bookCatalogOpen(book.id), serverCatalogClosed);
  const setShowAllChapters = (open: boolean) => open ? openBookCatalog(book.id) : closeBookCatalog();

  const catalog = useBookCatalog(book.id, book.writeVersion, recentChapterId ?? undefined, showAllChapters, initialCatalog);
  const chapterTotal = catalog.snapshot.total;
  const loadingChapters = chapterTotal === null;
  const chapterError = catalog.snapshot.error;
  const chapters = useMemo(() => [...catalog.snapshot.rows.values()].sort((a, b) => a.chapter_number - b.chapter_number), [catalog.snapshot.rows]);
  const firstChapterId = catalog.snapshot.rows.get(0)?.id ?? initialFirstChapterId ?? null;
  useEffect(() => {
    if (!firstChapterId && chapterTotal) catalog.ensureRange(0, 0);
  }, [firstChapterId, chapterTotal, catalog.ensureRange]);

  const [communityTab, setCommunityTab] = useState<'reviews' | 'articles'>('reviews');

  // --- 评论相关状态 ---
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewPage,setReviewPage]=useState(1);
  const [reviewTotal,setReviewTotal]=useState(book.numReviews ?? 0);
  const [reviewRefresh,setReviewRefresh]=useState(0);
  const [reviewResult,setReviewResult]=useState<{key:string;error:string}|null>(null);
  const [personalResult,setPersonalResult]=useState<{key:string;review:Review|null;error:string}|null>(null);
  const userId = user?.id || user?._id || '';
  const reviewKey = `${book.id}/${reviewPage}/${reviewRefresh}`;
  const personalKey = `${book.id}/${userId}/${reviewRefresh}`;
  const reviewsLoading = reviewResult?.key !== reviewKey;
  const reviewError = reviewsLoading ? '' : reviewResult.error;
  const personalLoading = Boolean(userId) && personalResult?.key !== personalKey;
  const personalError = userId && personalResult?.key === personalKey ? personalResult.error : '';
  const myReview = userId && personalResult?.key === personalKey ? personalResult.review : null;
  const [submittingReview, setSubmittingReview] = useState(false);
  const [showReviewForm, setShowReviewForm] = useState(false);
  useEffect(() => {
    if (showReviewForm && !authLoading && !userId) router.push('/login');
  }, [showReviewForm, authLoading, userId, router]);

  // --- 初始化逻辑 ---
  useEffect(() => {


    const userId = user?.id || user?._id;

    if (userId && book.id) {
      const checkBookmarkStatus = async () => {
        try {
          const res = await fetch(`/api/users/${userId}/bookmarks/${book.id}/check`);
          if (res.ok) {
            setIsBookmarked((await res.json()).isBookmarked);
          }
        } catch (error) {
          console.error('检查书架失败:', error);
        }
      };
      checkBookmarkStatus();
    }

  }, [user, book.id]);

  // 页面预览显示的章节 (电脑端显示30章，手机端显示8章)
  const previewChapters = useMemo(() => {
    // The detail preview keeps recent updates while the full catalog reads forward.
    return bookData.chapters.length ? bookData.chapters : chapters.slice(-30).reverse();
  }, [bookData.chapters, chapters]);

  useEffect(()=>{
    const controller=new AbortController();
    async function load(){
      try{
        const response=await fetch(`/api/books/${book.id}/reviews?page=${reviewPage}&limit=20`,{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
        if(!response.ok)throw new Error('评论加载失败，请重试');
        const rows:Review[]=await response.json();
        if(!controller.signal.aborted){
          const distribution:Record<string,number>=JSON.parse(response.headers.get('X-Review-Distribution')||'{}');
          const total=Number(response.headers.get('X-Total-Count'));
          const savedRating=response.headers.get('X-Book-Rating');
          const summary=JSON.parse(response.headers.get('X-Rating-Summary') || 'null') as Book['ratingSummary'] | null;
          const ratings=Object.values(distribution).reduce((sum,count)=>sum+count,0);
          const rating=savedRating!==null&&Number.isFinite(Number(savedRating))?Number(savedRating):ratings?Object.entries(distribution).reduce((sum,[score,count])=>sum+Number(score)*count,0)/ratings:0;
          setReviews(rows);setReviewTotal(total);setReviewResult({key:reviewKey,error:''});
          setBookData(previous=>({...previous,book:{...previous.book,rating,ratingSummary:summary || undefined,numRatings:summary?.readerCount ?? total,numReviews:total}}));
        }
      }catch{if(!controller.signal.aborted)setReviewResult({key:reviewKey,error:'评论加载失败，请重试'});}
    }
    void load();return()=>controller.abort();
  },[book.id,reviewPage,reviewKey]);
  // Public comments do not wait for sign-in or the reader's own review.
  useEffect(()=>{
    if(!userId)return;
    const controller=new AbortController();
    async function load(){
      try{
        const response=await fetch(`/api/books/${book.id}/reviews/mine`,{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
        if(!response.ok)throw new Error('个人书评读取失败');
        const review:Review|null=await response.json();
        if(!controller.signal.aborted)setPersonalResult({key:personalKey,review,error:''});
      }catch{if(!controller.signal.aborted)setPersonalResult({key:personalKey,review:null,error:'个人书评读取失败，请重试'});}
    }
    void load();return()=>controller.abort();
  },[book.id,userId,personalKey]);
  // --- 逻辑：评论排序 ---
  const sortedReviews = useMemo(() => {
    if (!myReview?.content?.trim()) return reviews;
    const others = reviews.filter(r => r._id !== myReview._id);
    return [myReview, ...others];
  }, [reviews, myReview]);
  const feedback = useReviewReactions(book.id, sortedReviews.map(review => review._id).join(','), user?.id || user?._id || '');

  // --- 操作：收藏 ---
  const handleToggleBookmark = async () => {
    if (!user) {
      router.push('/login');
      return;
    }
    if (loading) return; 

    const userId = user.id || user._id;
    setLoading(true);
    try {
      if (isBookmarked) {
        const res = await fetch(`/api/users/${userId}/bookmarks/${book.id}`, { method: 'DELETE' });
        if (res.ok) {setIsBookmarked(false); milestones.retry();}
      } else {
        const res = await fetch(`/api/users/${userId}/bookmarks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bookId: book.id })
        });
        if (res.ok) {setIsBookmarked(true); milestones.retry();}
      }
    } catch (error) {
      console.error('操作失败:', error);
    } finally {
      setLoading(false);
    }
  };

  // --- 操作：评论相关 ---
  const openReviewForm = () => {
    if (!authLoading && !user) return router.push('/login');
    setCommunityTab('reviews');
    setShowReviewForm(true);
    requestAnimationFrame(() => document.getElementById('reviews-section')?.scrollIntoView({block:'start',behavior:'smooth'}));
  };

  const handleSubmitReview = async (myRating: number, myContent: string) => {
    if (!user) return router.push('/login');
    if (submittingReview || myRating < 1 || myRating > 5) return;

    setSubmittingReview(true);
    
    try {
      const res = await fetch(`/api/books/${book.id}/reviews`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',},
        body: JSON.stringify({ rating: myRating, content: myContent })
      });

      const data = await res.json();
      
      if (!res.ok) {
        alert(data.error || data.message || '评分保存失败');
      } else {
        setReviewRefresh(value=>value+1);
        setShowReviewForm(false); 
        alert(myContent.trim() ? '评价发布成功！' : '评分已保存');
      }
    } catch (error) {
      console.error(error);
      alert('网络错误');
    } finally {
      setSubmittingReview(false);
    }
  };

  // --- 显示辅助 ---
  const { totalWords, updatedLabel } = bookData.summary;
  const wordCount = totalWords === null ? null : totalWords > 10000 ? `${(totalWords / 10000).toFixed(2)}万字` : `${totalWords}字`;
  const getCategoryDisplay = (category?: string) => {
    if (!category) return '';
    const parts = category.split('>');
    return parts[parts.length - 1].trim();
  };
  const categoryDisplay = getCategoryDisplay(book.category);
  const statusText = ['completed', '完结', '已完结'].includes(book.status || '') ? '已完结' : '连载中';
  const catalogProgress = chapterTotal === null && loadingChapters
    ? '目录加载中'
    : `${statusText === '已完结' ? '全' : '连载至'}${chapterTotal ?? chapters.length}章`;
  const getAuthorName = () => {
    if (typeof book.author_id === 'object' && book.author_id?.username) return book.author_id.username;
    return book.author || '未知作者';
  };
  const getAuthorId = () => {
     if (book.author_profile_id) return book.author_profile_id;
     if (typeof book.author_id === 'object') return book.author_id?.id || book.author_id?._id;
     return book.author_id;
  };
  const displayRating = formatRating(book.rating);
  const baselineRatingCount = book.ratingSummary?.baselineCount ?? book.statisticsSeed?.ratingSample?.votes.length ?? book.statisticsSeed?.ratingWeight ?? 0;
  const ratingOrigin = baselineRatingCount ? '基础评分为初始化样本，不代表真实读者；书友评分按实际提交人数计算。' : '评分来自读者实际提交，每人每书计一次。';
  const compactCount = new Intl.NumberFormat('zh-CN', {notation: 'compact', maximumFractionDigits: 1});
  const mobileWordCount = totalWords === null ? null : Math.floor(totalWords >= 10000 ? totalWords / 10000 : totalWords);
  const mobileWordUnit = totalWords !== null && totalWords >= 10000 ? '万字' : '字';
  const liveViews = milestones.data?.counts.views ?? book.views ?? 0;
  const viewParts = compactCount.formatToParts(liveViews);
  const viewCount = viewParts.filter(part => part.type !== 'compact').map(part => part.value).join('');
  const viewUnit = viewParts.find(part => part.type === 'compact')?.value;

  return (
    // 修改1：增加手机端底部 padding (pb-24)，防止被常驻底栏遮挡内容
    <div data-book-id={book.id} className="book-detail min-h-screen bg-gray-50 pb-24 md:pb-12">
      <RecordBookVisit bookId={book.id}/>
      <div className="hidden md:block h-[20px]"></div>

      {/* ⚠️ 修改2：将 space-y 替换为 flex flex-col 和 gap，以便利用 order 属性实现手机端模块换位 */}
      <div className="book-layout max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 md:py-8 flex flex-col gap-3 md:gap-6">
        
        {/* === 第一部分：书籍核心信息 === */}
        <div className="book-hero bg-white rounded-lg shadow-sm p-4 md:p-8 order-1">
            <div className="book-hero-main flex flex-row gap-4 md:gap-8">
              <nav className="book-home-actions" aria-label="详情页导航">
                <HomeLink href="/" prefetch={false} aria-label="返回精选"><ChevronLeft size={24} strokeWidth={1.8} aria-hidden="true"/></HomeLink>
                <HomeLink href="/" prefetch={false} aria-label="精选主页">
                  <Image src="/icon.png" alt="九天小说" width={20} height={20} sizes="20px" loading="eager" className="book-home-logo"/>
                </HomeLink>
              </nav>
              {/* 左侧封面 */}
              <div className="book-hero-cover flex-shrink-0">
                {book.cover_image ? (
                  <BookCover priority sizes="(min-width: 768px) 192px, 96px" src={book.cover_image} alt={book.title || '小说封面'} className="w-24 h-32 md:w-48 md:h-64 object-cover rounded shadow-md" />
                ) : (
                  <div className="w-24 h-32 md:w-48 md:h-64 bg-gradient-to-br from-blue-500 to-blue-700 rounded shadow-md flex items-center justify-center">
                    <BookOpen className="h-8 w-8 md:h-16 md:w-16 text-white" />
                  </div>
                )}
              </div>

              {/* 右侧信息 */}
              <div className="book-hero-info flex-1 flex flex-col justify-between md:justify-start">
                 {/* 书名 */}
                 <div className="flex items-start justify-between mb-1 md:mb-4">
                     <h1 className="text-lg md:text-3xl font-bold text-gray-900 line-clamp-2">{book.title}</h1>
                 </div>

                 {/* 信息列表 */}
                 <div className="book-meta flex flex-col space-y-1 md:space-y-2 mb-2 md:mb-8 text-xs md:text-sm text-gray-600">
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
                     <div className="hidden md:flex items-center">
                        <span className="text-gray-500 w-12 md:w-16">状态:</span>
                        <span className="text-gray-900">{statusText}{wordCount !== null && ` | ${wordCount}`}</span>
                     </div>
                     <div className="hidden">
                        <span className="text-gray-500 w-12">更新:</span>
                        <span className="text-gray-900">{updatedLabel}</span>
                     </div>
                     
                     {/* 电脑端才显示的额外信息 */}
                     <div className="hidden md:flex items-center">
                        <span className="text-gray-500 w-16">阅读量:</span>
                        <span className="text-gray-900 font-medium">{liveViews.toLocaleString('zh-CN')}</span>
                     </div>
                     <div className="hidden md:flex items-center">
                        <span className="text-gray-500 w-16">更新时间:</span>
                        <span className="text-gray-900">{updatedLabel}</span>
                     </div>
                 </div>

                 {/* 电脑端的大按钮组 (手机端已移除，改为常驻底栏) */}
                 <div className="hidden md:flex flex-wrap gap-4 mt-auto">
                    {firstChapterId ? (
                        <ReadingEntryLink bookId={book.id} firstChapterId={firstChapterId}
                          className="bg-blue-600 text-white px-8 py-3 rounded-md hover:bg-blue-700 font-semibold transition-colors shadow-sm" />
                    ) : (
                        <button disabled className="bg-gray-400 text-white px-8 py-3 rounded-md cursor-not-allowed font-semibold">{loadingChapters || chapters.length > 0 ? '加载首章…' : '暂无章节'}</button>
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

              {/* 电脑端评分栏 */}
              <div className="hidden md:block w-[280px] border-l border-gray-100 pl-6 pt-2">
                 <div className="flex items-end space-x-2 mb-2">
                    <span className="text-gray-500 text-xs">{baselineRatingCount ? '综合评分' : '书友评分'}</span>
                 </div>
                 <div className="book-desktop-rating flex items-center gap-2 mb-2" aria-label={`${baselineRatingCount ? '综合评分' : '书友评分'}：${ratingLabel(book.rating)}`}>
                    <Star className="w-6 h-6 fill-yellow-400 text-yellow-400 shrink-0" aria-hidden="true" />
                    <strong className={`book-rating-score font-bold text-gray-900 ${book.rating ? 'text-4xl' : 'text-lg'}`}>{displayRating}</strong>
                 </div>
                 <div className="mt-4 pt-4 border-t border-gray-100 text-right">
                     <span className="text-xs text-gray-400">{baselineRatingCount ? '基础评分与书友评分综合' : '评分来自真实用户'}</span>
                 </div>
                 <div className="book-desktop-milestone"><BookMilestoneEntry bookId={book.id} state={milestones}/></div>
              </div>
              <span className="book-hero-backdrop" aria-hidden="true"><BookCover src={book.cover_image} alt="" sizes="(min-width: 768px) 480px, 240px" loading="eager"/></span>
            </div>

            {/* 手机端统计与简介卡片 */}
            <div className="book-intro md:hidden mt-4 pt-3 border-t border-gray-100">
              <div className="book-mobile-overview">
                <BookMilestoneEntry bookId={book.id} state={milestones}/>
                <dl className="book-mobile-stats" aria-label="作品数据">
                  <div>
                    <dt>字数</dt>
                    <dd className="book-stat-count">{mobileWordCount === null ? '暂无统计' : <><span className="book-stat-value">{mobileWordCount}</span><small>{mobileWordUnit}</small></>}</dd>
                  </div>
                  <div>
                    <dt>浏览量</dt>
                    <dd className="book-stat-count"><span className="book-stat-value">{viewCount}</span>{viewUnit && <small>{viewUnit}</small>}</dd>
                  </div>
                  <div>
                    <dt>{baselineRatingCount ? '综合评分' : '评分'}</dt>
                    <dd className="book-mobile-rating" data-rated={displayRating !== '暂无评分'} title={ratingOrigin} aria-label={`${baselineRatingCount ? '综合评分' : '书友评分'}：${ratingLabel(book.rating)}`}>
                      <Star size={15} aria-hidden="true" />
                      <strong className="book-stat-value">{displayRating}</strong>
                    </dd>
                  </div>
                </dl>
              </div>
                <BookDescription description={book.description}/>
            </div>
        </div>

        <BookMilestoneSheet title={book.title} state={milestones}/>
        {/* === 第二部分：作品简介 (⚠️ 设为 hidden md:block 仅电脑端独立一栏显示，电脑端排在第2) === */}
        <div className="hidden md:block bg-white rounded-lg shadow-sm p-4 md:p-8 order-2">
          <div className="flex justify-between items-center mb-2 md:mb-4">
               <h2 className="text-base md:text-xl font-bold text-gray-900 border-l-4 border-blue-600 pl-3">作品简介</h2>
          </div>
          <div className="text-gray-700 leading-6 text-sm whitespace-pre-wrap">
              {book.description || '暂无简介'}
          </div>
        </div>

        {/* === 第三部分：书友评价区 (⚠️ 利用 order-3 md:order-4 在手机端提到目录前面，电脑端仍为第4) === */}
        <div id="reviews-section" className="book-community bg-white rounded-lg shadow-sm p-4 md:p-8 order-4">
            <div className="book-community-header">
            <div className="community-tabs" role="tablist" aria-label="书友交流">
              <button id="reviews-tab" role="tab" aria-selected={communityTab === 'reviews'} aria-controls="reviews-panel" onClick={() => setCommunityTab('reviews')}>评论 <small>{reviewTotal}</small></button>
              <button id="articles-tab" role="tab" aria-selected={communityTab === 'articles'} aria-controls="articles-panel" onClick={() => setCommunityTab('articles')}>文章</button>
            </div>
            {communityTab === 'reviews' && !showReviewForm && <button className="book-review-compose" onClick={openReviewForm}>写书评</button>}
            {communityTab === 'articles' && <Link className="book-article-compose" href={`/forum/create?type=article&bookId=${book.id}&bookTitle=${encodeURIComponent(book.title)}`}><PenLine size={14} aria-hidden="true"/>写文章</Link>}
            </div>
            {communityTab === 'articles' && <div id="articles-panel" role="tabpanel" aria-labelledby="articles-tab"><BookArticles bookId={book.id} /></div>}
            <div id="reviews-panel" role="tabpanel" aria-labelledby="reviews-tab" aria-busy={reviewsLoading} hidden={communityTab !== 'reviews'}>
            
            {/* 评论表单 */}
            {showReviewForm && (
                <div className="mb-8 p-4 md:p-6 bg-gray-50 rounded-lg border border-blue-100 shadow-inner animation-fade-in relative">
                    <button aria-label="关闭书评" onClick={() => setShowReviewForm(false)} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"><X className="w-5 h-5"/></button>
                    {authLoading || personalLoading || !userId ? <p className="book-review-loading" role="status"><LoadingText>正在准备书评</LoadingText></p>
                      : personalError ? null : <ReviewEditor key={userId} review={myReview} submitting={submittingReview} onSubmit={handleSubmitReview}/>}
                </div>
            )}

            {reviewError&&<p className="book-review-error" role="alert">{reviewError} <button onClick={()=>setReviewRefresh(value=>value+1)}>重试</button></p>}
            {personalError&&<p className="book-review-error" role="alert">{personalError} <button onClick={()=>setReviewRefresh(value=>value+1)}>重试</button></p>}
            {feedback.error && <p className="book-review-error" role="alert">{feedback.error} <button onClick={feedback.retry}>重试</button></p>}
            <nav hidden={reviewTotal <= 20} aria-label="评价分页" className="flex gap-4 justify-center my-4"><button disabled={reviewsLoading || reviewPage===1} onClick={()=>setReviewPage(reviewPage-1)}>上一页</button><span>第 {reviewPage} 页</span><button disabled={reviewsLoading || reviewPage*20>=reviewTotal} onClick={()=>setReviewPage(reviewPage+1)}>下一页</button></nav>
            {/* 评论列表 */}
            <div className="book-review-list">
                {reviewsLoading ? <p className="book-review-loading" role="status"><LoadingText>正在加载评论</LoadingText></p> : reviewError ? null : sortedReviews.length === 0 ? (
                    <div className="text-gray-500 text-sm text-center py-4">还没有文字评论，可以先评分，也可以写下读后感。</div>
                ) : (
                    sortedReviews.map((review) => {
                        const userId = user?.id || user?._id;
                        const isMyReview = userId && (review.user._id === userId || review.user.id === userId);
                        if (isMyReview && showReviewForm) return null;

                        return (
                            <article key={review._id} className="book-review">
                                <div className="book-review-row">
                                    <div className="book-review-avatar-wrap">
                                        <UserAvatar user={review.user || {username:'书友'}} className="book-review-avatar"/>
                                    </div>
                                    <div className="book-review-body flex-1">
                                        <div className="book-review-heading">
                                            <span className="book-review-name" title={review.user?.username || '书友'}>
                                                {review.user?.username || '书友'} {isMyReview && '(我)'}
                                            </span>
                                            <div className="book-review-meta">
                                            <StarRating rating={review.rating} size={4} />
                                            </div>
                                        </div>
                                        <p className="book-review-content">{review.content}</p>
                                        <footer className="book-review-footer">
                                            <time dateTime={review.createdAt} title={review.createdAt.slice(0, 10)}>{review.createdAt.slice(0, 4) === String(new Date().getFullYear()) ? review.createdAt.slice(5, 10) : review.createdAt.slice(0, 10)}</time>
                                            <div className="book-review-reactions" role="group" aria-label="评论反馈">
                                                {(['like', 'dislike'] as const).map(choice => {
                                                    const label = choice === 'like' ? '喜欢' : '不喜欢';
                                                    const row = feedback.rows[review._id];
                                                    const count = (choice === 'like' ? row?.likes : row?.dislikes) || 0;
                                                    const active = row?.reaction === choice;
                                                    const Icon = choice === 'like' ? Heart : HeartCrack;
                                                    return <button key={choice} type="button" aria-label={`${label}，${count} 人`} title={active ? `取消${label}` : label}
                                                        aria-pressed={active} disabled={feedback.busy(review._id) || (!!user && !row)}
                                                        onClick={() => {if (!user) router.push('/login'); else void feedback.react(review._id, active ? null : choice);}}>
                                                        <Icon size={18} aria-hidden="true"/>
                                                        {count > 0 && <span aria-hidden="true">{new Intl.NumberFormat('zh-CN', {notation:'compact', maximumFractionDigits:1}).format(count)}</span>}
                                                    </button>;
                                                })}
                                            </div>
                                        </footer>
                                    </div>
                                </div>
                            </article>
                        );
                    })
                )}
            </div>
            </div>
        </div>

        {/* === 第四部分：目录 (⚠️ 利用 order-4 md:order-3 在手机端沉底，电脑端仍为第3) === */}
        <div role="region" aria-label="章节目录" aria-busy={loadingChapters} className="book-catalog bg-white rounded-lg shadow-sm order-3">
          <button className="mobile-catalog md:hidden" onClick={() => setShowAllChapters(true)}>
            <strong>目录</strong>
            <span>{catalogProgress} · {updatedLabel}</span>
            <ChevronRight size={18}/>
          </button>
          <div className="hidden md:block p-4 md:p-8">
            <div className="flex justify-between items-center mb-3 md:mb-6">
                <h2 className="text-base md:text-xl font-bold text-gray-900 flex items-center space-x-2 border-l-4 border-blue-600 pl-3">
                    <span>目录</span>
                    <span className="text-xs md:text-sm font-normal text-gray-500 ml-2">{['completed', '完结', '已完结'].includes(book.status || '') ? '已完结' : '连载中'} · 共{chapterTotal ?? chapters.length}章</span>
                </h2>
            </div>

            {chapterError && <p role="alert" className="mb-3 text-sm text-red-600">{chapterError} <button onClick={catalog.retry} className="underline">重试</button></p>}
            {loadingChapters && chapters.length === 0 ? (
               <div className="py-6 md:py-10 text-center text-gray-500 flex flex-col items-center">
                  <LoadingLogo className="mb-2"/>
                  <p className="text-xs md:text-sm"><LoadingText>加载目录</LoadingText></p>
               </div>
            ) : chapters.length === 0 ? (
              !chapterError && <p className="text-gray-600 text-sm">暂无章节</p>
            ) : (
              <div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 md:gap-3">
                    {previewChapters.map((chapter, index) => (
                        <Link
                            key={chapter.id}
                            href={`/book/${book.id}/${chapter.id}`}
                            prefetchMode="intent"
                            aria-current={chapter.id === recentChapterId ? 'location' : undefined}
                            aria-description={chapter.id === recentChapterId ? '上次读到' : undefined}
                            onNavigate={() => beginChapterEntry(`/book/${book.id}/${chapter.id}`, formatChapterTitle(chapter.title, chapter.chapter_number))}
                            className={`group items-center p-2 bg-gray-50 hover:bg-blue-50 rounded border border-transparent hover:border-blue-200 transition-all text-xs md:text-sm ${index >= 8 ? 'hidden md:flex' : 'flex'}`}
                        >
                            <span className="text-gray-700 truncate group-hover:text-blue-600 w-full">
                                {formatChapterTitle(chapter.title, chapter.chapter_number)}
                            </span>
                        </Link>
                    ))}
                </div>
                <div className="mt-4 md:mt-6 text-center">
                    <button 
                        onClick={() => setShowAllChapters(true)}
                        className="w-full md:w-auto bg-gray-100 md:bg-gray-100 text-gray-700 md:px-12 py-3 rounded-lg md:rounded-full hover:bg-gray-200 transition-colors font-medium text-sm flex items-center justify-center mx-auto space-x-2"
                    >
                        <span>查看完整目录 ({chapterTotal ?? chapters.length}章)</span>
                        <ChevronRight className="w-4 h-4" />
                    </button>
                </div>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* === 🔥 新增：移动端常驻悬浮底栏 === */}
      <div 
        className="book-actions md:hidden fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-gray-100 z-40 shadow-[0_-8px_20px_rgba(0,0,0,0.06)]"
        // 兼容 iOS 底部安全区
        style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))', paddingTop: '0.75rem', paddingLeft: '1rem', paddingRight: '1rem' }}
      >
        <div className="flex gap-3 max-w-md mx-auto h-11">
            <button 
                onClick={handleToggleBookmark}
                className={`flex-1 flex items-center justify-center space-x-1.5 rounded-full text-sm font-bold transition-all active:scale-95 ${
                    isBookmarked 
                    ? 'bg-gray-100 text-gray-500 border border-gray-200' 
                    : 'bg-blue-50 text-blue-600 border border-blue-200'
                }`}
            >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : isBookmarked ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
                <span>{isBookmarked ? '已在书架' : '加入书架'}</span>
            </button>
            
            {firstChapterId ? (
                <ReadingEntryLink
                    bookId={book.id} firstChapterId={firstChapterId} label="立即阅读"
                    icon={<BookOpen className="w-4 h-4" />}
                    className="read-now flex-[1.2] flex items-center justify-center rounded-full text-sm font-bold text-white"
                />
            ) : (
                <button disabled className="flex-[1.2] flex items-center justify-center space-x-1.5 rounded-full text-sm font-bold text-white shadow-md bg-gray-400 cursor-not-allowed">
                    {loadingChapters || chapters.length > 0 ? '加载首章…' : '暂无章节'}
                </button>
            )}
        </div>
      </div>

      <BookCatalogSheet open={showAllChapters} onClose={closeBookCatalog} bookId={book.id} bookTitle={book.title}
        activeChapterId={recentChapterId ?? undefined} activeChapterLabel="上次读到"
        catalog={catalog.snapshot} onRange={catalog.ensureRange}
        onRetry={catalog.retry}/>


    </div>
  );
}
