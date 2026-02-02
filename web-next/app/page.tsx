'use client';

import { useEffect, useState, useMemo, Suspense } from 'react';
import Link from 'next/link';
// 引入图标
import { 
  BookOpen, TrendingUp, Star, Zap, ChevronRight,
  Sparkles, Sword, Building2, History, Rocket, ImageOff,
  Search, User, Library // 👈 新增图标
} from 'lucide-react';
import { booksApi, Book } from '@/lib/api';

// --- 0. 分类配置 ---
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

// --- 1. 单个榜单子组件 (🔥 已针对移动端深度优化) ---
const RankingList = ({ title, icon: Icon, books, rankColor, showRating = false }: any) => (
  <div className="bg-white md:rounded-xl shadow-sm md:border border-gray-100 flex flex-col h-full overflow-hidden">
    
    {/* 🔥 优化点 3：手机端隐藏榜单头部 (综合强推 Top10)，直接和 Tab 连在一起节约空间 
       hidden md:flex -> 手机隐藏，电脑显示
    */}
    <div className="hidden md:flex p-5 border-b border-gray-50 items-center justify-between bg-gradient-to-r from-gray-50 to-white">
      <div className="flex items-center gap-3">
        <Icon className={`w-6 h-6 ${rankColor}`} />
        <h3 className="font-extrabold text-gray-800 text-xl">{title}</h3>
      </div>
      <span className="text-xs text-gray-400 uppercase tracking-wider font-medium bg-white px-2 py-1 rounded border border-gray-100">TOP 10</span>
    </div>

    {/* 列表内容 */}
    <div className="flex-1 overflow-y-auto min-h-[600px] scrollbar-thin scrollbar-thumb-gray-200">
      {books.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-80 text-gray-400 text-sm gap-4">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center">
              <ImageOff className="w-8 h-8 text-gray-300" />
            </div>
            <span>暂无相关书籍</span>
        </div>
      ) : (
        books.map((book: any, index: number) => (
          <Link 
            key={book.id} 
            href={`/book/${book.id}`}
            className="flex items-start gap-4 md:gap-5 p-4 md:p-5 hover:bg-blue-50/40 transition-all group relative border-b border-gray-100 last:border-b-0"
          >
            {/* A. 排名数字 */}
            <div className={`
              w-6 h-6 md:w-7 md:h-7 flex-shrink-0 flex items-center justify-center rounded-lg text-xs md:text-sm font-extrabold mt-1
              ${index === 0 ? 'bg-red-500 text-white shadow-red-200 shadow-md transform scale-110' : ''}
              ${index === 1 ? 'bg-orange-500 text-white shadow-orange-200 shadow-md' : ''}
              ${index === 2 ? 'bg-yellow-500 text-white shadow-yellow-200 shadow-md' : ''}
              ${index > 2 ? 'bg-gray-100 text-gray-400' : ''}
            `}>
              {index + 1}
            </div>

            {/* B. 书籍封面 */}
            <div className="relative w-16 h-20 md:w-20 md:h-28 flex-shrink-0 rounded-md shadow-sm border border-gray-200 overflow-hidden group-hover:shadow-lg transition-all duration-300 group-hover:-translate-y-1">
               {book.cover_image ? (
                 <img src={book.cover_image} alt={book.title} className="w-full h-full object-cover" />
               ) : (
                 <div className="w-full h-full bg-gray-100 flex items-center justify-center">
                    <BookOpen className="w-8 h-8 text-gray-300" />
                 </div>
               )}
            </div>

            {/* C. 书籍信息 */}
            <div className="flex-1 min-w-0 flex flex-col justify-between h-20 md:h-28 py-0.5 md:py-1">
              <div>
                  {/* 🔥 优化点 4：书名改小，避免换行 */}
                  {/* text-sm (手机) md:text-[16px] (电脑) */}
                  <h4 className="text-sm md:text-[16px] font-extrabold text-gray-800 leading-snug line-clamp-1 md:line-clamp-2 group-hover:text-blue-600 transition-colors mb-1 md:mb-2">
                    {book.title}
                  </h4>
                  
                  <div className="flex items-center text-xs text-gray-500 gap-2 md:gap-3 mb-1 md:mb-3">
                    <span className="truncate max-w-[100px] hover:text-gray-900 font-medium">
                        {book.author || (book.author_id as any)?.username || '未知'}
                    </span>
                    
                    {/* 🔥 优化点 4：手机端删掉分类标签 (hidden md:block) */}
                    <span className="hidden md:block w-px h-3 bg-gray-300"></span>
                    <span className="hidden md:block bg-gray-100 px-2.5 py-1 rounded-md text-xs text-gray-600">
                        {book.category || '综合'}
                    </span>
                  </div>
              </div>

              {/* 🔥 优化点 4：改为“浏览” */}
              <div className="text-xs text-gray-400 flex items-center mt-auto">
                  <span>{(book.views || 0).toLocaleString()} 浏览</span>
              </div>
            </div>
            
            {/* D. 评分/箭头 */}
            <div className="self-center text-right pl-2">
               {showRating ? (
                 <div className="flex flex-col items-end">
                    <span className="text-base md:text-lg font-black text-yellow-500 flex items-baseline gap-1">
                        {(book.rating || 0).toFixed(1)} 
                        <span className="text-[10px] md:text-xs font-medium text-gray-400">分</span>
                    </span>
                 </div>
               ) : (
                 <div className="w-8 h-8 rounded-full bg-gray-50 flex items-center justify-center group-hover:bg-blue-500 group-hover:text-white transition-colors">
                   <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-white" />
                 </div>
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
  const [allBooks, setAllBooks] = useState<Book[]>([]); 
  const [featuredBooks, setFeaturedBooks] = useState<Book[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('all'); 
  const [activeBookIndex, setActiveBookIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [loading, setLoading] = useState(true);
  
  // 移动端 Tab 状态
  const [mobileTab, setMobileTab] = useState<'rec' | 'week' | 'day'>('rec');

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const books = await booksApi.getAll(); 
        setAllBooks(books);
        
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

  const { recList, weekList, dayList } = useMemo(() => {
    const targetCategory = categories.find(c => c.slug === selectedCategory);
    const filtered = allBooks.filter(book => {
        if (selectedCategory === 'all') return true;
        return targetCategory && book.category === targetCategory.name;
    });

    // 1. 综合强推
    const rec = [...filtered].sort((a: any, b: any) => {
        const scoreA = ((a.rating || 0) * 100 * 0.6) + ((a.weekly_views || 0) * 0.4);
        const scoreB = ((b.rating || 0) * 100 * 0.6) + ((b.weekly_views || 0) * 0.4);
        return scoreB - scoreA;
    }).slice(0, 10);

    // 2. 本周热度
    const week = [...filtered].sort((a: any, b: any) => (b.weekly_views || 0) - (a.weekly_views || 0)).slice(0, 10);

    // 3. 今日上升
    const day = [...filtered].sort((a: any, b: any) => (b.daily_views || 0) - (a.daily_views || 0)).slice(0, 10);

    return { recList: rec, weekList: week, dayList: day };
  }, [allBooks, selectedCategory]);

  useEffect(() => {
    if (isPaused || featuredBooks.length <= 1) return;
    const intervalId = window.setInterval(() => {
      setActiveBookIndex((prevIndex) => (prevIndex + 1) % featuredBooks.length);
    }, 3000);
    return () => window.clearInterval(intervalId);
  }, [featuredBooks, isPaused, activeBookIndex]);

  const activeBook = featuredBooks[activeBookIndex] || featuredBooks[0];

  return (
    <div className="min-h-screen bg-[#f8f9fa] pb-12">
      
      {/* 🔥 优化点 1：顶部导航栏 
         电脑端 (hidden md:block)：保持原样黑色长条
         手机端 (md:hidden)：白色背景，图标代替文字
      */}
      
      {/* 电脑端导航 (PC ONLY) */}
      <div className="hidden md:block w-full bg-[#3e3d43] h-[40px]">
        <div className="max-w-6xl mx-auto h-full flex justify-between items-center text-white text-[14px] px-4">
          <div className="flex gap-6 overflow-x-auto no-scrollbar">
            {['全部作品', '排行', '完本', '免费', 'VIP', '作家专区'].map((item) => (
                <Link key={item} href="#" className="hover:text-red-500 transition-colors whitespace-nowrap">
                {item}
                </Link>
            ))}
          </div>
          <div className="text-gray-400 text-xs hidden sm:block">登录 | 注册</div>
        </div>
      </div>

      {/* 手机端导航 (MOBILE ONLY) */}
      <div className="md:hidden sticky top-0 z-50 bg-white border-b border-gray-100 shadow-sm px-4 h-[50px] flex items-center justify-between">
          {/* Logo 简化 */}
          <div className="flex items-center gap-2">
             <BookOpen className="w-5 h-5 text-blue-600" />
             <span className="font-black text-lg text-gray-900 tracking-tighter">九天</span>
          </div>
          
          {/* 图标集成：搜索 + 书架 + 用户头像 */}
          <div className="flex items-center gap-5 text-gray-600">
             <Search className="w-5 h-5" />
             <Link href="/library"><Library className="w-5 h-5" /></Link>
             <Link href="/login">
                <div className="w-7 h-7 bg-gray-100 rounded-full flex items-center justify-center text-gray-500">
                    <User className="w-4 h-4" />
                </div>
             </Link>
          </div>
      </div>

      <div className="max-w-[1400px] mx-auto md:px-4 md:py-8 flex flex-col gap-0 md:gap-10">
      
        {/* === 轮播图区域 === */}
        <section className="w-full" onMouseLeave={() => setIsPaused(false)}>
          {featuredBooks.length > 0 && activeBook ? (
            <div className="bg-white md:rounded-2xl shadow-sm border-b md:border border-gray-200 overflow-hidden w-full">
              <Link href={`/book/${activeBook.id}`} className="block w-full h-full">
                {/* 手机高度 h-[220px]，平板以上 h-[380px] */}
                <div className="relative h-[220px] md:h-[380px] bg-gradient-to-br from-gray-900 to-black" onMouseEnter={() => setIsPaused(true)}>
                  {activeBook.cover_image && (
                    <div className="absolute inset-0">
                        <img src={activeBook.cover_image} alt={activeBook.title} className="w-full h-full object-cover opacity-40 blur-2xl scale-110" />
                        <div className="absolute inset-0 bg-gradient-to-r from-black via-black/60 to-transparent"></div>
                    </div>
                  )}
                  
                  <div className="relative h-full flex items-center p-5 md:p-10 gap-10 max-w-6xl mx-auto">
                      {/* 封面图：只在 md(平板) 以上显示 */}
                      {activeBook.cover_image && (
                           <img src={activeBook.cover_image} alt={activeBook.title} className="w-48 h-72 object-cover rounded-lg shadow-2xl border-2 border-white/10 flex-shrink-0 hidden md:block transform hover:scale-105 transition-transform duration-500" />
                      )}
                      <div className="flex-1 text-white">
                        <span className="inline-block bg-red-600 text-white text-[10px] md:text-xs font-bold px-2 py-0.5 md:px-3 md:py-1 rounded-full mb-2 md:mb-4 tracking-wide shadow-lg shadow-red-900/50">重磅推荐</span>
                        <h3 className="text-2xl md:text-5xl font-black mb-2 md:mb-4 tracking-tight drop-shadow-lg line-clamp-1">{activeBook.title}</h3>
                        
                        <p className="flex items-center gap-4 text-white/80 text-xs md:text-sm mb-2 md:mb-6 font-medium">
                            <span className="flex items-center gap-2"><span className="w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-blue-400"></span>{activeBook.author || '未知'}</span>
                            <span className="text-white/20">|</span>
                            <span className="bg-white/10 px-2 py-0.5 md:px-3 rounded-full backdrop-blur-sm">{activeBook.category || '综合'}</span>
                        </p>
                        
                        <p className="text-gray-300 text-xs md:text-base leading-relaxed line-clamp-2 md:line-clamp-3 max-w-2xl font-light">
                            {activeBook.description || '暂无简介'}
                        </p>
                      </div>
                  </div>
                </div>
              </Link>
              {/* PC端列表导航 (保留) */}
              <div className="bg-[#1a1a1a] border-t border-white/5 hidden lg:block">
                 <div className="max-w-6xl mx-auto grid grid-cols-5 divide-x divide-white/5">
                  {featuredBooks.map((book, index) => (
                    <button
                      key={book.id}
                      onClick={() => setActiveBookIndex(index)}
                      className={`px-4 py-5 text-sm transition-all relative overflow-hidden group text-left ${
                        index === activeBookIndex ? 'bg-white/5' : 'hover:bg-white/5'
                      }`}
                    >
                      {index === activeBookIndex && (
                          <div className="absolute top-0 left-0 w-full h-0.5 bg-red-600 shadow-[0_0_10px_rgba(220,38,38,0.8)]"></div>
                      )}
                      <span className={`block font-bold mb-0.5 line-clamp-1 ${index === activeBookIndex ? 'text-white' : 'text-gray-400 group-hover:text-gray-200'}`}>
                        {book.title}
                      </span>
                      <span className="text-xs text-gray-600 group-hover:text-gray-500">{book.category || '综合'}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="h-[220px] md:h-[380px] bg-gray-200 md:rounded-xl animate-pulse flex items-center justify-center text-gray-400">
               {loading ? '加载精彩内容...' : '暂无推荐'}
            </div>
          )}
        </section>

        {/* 🔥 优化点 2：隐藏分类筛选栏 (手机端)
           hidden md:block -> 手机隐藏，电脑显示
        */}
        <section className="w-full hidden md:block">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
              <nav className="flex flex-wrap items-center gap-4">
                {categories.map((category) => {
                  const Icon = category.icon;
                  const isSelected = selectedCategory === category.slug;
                  return (
                    <button
                      key={category.slug}
                      onClick={() => setSelectedCategory(category.slug)}
                      className={`flex items-center space-x-2 px-5 py-2.5 rounded-xl text-sm transition-all cursor-pointer border flex-shrink-0 ${
                          isSelected
                          ? 'bg-gray-900 text-white font-bold border-gray-900 shadow-lg shadow-gray-200 scale-105'
                          : 'text-gray-600 border-gray-100 hover:border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      <Icon className={`h-4 w-4 ${isSelected ? 'text-white' : 'text-gray-400'}`} />
                      <span>{category.name}</span>
                    </button>
                  );
                })}
              </nav>
            </div>
        </section>

        {/* === 三大榜单区域 === */}
        <section className="w-full">
            {/* 🔥 优化点 2：隐藏“xx热门排行”这行大字 (手机端)
                hidden md:flex -> 手机隐藏，电脑显示
            */}
            <div className="hidden md:flex mb-6 items-center justify-between gap-4">
                <h2 className="text-2xl font-black text-gray-900 flex items-center gap-3">
                    <span className="text-3xl">🔥</span>
                    {categories.find(c => c.slug === selectedCategory)?.name}热门排行
                </h2>
                <span className="text-xs text-gray-400 font-medium bg-white px-4 py-2 rounded-full border border-gray-100 shadow-sm">
                   榜单规则：日榜0点 · 周榜周四刷新
                </span>
            </div>

            {/* 🔥 优化点 2：Tab 栏紧贴轮播图 (手机端)
               lg:hidden -> 只在手机/平板显示
               改了 padding 和背景色，让它看起来更像原生 App 的 Tab
            */}
            <div className="flex border-b border-gray-100 bg-white lg:hidden sticky top-[50px] z-40">
                {[
                    { id: 'rec', label: '综合强推' },
                    { id: 'week', label: '本周热度' },
                    { id: 'day', label: '今日上升' }
                ].map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setMobileTab(tab.id as any)}
                        className={`flex-1 py-3 text-sm font-bold transition-all border-b-2 ${
                            mobileTab === tab.id 
                            ? 'border-blue-600 text-blue-600' 
                            : 'border-transparent text-gray-500'
                        }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {loading ? (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {[1,2,3].map(i => <div key={i} className="h-[700px] bg-gray-200 rounded-2xl animate-pulse"></div>)}
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-3 md:gap-8">
                    
                    {/* 1. 综合强推 */}
                    <div className={`${mobileTab === 'rec' ? 'block' : 'hidden'} lg:block`}>
                        <RankingList 
                            title="综合强推" 
                            icon={Star} 
                            books={recList} 
                            rankColor="text-yellow-500"
                            showRating={true}
                        />
                    </div>

                    {/* 2. 本周热度 */}
                    <div className={`${mobileTab === 'week' ? 'block' : 'hidden'} lg:block`}>
                        <RankingList 
                            title="本周热度" 
                            icon={TrendingUp} 
                            books={weekList} 
                            rankColor="text-red-500"
                        />
                    </div>

                    {/* 3. 今日上升 */}
                    <div className={`${mobileTab === 'day' ? 'block' : 'hidden'} lg:block`}>
                        <RankingList 
                            title="今日上升" 
                            icon={Zap} 
                            books={dayList} 
                            rankColor="text-purple-500"
                        />
                    </div>
                </div>
            )}
        </section>

      </div>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <HomeContent />
    </Suspense>
  );
}