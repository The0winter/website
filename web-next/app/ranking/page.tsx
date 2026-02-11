'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { booksApi, Book } from '@/lib/api';
import { 
  Trophy, Flame, Calendar, Clock, Sparkles, 
  LayoutGrid, Loader2, BookOpen, Crown, Medal // 👈 新增引入 Medal 图标
} from 'lucide-react';

// --- 1. 榜单配置 ---
const RANK_TYPES = [
  { id: 'rec', name: '综合榜', icon: Sparkles, desc: '口碑与热度双高', color: 'text-purple-600', bg: 'bg-purple-50' },
  { id: 'month', name: '月榜', icon: Calendar, desc: '近30天阅读热度', color: 'text-pink-600', bg: 'bg-pink-50' },
  { id: 'week', name: '周榜', icon: Flame, desc: '本周读者都在看', color: 'text-red-600', bg: 'bg-red-50' },
  { id: 'day', name: '日榜', icon: Clock, desc: '今日实时上升', color: 'text-blue-600', bg: 'bg-blue-50' },
  { id: 'total', name: '总榜', icon: Crown, desc: '全站历史最强', color: 'text-yellow-600', bg: 'bg-yellow-50' },
];

// 数字格式化函数：1.2k, 1.5M
const formatViews = (num: number) => {
  if (!num) return '0';
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
};

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

