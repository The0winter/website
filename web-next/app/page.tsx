'use client';

import { useEffect, useState, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
// 引入图标
import { 
  BookOpen, TrendingUp, Calendar, Star, Zap, Trophy, ChevronRight,
  Sparkles, Sword, Building2, History, Rocket 
} from 'lucide-react';
import { booksApi, Book } from '@/lib/api';

// --- 0. 分类配置 (保留你原有的分类) ---
const categories = [
  { name: '全部', icon: BookOpen, slug: 'all' },
  { name: '玄幻', icon: Sparkles, slug: 'fantasy' },
  { name: '仙侠', icon: Sword, slug: 'wuxia' },
  { name: '都市', icon: Building2, slug: 'urban' },
  { name: '历史', icon: History, slug: 'history' },
  { name: '科幻', icon: Rocket, slug: 'sci-fi' },
  { name: '奇幻', icon: Sparkles, slug: 'magic' },
  { name: '体育', icon: Rocket, slug: 'sports' },
  { name: '军事', icon: Sword, slug: 'military' },
  { name: '悬疑', icon: History, slug: 'mystery' },
];

// --- 1. 单个榜单子组件 (复用) ---
const RankingList = ({ title, icon: Icon, books, rankColor, showRating = false }: any) => (
  <div className="bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col h-full overflow-hidden">
    {/* 榜单头部 */}
    <div className="p-4 border-b border-gray-50 flex items-center justify-between bg-gradient-to-r from-gray-50 to-white">
      <div className="flex items-center gap-2">
        <Icon className={`w-5 h-5 ${rankColor}`} />
        <h3 className="font-bold text-gray-800">{title}</h3>
      </div>
      <span className="text-[10px] text-gray-400 uppercase tracking-wider">TOP 10</span>
    </div>

    {/* 列表内容 */}
    <div className="flex-1 overflow-y-auto divide-y divide-gray-50 min-h-[400px]">
      {books.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 text-gray-400 text-xs gap-2">
            <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center">?</div>
            <span>暂无数据</span>
        </div>
      ) : (
        books.map((book: any, index: number) => (
          <Link 
            key={book.id} 
            href={`/book/${book.id}`}
            className="flex items-start gap-3 p-3 hover:bg-blue-50/50 transition-colors group relative"
          >
            {/* 排名数字 */}
            <div className={`
              w-5 h-5 flex-shrink-0 flex items-center justify-center rounded text-[10px] font-bold mt-0.5
              ${index === 0 ? 'bg-red-500 text-white' : ''}
              ${index === 1 ? 'bg-orange-500 text-white' : ''}
              ${index === 2 ? 'bg-yellow-500 text-white' : ''}
              ${index > 2 ? 'bg-gray-100 text-gray-400' : ''}
            `}>
              {index + 1}
            </div>

            {/* 书籍信息 */}
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-bold text-gray-800 truncate group-hover:text-blue-600 mb-1">
                {book.title}
              </h4>
              <div className="flex items-center text-xs text-gray-400 mb-1 gap-2">
                 <span className="truncate max-w-[80px] hover:text-gray-600">
                    {book.author || (book.author_id as any)?.username || '未知'}
                 </span>
                 <span className="w-px h-2 bg-gray-200"></span>
                 <span className="bg-gray-100 px-1.5 py-0.5 rounded text-[10px] text-gray-500">
                    {book.category || '综合'}
                 </span>
              </div>
              <div className="text-xs text-gray-400 flex items-center">
                 <span>{(book.views || 0).toLocaleString()} 阅读</span>
              </div>
            </div>
            
            {/* 评分/箭头 */}
            <div className="text-right flex flex-col items-end justify-start">
               {showRating ? (
                 <span className="text-sm font-bold text-yellow-500 flex items-center gap-0.5">
                    {(book.rating || 0).toFixed(1)} <span className="text-[10px] font-normal text-gray-400">分</span>
                 </span>
               ) : (
                 <ChevronRight className="w-4 h-4 text-gray-300 mt-1" />
               )}
            </div>
          </Link>
        ))
      )}
    </div>
  </div>
);

