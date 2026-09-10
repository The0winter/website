'use client';
import {useStoredState} from '@/lib/useStoredState';
 

import { useEffect, useCallback, useState, useRef, useSyncExternalStore } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import Link from './PrefetchLink';
import { currentPrefetchPolicy, serverPrefetchPolicy, subscribePrefetchPolicy } from '@/lib/book-prefetch';
import { rememberChapter } from '@/lib/reading-session';
import {readerChapterCache as chapterCache,loadReaderChapter,loadReaderCounts} from '@/lib/reader-chapters';
import { 
  Settings, BookOpen, List, 
  Bookmark, BookmarkCheck, Moon, X, 
  ArrowUpDown, Check, Sun, Info, Library,
} from 'lucide-react';
import { booksApi, chaptersApi, bookmarksApi, Book, Chapter } from '@/lib/api';
import { useReadingSettings } from '@/contexts/ReadingSettingsContext';
import { useAuth } from '@/contexts/AuthContext';

import ReaderPages from './ReaderPages';
import type {ReaderTurnMode} from './useReaderPageTurn';

const turnModes=[
  {value:'horizontal',label:'左右翻页',hint:'左右滑动或点击两侧翻页，点击中央打开菜单'},
  {value:'scroll',label:'上下滚屏',hint:'上下滑动阅读，到章末继续上滑进入下一章'},
  {value:'vertical',label:'上下翻页',hint:'上下滑动或点击上下区域翻页，点击中央打开菜单'},
] as const;
function ReaderModeSetting({value,onChange}:{value:ReaderTurnMode;onChange:(value:ReaderTurnMode)=>void}){
  return <fieldset className="reader-mode-setting"><legend>翻页方式</legend><div className="reader-mode-options">{turnModes.map(mode=><button key={mode.value} type="button" aria-pressed={value===mode.value} onClick={()=>onChange(mode.value)}>{mode.label}</button>)}</div><p>{turnModes.find(mode=>mode.value===value)?.hint}</p></fieldset>;
}

let bgCleanupTimer: NodeJS.Timeout | null = null;

