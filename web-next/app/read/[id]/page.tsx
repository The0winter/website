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
  const [showNav, setShowNav] = useState(false);
  const [lastScrollY, setLastScrollY] = useState(0);
  const { theme, setTheme } = useReadingSettings();

  const [themeColor, setThemeColor] = useState<'gray' | 'cream' | 'green' | 'blue'>('cream');
  const [fontFamily, setFontFamily] = useState<'sans' | 'serif' | 'kai'>('sans');
  const [fontSizeNum, setFontSizeNum] = useState(20);
  const [lineHeight, setLineHeight] = useState(1.8);
  const [paraSpacing, setParaSpacing] = useState(4); 

  const [showHint, setShowHint] = useState(false); // 新手引导提示

  // 网页端默认参数调整：加载时如果是大屏，调整默认字号 (改小了) 和行距
  useEffect(() => {
    if (window.innerWidth >= 1024) {
      setFontSizeNum(20); 
      setLineHeight(1.8); 
    }
  }, []);

  // --- 新增：检查是否需要显示新手引导 (仅移动端 & 第一次) ---
  useEffect(() => {
    // 只有在客户端才执行
    const hasSeen = localStorage.getItem('has-seen-reading-hint');
    // 如果没看过，且当前是手机宽度 (<1024)，则显示提示
    if (!hasSeen && window.innerWidth < 1024) {
      setShowHint(true);
    }
  }, []);

  // --- 新增：监听安卓/小米的侧滑返回，实现“侧滑关闭目录” ---
  useEffect(() => {
    if (showCatalog) {
      // 1. 当目录打开时，手动往历史记录推入一个状态
      // 这样用户侧滑时，消耗的是这个状态，而不是直接退出页面
      window.history.pushState({ catalogOpen: true }, '', window.location.href);

      // 2. 定义处理函数：当检测到“后退”动作时
      const handlePopState = () => {
        setShowCatalog(false); // 关闭目录
      };

      // 3. 监听浏览器的 popstate 事件（侧滑、实体返回键都会触发）
      window.addEventListener('popstate', handlePopState);

      // 4. 清理函数
      return () => {
        window.removeEventListener('popstate', handlePopState);
      };
    }
  }, [showCatalog]); // 依赖 showCatalog，只有它变化时才执行

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

