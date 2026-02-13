'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { booksApi, Book } from '@/lib/api';
import { 
  Flame, Calendar, Clock, Sparkles, 
  Loader2, BookOpen, Crown 
} from 'lucide-react';

// --- 1. 榜单配置 (回归网页端原始设定) ---
// shortName 用于移动端左侧窄栏显示
const RANK_TYPES = [
  { id: 'month', name: '月榜', shortName: '月榜', icon: Calendar, desc: '近30天阅读热度' },
  { id: 'week', name: '周榜', shortName: '周榜', icon: Flame, desc: '本周读者都在看' },
  { id: 'day', name: '日榜', shortName: '日榜', icon: Clock, desc: '今日实时上升' },
  { id: 'rec', name: '综合榜', shortName: '综合榜', icon: Sparkles, desc: '口碑与热度双高' },
  { id: 'total', name: '总榜', shortName: '总榜', icon: Crown, desc: '全站历史最强' },
];

const CATEGORIES = [
  { name: '全部分类', slug: 'all' }, // 保持网页端一致
  { name: '玄幻', slug: 'fantasy' },
  { name: '仙侠', slug: 'wuxia' },
  { name: '都市', slug: 'urban' },
  { name: '历史', slug: 'history' },
  { name: '科幻', slug: 'sci-fi' },
  { name: '奇幻', slug: 'magic' },
  { name: '悬疑', slug: 'mystery' },
];

// 数字格式化
const formatViews = (num: number) => {
  if (!num) return '0';
  if (num >= 100000000) return (num / 100000000).toFixed(1) + '亿';
  if (num >= 10000) return (num / 10000).toFixed(1) + '万';
  return Math.round(num).toLocaleString();
};

