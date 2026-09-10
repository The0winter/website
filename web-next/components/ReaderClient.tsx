'use client';
import {useStoredState} from '@/lib/useStoredState';
import { safeFetch as fetch } from '@/lib/request';
 

import { useEffect, useCallback, useState, useRef, useSyncExternalStore, useTransition } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { PrefetchKind } from 'next/dist/client/components/router-reducer/router-reducer-types';
import { API_BASE_URL } from '@/lib/api';
import Link from './PrefetchLink';
import { currentPrefetchPolicy, serverPrefetchPolicy, subscribePrefetchPolicy } from '@/lib/book-prefetch';
import { rememberChapter } from '@/lib/reading-session';
import { 
  Settings, BookOpen, List, 
  Bookmark, BookmarkCheck, Moon, X, 
  ArrowUpDown, Check, Sun, Info, Library,
} from 'lucide-react';
import { booksApi, chaptersApi, bookmarksApi, Book, Chapter } from '@/lib/api';
import { useReadingSettings } from '@/contexts/ReadingSettingsContext';
import { useAuth } from '@/contexts/AuthContext';

import ReaderPages from './ReaderPages';

let bgCleanupTimer: NodeJS.Timeout | null = null;

// 🔥 [新增 1] 全局章节缓存池
class BoundedMap<K,V> extends Map<K,V> {
  constructor(private maximum:number){super();}
  set(key:K,value:V){super.delete(key);super.set(key,value);while(this.size>this.maximum){const oldest=this.keys().next();if(!oldest.done)super.delete(oldest.value);}return this;}
}
const chapterCache = new BoundedMap<string, Chapter>(20);
// 🔥 [新增] 全局书籍缓存池 (防止切换章节时书名/封面闪烁)
const bookCache = new BoundedMap<string, Book>(3);
const catalogCache = new BoundedMap<string, {rows:Chapter[];version:number|string;expiresAt:number}>(3);
function cachedCatalog(bookId:string, version:number|string|undefined) {
  const cached=catalogCache.get(bookId);
  return cached && cached.version===version && cached.expiresAt>Date.now() ? cached.rows : undefined;
}
const settingsCache = {
  themeColor: 'cream' as 'gray' | 'cream' | 'green' | 'blue',
  fontFamily: 'sans' as 'sans' | 'serif' | 'kai',
  fontSizeNum: 22,
  lineHeight: 1.6,
  paraSpacing: 4,
  pageWidth: 1000
};


const subscribeViewport = (notify: () => void) => {
  window.addEventListener('resize', notify);
  return () => window.removeEventListener('resize', notify);
};
function useIsDesktop() {
  return useSyncExternalStore(subscribeViewport, () => window.innerWidth >= 1024, () => false);
}

