'use client'; // 👈 必须放在第一行

import { useEffect, useState, Suspense, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { 
  ChevronLeft, Settings, BookOpen, List, 
  Bookmark, BookmarkCheck, Moon, X, 
  ArrowUpDown, Check, Sun, Type, AlignLeft, MoveHorizontal
} from 'lucide-react';
import { booksApi, chaptersApi, bookmarksApi, Book, Chapter } from '@/lib/api';
import { useReadingSettings } from '@/contexts/ReadingSettingsContext';
import { useAuth } from '@/contexts/AuthContext';

// 1. 阅读器核心组件
function ReaderContent() {
  // 获取路由参数
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  
  const bookId = params.id as string;
  const chapterIdParam = searchParams.get('chapterId');

  // 用户与数据状态
  const { user } = useAuth();
  const [book, setBook] = useState<Book | null>(null);
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [allChapters, setAllChapters] = useState<Chapter[]>([]);
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [loading, setLoading] = useState(true);
  
  // UI 开关状态
  const [showCatalog, setShowCatalog] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [catalogReversed, setCatalogReversed] = useState(false);

  // 导航栏状态
  const [showNav, setShowNav] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);
  
  // ⚙️ 全局设置 (Context)
  const { theme, setTheme } = useReadingSettings();

  // 📖 本地阅读偏好 (Local State)
  const [themeColor, setThemeColor] = useState<'gray' | 'cream' | 'green' | 'blue'>('cream');
  const [fontFamily, setFontFamily] = useState<'sans' | 'serif' | 'kai'>('sans');
  const [fontSizeNum, setFontSizeNum] = useState(20);
  const [lineHeight, setLineHeight] = useState(1.8);
  const [paraSpacing, setParaSpacing] = useState(4);
  const [pageWidth, setPageWidth] = useState<'auto' | '640' | '800' | '900' | '1000' | '1280'>('900');

  // 🎨 配色方案配置表
  const themeMap = {
    cream:  { name: '羊皮纸', bg: '#f6f1e7', text: '#333333', line: '#d4cbb3', panel: '#fffbf0' },
    gray:   { name: '雅致灰', bg: '#f0f0f0', text: '#222222', line: '#dcdcdc', panel: '#ffffff' },
    green:  { name: '护眼绿', bg: '#dcedc8', text: '#222222', line: '#c5e1a5', panel: '#e8f5e9' },
    blue:   { name: '极光蓝', bg: '#e3edfc', text: '#222222', line: '#d0e0f8', panel: '#f0f7ff' },
    dark:   { name: '夜间',   bg: '#1a1a1a', text: '#a0a0a0', line: '#333333', panel: '#252525' },
  };

  const isActuallyDark = theme === 'dark';
  const activeTheme = isActuallyDark ? themeMap.dark : themeMap[themeColor];

  const paraSpacingMap: Record<number, string> = {
    2: '0.5rem',
    4: '1rem',
    6: '1.5rem',
    8: '2rem',
  };

  // --- 初始化数据 ---
  useEffect(() => {
    if (bookId) initData();
  }, [bookId]); 

  // 统计阅读量
  useEffect(() => {
    if (bookId) {
      booksApi.incrementViews(bookId).catch(e => console.error(e));
    }
  }, [bookId, chapterIdParam]);

  useEffect(() => {
    if (bookId && user) checkBookmark();
  }, [bookId, user]);

  // 目录定位
  useEffect(() => {
    if (showCatalog) {
      setTimeout(() => {
        document.getElementById('active-chapter-anchor')?.scrollIntoView({ block: 'center', behavior: 'auto' });
      }, 100);
    }
  }, [showCatalog]);

  // 🔥 滚动监听：下滑隐藏，上滑显示
  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      const diff = currentScrollY - lastScrollY;
      if (Math.abs(diff) < 10) return;

      if (currentScrollY > lastScrollY && currentScrollY > 80) {
        setShowNav(false);
      } else {
        setShowNav(true);
      }
      setLastScrollY(currentScrollY);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [lastScrollY]);

  // 🔥 点击屏幕中央切换导航栏
  const handleContentClick = (e: React.MouseEvent) => {
    // 如果正在选中文本，不触发
    const selection = window.getSelection();
    if (selection && selection.toString().length > 0) return;

    const width = window.innerWidth;
    const x = e.clientX;
    // 点击屏幕中间 40% 区域触发
    if (x > width * 0.3 && x < width * 0.7) {
      setShowNav(prev => !prev);
    }
  };

  useEffect(() => {
    const fetchChapterContent = async () => {
      if (allChapters.length === 0) return;
      const targetId = chapterIdParam || allChapters[0].id;
      setLoading(true);
      try {
        const res = await fetch(`https://website-production-6edf.up.railway.app/api/chapters/${targetId}`);
        if (res.ok) {
          const fullChapter = await res.json();
          setChapter(fullChapter);
        }
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    };
    fetchChapterContent();
  }, [chapterIdParam, allChapters]);

  const initData = async () => {
    try {
      const [bookData, chaptersData] = await Promise.all([
        booksApi.getById(bookId),
        chaptersApi.getByBookId(bookId),
      ]);
      if (bookData) setBook(bookData);
      if (chaptersData) setAllChapters(chaptersData);
      setLoading(false);
    } catch (error) {
      setLoading(false);
    }
  };

  const checkBookmark = async () => {
    try {
      const bookmarked = await bookmarksApi.check(user!.id, bookId);
      setIsBookmarked(!!bookmarked);
    } catch (error) {}
  };

  const toggleBookmark = async () => {
    if (!user) return router.push('/login');
    try {
      if (isBookmarked) {
        await bookmarksApi.delete(user.id, bookId);
        setIsBookmarked(false);
      } else {
        await bookmarksApi.create(user.id, bookId);
        setIsBookmarked(true);
      }
    } catch (error) {}
  };

  const goToChapter = (targetChapterId: string) => {
    router.push(`/read/${bookId}?chapterId=${targetChapterId}`);
    window.scrollTo(0, 0);
  };

  const currentChapterIndex = allChapters.findIndex((ch) => ch.id === chapter?.id);
  const prevChapter = currentChapterIndex > 0 ? allChapters[currentChapterIndex - 1] : null;
  const nextChapter = currentChapterIndex < allChapters.length - 1 ? allChapters[currentChapterIndex + 1] : null;

  const fontFamilyValue = {
    sans: '"PingFang SC", "Microsoft YaHei", sans-serif',
    serif: '"Songti SC", "SimSun", serif',
    kai: '"Kaiti SC", "KaiTi", serif',
  }[fontFamily];

  const displayChapters = catalogReversed ? [...allChapters].reverse() : allChapters;

  // --- 渲染部分 ---

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: activeTheme.bg }}>
      <BookOpen className="h-12 w-12 opacity-50 animate-pulse" style={{ color: activeTheme.text }} />
    </div>
  );

  if (!book || !chapter) return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: activeTheme.bg }}>
       <div className="text-center">
         <h2 className="text-xl font-bold mb-4" style={{ color: activeTheme.text }}>加载失败</h2>
         <Link href={`/book/${bookId}`} className="text-blue-500 underline">返回详情</Link>
       </div>
    </div>
  );

  return (
    <div 
      className="min-h-screen w-full transition-colors duration-300"
      style={{ backgroundColor: activeTheme.bg }}
    >
      {/* 🔥 导航栏 (集成设置与目录) */}
      <nav
        className="fixed top-0 left-1/2 z-40 h-14 flex items-center justify-between px-4 sm:px-6 border-b shadow-sm transition-all duration-300"
        style={{
          backgroundColor: activeTheme.bg,
          color: activeTheme.text,
          borderColor: activeTheme.line,
          maxWidth: pageWidth === 'auto' ? '100%' : `${pageWidth}px`, // 宽度跟随页面设置
          width: '100%',
          transform: `translate(-50%, ${showNav ? '0' : '-100%'})`,
        }}
      >
        {/* 左侧：Logo + 九天 */}
        <Link href="/" className="flex items-center gap-2 hover:opacity-70 transition-opacity">
          <BookOpen className="w-5 h-5 text-blue-600" />
          <span className="font-bold text-lg tracking-tight">九天</span>
        </Link>

        {/* 右侧：功能按钮组 */}
        <div className="flex items-center gap-2 sm:gap-4">
          <button 
            onClick={() => setShowCatalog(true)}
            className="p-2 hover:bg-black/5 rounded-full transition-colors"
            title="目录"
          >
            <List className="w-5 h-5" />
          </button>
          
          <button 
            onClick={() => setShowSettings(!showSettings)}
            className={`p-2 hover:bg-black/5 rounded-full transition-colors ${showSettings ? 'bg-black/5 text-blue-500' : ''}`}
            title="设置"
          >
            <Settings className="w-5 h-5" />
          </button>

          <Link 
            href="/library" 
            className="flex items-center gap-1 px-3 py-1.5 text-xs sm:text-sm font-medium border rounded-full hover:bg-black/5 transition-all"
            style={{ borderColor: activeTheme.line }}
          >
            书架
          </Link>
        </div>
      </nav>

      {/* 主体内容容器 */}
      <div 
        className="mx-auto relative transition-all duration-300 min-h-screen"
        style={{ maxWidth: pageWidth === 'auto' ? '800px' : `${pageWidth}px` }} 
        onClick={handleContentClick}
      >
        <article 
          className="w-full min-h-screen px-4 md:px-8 lg:px-12 pt-20 pb-20 transition-colors duration-300"
          style={{ backgroundColor: activeTheme.bg, color: activeTheme.text }}
        >
          {/* 标题区 */}
          <div className="mb-8 border-b pb-4" style={{ borderColor: activeTheme.line }}>
            <h1 className="text-2xl md:text-3xl font-bold mb-3">
              {chapter.title.startsWith('第') ? chapter.title : `第${chapter.chapter_number}章 ${chapter.title}`}
            </h1>
            <div className="text-xs opacity-60 flex flex-wrap gap-3">
              <span>{book.title}</span>
              <span>{book.author || '未知'}</span>
              <span>字数：{chapter.content?.length || 0}</span>
            </div>
          </div>

          {/* 正文内容 */}
          <div 
            className="text-justify break-words"
            style={{ 
              fontFamily: fontFamilyValue, 
              fontSize: `${fontSizeNum}px`,
              lineHeight: lineHeight
            }}
          >
            {(chapter.content || '').split('\n').map((para, i) => {
              const text = para.trim();
              if (!text) return null;
              
              return (
                <p 
                  key={i} 
                  style={{ 
                    textIndent: '2em',
                    marginBottom: paraSpacingMap[paraSpacing] || '1rem'
                  }}
                >
                  {text}
                </p>
              );
            })}
          </div>

          {/* 底部导航 (优化按钮样式) */}
          <div className="mt-16 flex items-center justify-between gap-4">
            <button 
              disabled={!prevChapter}
              onClick={(e) => { e.stopPropagation(); prevChapter && goToChapter(prevChapter.id); }}
              className="flex-1 py-3 rounded-lg border text-sm font-medium hover:bg-black/5 disabled:opacity-30 disabled:hover:bg-transparent transition-all"
              style={{ borderColor: activeTheme.line }}
            >
              上一章
            </button>
            
            <button 
              disabled={!nextChapter}
              onClick={(e) => { e.stopPropagation(); nextChapter && goToChapter(nextChapter.id); }}
              className="flex-1 py-3 rounded-lg bg-blue-600 text-white text-sm font-medium shadow-md hover:bg-blue-700 disabled:opacity-50 disabled:bg-gray-400 transition-all"
            >
              {nextChapter ? '下一章' : '已是最新'}
            </button>
          </div>
        </article>
      </div>

      {/* 目录弹窗 */}
      {showCatalog && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex justify-end" onClick={() => setShowCatalog(false)}>
          <div 
            className="w-[85%] max-w-sm h-full shadow-2xl flex flex-col transition-colors animate-in slide-in-from-right" 
            style={{ backgroundColor: activeTheme.panel, color: activeTheme.text }} 
            onClick={e => e.stopPropagation()}
          >
            <div className="p-4 border-b flex justify-between items-center shrink-0" style={{ borderColor: activeTheme.line }}>
              <div className="flex items-center gap-2">
                 <h2 className="text-lg font-bold">目录</h2>
                 <span className="text-xs opacity-60">({allChapters.length}章)</span>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setCatalogReversed(!catalogReversed)} className="p-1.5 hover:bg-black/5 rounded" title="排序">
                   <ArrowUpDown className="w-4 h-4"/>
                </button>
                <button onClick={() => setShowCatalog(false)} className="p-1.5 hover:bg-black/5 rounded">
                   <X className="w-5 h-5"/>
                </button>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
              {displayChapters.map(ch => {
                const isActive = ch.id === chapter.id;
                return (
                  <button 
                    key={ch.id} 
                    id={isActive ? 'active-chapter-anchor' : undefined}
                    onClick={() => { goToChapter(ch.id); setShowCatalog(false); }}
                    className={`w-full text-left py-3 px-3 rounded-lg text-sm truncate mb-1 transition-colors
                      ${isActive ? 'bg-blue-50 text-blue-600 font-medium' : 'hover:bg-black/5'}`}
                  >
                    {ch.title.startsWith('第') ? ch.title : `第${ch.chapter_number}章 ${ch.title}`}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 设置弹窗 (紧凑型，位于顶部导航栏下方) */}
      {showSettings && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowSettings(false)} />
          <div 
            className="fixed top-16 right-4 sm:right-10 z-50 w-[320px] rounded-xl shadow-xl border p-5 animate-in fade-in zoom-in-95 origin-top-right"
            style={{ 
              backgroundColor: activeTheme.panel, 
              color: activeTheme.text,
              borderColor: activeTheme.line 
            }}
          >
            <div className="space-y-5">
              
              {/* 1. 主题与夜间模式 */}
              <div className="flex justify-between items-center">
                 <span className="text-sm font-bold opacity-80">阅读主题</span>
                 <button 
                    onClick={() => setTheme(isActuallyDark ? 'light' : 'dark')}
                    className="flex items-center gap-1 text-xs px-2 py-1 rounded-full border hover:bg-black/5"
                    style={{ borderColor: activeTheme.line }}
                 >
                    {isActuallyDark ? <Sun className="w-3 h-3"/> : <Moon className="w-3 h-3"/>}
                    {isActuallyDark ? '日间' : '夜间'}
                 </button>
              </div>
              <div className="flex justify-between gap-2">
                {Object.entries(themeMap).filter(([k]) => k !== 'dark').map(([key, val]) => (
                  <button 
                    key={key} 
                    disabled={isActuallyDark}
                    onClick={() => setThemeColor(key as any)}
                    className={`w-8 h-8 rounded-full border flex items-center justify-center transition-all ${themeColor === key && !isActuallyDark ? 'ring-2 ring-blue-500' : ''}`}
                    style={{ backgroundColor: val.bg, borderColor: activeTheme.line }}
                  >
                    {themeColor === key && !isActuallyDark && <Check className="w-4 h-4 text-green-600" />}
                  </button>
                ))}
              </div>

              {/* 2. 字号 */}
              <div className="space-y-2">
                 <div className="flex justify-between text-xs opacity-60">
                    <span>字号</span>
                    <span>{fontSizeNum}px</span>
                 </div>
                 <div className="flex items-center gap-3 bg-black/5 rounded-lg p-1">
                    <button onClick={() => setFontSizeNum(Math.max(12, fontSizeNum - 2))} className="flex-1 py-1 hover:bg-white/50 rounded text-xs">A-</button>
                    <div className="w-px h-3 bg-gray-300"></div>
                    <button onClick={() => setFontSizeNum(Math.min(48, fontSizeNum + 2))} className="flex-1 py-1 hover:bg-white/50 rounded text-sm font-bold">A+</button>
                 </div>
              </div>

              {/* 3. 字体 */}
              <div className="space-y-2">
                 <span className="text-xs opacity-60">字体</span>
                 <div className="flex gap-2">
                    {['sans', 'serif', 'kai'].map(f => (
                       <button
                          key={f}
                          onClick={() => setFontFamily(f as any)}
                          className={`flex-1 py-1.5 text-xs border rounded-md transition-colors ${fontFamily === f ? 'border-blue-500 text-blue-500' : 'border-transparent bg-black/5 hover:bg-black/10'}`}
                       >
                          {f === 'sans' ? '黑体' : f === 'serif' ? '宋体' : '楷体'}
                       </button>
                    ))}
                 </div>
              </div>

              {/* 4. 排版 (行高 & 宽度) */}
              <div className="grid grid-cols-2 gap-4">
                 <div className="space-y-2">
                    <span className="text-xs opacity-60">行间距</span>
                    <button onClick={() => setLineHeight(lineHeight === 1.8 ? 2.2 : 1.8)} className="w-full py-1.5 text-xs bg-black/5 rounded-md hover:bg-black/10 flex items-center justify-center gap-2">
                       <AlignLeft className="w-3 h-3"/> {lineHeight === 1.8 ? '适中' : '宽松'}
                    </button>
                 </div>
                 <div className="space-y-2">
                    <span className="text-xs opacity-60">页宽</span>
                    <button onClick={() => setPageWidth(pageWidth === '900' ? 'auto' : '900')} className="w-full py-1.5 text-xs bg-black/5 rounded-md hover:bg-black/10 flex items-center justify-center gap-2">
                       <MoveHorizontal className="w-3 h-3"/> {pageWidth === 'auto' ? '全屏' : '居中'}
                    </button>
                 </div>
              </div>

            </div>
          </div>
        </>
      )}

    </div>
  );
}

// 2. 导出组件
export default function ReaderPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">加载中...</div>}>
      <ReaderContent />
    </Suspense>
  );
}