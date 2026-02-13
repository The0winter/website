'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { booksApi, Book } from '@/lib/api';
import { 
  Trophy, Flame, Calendar, Clock, Sparkles, 
  LayoutGrid, Loader2, BookOpen, Crown, Medal, Star, Eye 
} from 'lucide-react';

// --- 1. 榜单配置 ---
const RANK_TYPES = [
  { id: 'month', name: '月榜', icon: Calendar, desc: '近30天阅读热度', color: 'text-pink-600', bg: 'bg-pink-50' },
  { id: 'week', name: '周榜', icon: Flame, desc: '本周读者都在看', color: 'text-red-600', bg: 'bg-red-50' },
  { id: 'day', name: '日榜', icon: Clock, desc: '今日实时上升', color: 'text-blue-600', bg: 'bg-blue-50' },
  { id: 'rec', name: '综合榜', icon: Sparkles, desc: '口碑与热度双高', color: 'text-purple-600', bg: 'bg-purple-50' },
  { id: 'total', name: '总榜', icon: Crown, desc: '全站历史最强', color: 'text-yellow-600', bg: 'bg-yellow-50' },
];

const CATEGORIES = [
  { name: '全部分类', slug: 'all' },
  { name: '玄幻', slug: 'fantasy' },
  { name: '仙侠', slug: 'wuxia' },
  { name: '都市', slug: 'urban' },
  { name: '历史', slug: 'history' },
  { name: '科幻', slug: 'sci-fi' },
  { name: '奇幻', slug: 'magic' },
  { name: '悬疑', slug: 'mystery' },
];

// 数字格式化函数
const formatViews = (num: number) => {
  if (!num) return '0';
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
  return Math.round(num).toString();
};