function ReaderContent({ initialBook = null, initialChapter = null }: { initialBook?: Book | null; initialChapter?: Chapter | null }) {
  const params = useParams();
  //const searchParams = useSearchParams();
  const router = useRouter();
  const isDesktop = useIsDesktop(); 
  
  const bookId = params.id as string;
  const chapterIdParam = params.chapterId as string;
  const hasInitialBook = !!initialBook;
  const hasInitialChapter = !!initialChapter;
  const catalogVersion = initialBook?.writeVersion ?? initialBook?.updatedAt;
  const initialCatalog = cachedCatalog(bookId, catalogVersion);
  const { user } = useAuth();
  const [allChapters, setAllChapters] = useState<Chapter[]>(initialCatalog ?? []);
  const [catalogTotal, setCatalogTotal] = useState<number | null>(initialCatalog?.length ?? null);
  const [catalogLoading, setCatalogLoading] = useState(!initialCatalog);
  const [catalogError, setCatalogError] = useState('');
  const [catalogRetry, setCatalogRetry] = useState(0);
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [book, setBook] = useState<Book | null>(initialBook || null);
  const [chapter, setChapter] = useState<Chapter | null>(initialChapter || null);
  
  // 只有当缓存里【既没有书也没有章节】时，才显示 loading
  // 如果有缓存，loading 初始值就是 false，直接渲染正文
  const [loading, setLoading] = useState(() => {
     return !(initialBook && initialChapter);
  });
  const [isNavigating, startNavigation] = useTransition();
  const prefetchPolicy = useSyncExternalStore(subscribePrefetchPolicy, currentPrefetchPolicy, serverPrefetchPolicy);
  const [nextButtonVisible, setNextButtonVisible] = useState(false);
  const warmedNext = useRef<string | null>(null);
  const nearEnd = useCallback(() => setNextButtonVisible(true), []);
  
  const [showCatalog, setShowCatalog] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [catalogReversed, setCatalogReversed] = useState(false);

  // 导航栏显示状态 (移动端专用)
  const [mobileNav,setShowNav]=useState(false);
  const showNav=mobileNav;
  const { theme, setTheme } = useReadingSettings();

  const [themeColor, setThemeColor] = useStoredState('reader_themeColor',settingsCache.themeColor,v=>['gray','cream','green','blue'].includes(String(v)));
  const [fontFamily, setFontFamily] = useStoredState('reader_fontFamily',settingsCache.fontFamily,v=>['sans','serif','kai'].includes(String(v)));
  const [fontSizeNum, setFontSizeNum] = useStoredState('reader_fontSizeNum',settingsCache.fontSizeNum,v=>typeof v==='number'&&Number.isFinite(v)&&v>=12&&v<=72);
  const [lineHeight, setLineHeight] = useStoredState('reader_lineHeight',settingsCache.lineHeight,v=>typeof v==='number'&&Number.isFinite(v)&&v>0&&v<3000);
  const [paraSpacing, setParaSpacing] = useStoredState('reader_paraSpacing',settingsCache.paraSpacing,v=>typeof v==='number'&&Number.isFinite(v)&&v>0&&v<3000); 
  const [pageWidth, setPageWidth] = useStoredState('reader_pageWidth',settingsCache.pageWidth,v=>typeof v==='number'&&Number.isFinite(v)&&v>0&&v<3000);

  // 🔥 新增：当这些设置改变时，自动同步回全局缓存
  // 这样下一章加载时，就能记住你刚才的设置了
  useEffect(() => { settingsCache.themeColor = themeColor; }, [themeColor]);
  useEffect(() => { settingsCache.fontFamily = fontFamily; }, [fontFamily]);
  useEffect(() => { settingsCache.fontSizeNum = fontSizeNum; }, [fontSizeNum]);
  useEffect(() => { settingsCache.lineHeight = lineHeight; }, [lineHeight]);
  useEffect(() => { settingsCache.paraSpacing = paraSpacing; }, [paraSpacing]);
  useEffect(() => { settingsCache.pageWidth = pageWidth; }, [pageWidth]);

  const [hintSeen,setHintSeen]=useStoredState('has-seen-reading-hint',false);
  const showHint=!isDesktop&&!hintSeen;
  const setShowHint=(visible:boolean)=>setHintSeen(!visible); // 新手引导提示

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
    cream:  { name: '羊皮纸', bg: '#e7d2ae', text: '#352a18', line: '#c7b18d', panel: '#faf3e5', desk: '#d9c6a6' },
    gray:   { name: '雅致灰', bg: '#f0f0f0', text: '#222222', line: '#dcdcdc', panel: '#ffffff', desk: '#dcdcdc' },
    green:  { name: '护眼绿', bg: '#dcedc8', text: '#222222', line: '#c5e1a5', panel: '#e8f5e9', desk: '#cce0b8' },
    blue:   { name: '极光蓝', bg: '#e3edfc', text: '#222222', line: '#d0e0f8', panel: '#f0f7ff', desk: '#d5e2f5' },
    dark:   { name: '夜间',   bg: '#1a1a1a', text: '#a0a0a0', line: '#333333', panel: '#252525', desk: '#121212' },
  };

  const isActuallyDark = theme === 'dark';
  const activeTheme = isActuallyDark ? themeMap.dark : themeMap[themeColor];

  useEffect(() => {
    if (!activeTheme) return;

    // 1. 如果有待执行的清理任务（说明上一章刚卸载），取消它！
    // 因为新章节马上就接上了，不需要重置背景
    if (bgCleanupTimer) {
        clearTimeout(bgCleanupTimer);
        bgCleanupTimer = null;
    }

    // 2. 立即把浏览器底色染成当前主题色
    const color = isDesktop ? activeTheme.desk : activeTheme.bg;
    document.body.style.backgroundColor = color;

    // 3. 组件卸载时的逻辑 (延时清理)
    return () => {
        // 我们不立即清除背景，而是等 100ms
        // 如果 100ms 内用户只是切章节，新组件会挂载并取消这个定时器，背景保持不变
        // 如果 100ms 后还没新组件（说明用户真的退出了），再恢复默认背景
        bgCleanupTimer = setTimeout(() => {
            document.body.style.backgroundColor = '';
        }, 100);
    };
}, [activeTheme, isDesktop]);

  const paraSpacingMap: Record<number, string> = {
    2: '0.5rem', 4: '1rem', 6: '1.5rem', 8: '2rem',
  };

  useEffect(() => {
    if (!bookId || !chapterIdParam) return;
    let timer:ReturnType<typeof setTimeout> | undefined;
    const schedule=()=>{if(timer)clearTimeout(timer);if(document.visibilityState==='visible')timer=setTimeout(()=>{booksApi.incrementViews(bookId,chapterIdParam).catch(()=>{});},10000);};
    schedule();document.addEventListener('visibilitychange',schedule);
    return ()=>{if(timer)clearTimeout(timer);document.removeEventListener('visibilitychange',schedule);};
  }, [bookId, chapterIdParam]);
  useEffect(() => { if (!bookId || !user) return; let active=true; bookmarksApi.check(user.id,bookId).then(value=>{if(active)setIsBookmarked(value);}).catch(()=>{});return ()=>{active=false;}; }, [bookId, user]);
  useEffect(() => {
    if (showCatalog) {
      setTimeout(() => {
        document.getElementById('active-chapter-anchor')?.scrollIntoView({ block: 'center', behavior: 'auto' });
      }, 100);
    }
  }, [showCatalog]);

  // Load once per book, independently of chapter navigation and authentication.
  useEffect(() => {
    if (catalogRetry === 0 && cachedCatalog(bookId, catalogVersion)) return;
    let active = true;
    chaptersApi.getByBookId(bookId, {
      onProgress: (rows, total) => {
        if (active) { setAllChapters(rows); setCatalogTotal(total); }
      },
    }).then(rows => {
      if (active) {
        setCatalogTotal(rows.length);
        // Chapter routes can remount. Reuse only a complete, recent, unchanged book.
        if (catalogVersion !== undefined && rows.length <= 10000) catalogCache.set(bookId, {rows, version:catalogVersion, expiresAt:Date.now()+60000});
      }
    }).catch(error => {
      if (active) setCatalogError(error instanceof Error ? error.message : '目录暂不可用，请重试');
    }).finally(() => {
      if (active) setCatalogLoading(false);
    });
    return () => { active = false; };
  }, [bookId, catalogVersion, catalogRetry]);