// 🔥 [新增 1] 全局章节缓存池
class BoundedMap<K,V> extends Map<K,V> {
  constructor(private maximum:number){super();}
  set(key:K,value:V){super.delete(key);super.set(key,value);while(this.size>this.maximum){const oldest=this.keys().next();if(!oldest.done)super.delete(oldest.value);}return this;}
}
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
  pageWidth: 1000,
  turnMode: 'horizontal' as ReaderTurnMode,
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
  const pathname=usePathname();
  //const searchParams = useSearchParams();
  const router = useRouter();
  const isDesktop = useIsDesktop(); 
  
  const bookId = params.id as string;
  const chapterIdParam = pathname?.split('/')[3] || params.chapterId as string;
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
  const [isNavigating,setNavigating]=useState(false);
  const [navigationError,setNavigationError]=useState('');
  const navigationSequence=useRef(0);
  const failedChapter=useRef<string|null>(null);
  const [adjacent,setAdjacent]=useState<{previous?:Chapter;next?:Chapter}>({});
  const prefetchPolicy = useSyncExternalStore(subscribePrefetchPolicy, currentPrefetchPolicy, serverPrefetchPolicy);
  const [nextButtonVisible, setNextButtonVisible] = useState(false);
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
  const [turnMode,setTurnMode]=useStoredState<ReaderTurnMode>('reader_turnMode',settingsCache.turnMode,value=>turnModes.some(mode=>mode.value===value));
  const hideTools=useCallback(()=>setShowNav(false),[]);

  // 🔥 新增：当这些设置改变时，自动同步回全局缓存
  // 这样下一章加载时，就能记住你刚才的设置了
  useEffect(() => { settingsCache.themeColor = themeColor; }, [themeColor]);
  useEffect(() => { settingsCache.fontFamily = fontFamily; }, [fontFamily]);
  useEffect(() => { settingsCache.fontSizeNum = fontSizeNum; }, [fontSizeNum]);
  useEffect(() => { settingsCache.lineHeight = lineHeight; }, [lineHeight]);
  useEffect(() => { settingsCache.paraSpacing = paraSpacing; }, [paraSpacing]);
  useEffect(() => { settingsCache.pageWidth = pageWidth; }, [pageWidth]);
  useEffect(() => { settingsCache.turnMode = turnMode; }, [turnMode]);

  const [hintSeen,setHintSeen]=useStoredState('has-seen-reading-hint',false);
  const showHint=!isDesktop&&!hintSeen;
  const setShowHint=(visible:boolean)=>setHintSeen(!visible); // 新手引导提示

  // Keep a return entry even when a chapter is opened directly in a new tab.
  // Give it the real detail URL so Back also works across a document reload.
  // For same-document Back, replace the retained reader tree with the detail route.
  useEffect(() => {
    if (window.history.state?.readerBook !== bookId) {
      const href = window.location.href;
      const state = window.history.state;
      window.history.replaceState({...state, readerReturn: bookId}, '', `/book/${bookId}`);
      window.history.pushState({...state, readerBook: bookId}, '', href);
    }
    const returnToDetail = (event: PopStateEvent) => {
      if (event.state?.readerReturn !== bookId) return;
      event.stopImmediatePropagation();
      navigationSequence.current++;
      router.replace(`/book/${bookId}`);
    };
    window.addEventListener('popstate', returnToDetail, true);
    return () => window.removeEventListener('popstate', returnToDetail, true);
  }, [bookId, router]);

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

  useEffect(() => {
    let active=true;
    navigationSequence.current++;
    const serverChapter=initialChapter?.id===chapterIdParam?initialChapter:null;
    if(serverChapter)chapterCache.set(serverChapter.id,serverChapter);
    if(initialBook?.id===bookId)bookCache.set(bookId,initialBook);
    void Promise.all([loadReaderChapter(bookId,chapterIdParam),bookCache.get(bookId) || booksApi.getById(bookId)]).then(([next,book])=>{
      if(!active)return;
      setChapter(next);setBook(book);if(book)bookCache.set(bookId,book);setLoading(false);setNavigating(false);setNavigationError('');
    }).catch(error=>{if(active){failedChapter.current=chapterIdParam;setNavigationError(error instanceof Error?error.message:'章节加载失败');setLoading(false);setNavigating(false);}});
    return()=>{active=false;};
  },[bookId,chapterIdParam,initialBook,initialChapter]);
  useEffect(()=>{
    const invalidate=()=>{navigationSequence.current++;};
    const restore=()=>{
      invalidate();
      const parts=window.location.pathname.split('/');
      if(parts[2]!==bookId || !parts[3])return;
      const cached=chapterCache.get(parts[3]);
      setShowNav(false);setNavigationError('');
      if(cached?.bookId===bookId){setChapter(cached);setNavigating(false);}else setNavigating(true);
    };
    window.addEventListener('popstate',restore);
    return()=>{invalidate();window.removeEventListener('popstate',restore);};
  },[bookId]);
  useEffect(()=>{if(chapter && book)document.title=`${chapter.title} - ${book.title}`;},[chapter,book]);

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
  const goToChapter=useCallback((targetChapterId:string)=>{
    if(targetChapterId===chapter?.id)return;
    const sequence=++navigationSequence.current;
    const enter=(next:Chapter)=>{
      if(sequence!==navigationSequence.current)return;
      chapterCache.set(next.id,next);
      rememberChapter(bookId,next.id);
      setChapter(next);setNavigating(false);setNavigationError('');setShowNav(false);setShowCatalog(false);
      // Chapter turns share one history entry. Native history integration keeps
      // the URL in sync without refetching the route; Back exits to book details.
      const href=`/book/${bookId}/${next.id}`;
      window.history.replaceState({readerBook:bookId},'',href);
    };
    const cached=chapterCache.get(targetChapterId) || (adjacent.previous?.id===targetChapterId?adjacent.previous:adjacent.next?.id===targetChapterId?adjacent.next:undefined);
    if(cached?.bookId===bookId){enter(cached);return;}
    setNavigating(true);setNavigationError('');
    void loadReaderChapter(bookId,targetChapterId).then(enter).catch(error=>{
      if(sequence===navigationSequence.current){failedChapter.current=targetChapterId;setNavigating(false);setNavigationError(error instanceof Error?error.message:'章节加载失败，请重试');}
    });
  },[bookId,chapter?.id,adjacent]);
  const prefetchChapter=useCallback((id:string|null)=>{
    if(id && id!==chapter?.id && currentPrefetchPolicy()!=='paused')void loadReaderChapter(bookId,id).catch(()=>{});
  },[bookId,chapter?.id]);
  const currentChapterIndex = allChapters.findIndex((ch) => ch.id === chapter?.id);
  const prevChapterId = currentChapterIndex > 0 ? allChapters[currentChapterIndex - 1].id : chapter?.previousId ?? null;
  const nextChapterId = currentChapterIndex >= 0 && currentChapterIndex < allChapters.length - 1 ? allChapters[currentChapterIndex + 1].id : chapter?.nextId ?? null;

  useEffect(() => {
    if (chapter?.id === chapterIdParam && chapter.bookId === bookId && pathname === `/book/${bookId}/${chapter.id}`) rememberChapter(bookId, chapter.id);
  }, [chapter, bookId, chapterIdParam, pathname]);

  // Preload parsed text and paragraph counts in both directions. No hidden
  // reader is mounted, so speculative reads never record views or bookmarks.
  useEffect(()=>{
    if(!chapter?.id || prefetchPolicy!=='visible')return;
    let active=true;
    const timer=window.setTimeout(()=>{
      for(const [side,id] of [['previous',prevChapterId],['next',nextChapterId]] as const){
        if(!id)continue;
        void Promise.all([loadReaderChapter(bookId,id),loadReaderCounts(id).catch(()=>({}))]).then(([value])=>{
          if(active)setAdjacent(previous=>({...previous,[side]:value}));
        }).catch(()=>{});
      }
    },nextButtonVisible?0:150);
    return()=>{active=false;window.clearTimeout(timer);};
  },[prefetchPolicy,bookId,chapter?.id,prevChapterId,nextChapterId,nextButtonVisible]);

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
        inert={!showNav}
        aria-hidden={!showNav}
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
          key={chapter.id} book={book} chapter={chapter} chapterIndex={currentChapterIndex} chapterTotal={catalogTotal}
          previousChapter={adjacent.previous?.id===prevChapterId?adjacent.previous:chapterCache.get(prevChapterId || '')}
          nextChapter={adjacent.next?.id===nextChapterId?adjacent.next:chapterCache.get(nextChapterId || '')}
          fontFamily={fontFamilyValue} fontSize={fontSizeNum} lineHeight={lineHeight}
          paragraphGap={paraSpacingMap[paraSpacing] || '1rem'} theme={activeTheme}
          paper={themeColor === 'cream'} dark={isActuallyDark} pageWidth={pageWidth}
          previousId={prevChapterId} nextId={nextChapterId} navigating={isNavigating}
          blocked={showCatalog || showSettings}
          turnMode={turnMode} toolsVisible={showNav} onHideTools={hideTools}
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

      {navigationError && <div role="alert" className="reader-navigation-error">{navigationError}<button onClick={()=>goToChapter(failedChapter.current || chapterIdParam)}>重试</button><button onClick={()=>setNavigationError('')}>关闭</button></div>}
      {/* 6. 设置弹窗 */}
      {showSettings && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowSettings(false)} />
          
          {isDesktop ? (
            // ============ 桌面端大设置面板 (保留不变) ============
            <div 
                className="fixed top-20 z-50 w-[500px] max-h-[calc(100dvh-160px)] overflow-y-auto rounded-xl shadow-2xl border p-6 animate-in fade-in zoom-in-95"
                style={{ 
                right: `calc(50% - ${pageWidth / 2 + 15}px)`,
                backgroundColor: isActuallyDark ? '#2a2a2a' : activeTheme.panel,
                color: activeTheme.text,
                borderColor: activeTheme.line 
                }}
            >
                <div className="flex justify-between items-center mb-6 pb-4 border-b" style={{ borderColor: activeTheme.line }}>
                    <h3 className="font-bold text-xl flex items-center gap-2"><Settings className="w-5 h-5" /> 阅读设置</h3>
                    <button onClick={() => setShowSettings(false)} aria-label="关闭阅读设置" className="p-1 hover:bg-black/5 rounded-full">
                        <X className="w-6 h-6 opacity-60"/>
                    </button>
                </div>

                <div className="space-y-6">
                    <ReaderModeSetting value={turnMode} onChange={setTurnMode}/>
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
            <div 
            className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 w-[92%] max-w-[360px] max-h-[calc(100dvh-120px)] overflow-y-auto rounded-xl shadow-2xl border p-4 animate-in slide-in-from-bottom-5 fade-in duration-200"
            style={{ 
              backgroundColor: isActuallyDark ? 'rgba(40,40,40,0.95)' : 'rgba(255,255,255,0.95)',
              backdropFilter: 'blur(10px)',
              color: activeTheme.text,
              borderColor: activeTheme.line 
            }}
          >
            <div className="flex items-center justify-between mb-3"><span className="text-sm font-bold">阅读设置</span><button aria-label="关闭阅读设置" onClick={()=>setShowSettings(false)} className="p-1"><X size={18}/></button></div>
            <ReaderModeSetting value={turnMode} onChange={setTurnMode}/>
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
                <span className="text-sm font-bold tracking-wide">{turnModes.find(mode=>mode.value===turnMode)?.hint}</span><span className="text-xs opacity-80">长按段落可评论或标记</span>
            </div>
        </div>
      )}

    </div>
  );
}

export default function ReaderPage({ initialBook = null, initialChapter = null }: { initialBook?: Book | null; initialChapter?: Chapter | null }) {
  const params = useParams();
  // Reset chapter presentation while the versioned catalog survives in its cache.
  const componentKey = params?.id ? String(params.id) : 'default';
  return <ReaderContent key={componentKey} initialBook={initialBook} initialChapter={initialChapter} />;
}