// 滚动监听 (完美适配版：手机电脑逻辑分离)
  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      const diff = currentScrollY - lastScrollY;
      
      // 阈值检测，防抖动
      if (Math.abs(diff) < 10) return;

      // 1. 下滑隐藏逻辑 (手机、电脑通用)
      // 向下滑动(diff > 0) 且 不在顶部时 -> 隐藏
      if (diff > 0 && currentScrollY > 80) {
        setShowNav(false);
        setShowSettings(false);
      }
      
      // 2. 上滑显示逻辑 (电脑端专属)
      // 如果是电脑端 (isDesktop) 且 向上滑动 (diff < 0) -> 自动显示
      // 手机端不执行这一步，保持“只能点击呼出”
      else if (isDesktop && diff < 0) {
        setShowNav(true);
      }
      
      setLastScrollY(currentScrollY);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [lastScrollY, isDesktop]);
  // 点击内容显隐菜单
  const handleContentClick = (e: React.MouseEvent) => {
    if (isDesktop) return;
    // 网页端不通过点击正文呼出菜单
    if (window.getSelection()?.toString().length) return;

    // --- 新增：如果提示还在，点击任意位置就关闭它，并永久记录 ---
    if (showHint) {
      setShowHint(false);
      localStorage.setItem('has-seen-reading-hint', 'true');
    }

    const width = window.innerWidth;
    const x = e.clientX;
    // [引用: 点击屏幕中央才会呼出]
    if (x > width * 0.3 && x < width * 0.7) {
      setShowNav(prev => !prev);
    }
  };

  useEffect(() => {
    // 1. 定义一个标记，用来判断当前请求是否有效
    let isActive = true;

    const fetchChapterContent = async () => {
      if (allChapters.length === 0) return;
      
      const targetId = chapterIdParam || allChapters[0].id;
      
      // 开始加载
      setLoading(true);

      try {
        const res = await fetch(`https://website-production-6edf.up.railway.app/api/chapters/${targetId}`);
        
        if (res.ok) {
          const data = await res.json();
          // 2. 只有当组件还没被卸载/重置时，才更新数据
          if (isActive) {
            setChapter(data);
            window.scrollTo(0, 0); 
          }
        }
      } catch (error) { 
        console.error("加载失败:", error); 
      } 
      finally { 
        // 3. 无论成功失败，只要组件还活跃，就关闭 loading
        if (isActive) {
          setLoading(false); 
        }
      }
    };

    fetchChapterContent();

    // 4. 清理函数：如果组件更新了，把上一次的标记设为 false
    return () => {
      isActive = false;
    };
    
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
    // 核心修改：加上 { scroll: false }
    // 这样路由跳转时页面会保持不动，直到数据加载完成后，我们的 useEffect 才会把它滚到顶部
    router.push(`/read/${bookId}?chapterId=${targetChapterId}`, { scroll: false });
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
        1. 网页端专属导航栏 (修复：固定显示，不再随滚动隐藏) 
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
                {chapter.title.startsWith('第') ?
                  chapter.title : `第${chapter.chapter_number}章 ${chapter.title}`}
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
      {/* ===========================================
        2. 移动端 新·顶部导航栏
        ===========================================
      */}
      <nav
        className="lg:hidden fixed top-0 left-0 right-0 z-50 h-14 flex items-center justify-between px-4 shadow-sm transition-all duration-300"
        style={{
          backgroundColor: activeTheme.bg,
          color: activeTheme.text,
          borderColor: activeTheme.line,
          borderBottomWidth: '1px',
          transform: `translateY(${showNav ? '0' : '-100%'})`,
        }}
      >
        {/* 左侧：返回按钮 */}
        <button onClick={() => router.back()} className="p-2 -ml-2 hover:bg-black/5 rounded-full relative z-10">
           <ChevronLeft className="w-6 h-6" />
        </button>

        {/* 中间：章节标题 (新增：绝对定位居中) */}
        <div className="absolute left-1/2 -translate-x-1/2 text-sm font-bold max-w-[60%] truncate opacity-90">
            {chapter.title}
        </div>

        {/* 右侧：用户头像 */}
        <Link href={user ? `/user/${user.id}` : '/login'} className="rounded-full overflow-hidden border border-black/10 relative z-10">
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
            w-full min-h-screen px-4 md:px-8 
            pt-4 pb-20  /* 核心修改：pt-16 改为 pt-4。让第一行文字直接顶上去，不再留出导航栏的位置 */
            transition-colors duration-300
            lg:max-w-[850px] lg:mx-auto lg:mt-16 lg:mb-10 lg:rounded-b-sm lg:rounded-t-none lg:pt-8 lg:px-12
            ${isDesktop ? 'shadow-[0_4px_20px_rgba(0,0,0,0.04)]' : ''} 
          `}
          style={{ 
            backgroundColor: activeTheme.bg, 
            color: activeTheme.text 
          }}
        >
        {/* 标题区 (修改：间距更紧凑) */}
          <div className="mb-5 px-2"> {/* mb-10 改为 mb-5，拉近标题和正文的距离 */}
            <h1 className="text-3xl md:text-4xl font-bold tracking-wide leading-tight" style={{ color: activeTheme.text }}>
              {chapter.title.startsWith('第') ?
                chapter.title : `第${chapter.chapter_number}章 ${chapter.title}`}
            </h1>
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

      {/* 5. 目录弹窗 (完美兼容版) */}
      {showCatalog && (
        <div 
          className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setShowCatalog(false)}
        >
          <div 
            className={`
               flex flex-col rounded-xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200
               ${isDesktop 
                  ? 'w-[960px] h-[80vh]'  /* 网页端：保持宽屏大尺寸 */
                  : 'w-[90%] max-w-[320px] h-[70vh] rounded-2xl' /* 移动端：居中精致小卡片 */
               }
            `}
            style={{ 
              backgroundColor: isActuallyDark ? '#1f1f1f' : (isDesktop ? activeTheme.panel : '#fff'), 
              color: activeTheme.text 
            }} 
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-5 py-4 border-b flex justify-between items-center shrink-0 bg-black/5" style={{ borderColor: activeTheme.line }}>
              <div className="flex items-baseline gap-2">
                 <h2 className="text-lg font-bold">目录</h2>
                 <span className="text-xs opacity-50">共 {allChapters.length} 章</span>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={() => setCatalogReversed(!catalogReversed)} 
                  className="px-3 py-1.5 text-xs font-medium rounded-full bg-black/5 hover:bg-black/10 transition-colors flex items-center gap-1 active:scale-95"
                >
                   <ArrowUpDown className="w-3 h-3"/> {catalogReversed ? '正序' : '倒序'}
                </button>
                <button onClick={() => setShowCatalog(false)} className="p-1.5 hover:bg-black/10 rounded-full bg-black/5 active:scale-95">
                  <X className="w-4 h-4 opacity-60"/>
                </button>
              </div>
            </div>
            
            {/* List */}
            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
              <div className={`${isDesktop ? 'grid grid-cols-2 gap-x-12 gap-y-2' : 'flex flex-col gap-1'}`}>
                {displayChapters.map(ch => {
                  const isActive = ch.id === chapter.id;
                  return (
                    <button 
                      key={ch.id} 
                      id={isActive ? 'active-chapter-anchor' : undefined}
                      onClick={() => { goToChapter(ch.id); setShowCatalog(false); }}
                      className={`
                        text-left transition-all flex items-center justify-between
                        ${isDesktop 
                            /* 网页端样式：保留原来的虚线风格，或者微调得整齐一点 */
                            ? `py-3 px-2 text-base border-b border-dashed ${isActive ? 'font-bold' : 'hover:text-blue-600'}`
                            /* 移动端样式：块状胶囊风格 */
                            : `py-3 px-4 text-sm rounded-xl ${isActive ? 'bg-blue-50 text-blue-600 font-bold' : 'hover:bg-black/5'}`
                        }
                      `}
                      style={{ 
                         borderColor: isDesktop ? (isActuallyDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)') : undefined,
                         color: isActive ? '#3b82f6' : activeTheme.text
                      }} 
                    >
                      <span className="truncate w-full">
                        {ch.title.startsWith('第') ? ch.title : `第${ch.chapter_number}章 ${ch.title}`}
                      </span>
                      {/* 移动端高亮时显示小圆点 */}
                      {!isDesktop && isActive && <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0 ml-2"></div>}
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
            className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 w-[90%] max-w-[320px] rounded-xl shadow-2xl border p-4 animate-in slide-in-from-bottom-5 fade-in duration-200"
            style={{ 
              backgroundColor: isActuallyDark ? 'rgba(40,40,40,0.95)' : 'rgba(255,255,255,0.95)',
              backdropFilter: 'blur(10px)',
              color: activeTheme.text,
              borderColor: activeTheme.line 
            }}
          >
            {/* 紧凑排版：字号调整 (放在最上面方便操作) */}
            <div className="flex items-center gap-3 mb-4 bg-black/5 rounded-lg p-2">
                <button onClick={() => setFontSizeNum(Math.max(12, fontSizeNum - 2))} className="px-3 font-serif hover:bg-black/10 rounded">A-</button>
                <div className="flex-1 text-center text-sm font-bold opacity-80">{fontSizeNum}</div>
                <button onClick={() => setFontSizeNum(Math.min(48, fontSizeNum + 2))} className="px-3 font-serif text-lg hover:bg-black/10 rounded">A+</button>
            </div>

            <div className="space-y-4">
              {/* 主题颜色 (用圆圈表示，省空间) */}
              <div className="flex justify-between items-center px-1">
                 <span className="text-xs opacity-50 font-bold w-10">主题</span>
                 <div className="flex gap-3">
                    <button 
                      onClick={() => setTheme(isActuallyDark ? 'light' : 'dark')}
                      className={`w-8 h-8 rounded-full flex items-center justify-center border ${isActuallyDark ? 'ring-2 ring-blue-500' : ''}`}
                      style={{ backgroundColor: '#222', borderColor: '#444' }}
                    >
                      <Moon className="w-4 h-4 text-gray-400"/>
                    </button>
                    {Object.entries(themeMap).filter(([k]) => k !== 'dark').map(([key, val]) => (
                      <button 
                        key={key} 
                        disabled={isActuallyDark}
                        onClick={() => setThemeColor(key as any)}
                        className={`w-8 h-8 rounded-full border flex items-center justify-center transition-all ${themeColor === key && !isActuallyDark ? 'ring-2 ring-blue-500 scale-110' : ''}`}
                        style={{ backgroundColor: val.bg, borderColor: 'transparent', opacity: isActuallyDark ? 0.3 : 1 }}
                      >
                        {themeColor === key && !isActuallyDark && <Check className="w-4 h-4 text-green-700" />}
                      </button>
                    ))}
                 </div>
              </div>

              {/* 字体选择 (紧凑按钮) */}
              <div className="flex items-center gap-2">
                 <span className="text-xs opacity-50 font-bold w-10">字体</span>
                 <div className="flex flex-1 gap-2">
                    {['sans', 'serif', 'kai'].map(f => (
                      <button
                        key={f}
                        onClick={() => setFontFamily(f as any)}
                        className={`flex-1 py-1.5 text-xs rounded border transition-all ${fontFamily === f ? 'bg-blue-50 text-blue-600 border-blue-500' : 'bg-black/5 border-transparent'}`}
                      >
                        {f === 'sans' ? '黑体' : f === 'serif' ? '宋体' : '楷体'}
                      </button>
                    ))}
                 </div>
              </div>

              {/* 间距 (合并在一行或者紧凑两行) */}
              <div className="flex items-center gap-2">
                 <span className="text-xs opacity-50 font-bold w-10">间距</span>
                 <div className="flex flex-1 gap-2 bg-black/5 rounded-lg p-1">
                    {[1.6, 1.8, 2.0, 2.4].map((lh) => (
                      <button 
                        key={lh}
                        onClick={() => setLineHeight(lh)}
                        className={`flex-1 py-1 text-xs rounded transition-all ${lineHeight === lh ? 'bg-white shadow-sm font-bold text-blue-600' : ''}`}
                      >
                        {lh}
                      </button>
                    ))}
                 </div>
              </div>
            </div>
          </div>
          )}
        </>
      )}

      {/* 7. 新手引导提示 (仅第一次出现，半透明浮层) */}
      {showHint && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center pointer-events-none animate-in fade-in duration-500">
            <div className="bg-black/70 backdrop-blur-sm text-white px-6 py-4 rounded-2xl shadow-xl flex flex-col items-center gap-2 animate-bounce">
                {/* 圆圈点点图标 */}
                <div className="w-8 h-8 rounded-full border-2 border-white/50 flex items-center justify-center">
                    <div className="w-1.5 h-1.5 bg-white rounded-full"></div>
                </div>
                <span className="text-sm font-bold tracking-wide">点击屏幕中央呼出菜单</span>
            </div>
        </div>
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