// --- 极速加载逻辑 (优化版：带缓存 + 预加载支持) ---
  useEffect(() => {
    let isActive = true;

    const loadData = async () => {

      const token = localStorage.getItem('token');
      const authHeaders = {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      };
      const targetId = chapterIdParam;

if (targetId) {
        const hasServerData = hasInitialBook && hasInitialChapter && !!initialBook && !!initialChapter;

        if (hasServerData) {
          setBook(initialBook);
          setChapter(initialChapter);
          bookCache.set(bookId, initialBook);
          chapterCache.set(targetId, initialChapter);
          setLoading(false);
          window.scrollTo(0, 0);
        }
        // 1. 优先检查缓存
        if (!hasServerData && chapterCache.has(targetId) && bookCache.has(bookId)) {
           // ⚡️ 如果书和章节都有缓存，什么都不用做！
           // 因为我们在 useState 初始化时已经拿到了
           setLoading(false);
           // 但为了保险（防止初始化后数据变了），还是默默更新一下 state
           setChapter(chapterCache.get(targetId) || null);
           setBook(bookCache.get(bookId) || null);
           window.scrollTo(0, 0);
        } 
        else if (!hasServerData) {
          // 2. 缓存缺失，需要请求
          // 只有在真的没数据时，才转圈圈。如果只是缺其中一个，尽量保持界面显示
          if (!chapter || !book) setLoading(true);

          try {
            const [chapterRes, bookRes] = await Promise.all([
              // 如果缓存有章节，就不请求了 (Promise.resolve)
              !chapterCache.has(targetId) 
                  ? fetch(`${API_BASE_URL}/chapters/${targetId}`, { headers: authHeaders })
                  : Promise.resolve(null),
              // 如果缓存有书，就不请求了
              !bookCache.has(bookId) 
                  ? booksApi.getById(bookId) 
                  : Promise.resolve(null)
            ]);

            if (isActive) {
              // 处理章节数据
              if (chapterRes && chapterRes.ok) {
                const chData = await chapterRes.json();
                setChapter(chData);
                chapterCache.set(targetId, chData); // ✅ 存入缓存
                window.scrollTo(0, 0);
              } else if (chapterCache.has(targetId)) {
                // 如果这次没请求(用了缓存)，确保滚动到顶部
                 window.scrollTo(0, 0);
              }

              // 处理书籍数据
              if (bookRes) {
                 setBook(bookRes);
                 bookCache.set(bookId, bookRes); // ✅ 存入缓存
              }

              setLoading(false);
            }
          } catch (e) {
            console.error("加载失败", e);
            setLoading(false);
          }
        }

      } 
      
      // === 场景 B: 慢速通道 (保持不变) ===
      else {
        setLoading(true);
        try {
          const [bookRes, chaptersRes] = await Promise.all([
             !book ? booksApi.getById(bookId) : Promise.resolve(null),
             chaptersApi.getByBookId(bookId)
          ]);

          if (isActive) {
             if (bookRes) setBook(bookRes);
             if (chaptersRes) {
               setAllChapters(chaptersRes);
               if (chaptersRes.length > 0) {
                 const firstId = chaptersRes[0].id;
                 // 🔥 [修改点 C] 即使是第一章，也尝试读缓存
                 if (chapterCache.has(firstId)) {
                    setChapter(chapterCache.get(firstId) || null);
                 } else {
                    const chRes = await fetch(`/api/chapters/${firstId}`, { headers: authHeaders });
                    if (chRes.ok) {
                      const chData = await chRes.json();
                      setChapter(chData);
                      chapterCache.set(firstId, chData); // 存缓存
                    }
                 }
                 window.scrollTo(0, 0);
               }
             }
             setLoading(false);
          }
        } catch (e) {
          console.error("初始化加载失败", e);
          setLoading(false);
        }
      }
    };

    loadData();

    return () => { isActive = false; };
  }, [bookId, chapterIdParam, hasInitialBook, hasInitialChapter, initialBook, initialChapter]); // 依赖项不变 

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
    } catch (error) { console.error('书架操作失败', error); }
  };
  // Navigate through the same router cache we prefetch. A separate chapter API
  // download here would still be followed by the server-rendered route request.
  const goToChapter = useCallback((targetChapterId: string) => {
    if (targetChapterId === chapterIdParam) return;
    startNavigation(() => router.push(`/book/${bookId}/${targetChapterId}`, { scroll: false }));
  }, [router, bookId, chapterIdParam]);
  const prefetchChapter = useCallback((targetChapterId: string | null) => {
    if (targetChapterId && targetChapterId !== chapterIdParam && currentPrefetchPolicy() !== 'paused') {
      router.prefetch(`/book/${bookId}/${targetChapterId}`, { kind: PrefetchKind.FULL });
    }
  }, [router, bookId, chapterIdParam]);
  const currentChapterIndex = allChapters.findIndex((ch) => ch.id === chapter?.id);
  const prevChapterId = currentChapterIndex > 0 ? allChapters[currentChapterIndex - 1].id : chapter?.previousId ?? null;
  const nextChapterId = currentChapterIndex >= 0 && currentChapterIndex < allChapters.length - 1 ? allChapters[currentChapterIndex + 1].id : chapter?.nextId ?? null;

  useEffect(() => {
    if (chapter?.id === chapterIdParam && chapter.bookId === bookId) rememberChapter(bookId, chapter.id);
  }, [chapter, bookId, chapterIdParam]);

  // Warm exactly one next route after the current text has rendered. Never
  // mount that reader: views, advertisements and bookmark effects run on entry.
  useEffect(() => {
    if (prefetchPolicy !== 'visible' || !chapter || !nextChapterId) return;
    // Long chapters may outlast the route cache. Warm again when the reader
    // reaches the next button, without repeatedly downloading while they read.
    if (warmedNext.current === nextChapterId && !nextButtonVisible) return;
    const timer = window.setTimeout(() => {
      if (currentPrefetchPolicy() === 'visible') {
        warmedNext.current = nextChapterId;
        router.prefetch(`/book/${bookId}/${nextChapterId}`, { kind: PrefetchKind.FULL });
      }
    }, 800);
    return () => window.clearTimeout(timer);
  }, [prefetchPolicy, bookId, chapter, nextChapterId, nextButtonVisible, router]);

  const fontFamilyValue = {
    sans: '"PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif',
    serif: '"Songti SC", "SimSun", serif',
    kai: '"Kaiti SC", "KaiTi", serif',
  }[fontFamily];
  const displayChapters = catalogReversed ? [...allChapters].reverse() : allChapters;

