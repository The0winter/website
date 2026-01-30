// src/app/page.tsx
'use client'; // <--- 关键：必须加这行，因为你用了 useState 和 useEffect

import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link'; // <--- 改动：使用 Next.js 的 Link
import { useSearchParams } from 'next/navigation'; // <--- 改动：使用 Next.js 的 hook
import { BookOpen, Sparkles, Sword, Building2, History, Rocket } from 'lucide-react';
// 确保你的 api 文件路径是正确的，如果报错请调整路径
import { booksApi, Book } from '@/lib/api';

// 分类数据 (保持不变)
const categories = [
  { name: '全部', icon: BookOpen, slug: 'all' },
  { name: '玄幻', icon: Sparkles, slug: 'fantasy' },
  { name: '仙侠', icon: Sword, slug: 'wuxia' },
  { name: '都市', icon: Building2, slug: 'urban' },
  { name: '历史', icon: History, slug: 'history' },
  { name: '科幻', icon: Rocket, slug: 'sci-fi' },
  // 👇 新增这几个，确保你在后台选的分类这里也有
  { name: '奇幻', icon: Sparkles, slug: 'magic' },
  { name: '体育', icon: Rocket, slug: 'sports' },
  { name: '军事', icon: Sword, slug: 'military' },
  { name: '悬疑', icon: History, slug: 'mystery' },
];

