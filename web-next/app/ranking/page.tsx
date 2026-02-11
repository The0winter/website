'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { booksApi } from '@/lib/api';
import { 
  Trophy, Flame, Calendar, Clock, Star, 
  ChevronRight, BookOpen, Crown, LayoutGrid, Loader2 
} from 'lucide-react';

// --- 1. 配置常量 ---

// 左侧榜单配置 (对应起点的左侧栏)
const RANK_TYPES = [
  { id: 'month', name: '月票榜', icon: Calendar, desc: '过去30天热度最高', color: 'text-pink-500', bg: 'bg-pink-50' },
  { id: 'week', name: '周推榜', icon: Flame, desc: '本周读者推荐最猛', color: 'text-red-500', bg: 'bg-red-50' },
  { id: 'day', name: '日更榜', icon: Clock, desc: '今日更新且热度高', color: 'text-blue-500', bg: 'bg-blue-50' },
  { id: 'total', name: '总榜单', icon: Crown, desc: '建站以来累计数据', color: 'text-yellow-500', bg: 'bg-yellow-50' },
  { id: 'rating', name: '好评榜', icon: Star, desc: '评分最高的佳作', color: 'text-purple-500', bg: 'bg-purple-50' },
];

// 顶部由原来的 slug 映射，保持和你主页一致
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
  const [allBooks, setAllBooks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // --- 状态管理 ---
  const [activeRank, setActiveRank] = useState('month'); // 当前选中的榜单 (左侧)
  const [activeCategory, setActiveCategory] = useState('all'); // 当前选中的分类 (顶部)

  // 获取数据
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

  // --- 核心逻辑：交叉检索 (Cross-Filtering) ---
  const displayBooks = useMemo(() => {
    // 1. 先过滤分类
    let filtered = allBooks;
    if (activeCategory !== 'all') {
        // 注意：这里假设你的数据库 category 存的是中文名 (如'玄幻')，需根据 categories 里的 slug 找到对应的 name
        const targetCatName = CATEGORIES.find(c => c.slug === activeCategory)?.name;
        // 如果你的数据库存的是英文 slug，就直接比较 activeCategory
        if (targetCatName && targetCatName !== '全部分类') {
             filtered = allBooks.filter(b => b.category === targetCatName);
        }
    }

    // 2. 再根据榜单类型排序
    return [...filtered].sort((a, b) => {
      switch (activeRank) {
        case 'month': // 假设数据里有 monthly_views
          return (b.monthly_views || b.views || 0) - (a.monthly_views || a.views || 0);
        case 'week':
          return (b.weekly_views || 0) - (a.weekly_views || 0);
        case 'day':
          return (b.daily_views || 0) - (a.daily_views || 0);
        case 'rating':
          return (b.rating || 0) - (a.rating || 0);
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
        
        {/* === 左侧：榜单导航栏 (固定宽度) === */}
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

        {/* === 右侧：主内容区 === */}
        <main className="flex-1 flex flex-col gap-4 min-w-0">
          
          {/* 1. 顶部：分类筛选器 & 当前榜单标题 */}
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

            {/* 分类 Tags */}
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

          {/* 2. 书籍列表 (List View) */}
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
                        // 前三名的特殊样式
                        const isTop1 = rank === 1;
                        const isTop2 = rank === 2;
                        const isTop3 = rank === 3;
                        const isTop3Book = rank <= 3;
                        
                        return (
                            <div key={book.id} className="group flex p-5 gap-5 hover:bg-gray-50 transition-colors relative">
                                {/* 排名数字 */}
                                <div className="w-12 flex-shrink-0 flex flex-col items-center pt-1">
                                    {isTop1 && <img src="https://img.icons8.com/fluency/48/medal2--v1.png" className="w-8 h-8 mb-1" alt="1" />}
                                    {isTop2 && <img src="https://img.icons8.com/fluency/48/medal-second-place--v1.png" className="w-8 h-8 mb-1" alt="2" />}
                                    {isTop3 && <img src="https://img.icons8.com/fluency/48/medal-third-place--v1.png" className="w-8 h-8 mb-1" alt="3" />}
                                    
                                    <span className={`text-xl font-black italic font-mono 
                                        ${isTop1 ? 'text-red-500 text-3xl' : ''}
                                        ${isTop2 ? 'text-orange-500 text-2xl' : ''}
                                        ${isTop3 ? 'text-yellow-500 text-2xl' : ''}
                                        ${rank > 3 ? 'text-gray-300' : ''}
                                    `}>
                                        {rank}
                                    </span>
                                </div>

                                {/* 书封 */}
                                <Link href={`/book/${book.id}`} className="relative flex-shrink-0 w-24 h-32 md:w-28 md:h-36 shadow-md rounded overflow-hidden group-hover:shadow-lg transition-all border border-gray-200">
                                     {book.cover_image ? (
                                         <img src={book.cover_image} alt={book.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                                     ) : (
                                         <div className="w-full h-full bg-gray-100 flex items-center justify-center text-gray-300">无封面</div>
                                     )}
                                     {/* 角标 */}
                                     {isTop3Book && (
                                         <div className="absolute top-0 left-0 bg-red-600 text-white text-[10px] px-2 py-0.5 font-bold rounded-br-lg shadow-sm z-10">
                                            HOT
                                         </div>
                                     )}
                                </Link>

                                {/* 信息内容 */}
                                <div className="flex-1 min-w-0 flex flex-col justify-between py-1">
                                    <div>
                                        <div className="flex items-center justify-between mb-2">
                                            <Link href={`/book/${book.id}`} className="text-xl md:text-2xl font-bold text-gray-900 group-hover:text-blue-600 transition-colors line-clamp-1">
                                                {book.title}
                                            </Link>
                                            {/* 右侧数据展示 */}
                                            <div className="hidden md:flex flex-col items-end">
                                                <span className={`text-xl font-black font-mono ${currentRankInfo?.color}`}>
                                                    {activeRank === 'rating' 
                                                        ? book.rating?.toFixed(1) 
                                                        : ((book.views || 0)/10000).toFixed(1)}
                                                    <span className="text-xs font-normal text-gray-400 ml-1">
                                                        {activeRank === 'rating' ? '分' : '万热度'}
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
                                                <span className="text-gray-900 font-medium">AuthorName</span> {/* 你这里如果有作者字段请替换 */}
                                                著
                                            </span>
                                            <span className="w-px h-3 bg-gray-300"></span>
                                            <span className="text-gray-400">连载中</span>
                                        </div>

                                        <p className="text-sm text-gray-500 line-clamp-2 md:line-clamp-3 leading-relaxed mb-3">
                                            {book.description || '暂无简介...'}
                                        </p>
                                    </div>

                                    {/* 底部操作栏 */}
                                    <div className="flex items-center justify-between mt-auto">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs text-red-500 border border-red-100 bg-red-50 px-2 py-0.5 rounded">
                                                必读好书
                                            </span>
                                        </div>
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