if (loading) return (
    <div 
      className="min-h-screen flex items-center justify-center transition-colors duration-300" 
      style={{ 
        backgroundColor: isDesktop ? activeTheme.desk : activeTheme.bg 
      }} 
    >
      <div className="flex flex-col items-center gap-3">
         <BookOpen className="h-10 w-10 animate-pulse opacity-50" style={{ color: activeTheme.text }} />
         <span className="text-xs opacity-50" style={{ color: activeTheme.text }}>加载中...</span>
      </div>
    </div>
  );
  if (!book || !chapter) return null;

  return (
    <div 
      className="min-h-screen w-full transition-colors duration-300 flex flex-col items-center"
      data-reader-cache-chapters={chapterCache.size}
      data-reader-cache-books={bookCache.size}
      style={{ 
        backgroundColor: isDesktop ? activeTheme.desk : activeTheme.bg 
      }}
    >
      <div
        className="reader-tools fixed bottom-0 left-0 right-0 z-50 h-16 flex items-center justify-between px-6 border-t transition-all duration-300 pb-safe"
        style={{
            backgroundColor: activeTheme.bg,
            color: activeTheme.text,
            borderColor: activeTheme.line,
            transform: `translateY(${showNav ? '0' : '100%'})`,
        }}
      >
          {/* 1. 设置 (原在右，现移至左) */}
          <button 
            onClick={() => setShowSettings(!showSettings)} 
            className={`flex flex-col items-center gap-1 opacity-80 active:opacity-100 ${showSettings ? 'text-blue-500' : ''}`}
          >
             <Settings className="w-5 h-5"/>
             <span className="text-[10px]">设置</span>
          </button>

          {/* 2. 书籍详情 (新增) */}
          <Link 
            href={`/book/${bookId}`}
            className="flex flex-col items-center gap-1 opacity-80 active:opacity-100"
          >
             <Info className="w-5 h-5"/>
             <span className="text-[10px]">详情</span>
          </Link>

          {/* 3. 目录 */}
          <button 
            onClick={() => setShowCatalog(true)} 
            className="flex flex-col items-center gap-1 opacity-90 active:opacity-100"
          >
             <List className="w-5 h-5"/> {/* 图标稍微改小一点点以适配4个按钮 */}
             <span className="text-[10px]">目录</span>
          </button>

          {/* 4. 夜间模式 (原在左，现移至右) */}
          <button 
            onClick={() => setTheme(isActuallyDark ? 'light' : 'dark')}
            className="flex flex-col items-center gap-1 opacity-80 active:opacity-100"
          >
             {isActuallyDark ? <Sun className="w-5 h-5"/> : <Moon className="w-5 h-5"/>}
             <span className="text-[10px]">
                {isActuallyDark ? '日间' : '夜间'}
             </span>
          </button>
      </div>


      <div className="relative w-full" onPointerDown={() => { if (showHint) setShowHint(false); }}>
        <ReaderPages
          book={book} chapter={chapter} chapterIndex={currentChapterIndex} chapterTotal={catalogTotal}
          fontFamily={fontFamilyValue} fontSize={fontSizeNum} lineHeight={lineHeight}
          paragraphGap={paraSpacingMap[paraSpacing] || '1rem'} theme={activeTheme}
          paper={themeColor === 'cream'} dark={isActuallyDark} pageWidth={pageWidth}
          previousId={prevChapterId} nextId={nextChapterId} navigating={isNavigating}
          blocked={showCatalog || showSettings}
          onChapter={goToChapter} onTools={() => { setShowHint(false); setShowNav(value => !value); }}
          onNearEnd={nearEnd}
        />

      <div
        className="hidden xl:block absolute top-0 h-full pointer-events-none" // pointer-events-none 防止隐形长条遮挡点击
        style={{ 
          left: '50%',
          marginLeft: `${pageWidth / 2 + 15}px`
        }}
      >
        <aside 
          className="sticky top-1/3 flex flex-col gap-3 p-2 rounded-xl shadow-lg border transition-all duration-300 pointer-events-auto" // pointer-events-auto 恢复按钮点击
          style={{ 
            backgroundColor: activeTheme.bg, 
            borderColor: activeTheme.line,
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
                 <span className="text-xs opacity-50">共 {catalogTotal ?? allChapters.length} 章</span>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={() => setCatalogReversed(!catalogReversed)} 
                  className="px-3 py-1.5 text-xs font-medium rounded-full bg-black/5 hover:bg-black/10 transition-colors flex items-center gap-1 active:scale-95"
                >
                   <ArrowUpDown className="w-3 h-3"/> {catalogReversed ? '正序' : '倒序'}
                </button>
                <button aria-label="关闭目录" onClick={() => setShowCatalog(false)} className="p-1.5 hover:bg-black/10 rounded-full bg-black/5 active:scale-95">
                  <X className="w-4 h-4 opacity-60"/>
                </button>
              </div>
            </div>
            
            {/* List */}
            <div role="region" aria-label="阅读目录" aria-busy={catalogLoading} className="flex-1 overflow-y-auto p-4 custom-scrollbar">
              {catalogLoading && allChapters.length === 0 && <p role="status" className="mb-3 text-sm opacity-60">加载目录…</p>}
              {catalogError && <p role="alert" className="mb-3 text-sm text-red-600">{catalogError} <button onClick={() => { setCatalogLoading(true); setCatalogError(''); setCatalogRetry(value => value + 1); }} className="underline">重试</button></p>}
              {!catalogLoading && !catalogError && !allChapters.length && <p className="text-sm opacity-60">暂无章节</p>}
              <div className={`${isDesktop ? 'grid grid-cols-2 gap-x-12 gap-y-2' : 'flex flex-col gap-1'}`}>
                {displayChapters.map(ch => {
                  const isActive = ch.id === chapter.id;
                  return (
                    <button 
                      key={ch.id} 
                      id={isActive ? 'active-chapter-anchor' : undefined}
                      onMouseEnter={() => prefetchChapter(ch.id)}
                      onFocus={() => prefetchChapter(ch.id)}
                      onTouchStart={() => prefetchChapter(ch.id)}
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
                className="fixed top-32 z-50 w-[500px] rounded-xl shadow-2xl border p-6 animate-in fade-in zoom-in-95"
                style={{ 
                right: `calc(50% - ${pageWidth / 2 + 15}px)`,
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
                                // 1. 移除了 disabled 属性
                                onClick={() => {
                                    setThemeColor(key as 'gray' | 'cream' | 'green' | 'blue'); // 改变主题颜色
                                    if (isActuallyDark) setTheme('light'); // 2. 如果当前是黑夜，强制切回日间
                                }}
                                className={`w-12 h-12 rounded-full border flex items-center justify-center transition-all ${themeColor === key && !isActuallyDark ? 'ring-2 ring-blue-500 scale-110' : ''}`}
                                // 3. 将 opacity 固定为 1，确保黑夜模式下按钮依然清晰可见可点
                                style={{ backgroundColor: val.bg, borderColor: 'transparent', opacity: 1 }}
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
                                onClick={() => setFontFamily(f as 'sans' | 'serif' | 'kai')}
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
                            <button onClick={() => setFontSizeNum(Math.max(12, fontSizeNum - 1))} className="p-2 hover:bg-white/60 rounded text-sm font-bold">A-</button>
                            <input 
                                type="range" min="14" max="36" step="1" 
                                value={fontSizeNum} 
                                onChange={(e) => setFontSizeNum(Number(e.target.value))}
                                className="flex-1 h-2 bg-gray-300 rounded-lg appearance-none cursor-pointer accent-blue-600"
                            />
                            <button onClick={() => setFontSizeNum(Math.min(48, fontSizeNum + 1))} className="p-2 hover:bg-white/60 rounded text-xl font-bold">A+</button>
                            <span className="w-12 text-center font-bold">{fontSizeNum}</span>
                        </div>
                    </div>

                    {/* 🟢 新增：页面宽度设置 */}
                    <div className="flex items-center">
                        <span className="w-20 font-bold opacity-70 shrink-0">页面宽度</span>
                        <div className="flex gap-3 flex-1">
                            {[850, 1000, 1200, 1400].map(w => (
                                <button
                                    key={w}
                                    onClick={() => setPageWidth(w)}
                                    className={`flex-1 py-2 rounded-lg border transition-all text-sm font-bold ${pageWidth === w ? 'bg-blue-600 text-white border-blue-600' : 'hover:bg-black/5 border-gray-200'}`}
                                >
                                    {w === 850 ? '窄屏' : w === 1000 ? '标准' : w === 1200 ? '宽屏' : '超宽'}
                                </button>
                            ))}
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
                <button onClick={() => setFontSizeNum(Math.max(12, fontSizeNum - 1))} className="px-3 font-serif hover:bg-black/10 rounded">A-</button>
                <div className="flex-1 text-center text-sm font-bold opacity-80">{fontSizeNum}</div>
                <button onClick={() => setFontSizeNum(Math.min(48, fontSizeNum + 1))} className="px-3 font-serif text-lg hover:bg-black/10 rounded">A+</button>
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
                        // 1. 移除了 disabled 属性
                        onClick={() => {
                            setThemeColor(key as 'gray' | 'cream' | 'green' | 'blue');
                            if (isActuallyDark) setTheme('light'); // 2. 同步退出黑夜模式
                        }}
                        className={`w-8 h-8 rounded-full border flex items-center justify-center transition-all ${themeColor === key && !isActuallyDark ? 'ring-2 ring-blue-500 scale-110' : ''}`}
                        // 3. 将 opacity 固定为 1
                        style={{ backgroundColor: val.bg, borderColor: 'transparent', opacity: 1 }}
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
                        onClick={() => setFontFamily(f as 'sans' | 'serif' | 'kai')}
                        className={`flex-1 py-1.5 text-xs rounded border transition-all ${fontFamily === f ? 'bg-blue-50 text-blue-600 border-blue-500' : 'bg-black/5 border-transparent'}`}
                      >
                        {f === 'sans' ? '黑体' : f === 'serif' ? '宋体' : '楷体'}
                      </button>
                    ))}
                 </div>
              </div>

              {/* 排版间距：行高与段距 (移动端) */}
              <div className="flex flex-col gap-3">
                {/* 行高 */}
                <div className="flex items-center gap-2">
                    <span className="text-xs opacity-50 font-bold w-10">行高</span>
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
                
                {/* 段距 */}
                <div className="flex items-center gap-2">
                    <span className="text-xs opacity-50 font-bold w-10">段距</span>
                    <div className="flex flex-1 gap-2 bg-black/5 rounded-lg p-1">
                      <button onClick={() => setParaSpacing(2)} className={`flex-1 py-1 text-xs rounded transition-all ${paraSpacing === 2 ? 'bg-white shadow-sm font-bold text-blue-600' : ''}`}>紧凑</button>
                      <button onClick={() => setParaSpacing(4)} className={`flex-1 py-1 text-xs rounded transition-all ${paraSpacing === 4 ? 'bg-white shadow-sm font-bold text-blue-600' : ''}`}>标准</button>
                      <button onClick={() => setParaSpacing(6)} className={`flex-1 py-1 text-xs rounded transition-all ${paraSpacing === 6 ? 'bg-white shadow-sm font-bold text-blue-600' : ''}`}>中等</button>
                      <button onClick={() => setParaSpacing(8)} className={`flex-1 py-1 text-xs rounded transition-all ${paraSpacing === 8 ? 'bg-white shadow-sm font-bold text-blue-600' : ''}`}>宽疏</button>
                    </div>
                </div>
              </div>
            </div>
          </div>
          )}
        </>
      )}

      {/* 7. 新手引导提示 (仅第一次出现，半透明浮层) */}
      {showHint && (
        <div className="fixed bottom-20 left-0 right-0 z-[70] flex items-center justify-center pointer-events-none">
            <div className="bg-black/70 backdrop-blur-sm text-white px-6 py-4 rounded-2xl shadow-xl flex flex-col items-center gap-2 ">
                {/* 圆圈点点图标 */}
                <div className="w-8 h-8 rounded-full border-2 border-white/50 flex items-center justify-center">
                    <div className="w-1.5 h-1.5 bg-white rounded-full"></div>
                </div>
                <span className="text-sm font-bold tracking-wide">点击两侧翻页，点击中间打开菜单</span><span className="text-xs opacity-80">长按段落可评论或标记</span>
            </div>
        </div>
      )}

    </div>
  );
}

export default function ReaderPage({ initialBook = null, initialChapter = null }: { initialBook?: Book | null; initialChapter?: Chapter | null }) {
  const params = useParams();
  // Reset chapter presentation while the versioned catalog survives in its cache.
  const componentKey = params?.chapterId ? String(params.chapterId) : 'default';
  return <ReaderContent key={componentKey} initialBook={initialBook} initialChapter={initialChapter} />;
}
