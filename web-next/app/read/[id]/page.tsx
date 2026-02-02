'use client'; 

import { useEffect, useState, Suspense } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { 
  ChevronLeft, Settings, BookOpen, List, 
  Bookmark, BookmarkCheck, Moon, X, 
  ArrowUpDown, Check, Sun, AlignLeft, MoveHorizontal
} from 'lucide-react';
import { booksApi, chaptersApi, bookmarksApi, Book, Chapter } from '@/lib/api';
import { useReadingSettings } from '@/contexts/ReadingSettingsContext';
import { useAuth } from '@/contexts/AuthContext';

function ReaderContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  
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

  // 导航栏显示状态
  const [showNav, setShowNav] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);
  
  const { theme, setTheme } = useReadingSettings();

  const [themeColor, setThemeColor] = useState<'gray' | 'cream' | 'green' | 'blue'>('cream');
  const [fontFamily, setFontFamily] = useState<'sans' | 'serif' | 'kai'>('sans');
  const [fontSizeNum, setFontSizeNum] = useState(20);
  const [lineHeight, setLineHeight] = useState(1.8);
  const [paraSpacing, setParaSpacing] = useState(4);
  const [pageWidth, setPageWidth] = useState<'auto' | '640' | '800' | '900' | '1000' | '1280'>('900');

  const themeMap = {
    cream:  { name: '羊皮纸', bg: '#f6f1e7', text: '#333333', line: '#d4cbb3' },
    gray:   { name: '雅致灰', bg: '#f0f0f0', text: '#222222', line: '#dcdcdc' },
    green:  { name: '护眼绿', bg: '#dcedc8', text: '#222222', line: '#c5e1a5' },
    blue:   { name: '极光蓝', bg: '#e3edfc', text: '#222222', line: '#d0e0f8' },
    dark:   { name: '夜间',   bg: '#1a1a1a', text: '#a0a0a0', line: '#333333' },
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

  // 🔥 点击屏幕中央呼出/隐藏菜单 (Mobile First)
  const handleContentClick = (e: React.MouseEvent) => {
    // 防止选中文本时触发
    if (window.getSelection()?.toString().length) return;
    
    const width = window.innerWidth;
    const x = e.clientX;
    // 点击中间 40% 区域触发
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
      } catch (error) { console.error(error); } 
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
      className="min-h-screen w-full transition-colors duration-300"
      style={{ backgroundColor: activeTheme.bg }}
    >
      {/* === 导航栏 (Navbar) === */}
      <nav
        className="fixed top-0 left-1/2 z-40 h-14 flex items-center justify-between px-4 sm:px-6 border-b shadow-sm transition-all duration-300"
        style={{
          backgroundColor: activeTheme.bg,
          color: activeTheme.text,
          borderColor: activeTheme.line,
          maxWidth: pageWidth === 'auto' ? '100%' : `${pageWidth}px`, // 跟随页面宽度
          width: '100%',
          transform: `translate(-50%, ${showNav ? '0' : '-100%'})`,
        }}
      >
        {/* 🔥 修改点 5：左侧改为 图标 + 九天 */}
        <Link href="/" className="flex items-center gap-2 hover:opacity-70 transition-opacity">
          <BookOpen className="w-5 h-5 text-blue-600" />
          <span className="font-bold text-lg tracking-tight">九天</span>
        </Link>

        {/* 🔥 修改点 6：删除了中间的书名 (空间留白) */}

        {/* 右侧：功能区 (PC端的设置在侧边栏，这里只留详情和书架) */}
        <div className="flex items-center gap-4">
          {/* 手机端可以在这里放一个简单的目录入口，或者完全依赖点击呼出 */}
          <button onClick={() => setShowCatalog(true)} className="md:hidden p-2">
             <List className="w-5 h-5"/>
          </button>
          
          {/* 手机端设置入口 */}
          <button onClick={() => setShowSettings(true)} className="md:hidden p-2">
             <Settings className="w-5 h-5"/>
          </button>

          <Link href={`/book/${bookId}`} className="text-sm hover:opacity-70 transition-opacity hidden sm:block">详情</Link>
          <Link href="/library" className="flex items-center gap-1 text-sm hover:opacity-70 transition-opacity">
            <span>书架</span>
          </Link>
        </div>
      </nav>

      {/* === 主体内容 === */}
      <div 
        className="mx-auto relative transition-all duration-300 min-h-screen"
        style={{ maxWidth: pageWidth === 'auto' ? '800px' : `${pageWidth}px` }} 
        onClick={handleContentClick} // 🔥 核心交互：点击正文呼出菜单
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
              // ✅ 1. 恢复过滤逻辑：
                // 过滤掉：空行、包含“作者：”的行、日期格式的行 (如 2026-01-29)
                if (!text || text.includes('作者：') || /^\d{4}-\d{2}-\d{2}/.test(text)) return null;
                
                // ✅ 2. 恢复过滤逻辑：
                // 过滤掉：内容完全等于章节标题的行
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

          {/* 🔥 修改点 4：底部按钮优化 (更和谐的圆角和高度) */}
          <div className="mt-16 flex items-center justify-between gap-4">
            <button 
              disabled={!prevChapter}
              onClick={(e) => { e.stopPropagation(); prevChapter && goToChapter(prevChapter.id); }}
              className="flex-1 py-3 rounded-xl border text-sm font-bold shadow-sm active:scale-95 transition-all disabled:opacity-30 disabled:active:scale-100 hover:bg-black/5"
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

        {/* ✅ 恢复：PC端侧边工具栏 (Sidebar) - 用户要求改回上一版 */}
        <aside 
          className="fixed right-10 top-1/3 hidden xl:flex flex-col gap-4 p-3 rounded-xl shadow-lg border transition-all duration-300" 
          style={{ backgroundColor: activeTheme.bg, borderColor: activeTheme.line }}
        >
          <button onClick={() => setShowCatalog(true)} className="p-3 hover:bg-black/5 rounded-lg tooltip-right" title="目录">
            <List style={{ color: activeTheme.text }} />
          </button>
          <button onClick={toggleBookmark} className="p-3 hover:bg-black/5 rounded-lg" title="书签">
            {isBookmarked ? <BookmarkCheck className="text-red-500" /> : <Bookmark style={{ color: activeTheme.text }} />}
          </button>
          <button onClick={() => setTheme(isActuallyDark ? 'light' : 'dark')} className="p-3 hover:bg-black/5 rounded-lg" title="夜间模式">
            {isActuallyDark ? <Sun className="text-yellow-500" /> : <Moon style={{ color: activeTheme.text }} />}
          </button>
          <button onClick={() => setShowSettings(true)} className="p-3 hover:bg-black/5 rounded-lg" title="设置">
            <Settings style={{ color: activeTheme.text }} />
          </button>
        </aside>
      </div>

      {/* 目录弹窗 */}
      {showCatalog && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex justify-end" onClick={() => setShowCatalog(false)}>
          <div 
            className="w-[85%] max-w-sm h-full shadow-2xl flex flex-col transition-colors animate-in slide-in-from-right" 
            style={{ backgroundColor: isActuallyDark ? '#222' : '#fff', color: activeTheme.text }} 
            onClick={e => e.stopPropagation()}
          >
            <div className="p-4 border-b flex justify-between items-center shrink-0" style={{ borderColor: activeTheme.line }}>
              <div className="flex items-center gap-2">
                 <h2 className="text-lg font-bold">目录</h2>
                 <span className="text-xs opacity-60">({allChapters.length}章)</span>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setCatalogReversed(!catalogReversed)} className="p-1.5 hover:bg-black/5 rounded">
                   <ArrowUpDown className="w-4 h-4"/>
                </button>
                <button onClick={() => setShowCatalog(false)} className="p-1.5 hover:bg-black/5 rounded"><X className="w-5 h-5"/></button>
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

      {/* ✅ 恢复：PC端居中大设置弹窗 (用户要求保留大面板) */}
      {showSettings && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowSettings(false)}>
          <div 
            className="w-full max-w-[500px] max-h-[85vh] overflow-y-auto p-6 md:p-8 rounded-2xl shadow-2xl space-y-6 transition-colors animate-in zoom-in-95" 
            style={{ backgroundColor: isActuallyDark ? '#222' : '#fff', color: isActuallyDark ? '#eee' : '#333' }} 
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between border-b pb-4" style={{ borderColor: isActuallyDark ? '#444' : '#eee' }}>
              <div>
                  <h2 className="text-xl font-bold">阅读设置</h2>
                  {/* 🔥 修改点 6：书名集成到这里显示 */}
                  <p className="text-xs opacity-50 mt-1">当前书籍：{book.title}</p>
              </div>
              <button onClick={() => setShowSettings(false)}><X /></button>
            </div>
            
            {/* 1. 主题 */}
            <div className="flex flex-col gap-3">
              <span className="text-sm font-bold opacity-60">阅读主题</span>
              <div className="flex gap-4 overflow-x-auto pb-2">
                {Object.entries(themeMap).filter(([k]) => k !== 'dark').map(([key, val]) => (
                  <button 
                    key={key} 
                    disabled={isActuallyDark}
                    onClick={() => setThemeColor(key as any)}
                    className={`w-12 h-12 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${themeColor === key && !isActuallyDark ? 'ring-2 ring-blue-500 ring-offset-2' : ''}`}
                    style={{ backgroundColor: val.bg, borderColor: isActuallyDark ? '#444' : '#ddd', opacity: isActuallyDark ? 0.3 : 1 }}
                  >
                    {themeColor === key && !isActuallyDark && <Check className="w-5 h-5 text-green-600" />}
                  </button>
                ))}
              </div>
            </div>

            {/* 2. 字号 */}
            <div className="flex flex-col gap-3">
              <span className="text-sm font-bold opacity-60">字号大小</span>
              <div className="flex items-center gap-4 rounded-xl px-4 py-2 transition-colors" style={{ backgroundColor: isActuallyDark ? '#333' : '#f3f4f6' }}>
                <button onClick={() => setFontSizeNum(Math.max(12, fontSizeNum - 2))} className="p-2 hover:text-blue-500 font-bold">A-</button>
                <div className="flex-1 h-1 bg-gray-300 rounded-full mx-4 overflow-hidden">
                    <div className="h-full bg-blue-500" style={{ width: `${(fontSizeNum - 12) / (48 - 12) * 100}%` }}></div>
                </div>
                <button onClick={() => setFontSizeNum(Math.min(48, fontSizeNum + 2))} className="p-2 hover:text-blue-500 font-bold">A+</button>
              </div>
            </div>

            {/* 3. 字体 */}
            <div className="flex flex-col gap-3">
              <span className="text-sm font-bold opacity-60">正文字体</span>
              <div className="flex gap-2 p-1 rounded-xl w-full transition-colors" style={{ backgroundColor: isActuallyDark ? '#333' : '#f3f4f6' }}>
                {['sans', 'serif', 'kai'].map((f) => (
                  <button 
                    key={f} 
                    onClick={() => setFontFamily(f as any)}
                    className={`flex-1 py-2 rounded-lg text-sm transition-all ${fontFamily === f ? 'bg-white shadow text-blue-600 font-bold' : 'opacity-60 hover:opacity-100'}`}
                    style={{ backgroundColor: fontFamily === f ? (isActuallyDark ? '#555' : '#fff') : 'transparent' }}
                  >
                    {f === 'sans' ? '黑体' : f === 'serif' ? '宋体' : '楷体'}
                  </button>
                ))}
              </div>
            </div>
            
            {/* 4. 间距控制 */}
            <div className="grid grid-cols-2 gap-4">
                 <div className="space-y-2">
                    <span className="text-sm font-bold opacity-60">行间距</span>
                    <button onClick={() => setLineHeight(lineHeight === 1.8 ? 2.2 : 1.8)} className="w-full py-2 bg-black/5 rounded-lg hover:bg-black/10 flex items-center justify-center gap-2 text-sm">
                       <AlignLeft className="w-4 h-4"/> {lineHeight === 1.8 ? '适中' : '宽松'}
                    </button>
                 </div>
                 <div className="space-y-2">
                    <span className="text-sm font-bold opacity-60">页宽 (PC)</span>
                    <button onClick={() => setPageWidth(pageWidth === '900' ? 'auto' : '900')} className="w-full py-2 bg-black/5 rounded-lg hover:bg-black/10 flex items-center justify-center gap-2 text-sm">
                       <MoveHorizontal className="w-4 h-4"/> {pageWidth === 'auto' ? '全屏' : '居中'}
                    </button>
                 </div>
            </div>

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