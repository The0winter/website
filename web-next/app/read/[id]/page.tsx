'use client'; 

import { useEffect, useState, Suspense } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { 
  Settings, BookOpen, List, 
  Bookmark, BookmarkCheck, Moon, X, 
  ArrowUpDown, Check, Sun, AlignLeft, AlignJustify, User, Info, Library, Type, Layout,
  ChevronLeft // [引用: 新增图标]
} from 'lucide-react';
import { booksApi, chaptersApi, bookmarksApi, Book, Chapter } from '@/lib/api';
import { useReadingSettings } from '@/contexts/ReadingSettingsContext';
import { useAuth } from '@/contexts/AuthContext';

// Hook: 检测是否为大屏设备 (PC端)
function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= 1024);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return isDesktop;
}

function ReaderContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const isDesktop = useIsDesktop(); 
  
  const bookId = params.id as string;
  const chapterIdParam = searchParams.get('chapterId');
  const { user } = useAuth();
  const [book, setBook] = useState<Book | null>(null);
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [allChapters, setAllChapters] = useState<Chapter[]>([]);
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [loading, setLoading] = useState(true);
  
  const [showCatalog, setShowCatalog] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [catalogReversed, setCatalogReversed] = useState(false);

  // 导航栏显示状态 (移动端专用)
  const [showNav, setShowNav] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);
  const { theme, setTheme } = useReadingSettings();

  const [themeColor, setThemeColor] = useState<'gray' | 'cream' | 'green' | 'blue'>('cream');
  const [fontFamily, setFontFamily] = useState<'sans' | 'serif' | 'kai'>('sans');
  const [fontSizeNum, setFontSizeNum] = useState(20);
  const [lineHeight, setLineHeight] = useState(1.8);
  const [paraSpacing, setParaSpacing] = useState(4); 

  // 网页端默认参数调整：加载时如果是大屏，调整默认字号 (改小了) 和行距
  useEffect(() => {
    if (window.innerWidth >= 1024) {
      setFontSizeNum(20); 
      setLineHeight(1.8); 
    }
  }, []);

  // 主题映射
  const themeMap = {
    cream:  { name: '羊皮纸', bg: '#f6f1e7', text: '#333333', line: '#d4cbb3', panel: '#fffbf0', desk: '#e8e4d9' },
    gray:   { name: '雅致灰', bg: '#f0f0f0', text: '#222222', line: '#dcdcdc', panel: '#ffffff', desk: '#dcdcdc' },
    green:  { name: '护眼绿', bg: '#dcedc8', text: '#222222', line: '#c5e1a5', panel: '#e8f5e9', desk: '#cce0b8' },
    blue:   { name: '极光蓝', bg: '#e3edfc', text: '#222222', line: '#d0e0f8', panel: '#f0f7ff', desk: '#d5e2f5' },
    dark:   { name: '夜间',   bg: '#1a1a1a', text: '#a0a0a0', line: '#333333', panel: '#252525', desk: '#121212' },
  };

  const isActuallyDark = theme === 'dark';
  const activeTheme = isActuallyDark ? themeMap.dark : themeMap[themeColor];

  const paraSpacingMap: Record<number, string> = {
    2: '0.5rem', 4: '1rem', 6: '1.5rem', 8: '2rem',
  };
  useEffect(() => { if (bookId) initData(); }, [bookId]); 

  useEffect(() => {
    if (bookId) booksApi.incrementViews(bookId).catch(e => console.error(e));
  }, [bookId, chapterIdParam]);
  useEffect(() => { if (bookId && user) checkBookmark(); }, [bookId, user]);
  useEffect(() => {
    if (showCatalog) {
      setTimeout(() => {
        document.getElementById('active-chapter-anchor')?.scrollIntoView({ block: 'center', behavior: 'auto' });
      }, 100);
    }
  }, [showCatalog]);

  // 滚动监听 (仅影响移动端导航栏显隐)
  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      const diff = currentScrollY - lastScrollY;
      if (Math.abs(diff) < 10) return;
      // 只在移动端或滚动距离较大时隐藏
      // [引用: 下滑隐藏，上滑/点击呼出]
      if (currentScrollY > lastScrollY && currentScrollY > 80) {
        setShowNav(false);
        // 同时关闭设置面板，优化体验
        setShowSettings(false); 
      } else {
        // 上滑时呼出
        setShowNav(true);
      }
    
      setLastScrollY(currentScrollY);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [lastScrollY]);

  // 点击内容显隐菜单
  const handleContentClick = (e: React.MouseEvent) => {
    if (isDesktop) return;
    // 网页端不通过点击正文呼出菜单
    if (window.getSelection()?.toString().length) return;
    const width = window.innerWidth;
    const x = e.clientX;
    // [引用: 点击屏幕中央才会呼出]
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
          setChapter(await res.json());
        }
      } catch (error) { 
        console.error(error); 
      } 
      finally { setLoading(false); }
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
    } catch (error) { setLoading(false); }
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

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: activeTheme.bg }}>
      <BookOpen className="h-12 w-12 opacity-50 animate-pulse" style={{ color: activeTheme.text }} />
    </div>
  );
  if (!book || !chapter) return null;

  return (
    <div 
      className="min-h-screen w-full transition-colors duration-300 flex flex-col items-center"
      style={{ 
        backgroundColor: isDesktop ? activeTheme.desk : activeTheme.bg 
      }}
    >
      {/* ===========================================
        1. 网页端专属导航栏 (只在大屏显示 lg:flex) 
        [引用: 保持网页端功能不变]
        ===========================================
      */}
      <header 
        className="hidden lg:flex fixed top-0 left-0 right-0 z-50 h-16 justify-center pointer-events-none transition-transform duration-300"
      >
        <div 
          className="w-full max-w-[850px] flex items-center justify-between px-12 pointer-events-auto shadow-sm transition-colors duration-300"
          style={{
            backgroundColor: activeTheme.bg, 
            color: activeTheme.text,
            borderColor: activeTheme.line,
            borderBottomWidth: '1px',
            borderLeftWidth: '1px',
            borderRightWidth: '1px',
            transform: showNav ? 'translateY(0)' : 'translateY(-100%)',
          }}
        >
            <Link href="/" className="flex items-center gap-3 hover:opacity-70 transition-opacity">
              <BookOpen className="w-7 h-7 text-blue-600" />
              <span className="font-bold text-2xl tracking-tight">九天</span>
            </Link>

            <div className="flex-1 text-center px-4 overflow-hidden">
              <div className="text-lg font-bold truncate opacity-90 text-gray-700" style={{ color: activeTheme.text }}>
                {chapter.title.startsWith('第') ? chapter.title : `第${chapter.chapter_number}章 ${chapter.title}`}
              </div>
            </div>

            <Link href={user ? `/user/${user.id}` : '/login'} className="flex items-center gap-3 hover:bg-black/5 py-1 px-3 rounded-full transition-colors">
              <div className="text-right hidden xl:block">
                <div className="text-sm font-bold">{user ? (user.username || '书友') : '点击登录'}</div>
                {user && <div className="text-xs opacity-60">个人中心</div>}
              </div>
              <div className="w-10 h-10 rounded-full bg-gray-200 overflow-hidden border border-gray-300 flex items-center justify-center shrink-0">
                 {(user as any)?.avatar ? (
                    <img src={(user as any).avatar} alt="avatar" className="w-full h-full object-cover" />
                ) : (
                    <User className="w-6 h-6 opacity-50" />
                )}
              </div>
            </Link>
        </div>
      </header>


      {/* ===========================================
        2. 移动端 新·顶部导航栏 (只在小屏显示 lg:hidden)
        [引用: 上方为导航栏，移除订阅月票等，左侧返回，右侧头像]
        ===========================================
      */}
      <nav
        className="lg:hidden fixed top-0 left-0 right-0 z-50 h-14 flex items-center justify-between px-4 shadow-sm transition-all duration-300"
        style={{
          backgroundColor: activeTheme.bg,
          color: activeTheme.text,
          borderColor: activeTheme.line,
          borderBottomWidth: '1px',
          transform: `translateY(${showNav ? '0' : '-100%'})`, // 控制显隐
        }}
      >
        {/* 左侧：返回按钮 */}
        <button onClick={() => router.back()} className="p-2 -ml-2 hover:bg-black/5 rounded-full">
           <ChevronLeft className="w-6 h-6" />
        </button>

        {/* 中间：留空 (保持起点极简风格) 或 显示章节标题 */}
        {/* <div className="font-bold text-sm truncate px-4">{chapter.title}</div> */}

        {/* 右侧：用户头像 */}
        <Link href={user ? `/user/${user.id}` : '/login'} className="rounded-full overflow-hidden border border-black/10">
            {(user as any)?.avatar ? (
                <img src={(user as any).avatar} alt="avatar" className="w-8 h-8 object-cover" />
            ) : (
                <div className="w-8 h-8 bg-black/10 flex items-center justify-center">
                    <User className="w-5 h-5 opacity-50" />
                </div>
            )}
        </Link>
      </nav>


      {/* ===========================================
        2.5 移动端 新·底部工具栏 (只在小屏显示 lg:hidden)
        [引用: 下方工具栏，目录在中间，其他删掉只留夜间和设置]
        ===========================================
      */}
      <div
        className="lg:hidden fixed bottom-0 left-0 right-0 z-50 h-16 flex items-center justify-between px-8 border-t transition-all duration-300 pb-safe"
        style={{
            backgroundColor: activeTheme.bg,
            color: activeTheme.text,
            borderColor: activeTheme.line,
            transform: `translateY(${showNav ? '0' : '100%'})`, // 随 showNav 显隐
        }}
      >
          {/* 左侧：夜间模式 */}
          <button 
            onClick={() => setTheme(isActuallyDark ? 'light' : 'dark')}
            className="flex flex-col items-center gap-1 opacity-80 active:opacity-100"
          >
             {isActuallyDark ? <Sun className="w-5 h-5"/> : <Moon className="w-5 h-5"/>}
             <span className="text-[10px]">
                {isActuallyDark ? '日间' : '夜间'}
             </span>
          </button>

          {/* 中间：目录 (重点) */}
          <button 
            onClick={() => setShowCatalog(true)} 
            className="flex flex-col items-center gap-1 opacity-90 active:opacity-100 scale-110"
          >
             <List className="w-6 h-6"/>
             <span className="text-[10px] font-bold">目录</span>
          </button>

          {/* 右侧：设置 */}
          <button 
            onClick={() => setShowSettings(!showSettings)} 
            className={`flex flex-col items-center gap-1 opacity-80 active:opacity-100 ${showSettings ? 'text-blue-500' : ''}`}
          >
             <Settings className="w-5 h-5"/>
             <span className="text-[10px]">设置</span>
          </button>
      </div>


      {/* ===========================================
        3. 主体阅读内容区
        ===========================================
      */}
      <div 
        className="relative transition-all duration-300"
        style={{ width: '100%' }}
        onClick={handleContentClick}
      >
        <article 
          className={`
            w-full min-h-screen px-4 md:px-8 pt-20 pb-20 transition-colors duration-300
            lg:max-w-[850px] lg:mx-auto lg:mt-16 lg:mb-10 lg:rounded-b-sm lg:rounded-t-none lg:pt-8 lg:px-12
            ${isDesktop ? 'shadow-[0_4px_20px_rgba(0,0,0,0.04)]' : ''} 
          `}
          style={{ 
            backgroundColor: activeTheme.bg, 
            color: activeTheme.text 
          }}
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

          {/* 正文 */}
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
              if (!text || text.includes('作者：') || /^\d{4}-\d{2}-\d{2}/.test(text)) return null;
              if (text === chapter.title.trim()) return null;
              return (
                <p 
                  key={i} 
                  style={{ textIndent: '2em', marginBottom: paraSpacingMap[paraSpacing] || '1rem' }}
                >
                  {text}
                </p>
              );
            })}
          </div>

          {/* 底部翻页按钮 */}
          <div className="mt-16 flex items-center justify-between gap-4">
            <button 
              disabled={!prevChapter}
              onClick={(e) => { e.stopPropagation(); prevChapter && goToChapter(prevChapter.id); }}
              className="flex-1 py-3 rounded-xl border text-lg font-bold shadow-sm active:scale-95 transition-all disabled:opacity-30 disabled:active:scale-100 hover:bg-black/5"
              style={{ borderColor: activeTheme.line }}
            >
              上一章
            </button>
            <button 
              disabled={!nextChapter}
              onClick={(e) => { e.stopPropagation(); nextChapter && goToChapter(nextChapter.id); }}
              className="flex-1 py-3 rounded-xl bg-blue-600 text-white text-sm font-bold shadow-md shadow-blue-200 active:scale-95 transition-all disabled:opacity-50 disabled:bg-gray-400 disabled:shadow-none disabled:active:scale-100"
            >
              {nextChapter ? '下一章' : '已是最新'}
            </button>
          </div>
        </article>

        {/* 4. 网页端悬浮工具栏 (保留不变) */}
        <aside 
          className="fixed top-1/3 hidden xl:flex flex-col gap-3 p-2 rounded-xl shadow-lg border transition-all duration-300" 
          style={{ 
            backgroundColor: activeTheme.bg, 
            borderColor: activeTheme.line,
            left: '50%',
            marginLeft: '440px' 
          }}
        >
          <Link href="/library" className="p-3 hover:bg-black/5 rounded-lg tooltip-right" title="书架">
            <Library style={{ color: activeTheme.text }} className="w-5 h-5" />
          </Link>
          <Link href={`/book/${bookId}`} className="p-3 hover:bg-black/5 rounded-lg tooltip-right" title="书籍详情">
            <Info style={{ color: activeTheme.text }} className="w-5 h-5" />
          </Link>
          <div className="h-px w-full bg-black/10 mx-auto" style={{ backgroundColor: activeTheme.line }}></div>
          <button onClick={() => setShowCatalog(true)} className="p-3 hover:bg-black/5 rounded-lg tooltip-right" title="目录">
            <List style={{ color: activeTheme.text }} className="w-5 h-5" />
          </button>
          <button onClick={toggleBookmark} className="p-3 hover:bg-black/5 rounded-lg" title="书签">
            {isBookmarked ? <BookmarkCheck className="text-red-500 w-5 h-5" /> : <Bookmark style={{ color: activeTheme.text }} className="w-5 h-5" />}
          </button>
          <button onClick={() => setTheme(isActuallyDark ? 'light' : 'dark')} className="p-3 hover:bg-black/5 rounded-lg" title="夜间模式">
            {isActuallyDark ? <Sun className="text-yellow-500 w-5 h-5" /> : <Moon style={{ color: activeTheme.text }} className="w-5 h-5" />}
          </button>
          <button onClick={() => setShowSettings(true)} className="p-3 hover:bg-black/5 rounded-lg" title="设置">
            <Settings style={{ color: activeTheme.text }} className="w-5 h-5" />
          </button>
        </aside>
      </div>

      {/* 5. 目录弹窗 */}
      {showCatalog && (
        <div 
          className={`fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex ${isDesktop ? 'items-center justify-center' : 'justify-end'}`} 
          onClick={() => setShowCatalog(false)}
        >
          <div 
            className={`
               flex flex-col transition-colors animate-in shadow-2xl
               ${isDesktop ? 'w-[960px] h-[80vh] rounded-xl zoom-in-95' : 'w-[85%] max-w-sm h-full slide-in-from-right'}
            `}
            style={{ 
              backgroundColor: isActuallyDark ? '#222' : activeTheme.panel, 
              color: activeTheme.text 
            }} 
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-6 py-5 border-b flex justify-between items-end shrink-0" style={{ borderColor: activeTheme.line }}>
              <div className="flex items-baseline gap-3">
                 <h2 className="text-2xl font-bold">目录</h2>
                 <span className="text-sm opacity-60">共 {allChapters.length} 章</span>
              </div>
              <div className="flex gap-4 items-center">
                <button 
                  onClick={() => setCatalogReversed(!catalogReversed)} 
                  className="flex items-center gap-1 text-sm opacity-70 hover:opacity-100 hover:text-blue-600 transition-colors"
                >
                   <ArrowUpDown className="w-4 h-4"/> <span>{catalogReversed ? '正序' : '倒序'}</span>
                </button>
                <button onClick={() => setShowCatalog(false)} className="p-1 hover:bg-black/5 rounded text-gray-500">
                  <X className="w-6 h-6"/>
                </button>
              </div>
            </div>
            
            {/* List */}
            <div className="flex-1 overflow-y-auto px-6 py-2 custom-scrollbar">
              <div className={`${isDesktop ? 'grid grid-cols-2 gap-x-12' : 'flex flex-col'}`}>
                {displayChapters.map(ch => {
                  const isActive = ch.id === chapter.id;
                  return (
                    <button 
                      key={ch.id} 
                      id={isActive ? 'active-chapter-anchor' : undefined}
                      onClick={() => { goToChapter(ch.id); setShowCatalog(false); }}
                      className={`
                        text-left py-4 px-2 text-base font-medium border-b border-dashed truncate transition-all group flex items-center justify-between rounded-lg
                        ${isActive ? 'font-bold' : 'hover:bg-black/5 hover:text-blue-600'}
                      `}
                      style={{ 
                        borderColor: isActuallyDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.1)', 
                        color: isActive ? '#d32f2f' : activeTheme.text 
                      }} 
                    >
                      <span className="truncate w-full">
                        {ch.title.startsWith('第') ? ch.title : `第${ch.chapter_number}章 ${ch.title}`}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 6. 设置弹窗 */}
      {showSettings && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowSettings(false)} />
          
          {isDesktop ? (
            // ============ 桌面端大设置面板 (保留不变) ============
            <div 
                className="fixed top-[20%] right-[calc(50%-440px)] z-50 w-500px rounded-xl shadow-2xl border p-6 animate-in fade-in zoom-in-95"
                style={{ 
                backgroundColor: isActuallyDark ? '#2a2a2a' : activeTheme.panel,
                color: activeTheme.text,
                borderColor: activeTheme.line 
                }}
            >
                <div className="flex justify-between items-center mb-6 pb-4 border-b" style={{ borderColor: activeTheme.line }}>
                    <h3 className="font-bold text-xl flex items-center gap-2"><Settings className="w-5 h-5" /> 阅读设置</h3>
                    <button onClick={() => setShowSettings(false)} className="p-1 hover:bg-black/5 rounded-full">
                        <X className="w-6 h-6 opacity-60"/>
                    </button>
                </div>

                <div className="space-y-6">
                    {/* Theme */}
                    <div className="flex items-center">
                        <span className="w-20 font-bold opacity-70 shrink-0">阅读主题</span>
                        <div className="flex gap-4">
                            <button 
                                onClick={() => setTheme(isActuallyDark ? 'light' : 'dark')}
                                className={`w-12 h-12 rounded-full flex items-center justify-center border hover:opacity-80 transition-all ${isActuallyDark ? 'ring-2 ring-blue-500' : ''}`}
                                style={{ backgroundColor: '#222', borderColor: '#444' }}
                            >
                                <Moon className="w-5 h-5 text-gray-400"/>
                            </button>
                            {Object.entries(themeMap).filter(([k]) => k !== 'dark').map(([key, val]) => (
                                <button 
                                    key={key} 
                                    disabled={isActuallyDark}
                                    onClick={() => setThemeColor(key as any)}
                                    className={`w-12 h-12 rounded-full border flex items-center justify-center transition-all ${themeColor === key && !isActuallyDark ? 'ring-2 ring-blue-500 scale-110' : ''}`}
                                    style={{ backgroundColor: val.bg, borderColor: 'transparent', opacity: isActuallyDark ? 0.3 : 1 }}
                                >
                                    {themeColor === key && !isActuallyDark && <Check className="w-6 h-6 text-green-700" />}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Font */}
                    <div className="flex items-center">
                        <span className="w-20 font-bold opacity-70 shrink-0">正文字体</span>
                        <div className="flex gap-3 flex-1">
                            {['sans', 'serif', 'kai'].map(f => (
                            <button
                                key={f}
                                onClick={() => setFontFamily(f as any)}
                                className={`px-6 py-2 rounded-lg border transition-all ${fontFamily === f ? 'bg-blue-600 text-white border-blue-600' : 'hover:bg-black/5 border-gray-200'}`}
                            >
                                {f === 'sans' ? '黑体' : f === 'serif' ? '宋体' : '楷体'}
                            </button>
                            ))}
                        </div>
                    </div>

                    {/* Size */}
                    <div className="flex items-center">
                        <span className="w-20 font-bold opacity-70 shrink-0">字体大小</span>
                        <div className="flex items-center gap-4 flex-1 bg-black/5 rounded-lg p-2 px-4">
                            <button onClick={() => setFontSizeNum(Math.max(12, fontSizeNum - 2))} className="p-2 hover:bg-white/60 rounded text-sm font-bold">A-</button>
                            <input 
                                type="range" min="14" max="36" step="2" 
                                value={fontSizeNum} 
                                onChange={(e) => setFontSizeNum(Number(e.target.value))}
                                className="flex-1 h-2 bg-gray-300 rounded-lg appearance-none cursor-pointer accent-blue-600"
                            />
                            <button onClick={() => setFontSizeNum(Math.min(48, fontSizeNum + 2))} className="p-2 hover:bg-white/60 rounded text-xl font-bold">A+</button>
                            <span className="w-12 text-center font-bold">{fontSizeNum}</span>
                        </div>
                    </div>

                    {/* Spacing */}
                    <div className="flex items-start">
                        <span className="w-20 font-bold opacity-70 shrink-0 pt-2">排版间距</span>
                        <div className="flex-1 flex flex-col gap-4">
                            {/* 行高 */}
                            <div>
                                <div className="text-xs opacity-50 mb-2">行高</div>
                                <div className="flex bg-black/5 rounded-lg p-1">
                                    {[1.6, 1.8, 2.0, 2.4].map((lh) => (
                                        <button 
                                            key={lh}
                                            onClick={() => setLineHeight(lh)}
                                            className={`flex-1 py-1.5 text-sm rounded transition-all ${lineHeight === lh ? 'bg-white shadow-sm font-bold text-blue-600' : 'hover:bg-black/5'}`}
                                        >
                                            {lh}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            {/* 段距 */}
                            <div>
                                <div className="text-xs opacity-50 mb-2">段距</div>
                                <div className="flex bg-black/5 rounded-lg p-1">
                                    <button onClick={() => setParaSpacing(2)} className={`flex-1 py-1.5 text-sm rounded transition-all ${paraSpacing === 2 ? 'bg-white shadow-sm font-bold text-blue-600' : ''}`}>紧凑</button>
                                    <button onClick={() => setParaSpacing(4)} className={`flex-1 py-1.5 text-sm rounded transition-all ${paraSpacing === 4 ? 'bg-white shadow-sm font-bold text-blue-600' : ''}`}>标准</button>
                                    <button onClick={() => setParaSpacing(6)} className={`flex-1 py-1.5 text-sm rounded transition-all ${paraSpacing === 6 ? 'bg-white shadow-sm font-bold text-blue-600' : ''}`}>中等</button>
                                    <button onClick={() => setParaSpacing(8)} className={`flex-1 py-1.5 text-sm rounded transition-all ${paraSpacing === 8 ? 'bg-white shadow-sm font-bold text-blue-600' : ''}`}>宽疏</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
          ) : (
            // ============ 移动端设置面板 (保留基本功能，配合底部工具栏) ============
            // 注意：这里我们保留原有的顶部弹出样式，如果你想改为底部弹出(Bottom Sheet)，需要大幅改动 CSS。
            // 鉴于要求“不影响网页端且基于此代码”，维持原样但在视觉上与底部栏配合。
            <div 
                className="fixed top-20 right-4 sm:right-10 z-50 w-[340px] rounded-xl shadow-2xl border p-5 animate-in fade-in zoom-in-95 origin-top-right"
                style={{ 
                backgroundColor: isActuallyDark ? '#2a2a2a' : '#fff',
                color: activeTheme.text,
                borderColor: activeTheme.line 
                }}
            >
                <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-lg">设置</h3>
                    <button onClick={() => setShowSettings(false)} className="p-1 hover:bg-black/5 rounded-full">
                    <X className="w-5 h-5 opacity-60"/>
                    </button>
                </div>

                <div className="space-y-6">
                
                {/* 阅读主题 */}
                <div>
                    <div className="text-xs opacity-60 mb-2">阅读主题</div>
                    <div className="flex justify-between gap-2 px-1">
                        <button 
                        onClick={() => setTheme(isActuallyDark ? 'light' : 'dark')}
                        className={`w-10 h-10 rounded-full flex items-center justify-center border transition-all ${isActuallyDark ? 'ring-2 ring-blue-500' : ''}`}
                        style={{ backgroundColor: '#222', borderColor: '#444' }}
                        title="夜间模式"
                        >
                        <Moon className="w-4 h-4 text-gray-400"/>
                        </button>
                        {Object.entries(themeMap).filter(([k]) => k !== 'dark').map(([key, val]) => (
                        <button 
                            key={key} 
                            disabled={isActuallyDark}
                            onClick={() => setThemeColor(key as any)}
                            className={`w-10 h-10 rounded-full border flex items-center justify-center transition-all ${themeColor === key && !isActuallyDark ? 'ring-2 ring-blue-500 scale-110' : ''}`}
                            style={{ backgroundColor: val.bg, borderColor: 'transparent', opacity: isActuallyDark ? 0.3 : 1 }}
                        >
                            {themeColor === key && !isActuallyDark && <Check className="w-5 h-5 text-green-700" />}
                        </button>
                        ))}
                    </div>
                </div>

                {/* 正文字体 */}
                <div>
                    <div className="text-xs opacity-60 mb-2">正文字体</div>
                    <div className="flex gap-3">
                        {['sans', 'serif', 'kai'].map(f => (
                        <button
                            key={f}
                            onClick={() => setFontFamily(f as any)}
                            className={`flex-1 py-2 text-sm rounded-lg border transition-all ${fontFamily === f ? 'bg-blue-50 text-blue-600 border-blue-500' : 'bg-black/5 border-transparent hover:bg-black/10'}`}
                        >
                            {f === 'sans' ? '黑体' : f === 'serif' ? '宋体' : '楷体'}
                        </button>
                        ))}
                    </div>
                </div>

                {/* 字体大小 */}
                <div>
                    <div className="flex justify-between text-xs opacity-60 mb-2">
                        <span>字体大小</span>
                        <span>{fontSizeNum}px</span>
                    </div>
                    <div className="flex items-center gap-1 bg-black/5 rounded-lg p-1.5">
                        <button onClick={() => setFontSizeNum(Math.max(12, fontSizeNum - 2))} className="w-12 py-1.5 hover:bg-white/60 rounded text-sm">A-</button>
                        <div className="flex-1 flex justify-center text-sm font-bold opacity-80">{fontSizeNum}</div>
                        <button onClick={() => setFontSizeNum(Math.min(48, fontSizeNum + 2))} className="w-12 py-1.5 hover:bg-white/60 rounded text-lg">A+</button>
                    </div>
                </div>

                {/* 间距 */}
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <div className="text-xs opacity-60 mb-2">行间距</div>
                        <div className="flex bg-black/5 rounded-lg p-1">
                            {[1.6, 1.8, 2.0, 2.2].map((lh) => (
                            <button 
                                key={lh}
                                onClick={() => setLineHeight(lh)}
                                className={`flex-1 py-1.5 text-xs rounded transition-all ${lineHeight === lh ? 'bg-white shadow-sm font-bold text-blue-600' : 'hover:bg-black/5'}`}
                            >
                                {lh}
                            </button>
                            ))}
                        </div>
                    </div>
                    <div>
                        <div className="text-xs opacity-60 mb-2">段间距</div>
                        <div className="flex bg-black/5 rounded-lg p-1">
                        <button onClick={() => setParaSpacing(4)} className={`flex-1 py-1.5 text-xs rounded transition-all ${paraSpacing === 4 ? 'bg-white shadow-sm font-bold text-blue-600' : ''}`}>标准</button>
                        <button onClick={() => setParaSpacing(8)} className={`flex-1 py-1.5 text-xs rounded transition-all ${paraSpacing === 8 ? 'bg-white shadow-sm font-bold text-blue-600' : ''}`}>超大</button>
                        </div>
                    </div>
                </div>

                </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function ReaderPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">加载中...</div>}>
      <ReaderContent />
    </Suspense>
  );
}