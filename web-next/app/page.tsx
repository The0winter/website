'use client';

import { useEffect, useState, useMemo, Suspense, useCallback } from 'react';
import Link from 'next/link';
// 引入图标
import { 
  BookOpen, TrendingUp, Star, Zap, ChevronRight,
  Sparkles, Sword, Building2, History, Rocket, ImageOff,
  Search, User, Library, LayoutGrid, PenTool, Trophy
} from 'lucide-react';
import { booksApi, Book } from '@/lib/api';

// --- 0. 分类配置 (保持不变) ---
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

// --- 1. 单个榜单子组件 (保持不变) ---
const RankingList = ({ title, icon: Icon, books, rankColor, showRating = false }: any) => (
  <div className="bg-white md:rounded-xl shadow-sm md:border border-gray-100 flex flex-col h-full overflow-hidden">
    
    <div className="hidden md:flex p-5 border-b border-gray-50 items-center justify-between bg-gradient-to-r from-gray-50 to-white">
      <div className="flex items-center gap-3">
        <Icon className={`w-6 h-6 ${rankColor}`} />
        <h3 className="font-extrabold text-gray-800 text-xl">{title}</h3>
      </div>
      <span className="text-xs text-gray-400 uppercase tracking-wider font-medium bg-white px-2 py-1 rounded border border-gray-100">TOP 10</span>
    </div>

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
            <div className={`
              w-6 h-6 md:w-7 md:h-7 flex-shrink-0 flex items-center justify-center rounded-lg text-xs md:text-sm font-extrabold mt-1
              ${index === 0 ? 'bg-red-500 text-white shadow-red-200 shadow-md transform scale-110' : ''}
              ${index === 1 ? 'bg-orange-500 text-white shadow-orange-200 shadow-md' : ''}
              ${index === 2 ? 'bg-yellow-500 text-white shadow-yellow-200 shadow-md' : ''}
              ${index > 2 ? 'bg-gray-100 text-gray-400' : ''}
            `}>
              {index + 1}
            </div>

            <div className="relative w-16 h-20 md:w-20 md:h-28 flex-shrink-0 rounded-md shadow-sm border border-gray-200 overflow-hidden group-hover:shadow-lg transition-all duration-300 group-hover:-translate-y-1">
               {book.cover_image ? (
                 <img src={book.cover_image} alt={book.title} className="w-full h-full object-cover" />
               ) : (
                 <div className="w-full h-full bg-gray-100 flex items-center justify-center">
                    <BookOpen className="w-8 h-8 text-gray-300" />
                 </div>
               )}
            </div>

            <div className="flex-1 min-w-0 flex flex-col justify-between h-20 md:h-28 py-0.5 md:py-1">
              <div>
                  <h4 className="text-sm md:text-[16px] font-extrabold text-gray-800 leading-snug line-clamp-1 md:line-clamp-2 group-hover:text-blue-600 transition-colors mb-1 md:mb-2">
                    {book.title}
                  </h4>
                  
                  <div className="flex items-center text-xs text-gray-500 gap-2 md:gap-3 mb-1 md:mb-3">
                    <span className="truncate max-w-[100px] hover:text-gray-900 font-medium">
                        {book.author || (book.author_id as any)?.username || '未知'}
                    </span>
                    <span className="hidden md:block w-px h-3 bg-gray-300"></span>
                    <span className="hidden md:block bg-gray-100 px-2.5 py-1 rounded-md text-xs text-gray-600">
                        {book.category || '综合'}
                    </span>
                  </div>
              </div>

              <div className="text-xs text-gray-400 flex items-center mt-auto">
                  <span>{(book.views || 0).toLocaleString()} 浏览</span>
              </div>
            </div>
            
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
  const [loading, setLoading] = useState(true);
  
  const [mobileTab, setMobileTab] = useState<'rec' | 'week' | 'day'>('rec');

  // 轮播图状态
  const [activeBookIndex, setActiveBookIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isTouching, setIsTouching] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const books = await booksApi.getAll(); 
        setAllBooks(books);
        
        const sortedForFeature = [...books].sort((a: any, b: any) => (b.views || 0) - (a.views || 0));
        setFeaturedBooks(sortedForFeature.slice(0, 3));
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const sliderList = useMemo(() => {
      if (featuredBooks.length === 0) return [];
      return [...featuredBooks, featuredBooks[0]];
  }, [featuredBooks]);

  const handleNext = useCallback(() => {
      if (featuredBooks.length === 0) return;
      setActiveBookIndex(prev => {
          if (prev >= featuredBooks.length) return prev;
          return prev + 1;
      });
  }, [featuredBooks.length]);

  const handlePrev = useCallback(() => {
      if (featuredBooks.length === 0) return;
      setActiveBookIndex(prev => {
          if (prev === 0) {
              return featuredBooks.length - 1;
          }
          return prev - 1;
      });
  }, [featuredBooks.length]);

  useEffect(() => {
      if (activeBookIndex === featuredBooks.length && featuredBooks.length > 0) {
          const timer = setTimeout(() => {
              setIsTransitioning(false);
              setActiveBookIndex(0);
              requestAnimationFrame(() => {
                  requestAnimationFrame(() => {
                      setIsTransitioning(true);
                  });
              });
          }, 500);
          return () => clearTimeout(timer);
      }
  }, [activeBookIndex, featuredBooks.length]);

  useEffect(() => {
    if (isPaused || isTouching || featuredBooks.length <= 1) return;
    const intervalId = window.setInterval(handleNext, 3000);
    return () => window.clearInterval(intervalId);
  }, [handleNext, isPaused, isTouching, featuredBooks.length, activeBookIndex]);

  const [touchStart, setTouchStart] = useState(0);
  const [touchEnd, setTouchEnd] = useState(0);

  const handleTouchStart = (e: React.TouchEvent) => {
      setIsTouching(true);
      setTouchStart(e.targetTouches[0].clientX);
  };
  
  const handleTouchMove = (e: React.TouchEvent) => {
      setTouchEnd(e.targetTouches[0].clientX);
  };

  const handleTouchEnd = () => {
      setIsTouching(false);
      if (!touchStart || !touchEnd) return;
      const distance = touchStart - touchEnd;
      if (distance > 50) handleNext();
      if (distance < -50) handlePrev();
      setTouchStart(0);
      setTouchEnd(0);
  };

  const { recList, weekList, dayList } = useMemo(() => {
    const rec = [...allBooks].sort((a: any, b: any) => {
        const scoreA = ((a.rating || 0) * 100 * 0.6) + ((a.weekly_views || 0) * 0.4);
        const scoreB = ((b.rating || 0) * 100 * 0.6) + ((b.weekly_views || 0) * 0.4);
        return scoreB - scoreA;
    }).slice(0, 10);

    const week = [...allBooks].sort((a: any, b: any) => (b.weekly_views || 0) - (a.weekly_views || 0)).slice(0, 10);
    const day = [...allBooks].sort((a: any, b: any) => (b.daily_views || 0) - (a.daily_views || 0)).slice(0, 10);

    return { recList: rec, weekList: week, dayList: day };
  }, [allBooks]);

  const categoryBooks = useMemo(() => {
      const targetCategory = categories.find(c => c.slug === selectedCategory);
      return allBooks.filter(book => {
          if (selectedCategory === 'all') return true;
          return targetCategory && book.category === targetCategory.name;
      }).sort((a: any, b: any) => (b.views || 0) - (a.views || 0));
  }, [allBooks, selectedCategory]);

    return (
      <div className="min-h-screen bg-[#f8f9fa] pb-12">
        
        {/* 🔥🔥🔥 修改点：彻底删除了顶部的黑色导航栏 div === */}

        <div className="max-w-[1400px] mx-auto md:px-4 md:py-8 flex flex-col gap-0 md:gap-10">
        
          {/* === 轮播图区域 === */}
          <section className="w-full" onMouseLeave={() => setIsPaused(false)}>
            {featuredBooks.length > 0 ? (
              // 🔥🔥🔥 修改点：增加 flex 布局，将轮播图和右侧图标栏并排 ===
              <div className="bg-white md:rounded-2xl shadow-sm border-b md:border border-gray-200 overflow-hidden w-full flex">
                
                {/* --- 左侧：原有的轮播图 + 底部导航 (flex-1 占满剩余空间) --- */}
                <div className="flex-1 flex flex-col min-w-0 border-r border-white/5 relative">
                    <div 
                      className="relative h-[220px] md:h-[380px] w-full overflow-hidden group"
                      onMouseEnter={() => setIsPaused(true)}
                      onTouchStart={handleTouchStart}
                      onTouchMove={handleTouchMove}
                      onTouchEnd={handleTouchEnd}
                    >
                      <div 
                          className={`flex h-full ease-out ${isTransitioning ? 'transition-transform duration-500' : ''}`}
                          style={{ transform: `translateX(-${activeBookIndex * 100}%)` }}
                      >
                          {sliderList.map((book, index) => (
                              <Link 
                                  key={`${book.id}-${index}`} 
                                  href={`/book/${book.id}`} 
                                  className="min-w-full h-full relative block"
                                  draggable={false}
                              >
                                  <div className="relative h-full bg-gradient-to-br from-gray-900 to-black select-none">
                                      {book.cover_image && (
                                          <div className="absolute inset-0">
                                              <img src={book.cover_image} alt={book.title} className="w-full h-full object-cover opacity-40 blur-2xl scale-110" draggable={false} />
                                              <div className="absolute inset-0 bg-gradient-to-r from-black via-black/60 to-transparent"></div>
                                          </div>
                                      )}
                                      
                                      <div className="relative h-full flex items-center p-5 md:p-10 gap-10 max-w-6xl mx-auto">
                                          {book.cover_image && (
                                              <img src={book.cover_image} alt={book.title} className="w-48 h-72 object-cover rounded-lg shadow-2xl border-2 border-white/10 flex-shrink-0 hidden md:block transform hover:scale-105 transition-transform duration-500" />
                                          )}
                                          <div className="flex-1 text-white">
                                              <span className="inline-block bg-red-600 text-white text-[10px] md:text-xs font-bold px-2 py-0.5 md:px-3 md:py-1 rounded-full mb-2 md:mb-4 tracking-wide shadow-lg shadow-red-900/50">
                                                  重磅推荐
                                              </span>
                                              <h3 className="text-2xl md:text-5xl font-black mb-2 md:mb-4 tracking-tight drop-shadow-lg line-clamp-1">
                                                  {book.title}
                                              </h3>
                                              
                                              <p className="flex items-center gap-4 text-white/80 text-xs md:text-sm mb-2 md:mb-6 font-medium">
                                                  <span className="flex items-center gap-2">
                                                      <span className="w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-blue-400"></span>
                                                      {book.author || '未知'}
                                                  </span>
                                                  <span className="text-white/20">|</span>
                                                  <span className="bg-white/10 px-2 py-0.5 md:px-3 rounded-full backdrop-blur-sm">
                                                      {book.category || '综合'}
                                                  </span>
                                              </p>
                                              
                                              <p className="text-gray-300 text-xs md:text-base leading-relaxed line-clamp-2 md:line-clamp-3 max-w-2xl font-light">
                                                  {book.description || '暂无简介'}
                                              </p>
                                          </div>
                                      </div>
                                  </div>
                              </Link>
                          ))}
                      </div>

                      <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-2 z-20">
                          {featuredBooks.map((_, index) => (
                              <button
                                  key={index}
                                  onClick={(e) => {
                                      e.preventDefault(); 
                                      setIsTransitioning(true); 
                                      setActiveBookIndex(index);
                                  }}
                                  className={`h-1.5 rounded-full transition-all duration-300 ${
                                      (activeBookIndex % featuredBooks.length) === index 
                                      ? 'w-6 bg-white shadow-sm' 
                                      : 'w-1.5 bg-white/40 hover:bg-white/60'
                                  }`}
                              />
                          ))}
                      </div>
                    </div>

                    <div className="bg-[#1a1a1a] border-t border-white/5 hidden lg:block flex-shrink-0">
                      <div className="max-w-6xl mx-auto grid grid-cols-3 divide-x divide-white/5">
                        {featuredBooks.map((book, index) => (
                          <button
                            key={book.id}
                            onClick={() => {
                                setIsTransitioning(true);
                                setActiveBookIndex(index);
                            }}
                            className={`px-4 py-5 text-sm transition-all relative overflow-hidden group text-left ${
                              (activeBookIndex % featuredBooks.length) === index ? 'bg-white/5' : 'hover:bg-white/5'
                            }`}
                          >
                            {(activeBookIndex % featuredBooks.length) === index && (
                                <div className="absolute top-0 left-0 w-full h-0.5 bg-red-600 shadow-[0_0_10px_rgba(220,38,38,0.8)]"></div>
                            )}
                            <span className={`block font-bold mb-0.5 line-clamp-1 ${
                                (activeBookIndex % featuredBooks.length) === index ? 'text-white' : 'text-gray-400 group-hover:text-gray-200'
                            }`}>
                              {book.title}
                            </span>
                            <span className="text-xs text-gray-600 group-hover:text-gray-500">{book.category || '综合'}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                </div>

                {/* --- 🔥🔥🔥 右侧：新增的图标栏 (PC端显示) --- */}
                {/* 改动说明：
                    1. w-[80px] -> w-[110px]：加宽了，图标更舒展。
                    2. 删除了 border-l border-white/10：去掉了生硬的白线。
                    3. 新增 shadow-[-10px_0_30px_rgba(0,0,0,0.5)]：用左侧阴影代替线条，过渡更自然。
                    4. bg-[#222]：颜色微调，更有质感。
                */}
                <div className="hidden md:flex flex-col w-[110px] bg-[#222] shrink-0 z-10 shadow-[-10px_0_30px_rgba(0,0,0,0.5)]">
                    <Link href="#ranking" className="flex-1 flex flex-col items-center justify-center gap-3 group hover:bg-white/5 transition-all text-gray-400 hover:text-white relative overflow-hidden">
                        <div className="p-3 rounded-full bg-white/5 group-hover:bg-yellow-500/20 transition-colors">
                           <Trophy className="w-6 h-6 text-yellow-500/80 group-hover:text-yellow-400 group-hover:scale-110 transition-transform" />
                        </div>
                        <span className="text-xs font-bold tracking-widest opacity-80 group-hover:opacity-100">排行</span>
                    </Link>
                    
                    <Link href="#category" onClick={() => {
                        document.querySelector('.category-section')?.scrollIntoView({ behavior: 'smooth' });
                    }} className="flex-1 flex flex-col items-center justify-center gap-3 group hover:bg-white/5 transition-all text-gray-400 hover:text-white relative overflow-hidden">
                        <div className="p-3 rounded-full bg-white/5 group-hover:bg-blue-500/20 transition-colors">
                            <LayoutGrid className="w-6 h-6 text-blue-400/80 group-hover:text-blue-300 group-hover:scale-110 transition-transform" />
                        </div>
                        <span className="text-xs font-bold tracking-widest opacity-80 group-hover:opacity-100">分类</span>
                    </Link>
                    
                    <Link href="/authors" className="flex-1 flex flex-col items-center justify-center gap-3 group hover:bg-white/5 transition-all text-gray-400 hover:text-white relative overflow-hidden">
                         <div className="p-3 rounded-full bg-white/5 group-hover:bg-pink-500/20 transition-colors">
                            <PenTool className="w-6 h-6 text-pink-400/80 group-hover:text-pink-300 group-hover:scale-110 transition-transform" />
                         </div>
                        <span className="text-xs font-bold tracking-widest opacity-80 group-hover:opacity-100">作者</span>
                    </Link>
                </div>

              </div>
            ) : (
              <div className="h-[220px] md:h-[380px] bg-gray-200 md:rounded-xl animate-pulse flex items-center justify-center text-gray-400">
                {loading ? '加载精彩内容...' : '暂无推荐'}
              </div>
            )}
          </section>

          {/* === 三大榜单区域 === */}
          <section className="w-full" id="ranking">
              
              {/* 移动端 Tab 栏 */}
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
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                      
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

          {/* === 分类浏览区域 === */}
          <section className="w-full hidden md:block category-section">
              <div className="flex items-center gap-3 mb-6">
                <LayoutGrid className="w-6 h-6 text-gray-800" />
                <h2 className="text-2xl font-black text-gray-900">分类书库</h2>
              </div>

              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 flex flex-col gap-8 min-h-[500px]">
                {/* 分类按钮 */}
                <nav className="flex flex-wrap items-center gap-3 border-b border-gray-100 pb-6">
                  {categories.map((category) => {
                    const Icon = category.icon;
                    const isSelected = selectedCategory === category.slug;
                    return (
                      <button
                        key={category.slug}
                        onClick={() => setSelectedCategory(category.slug)}
                        className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm transition-all cursor-pointer border flex-shrink-0 ${
                            isSelected
                            ? 'bg-gray-900 text-white font-bold border-gray-900 shadow-lg shadow-gray-200'
                            : 'text-gray-600 border-gray-100 hover:border-gray-300 hover:bg-gray-50'
                        }`}
                      >
                        <Icon className={`h-4 w-4 ${isSelected ? 'text-white' : 'text-gray-400'}`} />
                        <span>{category.name}</span>
                      </button>
                    );
                  })}
                </nav>

                {/* 分类下对应的书籍展示 (Grid 布局) */}
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-6">
                  {categoryBooks.length > 0 ? (
                    categoryBooks.map((book: any) => (
                      <Link 
                        key={book.id}
                        href={`/book/${book.id}`}
                        className="group flex flex-col gap-3"
                      >
                        <div className="aspect-[3/4] rounded-lg overflow-hidden bg-gray-100 shadow-sm border border-gray-200 relative">
                            {book.cover_image ? (
                              <img 
                                src={book.cover_image} 
                                alt={book.title} 
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" 
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-gray-300">
                                <BookOpen className="w-10 h-10" />
                              </div>
                            )}
                            <div className="absolute top-2 right-2 bg-black/50 backdrop-blur-sm text-white text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1">
                              <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
                              {book.rating?.toFixed(1) || '0.0'}
                            </div>
                        </div>
                        <div>
                          <h4 className="font-bold text-gray-900 line-clamp-1 group-hover:text-blue-600 transition-colors">
                            {book.title}
                          </h4>
                          <div className="flex items-center justify-between text-xs text-gray-500 mt-1">
                            <span>{book.author || '未知'}</span>
                            <span>{book.views > 10000 ? `${(book.views/10000).toFixed(1)}万` : book.views}热度</span>
                          </div>
                        </div>
                      </Link>
                    ))
                  ) : (
                    <div className="col-span-full py-20 flex flex-col items-center justify-center text-gray-400">
                       <Search className="w-12 h-12 mb-4 text-gray-200" />
                       <p>该分类下暂无书籍</p>
                    </div>
                  )}
                </div>
              </div>
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