export default function RankingPage() {
  const [allBooks, setAllBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  
  // --- 状态管理 ---
  const [activeRank, setActiveRank] = useState('month'); 
  const [activeCategory, setActiveCategory] = useState('all');

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const data = await booksApi.getAll();
        setAllBooks(data);
      } catch (error) {
        console.error('Fetch error:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const displayBooks = useMemo(() => {
    let filtered = allBooks;
    
    if (activeCategory !== 'all') {
        const targetCatName = CATEGORIES.find(c => c.slug === activeCategory)?.name;
        if (targetCatName && targetCatName !== '全部分类') {
             filtered = allBooks.filter(b => b.category === targetCatName);
        }
    }

    return [...filtered].sort((a, b) => {
      const getVal = (obj: Book, key: string) => (obj as any)[key] || 0;
      const getRating = (obj: Book) => (obj as any).rating || 0;
      
      switch (activeRank) {
        case 'month': return getVal(b, 'monthly_views') - getVal(a, 'monthly_views');
        case 'week': return getVal(b, 'weekly_views') - getVal(a, 'weekly_views');
        case 'day': return getVal(b, 'daily_views') - getVal(a, 'daily_views');
        case 'rec':
          const scoreA = (getVal(a, 'weekly_views') * 0.4) + (getRating(a) * 100 * 0.6);
          const scoreB = (getVal(b, 'weekly_views') * 0.4) + (getRating(b) * 100 * 0.6);
          return scoreB - scoreA;
        case 'total':
        default: return (b.views || 0) - (a.views || 0);
      }
    });
  }, [allBooks, activeRank, activeCategory]);

  const currentRankInfo = RANK_TYPES.find(r => r.id === activeRank);

  return (
    <div className="min-h-screen bg-[#f4f5f7] md:py-6 pb-12">
      <div className="max-w-[1200px] mx-auto md:px-4 flex flex-col md:flex-row gap-4 md:gap-6">
        
        {/* === 🔥🔥🔥 移动端专属：顶部吸顶榜单导航 === */}
        <div className="md:hidden sticky top-0 z-30 bg-white border-b border-gray-100 shadow-[0_2px_10px_-5px_rgba(0,0,0,0.05)]">
            <div className="flex items-center overflow-x-auto no-scrollbar px-2 py-2 gap-1">
                {RANK_TYPES.map((rank) => {
                    const isActive = activeRank === rank.id;
                    const Icon = rank.icon;
                    return (
                        <button
                            key={rank.id}
                            onClick={() => setActiveRank(rank.id)}
                            className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap border
                                ${isActive 
                                    ? `${rank.bg} ${rank.color} border-transparent` 
                                    : 'text-gray-500 bg-transparent border-transparent'}`}
                        >
                            <Icon className={`w-3.5 h-3.5 ${isActive ? 'fill-current' : ''}`} />
                            {rank.name}
                            {isActive && <div className="w-1.5 h-1.5 rounded-full bg-current ml-1" />}
                        </button>
                    );
                })}
            </div>
        </div>

        {/* === PC端左侧导航 (保持原样，移动端隐藏) === */}
        <aside className="hidden md:flex w-[240px] flex-shrink-0 flex-col gap-4">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sticky top-4">
            <h2 className="text-lg font-black text-gray-800 mb-4 px-2 flex items-center gap-2">
               <Crown className="w-5 h-5 text-yellow-500" /> 
               排行榜
            </h2>
            <div className="flex flex-col space-y-1">
              {RANK_TYPES.map((rank) => {
                const Icon = rank.icon;
                const isActive = activeRank === rank.id;
                return (
                  <button
                    key={rank.id}
                    onClick={() => setActiveRank(rank.id)}
                    className={`group relative flex items-center gap-3 px-4 py-3.5 rounded-lg text-sm font-medium transition-all duration-200 
                      ${isActive 
                        ? `${rank.bg} ${rank.color} shadow-sm` 
                        : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
                      }`}
                  >
                    <Icon className={`w-5 h-5 ${isActive ? 'scale-110' : 'text-gray-400 group-hover:text-gray-600'} transition-transform`} />
                    <span>{rank.name}</span>
                    {isActive && (
                      <div className={`absolute right-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-l-full bg-current opacity-20`} />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        {/* === 右侧主要内容区域 === */}
        <main className="flex-1 flex flex-col gap-4 min-w-0">
          {/* 头部标题与分类筛选 */}
          <div className="bg-white md:rounded-xl shadow-sm border-b md:border border-gray-100 p-4 md:p-5">
            <div className="flex items-center justify-between mb-4">
                <div>
                    <h1 className="text-lg md:text-2xl font-black text-gray-900 flex items-center gap-2">
                        {currentRankInfo?.name}
                        <span className="text-[10px] md:text-xs font-normal text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                            {currentRankInfo?.desc}
                        </span>
                    </h1>
                </div>
                <div className="text-[10px] md:text-xs text-gray-400">
                    共 {displayBooks.length} 本
                </div>
            </div>

            {/* 分类筛选 (移动端横向滚动) */}
            <div className="flex overflow-x-auto no-scrollbar gap-2 pb-1 md:pb-0 md:flex-wrap">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.slug}
                  onClick={() => setActiveCategory(cat.slug)}
                  className={`flex-shrink-0 px-3 py-1.5 md:px-4 rounded-full text-[10px] md:text-xs font-bold transition-all border whitespace-nowrap
                    ${activeCategory === cat.slug 
                      ? 'bg-gray-900 text-white border-gray-900 shadow-md' 
                      : 'bg-gray-50 text-gray-500 border-gray-100 hover:bg-gray-100'
                    }`}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          </div>

          {/* 书籍列表区域 */}
          <div className="bg-white md:rounded-xl shadow-sm border border-gray-100 overflow-hidden min-h-[600px]">
            {loading ? (
                <div className="flex flex-col items-center justify-center h-60 gap-3 text-gray-400">
                    <Loader2 className="animate-spin w-8 h-8 text-blue-500" />
                    <p>正在计算榜单数据...</p>
                </div>
            ) : displayBooks.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-80 text-gray-400">
                    <BookOpen className="w-12 h-12 mb-2 text-gray-200" />
                    <p>该分类下暂无上榜作品</p>
                </div>
            ) : (
                <div className="divide-y divide-gray-100">
                    {displayBooks.map((book, index) => {
                        const rank = index + 1;
                        const isTop1 = rank === 1;
                        const isTop2 = rank === 2;
                        const isTop3 = rank === 3;
                        const isTop3Book = rank <= 3;
                        
                        // 计算显示热度
                        const rawScore = activeRank === 'rec' 
                           ? (((book as any).weekly_views || 0) * 0.4 + ((book as any).rating || 0) * 100 * 0.6) 
                           : ((book as any)[activeRank === 'total' ? 'views' : `${activeRank}_views`] || 0);
                        
                        const displayScore = formatViews(rawScore);

                        return (
                            <div key={book.id} className="group flex p-3 md:p-5 gap-3 md:gap-5 hover:bg-gray-50 transition-colors relative items-start md:items-center">
                                
                                {/* 排名数字：移动端紧凑布局 */}
                                <div className="w-8 md:w-12 flex-shrink-0 flex flex-col items-center pt-1 md:pt-0">
                                    {isTop1 && <Medal className="w-6 h-6 md:w-8 md:h-8 mb-1 text-yellow-500 fill-yellow-100" />}
                                    {isTop2 && <Medal className="w-6 h-6 md:w-8 md:h-8 mb-1 text-gray-400 fill-gray-100" />}
                                    {isTop3 && <Medal className="w-6 h-6 md:w-8 md:h-8 mb-1 text-orange-600 fill-orange-100" />}
                                    
                                    <span className={`font-black italic font-mono leading-none
                                        ${isTop1 ? 'text-yellow-600 text-xl md:text-3xl' : ''}
                                        ${isTop2 ? 'text-gray-500 text-lg md:text-2xl' : ''}
                                        ${isTop3 ? 'text-orange-500 text-lg md:text-2xl' : ''}
                                        ${rank > 3 ? 'text-gray-400 text-base md:text-xl' : ''}
                                    `}>
                                        {rank}
                                    </span>
                                </div>

                                {/* 书封：移动端缩小尺寸 */}
                                <Link href={`/book/${book.id}`} className="relative flex-shrink-0 w-[70px] h-[98px] md:w-24 md:h-32 shadow-sm rounded overflow-hidden border border-gray-100 bg-gray-100">
                                     {book.cover_image ? (
                                         <img src={book.cover_image} alt={book.title} className="w-full h-full object-cover" />
                                     ) : (
                                         <div className="w-full h-full flex items-center justify-center text-gray-300 transform scale-75"><BookOpen /></div>
                                     )}
                                     {isTop3Book && (
                                         <div className="absolute top-0 left-0 bg-red-600 text-white text-[8px] md:text-[10px] px-1.5 py-0.5 font-bold rounded-br-md shadow-sm z-10">
                                            HOT
                                         </div>
                                     )}
                                </Link>

                                {/* 信息区域：移动端优化布局 */}
                                <div className="flex-1 min-w-0 flex flex-col gap-1 md:gap-2 pt-0.5">
                                    <div className="flex items-start justify-between gap-2">
                                        <Link href={`/book/${book.id}`} className="text-base md:text-xl font-bold text-gray-900 line-clamp-2 md:line-clamp-1 leading-tight">
                                            {book.title}
                                        </Link>
                                        
                                        {/* 评分显示 */}
                                        {(book as any).rating > 0 && (
                                            <div className="flex-shrink-0 flex items-center gap-1 bg-yellow-50 px-1.5 py-0.5 rounded text-[10px] md:text-xs font-bold text-yellow-700">
                                                <Star className="w-3 h-3 fill-yellow-500 text-yellow-500" />
                                                {(book as any).rating.toFixed(1)}
                                            </div>
                                        )}
                                    </div>

                                    <p className="text-xs md:text-sm text-gray-500 line-clamp-2 leading-relaxed h-[32px] md:h-auto">
                                        {book.description || '暂无简介...'}
                                    </p>
                                    
                                    <div className="flex items-center justify-between mt-auto md:mt-1">
                                        <div className="flex items-center gap-2 text-[10px] md:text-xs text-gray-400">
                                            <span className="bg-gray-100 px-1.5 py-0.5 rounded text-gray-500">
                                                {book.category || '综合'}
                                            </span>
                                            <span className="hidden md:inline w-px h-3 bg-gray-300"></span>
                                            <span className="truncate max-w-[80px]">
                                                {book.author || book.profiles?.username || '佚名'}
                                            </span>
                                        </div>

                                        <span className="flex items-center gap-1 text-[10px] md:text-xs text-red-500 font-medium bg-red-50 px-2 py-0.5 rounded-full">
                                            <Flame className="w-3 h-3" />
                                            {displayScore}
                                        </span>
                                    </div>
                                </div>

                                {/* PC端阅读按钮 (移动端隐藏) */}
                                <div className="hidden md:block pl-4 border-l border-gray-100 ml-2 self-center">
                                  <Link 
                                        href={`/book/${book.id}`}
                                        className="px-5 py-2 bg-white text-gray-900 text-sm font-bold border border-gray-200 rounded-full hover:bg-gray-900 hover:text-white hover:border-gray-900 transition-all shadow-sm whitespace-nowrap"
                                    >
                                        立即阅读
                                  </Link>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}