// --- 2. 主逻辑组件 ---
function HomeContent() {
  // 状态管理
  const [allBooks, setAllBooks] = useState<Book[]>([]); // 存所有书
  const [featuredBooks, setFeaturedBooks] = useState<Book[]>([]); // 轮播图
  const [selectedCategory, setSelectedCategory] = useState('all'); // 当前选中的分类
  const [activeBookIndex, setActiveBookIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [loading, setLoading] = useState(true);

  // 初始化加载数据
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        // 1. 获取所有书籍 (不做分页，一次拿回来方便前端筛选分类)
        const books = await booksApi.getAll(); 
        setAllBooks(books);

        // 2. 轮播图 (取总阅读量前5)
        const sortedForFeature = [...books].sort((a: any, b: any) => (b.views || 0) - (a.views || 0));
        setFeaturedBooks(sortedForFeature.slice(0, 5));

      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  // --- 🔥 核心逻辑：根据分类和规则动态计算 4 个榜单 ---
  const { recList, weekList, monthList, dayList } = useMemo(() => {
    // 1. 先根据分类筛选
    const targetCategory = categories.find(c => c.slug === selectedCategory);
    
    const filtered = allBooks.filter(book => {
        if (selectedCategory === 'all') return true;
        // 注意：这里对比的是中文名 (比如 "玄幻")
        return targetCategory && book.category === targetCategory.name;
    });

    // 2. 再分别排序生成四个榜单 (取前10)
        // D. 日榜 (daily_views)
    const day = [...filtered].sort((a: any, b: any) => (b.daily_views || 0) - (a.daily_views || 0)).slice(0, 10);
    

    // B. 周榜 (weekly_views)
    const week = [...filtered].sort((a: any, b: any) => (b.weekly_views || 0) - (a.weekly_views || 0)).slice(0, 10);

    // C. 月榜 (monthly_views)
    const month = [...filtered].sort((a: any, b: any) => (b.monthly_views || 0) - (a.monthly_views || 0)).slice(0, 10);

        // A. 综合推荐: 评分(60%) + 周热度(40%)
    const rec = [...filtered].sort((a: any, b: any) => {
        const scoreA = ((a.rating || 0) * 100 * 0.6) + ((a.weekly_views || 0) * 0.4);
        const scoreB = ((b.rating || 0) * 100 * 0.6) + ((b.weekly_views || 0) * 0.4);
        return scoreB - scoreA;
    }).slice(0, 10);



    return { recList: rec, weekList: week, monthList: month, dayList: day };
  }, [allBooks, selectedCategory]);

  // 轮播图自动播放
  useEffect(() => {
    if (isPaused || featuredBooks.length <= 1) return;
    const intervalId = window.setInterval(() => {
      setActiveBookIndex((prevIndex) => (prevIndex + 1) % featuredBooks.length);
    }, 3000);
    return () => window.clearInterval(intervalId);
  }, [featuredBooks, isPaused, activeBookIndex]);

  const activeBook = featuredBooks[activeBookIndex] || featuredBooks[0];

  return (
    <div className="min-h-screen bg-gray-50 pb-12">
      {/* 顶部黑条导航 */}
      <div className="w-full bg-[#3e3d43] h-[40px]">
        <div className="max-w-4xl mx-auto h-full flex justify-between items-center text-white text-[14px] px-2">
          {['全部作品', '排行', '完本', '免费', 'VIP', '作家专区'].map((item) => (
            <Link key={item} href="#" className="hover:text-red-500 transition-colors whitespace-nowrap">
              {item}
            </Link>
          ))}
        </div>
      </div>

      <div className="max-w-[1200px] mx-auto px-4 py-6 flex flex-col gap-8">
        
        {/* === 轮播图区域 === */}
        <section className="w-full" onMouseLeave={() => setIsPaused(false)}>
          {featuredBooks.length > 0 && activeBook ? (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden w-full">
              <Link href={`/book/${activeBook.id}`} className="block w-full h-full">
                <div className="relative h-80 bg-gradient-to-br from-blue-600 to-purple-700" onMouseEnter={() => setIsPaused(true)}>
                  {activeBook.cover_image ? (
                    <img src={activeBook.cover_image} alt={activeBook.title} className="w-full h-full object-cover cursor-pointer hover:opacity-90 transition-opacity"/>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <BookOpen className="h-24 w-24 text-white/50" />
                    </div>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-6">
                    <h3 className="text-2xl font-bold text-white mb-2">{activeBook.title}</h3>
                    <p className="text-white/90 text-sm mb-1">by {activeBook.author || (activeBook.author_id as any)?.username || 'Unknown'}</p>
                    <p className="text-white/80 text-sm line-clamp-2">{activeBook.description || '暂无简介'}</p>
                  </div>
                </div>
              </Link>
              <div className="bg-gray-900/60">
                <div className="grid grid-cols-5">
                  {featuredBooks.map((book, index) => (
                    <button
                      key={book.id}
                      onClick={() => setActiveBookIndex(index)}
                      className={`px-4 py-3 text-sm font-medium transition-all ${
                        index === activeBookIndex ? 'bg-red-600 text-white' : 'bg-black/60 text-gray-300 hover:bg-black/80'
                      }`}
                    >
                      <span className="line-clamp-1">{book.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="h-80 bg-gray-200 rounded-lg animate-pulse flex items-center justify-center text-gray-400">
               {loading ? '加载精彩内容...' : '暂无推荐'}
            </div>
          )}
        </section>

        {/* === 🔥 分类筛选栏 (保留并放在榜单上方) === */}
        <section className="w-full">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
              <nav className="flex flex-row flex-wrap items-center gap-y-4">
                {categories.map((category, index) => {
                  const Icon = category.icon;
                  const isLast = index === categories.length - 1;
                  const isSelected = selectedCategory === category.slug;
                  return (
                    <span key={category.slug} className="flex items-center">
                      <button
                        onClick={() => setSelectedCategory(category.slug)}
                        className={`flex items-center space-x-1.5 px-3 py-1 rounded-full text-sm transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-red-50 text-red-600 font-bold ring-1 ring-red-200'
                            : 'text-gray-600 hover:text-red-600 hover:bg-gray-50'
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                        <span>{category.name}</span>
                      </button>
                      {!isLast && <span className="h-4 w-px bg-gray-200 mx-3" />}
                    </span>
                  );
                })}
              </nav>
            </div>
        </section>

        {/* === 🔥 四大榜单区域 (数据随分类变化) === */}
        <section className="w-full">
            {/* 标题 */}
            <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-bold text-gray-900 border-l-4 border-red-600 pl-3 flex items-center gap-2">
                    {categories.find(c => c.slug === selectedCategory)?.name}排行
                    <span className="text-xs font-normal text-gray-400 ml-2 bg-gray-100 px-2 py-0.5 rounded-full">
                        实时更新
                    </span>
                </h2>
                <span className="text-xs text-gray-400 hidden sm:inline">
                    榜单规则：日榜0点 · 周榜周四 · 月榜每月1号
                </span>
            </div>

            {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                    {[1,2,3,4].map(i => <div key={i} className="h-[400px] bg-gray-200 rounded-xl animate-pulse"></div>)}
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                    {/* 1. 综合推荐 */}
                    <RankingList 
                        title={`${categories.find(c => c.slug === selectedCategory)?.name}强推`}
                        icon={Star} 
                        books={recList} 
                        rankColor="text-yellow-500"
                        showRating={true}
                    />

                    {/* 2. 周热度榜 */}
                    <RankingList 
                        title="本周热度" 
                        icon={TrendingUp} 
                        books={weekList} 
                        rankColor="text-red-500"
                    />

                    {/* 3. 经典月榜 */}
                    <RankingList 
                        title="必看月票" 
                        icon={Trophy} 
                        books={monthList} 
                        rankColor="text-blue-500"
                    />

                    {/* 4. 今日日榜 */}
                    <RankingList 
                        title="今日上升" 
                        icon={Zap} 
                        books={dayList} 
                        rankColor="text-purple-500"
                    />
                </div>
            )}
        </section>

      </div>
    </div>
  );
}

// 主入口组件
export default function Home() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <HomeContent />
    </Suspense>
  );
}