export default function RankingPage() {
  const [allBooks, setAllBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  
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
    
    // 筛选逻辑保持网页端一致
    if (activeCategory !== 'all') {
        const targetCatName = CATEGORIES.find(c => c.slug === activeCategory)?.name;
        if (targetCatName && targetCatName !== '全部分类') {
             filtered = allBooks.filter(b => b.category === targetCatName);
        }
    }

    // 排序算法保持网页端一致
    return [...filtered].sort((a, b) => {
      const getVal = (obj: Book, key: string) => (obj as any)[key] || 0;
      const getRating = (obj: Book) => (obj as any).rating || 0;
      
      switch (activeRank) {
        case 'month': return getVal(b, 'monthly_views') - getVal(a, 'monthly_views');
        case 'week': return getVal(b, 'weekly_views') - getVal(a, 'weekly_views');
        case 'day': return getVal(b, 'daily_views') - getVal(a, 'daily_views');
        case 'rec':
          // 综合榜算法：热度40% + 评分60%
          const scoreA = (getVal(a, 'weekly_views') * 0.4) + (getRating(a) * 100 * 0.6);
          const scoreB = (getVal(b, 'weekly_views') * 0.4) + (getRating(b) * 100 * 0.6);
          return scoreB - scoreA;
        case 'total':
        default: return (b.views || 0) - (a.views || 0);
      }
    });
  }, [allBooks, activeRank, activeCategory]);

  return (
    // 移动端：Fixed布局隐藏Footer
    <div className="md:static md:min-h-screen md:bg-[#f4f5f7] md:py-6 md:pb-12 fixed inset-x-0 bottom-0 top-[60px] bg-white z-30 overflow-hidden flex flex-col md:block">
      
      {/* 桌面端最大宽度限制 */}
      <div className="max-w-[1200px] mx-auto md:px-4 flex flex-col md:flex-row gap-4 md:gap-6 h-full md:h-auto">
        
        {/* =========================================================
            1. 移动端侧边导航 (仿起点布局，但用回网页端榜单名)
           ========================================================= */}
        <aside className="md:hidden w-[86px] flex-shrink-0 bg-[#f6f7f9] h-full overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']">
            <div className="flex flex-col pb-20">
                {RANK_TYPES.map((rank) => {
                    const isActive = activeRank === rank.id;
                    return (
                        <button
                            key={rank.id}
                            onClick={() => setActiveRank(rank.id)}
                            className={`relative h-[56px] flex items-center justify-center text-[15px] transition-colors
                                ${isActive 
                                    ? 'bg-white text-red-600 font-bold' 
                                    : 'text-gray-500 font-medium hover:text-gray-900'
                                }`}
                        >
                            {isActive && <div className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-1 bg-red-600 rounded-r-full" />}
                            {rank.shortName}
                        </button>
                    );
                })}
            </div>
        </aside>

        {/* =========================================================
            2. 桌面端侧边导航 (保持不变)
           ========================================================= */}
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
                        ? 'bg-red-50 text-red-600 shadow-sm' 
                        : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
                      }`}
                  >
                    <Icon className={`w-5 h-5 ${isActive ? 'scale-110' : 'text-gray-400 group-hover:text-gray-600'} transition-transform`} />
                    <span>{rank.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        {/* =========================================================
            3. 右侧内容区域
           ========================================================= */}
        <main className="flex-1 flex flex-col min-w-0 md:gap-4 md:bg-transparent bg-white h-full md:h-auto pl-0 md:pl-0">
          
          {/* --- 顶部：分类筛选 (名称改回全部分类) --- */}
          <div className="flex-shrink-0 z-10 bg-white/95 backdrop-blur-sm md:static md:bg-white md:rounded-xl md:shadow-sm md:border border-gray-100 p-3 md:p-5 border-b md:border-b-0 border-gray-50">
            <div className="hidden md:flex items-center justify-between mb-4">
               <h1 className="text-2xl font-black text-gray-900">{RANK_TYPES.find(r => r.id === activeRank)?.name}</h1>
            </div>

            <div className="flex overflow-x-auto gap-2 md:gap-3 md:flex-wrap items-center [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.slug}
                  onClick={() => setActiveCategory(cat.slug)}
                  className={`flex-shrink-0 px-3 py-1.5 md:px-4 rounded-full text-[13px] md:text-xs font-bold transition-all border whitespace-nowrap
                    ${activeCategory === cat.slug 
                      ? 'bg-red-50 text-red-600 border-red-100' 
                      : 'bg-gray-50 text-gray-500 border-transparent hover:bg-gray-100'
                    }`}
                >
                  {/* 移动端如果不想显示“全部分类”这么长，可以简单处理，这里暂时保持一致 */}
                  {cat.name === '全部分类' ? (
                      <span className="md:hidden">全部</span>
                  ) : null}
                  <span className={cat.name === '全部分类' ? 'hidden md:inline' : ''}>{cat.name === '全部分类' ? '全部分类' : cat.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* --- 列表区域 --- */}
          <div className="flex-1 bg-white md:rounded-xl md:shadow-sm md:border border-gray-100 overflow-y-auto min-h-0 md:min-h-[600px] [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']">
            {loading ? (
                <div className="flex flex-col items-center justify-center pt-20 gap-3 text-gray-400">
                    <Loader2 className="animate-spin w-8 h-8 text-red-500" />
                    <p>加载中...</p>
                </div>
            ) : displayBooks.length === 0 ? (
                <div className="flex flex-col items-center justify-center pt-20 text-gray-400">
                    <BookOpen className="w-12 h-12 mb-2 text-gray-200" />
                    <p>暂无相关作品</p>
                </div>
            ) : (
                <div className="pb-10 md:pb-0"> 
                    {displayBooks.map((book, index) => {
                        const rank = index + 1;
                        
                        // 计算算法保持原样
                        const rawScore = activeRank === 'rec' 
                           ? (((book as any).weekly_views || 0) * 0.4 + ((book as any).rating || 0) * 100 * 0.6) 
                           : ((book as any)[activeRank === 'total' ? 'views' : `${activeRank}_views`] || 0);
                        const displayScore = formatViews(rawScore);

                        return (
                            <div key={book.id} className="group relative flex items-start gap-3 p-4 md:p-5 hover:bg-gray-50 transition-colors md:border-b border-gray-100">
                                
                                <Link href={`/book/${book.id}`} className="relative flex-shrink-0 w-[56px] h-[74px] md:w-24 md:h-32 rounded shadow-sm overflow-hidden bg-gray-100">
                                     {book.cover_image ? (
                                         <img src={book.cover_image} alt={book.title} className="w-full h-full object-cover" />
                                     ) : (
                                         <div className="w-full h-full flex items-center justify-center text-gray-300 transform scale-75"><BookOpen /></div>
                                     )}
                                </Link>

                                <div className="flex-1 min-w-0 flex flex-col justify-between h-[74px] md:h-32 py-0.5">
                                    <div className="flex items-center justify-between">
                                        <Link href={`/book/${book.id}`} className="flex items-center text-[16px] md:text-xl text-[#333] font-medium md:font-bold truncate pr-4">
                                            <span className={`mr-1.5 font-sans font-bold w-4 text-center ${rank <= 3 ? 'text-[#ff3b30]' : 'text-gray-400 text-[15px]'}`}>
                                                {rank}.
                                            </span>
                                            <span className="truncate">{book.title}</span>
                                        </Link>
                                    </div>

                                    <p className="hidden md:block text-sm text-gray-500 line-clamp-2 mt-1">
                                        {book.description}
                                    </p>

                                    <div className="flex items-center justify-between text-[12px] md:text-sm text-gray-400 md:mt-auto">
                                        <div className="flex items-center gap-1.5 truncate max-w-[70%]">
                                            <span className="truncate text-gray-500">
                                                {book.author || book.profiles?.username || '佚名'}
                                            </span>
                                            <span className="w-[1px] h-2.5 bg-gray-300"></span>
                                            <span className="truncate">
                                                {book.category || '综合'}
                                            </span>
                                            <span className="w-[1px] h-2.5 bg-gray-300 hidden sm:inline"></span>
                                            <span className="hidden sm:inline">{((book.views || 0) / 10000).toFixed(1)}万字</span>
                                        </div>
                                        
                                        <div className="flex flex-col items-end">
                                            <span className="text-red-500 md:text-gray-500 font-medium md:font-normal text-[13px] md:text-sm">
                                                {displayScore}
                                            </span>
                                            <span className="md:hidden text-[10px] text-gray-400 scale-90 origin-right">
                                                {activeRank === 'rec' ? '综合指数' : '热度'}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                                
                                <div className="hidden md:block absolute right-5 top-1/2 -translate-y-1/2">
                                     <Link href={`/book/${book.id}`} className="px-5 py-2 border border-red-500 text-red-500 rounded-full text-sm hover:bg-red-50 transition-colors">
                                         阅读
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