// 为了使用 useSearchParams，我们需要包裹一层 Suspense，这是 Next.js 的规范
function HomeContent() {
  const searchParams = useSearchParams();
  const searchQuery = searchParams.get('q') || '';
  
  const [featuredBooks, setFeaturedBooks] = useState<Book[]>([]);
  const [allBooks, setAllBooks] = useState<Book[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [activeBookIndex, setActiveBookIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBooks();
  }, []);

  const fetchBooks = async () => {
    try {
      // 获取推荐书籍 (Top 5)
      const featured = await booksApi.getAll({ orderBy: 'views', order: 'desc', limit: 5 });
      setFeaturedBooks(featured);

      // 获取所有书籍
      const books = await booksApi.getAll();
      setAllBooks(books);
    } catch (error) {
      console.error('Error fetching books:', error);
    } finally {
      setLoading(false);
    }
  };

  // 轮播图自动播放逻辑
  useEffect(() => {
    if (isPaused || featuredBooks.length <= 1) return;
    const intervalId = window.setInterval(() => {
      setActiveBookIndex((prevIndex) => (prevIndex + 1) % featuredBooks.length);
    }, 3000);
    return () => window.clearInterval(intervalId);
  }, [featuredBooks, isPaused, activeBookIndex]);

// 筛选逻辑
  const filteredBooks = allBooks.filter((book) => {
    // 1. 先找到当前选中的分类配置对象
    // 比如：你选中了 'fantasy'，这里就会找到 { name: '玄幻', slug: 'fantasy' ... }
    const targetCategory = categories.find(c => c.slug === selectedCategory);

    // 2. 比对逻辑
    const matchesCategory =
      selectedCategory === 'all' || // 如果选的是“全部”，直接通过
      (targetCategory && book.category === targetCategory.name); // 否则：比对数据库里的中文名 ("玄幻") 和配置里的中文名 ("玄幻")

    const matchesSearch =
      !searchQuery ||
      book.title.toLowerCase().includes(searchQuery.toLowerCase());
      
    return matchesCategory && matchesSearch;
  });

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <BookOpen className="h-12 w-12 text-blue-600 animate-pulse mx-auto" />
          <p className="mt-4 text-gray-600">加载中...</p>
        </div>
      </div>
    );
  }

  const activeBook = featuredBooks[activeBookIndex] || featuredBooks[0];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 顶部导航条 */}
      <div className="w-full bg-[#3e3d43] h-[40px]">
        <div className="max-w-4xl mx-auto h-full flex justify-between items-center text-white text-[14px] px-2">
          {['全部作品', '排行', '完本', '免费', 'VIP', '作家专区'].map((item) => (
            <Link
              key={item}
              href="#" // <--- 改动：to 变成了 href
              className="hover:text-red-500 transition-colors whitespace-nowrap"
            >
              {item}
            </Link>
          ))}
        </div>
      </div>

      {/* 主要内容区域 */}
      <div className="max-w-[1200px] mx-auto px-4 py-6 flex flex-col gap-8">
        
        {/* 轮播图区域 */}
        <section className="w-full" onMouseLeave={() => setIsPaused(false)}>
          {featuredBooks.length > 0 && activeBook ? (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden w-full">
              {/* 轮播主图 */}
              <Link
                href={`/book/${activeBook.id}`} // <--- 改动：to 变成了 href
                className="block w-full h-full"
              >
                <div
                  className="relative h-80 bg-gradient-to-br from-blue-600 to-purple-700"
                  onMouseEnter={() => setIsPaused(true)}
                >
                  {activeBook.cover_image ? (
                    <img
                      src={activeBook.cover_image}
                      alt={activeBook.title}
                      className="w-full h-full object-cover cursor-pointer hover:opacity-90 transition-opacity"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <BookOpen className="h-24 w-24 text-white/50" />
                    </div>
                  )}
                  {/* 书籍信息遮罩 */}
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-6">
                    <h3 className="text-2xl font-bold text-white mb-2">{activeBook.title}</h3>
                      <p className="text-white/90 text-sm mb-1">
                      {/* 👇 优先读 author 字符串，读不到再尝试去 author_id 里找 */}
                      by {activeBook.author || (activeBook.author_id as any)?.username || 'Unknown'}
                     </p>
                    <p className="text-white/80 text-sm line-clamp-2">
                      {activeBook.description || '暂无简介'}
                    </p>
                  </div>
                </div>
              </Link>

              {/* 轮播图下方的 Tabs 导航 */}
              <div className="bg-gray-900/60">
                <div className="grid grid-cols-5">
                  {featuredBooks.map((book, index) => (
                    <button
                      key={book.id}
                      onClick={() => setActiveBookIndex(index)}
                      className={`px-4 py-3 text-sm font-medium transition-all ${
                        index === activeBookIndex
                          ? 'bg-red-600 text-white'
                          : 'bg-black/60 text-gray-300 hover:bg-black/80'
                      }`}
                    >
                      <span className="line-clamp-1">{book.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
              <BookOpen className="h-16 w-16 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-600 text-lg">暂无推荐书籍</p>
            </div>
          )}
        </section>

        {/* 分类 + 书籍列表 */}
        <div className="flex flex-col">
          {/* 分类筛选栏 */}
          <section className="w-full">
            <div className="bg-white rounded-t-xl rounded-b-none shadow-sm border border-gray-200 border-b-0 p-6">
              <nav className="flex flex-row flex-wrap items-center">
                {categories.map((category, index) => {
                  const Icon = category.icon;
                  const isLast = index === categories.length - 1;
                  const isSelected = selectedCategory === category.slug;
                  return (
                    <span key={category.slug} className="flex items-center">
                      <button
                        onClick={() => setSelectedCategory(category.slug)}
                        className={`flex items-center space-x-2 text-lg transition-colors cursor-pointer ${
                          isSelected
                            ? 'text-red-600 font-bold'
                            : 'text-gray-500 hover:text-red-600'
                        }`}
                      >
                        <Icon className="h-5 w-5" />
                        <span>{category.name}</span>
                      </button>
                      {!isLast && <span className="h-5 w-px bg-gray-300 mx-5" />}
                    </span>
                  );
                })}
              </nav>
            </div>
          </section>

          {/* 书籍网格 */}
          <section className="w-full">
            <div className="bg-white rounded-t-none rounded-b-xl shadow-sm border border-gray-200 p-6">
              {/* 搜索结果提示 */}
              {searchQuery && (
                <div className="mb-4 pb-4 border-b border-gray-200">
                  <p className="text-gray-700">
                    搜索结果: <span className="font-semibold text-red-600">"{searchQuery}"</span>
                  </p>
                </div>
              )}

              {filteredBooks.length > 0 ? (
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-6">
                  {filteredBooks.map((book) => (
                    <Link
                      key={book.id}
                      href={`/book/${book.id}`} // <--- 改动：to 变成了 href
                      className="group"
                    >
                      <div className="bg-gray-100 rounded-lg overflow-hidden aspect-[3/4] mb-3">
                        {book.cover_image ? (
                          <img
                            src={book.cover_image}
                            alt={book.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-blue-500 to-purple-600">
                            <BookOpen className="h-12 w-12 text-white/50" />
                          </div>
                        )}
                      </div>
                      <h3 className="text-sm font-medium text-gray-800 line-clamp-2 group-hover:text-red-600 transition-colors">
                        {book.title}
                      </h3>
                        <p className="text-xs text-gray-500 mt-1">
                          {/* 👇 同样加上 book.author 的优先读取 */}
                          {book.author || (book.author_id as any)?.username || 'Unknown Author'}
                        </p>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <BookOpen className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-500">
                    {searchQuery
                      ? `没有找到匹配 "${searchQuery}" 的书籍`
                      : '该分类下暂无书籍'}
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>
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