export default function RankingPage() {
  const [allBooks, setAllBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);

  // --- 状态管理 ---
  const [activeRank, setActiveRank] = useState('rec'); 
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

  // --- 核心逻辑：交叉检索 ---
  const displayBooks = useMemo(() => {
    let filtered = allBooks;
    
    // 1. 过滤分类
    if (activeCategory !== 'all') {
        const targetCatName = CATEGORIES.find(c => c.slug === activeCategory)?.name;
        if (targetCatName && targetCatName !== '全部分类') {
             filtered = allBooks.filter(b => b.category === targetCatName);
        }
    }

    // 2. 排序算法
    return [...filtered].sort((a, b) => {
      // 类型断言，防止 TS 报错
      const getVal = (obj: Book, key: string) => (obj as any)[key] || 0;
      const getRating = (obj: Book) => (obj as any).rating || 0;
      
      switch (activeRank) {
        case 'month':
          return getVal(b, 'monthly_views') - getVal(a, 'monthly_views');
        case 'week':
          return getVal(b, 'weekly_views') - getVal(a, 'weekly_views');
        case 'day':
          return getVal(b, 'daily_views') - getVal(a, 'daily_views');
        case 'rec':
          // 综合算法：周流量(40%) + 评分x100(60%)
          const scoreA = (getVal(a, 'weekly_views') * 0.4) + (getRating(a) * 100 * 0.6);
          const scoreB = (getVal(b, 'weekly_views') * 0.4) + (getRating(b) * 100 * 0.6);
          return scoreB - scoreA;
        case 'total':
        default:
          return (b.views || 0) - (a.views || 0);
      }
    });
  }, [allBooks, activeRank, activeCategory]);

  const currentRankInfo = RANK_TYPES.find(r => r.id === activeRank);

  return (
    <div className="min-h-screen bg-[#f4f5f7] py-6">
      <div className="max-w-[1200px] mx-auto px-4 flex flex-col md:flex-row gap-6">
        
        {/* 左侧导航 */}
        <aside className="w-full md:w-[240px] flex-shrink-0 flex flex-col gap-4">
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

        {/* 右侧内容 */}
        <main className="flex-1 flex flex-col gap-4 min-w-0">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-black text-gray-900 flex items-center gap-2">
                        {currentRankInfo?.name}
                        <span className="text-xs font-normal text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full ml-2 hidden md:inline-block">
                            {currentRankInfo?.desc}
                        </span>
                    </h1>
                </div>
                <div className="text-xs text-gray-400">
                    共找到 {displayBooks.length} 本相关作品
                </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.slug}
                  onClick={() => setActiveCategory(cat.slug)}
                  className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all border
                    ${activeCategory === cat.slug 
                      ? 'bg-gray-900 text-white border-gray-900 shadow-md transform scale-105' 
                      : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden min-h-[600px]">
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
                        
                        return (
                            <div key={book.id} className="group flex p-5 gap-5 hover:bg-gray-50 transition-colors relative">
                                
                                {/* 🔥🔥🔥 修复点：使用 SVG 组件代替 img 标签，防止破图 🔥🔥🔥 */}
                                <div className="w-12 flex-shrink-0 flex flex-col items-center pt-1">
                                    {isTop1 && <Medal className="w-8 h-8 mb-1 text-yellow-500 fill-yellow-100" />}
                                    {isTop2 && <Medal className="w-8 h-8 mb-1 text-gray-400 fill-gray-100" />}
                                    {isTop3 && <Medal className="w-8 h-8 mb-1 text-orange-600 fill-orange-100" />}
                                    
                                    <span className={`text-xl font-black italic font-mono 
                                        ${isTop1 ? 'text-yellow-600 text-3xl' : ''}
                                        ${isTop2 ? 'text-gray-500 text-2xl' : ''}
                                        ${isTop3 ? 'text-orange-500 text-2xl' : ''}
                                        ${rank > 3 ? 'text-gray-300' : ''}
                                    `}>
                                        {rank}
                                    </span>
                                </div>

                                <Link href={`/book/${book.id}`} className="relative flex-shrink-0 w-24 h-32 md:w-28 md:h-36 shadow-md rounded overflow-hidden group-hover:shadow-lg transition-all border border-gray-200">
                                     {book.cover_image ? (
                                         <img src={book.cover_image} alt={book.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                                     ) : (
                                         <div className="w-full h-full bg-gray-100 flex items-center justify-center text-gray-300">无封面</div>
                                     )}
                                     {isTop3Book && (
                                         <div className="absolute top-0 left-0 bg-red-600 text-white text-[10px] px-2 py-0.5 font-bold rounded-br-lg shadow-sm z-10">
                                            HOT
                                         </div>
                                     )}
                                </Link>

                                <div className="flex-1 min-w-0 flex flex-col justify-between py-1">
                                    <div>
                                        <div className="flex items-center justify-between mb-2">
                                            <Link href={`/book/${book.id}`} className="text-xl md:text-2xl font-bold text-gray-900 group-hover:text-blue-600 transition-colors line-clamp-1">
                                                {book.title}
                                            </Link>
                                            {/* 右侧数据展示 */}
                                            <div className="hidden md:flex flex-col items-end">
                                                <span className={`text-xl font-black font-mono ${currentRankInfo?.color}`}>
                                                    {/* 调用格式化函数 */}
                                                    {formatViews(
                                                        activeRank === 'rec' 
                                                        ? (( (book as any).weekly_views || 0) * 0.4 + ((book as any).rating || 0) * 100 * 0.6) 
                                                        : ((book as any)[activeRank === 'total' ? 'views' : `${activeRank}_views`] || 0)
                                                    )}
                                                    <span className="text-xs font-normal text-gray-400 ml-1">
                                                        浏览量
                                                    </span>
                                                </span>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-3 text-xs md:text-sm text-gray-500 mb-3">
                                            <span className="flex items-center gap-1">
                                                <LayoutGrid className="w-3 h-3" />
                                                {book.category || '未分类'}
                                            </span>
                                            <span className="w-px h-3 bg-gray-300"></span>
                                            <span className="flex items-center gap-1">
                                                <span className="text-gray-900 font-medium">
                                                    {book.author || book.profiles?.username || '佚名'}
                                                </span>
                                                著
                                            </span>
                                            <span className="w-px h-3 bg-gray-300"></span>
                                            <span className="text-gray-400">连载中</span>
                                        </div>

                                        <p className="text-sm text-gray-500 line-clamp-2 md:line-clamp-3 leading-relaxed mb-3">
                                            {book.description || '暂无简介...'}
                                        </p>
                                    </div>

                                    <div className="flex items-center justify-between mt-auto">
                                        <div className="flex items-center gap-2"></div>
                                        <Link 
                                            href={`/book/${book.id}`}
                                            className="px-6 py-2 bg-gray-900 text-white text-sm font-bold rounded-full hover:bg-blue-600 hover:shadow-lg hover:shadow-blue-200 transition-all transform active:scale-95"
                                        >
                                            立即阅读
                                        </Link>
                                    </div>
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