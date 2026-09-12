'use client';
import {useStoredState} from '@/lib/useStoredState';
import {mobileReaderCream, readerPaperImage} from '@/lib/reader-paper';
 

import { useEffect, useCallback, useState, useRef, useSyncExternalStore } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import Link from './PrefetchLink';
import { currentPrefetchPolicy, serverPrefetchPolicy, subscribePrefetchPolicy } from '@/lib/book-prefetch';
import { rememberChapter } from '@/lib/reading-session';
import {replaceReaderChapter, openBookCatalog, closeBookCatalog, bookCatalogOpen, serverCatalogClosed, subscribeBookNavigation, selectReaderCatalogChapter, openReaderSettings, closeReaderSettings, readerSettingsOpen} from '@/lib/book-navigation';
import BookCatalogSheet from './BookCatalogSheet';
import {useBookCatalog} from '@/lib/useBookCatalog';
import {currentChapterEntry, failChapterEntry, serverChapterEntry, subscribeChapterEntry} from '@/lib/chapter-entry';
import {readerChapterCache as chapterCache,loadReaderChapter,loadReaderCounts} from '@/lib/reader-chapters';
import { 
  Settings, BookOpen, List, 
  Bookmark, BookmarkCheck, Moon, X, 
  Check, Sun, Info, Library,
} from 'lucide-react';
import { booksApi, bookmarksApi, Book, Chapter } from '@/lib/api';
import RecordBookVisit from './RecordBookVisit';
import { useReadingSettings } from '@/contexts/ReadingSettingsContext';
import { useAuth } from '@/contexts/AuthContext';

import ReaderPages from './ReaderPages';
import ReaderScroll from './ReaderScroll';
import type {ReaderTurnMode} from './useReaderPageTurn';

const turnModes=[
  {value:'horizontal',label:'左右翻页',hint:'左右滑动或点击两侧翻页，点击中央打开菜单'},
  {value:'scroll',label:'上下滚屏',hint:'上下滑动连续阅读，章节自动衔接'},
  {value:'vertical',label:'上下翻页',hint:'上下滑动或点击上下区域翻页，点击中央打开菜单'},
] as const;
function ReaderModeSetting({value,onChange}:{value:ReaderTurnMode;onChange:(value:ReaderTurnMode)=>void}){
  return <fieldset className="reader-mode-setting"><legend>翻页方式</legend><div className="reader-mode-options">{turnModes.map(mode=><button key={mode.value} type="button" aria-pressed={value===mode.value} onClick={()=>onChange(mode.value)}>{mode.label}</button>)}</div></fieldset>;
}

let bgCleanupTimer: NodeJS.Timeout | null = null;

// 🔥 [新增 1] 全局章节缓存池
class BoundedMap<K,V> extends Map<K,V> {
  constructor(private maximum:number){super();}
  set(key:K,value:V){super.delete(key);super.set(key,value);while(this.size>this.maximum){const oldest=this.keys().next();if(!oldest.done)super.delete(oldest.value);}return this;}
}
// 🔥 [新增] 全局书籍缓存池 (防止切换章节时书名/封面闪烁)
const bookCache = new BoundedMap<string, Book>(3);
const settingsCache = {
  themeColor: 'cream' as 'gray' | 'cream' | 'green' | 'blue',
  fontFamily: 'sans' as 'sans' | 'serif' | 'kai',
  fontSizeNum: 22,
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
  const { user } = useAuth();
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
  
  const showCatalog = useSyncExternalStore(subscribeBookNavigation, () => bookCatalogOpen(bookId), serverCatalogClosed);
  const catalog = useBookCatalog(bookId, book?.writeVersion, chapter?.id ?? chapterIdParam, showCatalog);
  const catalogTotal = catalog.snapshot.total;
  const showSettings = useSyncExternalStore(subscribeBookNavigation, () => readerSettingsOpen(bookId), serverCatalogClosed);
  const chapterEntry = useSyncExternalStore(subscribeChapterEntry, currentChapterEntry, serverChapterEntry);
  const entryLocked = Boolean(chapterEntry && !chapterEntry.releasing);
  const [entryKey, setEntryKey] = useState(() => currentChapterEntry()?.token || '');

  // 导航栏显示状态 (移动端专用)
  const [mobileNav,setShowNav]=useState(false);
  const showNav=mobileNav;
  const setShowCatalog = (open: boolean) => {
    if (open) { setShowNav(false); openBookCatalog(bookId); }
    else closeBookCatalog();
  };
  const setShowSettings = (open: boolean) => {
    if (open) { setShowNav(true); openReaderSettings(bookId); }
    else closeReaderSettings();
  };
  useEffect(() => {
    if (!showSettings) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = document.querySelector<HTMLElement>('[data-reader-settings]');
    const frame = requestAnimationFrame(() => panel?.querySelector<HTMLElement>('[aria-label="关闭阅读设置"]')?.focus({preventScroll: true}));
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeReaderSettings(); }
      if (event.key !== 'Tab' || !panel) return;
      const buttons = [...panel.querySelectorAll<HTMLElement>('button:not([disabled]),input')].filter(el => el.getBoundingClientRect().width > 0);
      const first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) {event.preventDefault(); last?.focus();}
      else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first?.focus();}
    };
    document.addEventListener('keydown', keyboard);
    return () => {cancelAnimationFrame(frame); document.removeEventListener('keydown', keyboard); if (previous?.isConnected) previous.focus({preventScroll: true});};
  }, [showSettings]);
  const { theme, setTheme } = useReadingSettings();

  const [themeColor, setThemeColor] = useStoredState('reader_themeColor',settingsCache.themeColor,v=>['gray','cream','green','blue'].includes(String(v)));
  const [fontFamily, setFontFamily] = useStoredState('reader_fontFamily',settingsCache.fontFamily,v=>['sans','serif','kai'].includes(String(v)));
  const [fontSizeNum, setFontSizeNum] = useStoredState('reader_fontSizeNum',settingsCache.fontSizeNum,v=>typeof v==='number'&&Number.isFinite(v)&&v>=12&&v<=72);
  const [lineHeight, setLineHeight] = useStoredState('reader_lineHeight',isDesktop ? 1.6 : 1.5,v=>typeof v==='number'&&Number.isFinite(v)&&v>0&&v<3000);
  const [paraSpacing, setParaSpacing] = useStoredState('reader_paraSpacing',settingsCache.paraSpacing,v=>typeof v==='number'&&Number.isFinite(v)&&v>0&&v<3000); 
  const [pageWidth, setPageWidth] = useStoredState('reader_pageWidth',settingsCache.pageWidth,v=>typeof v==='number'&&Number.isFinite(v)&&v>0&&v<3000);
  const [turnMode,setTurnMode]=useStoredState<ReaderTurnMode>('reader_turnMode',settingsCache.turnMode,value=>turnModes.some(mode=>mode.value===value));
  const hideTools=useCallback(()=>setShowNav(false),[]);

  // 🔥 新增：当这些设置改变时，自动同步回全局缓存
  // 这样下一章加载时，就能记住你刚才的设置了
  useEffect(() => { settingsCache.themeColor = themeColor; }, [themeColor]);
  useEffect(() => { settingsCache.fontFamily = fontFamily; }, [fontFamily]);
  useEffect(() => { settingsCache.fontSizeNum = fontSizeNum; }, [fontSizeNum]);
  useEffect(() => { settingsCache.paraSpacing = paraSpacing; }, [paraSpacing]);
  useEffect(() => { settingsCache.pageWidth = pageWidth; }, [pageWidth]);
  useEffect(() => { settingsCache.turnMode = turnMode; }, [turnMode]);

  const [hintSeen,setHintSeen]=useStoredState('has-seen-reading-hint',false);
  const showHint=!isDesktop&&!hintSeen;
  const setShowHint=(visible:boolean)=>setHintSeen(!visible); // 新手引导提示

  // 主题映射
  const themeMap = {
    cream:  { name: '羊皮纸', bg: '#e7d2ae', text: '#352a18', ...(!isDesktop ? mobileReaderCream : {}), line: '#c7b18d', panel: '#faf3e5', desk: '#d9c6a6' },
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

  const paraSpacingMap: Record<number, string> = isDesktop ? {
    2: '0.5rem', 4: '1rem', 6: '1.5rem', 8: '2rem',
  } : {
    2: '0.36em', 4: '0.72em', 6: '1.08em', 8: '1.44em',
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
    let active=true;
    const sequence=++navigationSequence.current;
    const serverChapter=initialChapter?.id===chapterIdParam?initialChapter:null;
    if(serverChapter)chapterCache.set(serverChapter.id,serverChapter);
    if(initialBook?.id===bookId)bookCache.set(bookId,initialBook);
    void Promise.all([loadReaderChapter(bookId,chapterIdParam),bookCache.get(bookId) || booksApi.getById(bookId)]).then(([next,book])=>{
      if(!active || sequence!==navigationSequence.current)return;
      setChapter(next);setBook(book);if(book)bookCache.set(bookId,book);setLoading(false);setNavigating(false);setNavigationError('');
    }).catch(error=>{if(active && sequence===navigationSequence.current){failedChapter.current=chapterIdParam;setNavigationError(error instanceof Error?error.message:'章节加载失败');setLoading(false);setNavigating(false);}});
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
    window.addEventListener('book-navigation-leave',invalidate);
    window.addEventListener('chapter-entry-start',invalidate);
    return()=>{invalidate();window.removeEventListener('popstate',restore);window.removeEventListener('book-navigation-leave',invalidate);window.removeEventListener('chapter-entry-start',invalidate);};
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
  const goToChapter=useCallback((targetChapterId:string,fromCatalog=false)=>{
    const selected=currentChapterEntry();
    if (!fromCatalog && selected) return;
    if(targetChapterId===chapter?.id && !fromCatalog)return;
    const sequence=++navigationSequence.current;
    const enter=(next:Chapter)=>{
      if(sequence!==navigationSequence.current)return;
      if(fromCatalog && selected) setEntryKey(selected.token);
      chapterCache.set(next.id,next);
      rememberChapter(bookId,next.id);
      setChapter(next);setNavigating(false);setNavigationError('');setShowNav(false);
      // Chapter turns share one history entry. Native history integration keeps
      // the URL in sync without refetching the route; Back exits to book details.
      const href=`/book/${bookId}/${next.id}`;
      replaceReaderChapter(href);
    };
    const cached=chapterCache.get(targetChapterId) || (adjacent.previous?.id===targetChapterId?adjacent.previous:adjacent.next?.id===targetChapterId?adjacent.next:undefined);
    if(cached?.bookId===bookId){enter(cached);return;}
    setNavigating(true);setNavigationError('');
    void loadReaderChapter(bookId,targetChapterId).then(enter).catch(error=>{
      if(sequence===navigationSequence.current){failedChapter.current=targetChapterId;setNavigating(false);setNavigationError(error instanceof Error?error.message:'章节加载失败，请重试');if(fromCatalog)failChapterEntry(`/book/${bookId}/${targetChapterId}`,error instanceof Error?error.message:'章节加载失败，请重试');}
    });
  },[bookId,chapter?.id,adjacent]);
  const prefetchChapter=useCallback((id:string|null)=>{
    if(id && id!==chapter?.id && currentPrefetchPolicy()!=='paused')void loadReaderChapter(bookId,id).catch(()=>{});
  },[bookId,chapter?.id]);
  const currentChapterIndex = catalog.snapshot.indices.get(chapter?.id ?? '') ?? -1;
  const prevChapterId = chapter?.previousId ?? null;
  const nextChapterId = chapter?.nextId ?? null;

  useEffect(() => {
    if (chapter?.id === chapterIdParam && chapter.bookId === bookId && pathname === `/book/${bookId}/${chapter.id}`) rememberChapter(bookId, chapter.id);
  }, [chapter, bookId, chapterIdParam, pathname]);

  // Preload parsed text and paragraph counts in both directions. No hidden
  // reader is mounted, so speculative reads never record views or bookmarks.
  useEffect(()=>{
    if(!chapter?.id || prefetchPolicy==='paused' || (prefetchPolicy==='intent' && !nextButtonVisible))return;
    let active=true;
    const timer=window.setTimeout(()=>{
      for(const [side,id] of [['previous',prevChapterId],['next',nextChapterId]] as const){
        if(!id)continue;
        void loadReaderChapter(bookId,id).then(value=>{
          if(active)setAdjacent(previous=>({...previous,[side]:value}));
        }).catch(()=>{});
        void loadReaderCounts(id).catch(()=>{});
      }
    },nextButtonVisible?0:150);
    return()=>{active=false;window.clearTimeout(timer);};
  },[prefetchPolicy,bookId,chapter?.id,prevChapterId,nextChapterId,nextButtonVisible]);

  const fontFamilyValue = {
    sans: '"PingFang SC", "Noto Sans CJK SC", "Noto Sans SC", "Microsoft YaHei", sans-serif',
    serif: '"Songti SC", "SimSun", serif',
    kai: '"Kaiti SC", "KaiTi", serif',
  }[fontFamily];
  const ReadingSurface=turnMode==='scroll'?ReaderScroll:ReaderPages;

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
      className="reader-entry-content min-h-screen w-full flex flex-col items-center"
      data-reader-entry-key={entryKey} data-entry-pending={entryLocked} data-entry-revealing={Boolean(chapterEntry?.revealing)} inert={Boolean(chapterEntry && !chapterEntry.revealing)}
      data-reader-cache-chapters={chapterCache.size}
      data-reader-cache-books={bookCache.size}
      style={{ 
        backgroundColor: isDesktop ? activeTheme.desk : activeTheme.bg 
      }}
    >
      {themeColor === 'cream' && !isActuallyDark && <link rel="preload" as="image" href={readerPaperImage} media="(max-width:1023px)" />}
      <RecordBookVisit bookId={bookId} chapterId={chapter.id}/>
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
          {/* 设置 */}
          <button 
            onClick={() => setShowSettings(!showSettings)} 
            className={`flex flex-col items-center gap-1 opacity-80 active:opacity-100 ${showSettings ? 'text-blue-500' : ''}`}
          >
             <Settings className="w-5 h-5"/>
             <span className="text-[10px]">设置</span>
          </button>

          {/* 目录 */}
          <button 
            onClick={() => setShowCatalog(true)} 
            className="flex flex-col items-center gap-1 opacity-90 active:opacity-100"
          >
             <List className="w-5 h-5"/>
             <span className="text-[10px]">目录</span>
          </button>

          {/* 夜间模式 */}
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
        <ReadingSurface
          key={`${turnMode==='scroll'?bookId:chapter.id}:${entryKey}`} book={book} chapter={chapter} chapterIndex={currentChapterIndex} chapterTotal={catalogTotal}
          previousChapter={adjacent.previous?.id===prevChapterId?adjacent.previous:chapterCache.get(prevChapterId || '')}
          nextChapter={adjacent.next?.id===nextChapterId?adjacent.next:chapterCache.get(nextChapterId || '')}
          fontFamily={fontFamilyValue} fontSize={fontSizeNum} lineHeight={lineHeight}
          paragraphGap={paraSpacingMap[paraSpacing] || '1rem'} theme={activeTheme}
          paper={themeColor === 'cream'} dark={isActuallyDark} pageWidth={pageWidth}
          previousId={prevChapterId} nextId={nextChapterId} navigating={isNavigating}
          blocked={showCatalog || showSettings || Boolean(chapterEntry)}
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

      <BookCatalogSheet open={showCatalog} onClose={closeBookCatalog} bookId={bookId} bookTitle={book.title}
        catalog={catalog.snapshot} onRange={catalog.ensureRange}
        activeChapterId={chapter.id} onPrefetch={prefetchChapter}
        onSelect={id => selectReaderCatalogChapter(() => goToChapter(id,true))}
        onRetry={catalog.retry}/>

      {navigationError && <div role="alert" className="reader-navigation-error">{navigationError}<button onClick={()=>goToChapter(failedChapter.current || chapterIdParam)}>重试</button><button onClick={()=>setNavigationError('')}>关闭</button></div>}
      {/* 6. 设置弹窗 */}
      {showSettings && (
        <>
          <div data-reader-settings-backdrop className="fixed inset-0 z-40" onClick={() => { setShowSettings(false); setShowNav(false); }} />
          
          {isDesktop ? (
            // ============ 桌面端大设置面板 (保留不变) ============
            <div 
                role="dialog" aria-modal="true" aria-label="阅读设置" data-reader-settings
                className="fixed top-20 z-50 w-[500px] max-h-[calc(100dvh-160px)] overflow-y-auto rounded-xl shadow-2xl border p-6 animate-in fade-in zoom-in-95"
                style={{ 
                right: `calc(50% - ${pageWidth / 2 + 15}px)`,
                backgroundColor: isActuallyDark ? '#2a2a2a' : activeTheme.panel,
                color: activeTheme.text,
                borderColor: activeTheme.line 
                }}
            >
                <div className="flex justify-end mb-2">
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
            role="dialog" aria-modal="true" aria-label="阅读设置" data-reader-settings
            className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 w-[92%] max-w-[360px] max-h-[calc(100dvh-120px)] overflow-y-auto rounded-xl shadow-2xl border p-4 animate-in slide-in-from-bottom-5 fade-in duration-200"
            style={{ 
              backgroundColor: isActuallyDark ? 'rgba(40,40,40,0.95)' : 'rgba(255,255,255,0.95)',
              backdropFilter: 'blur(10px)',
              color: activeTheme.text,
              borderColor: activeTheme.line 
            }}
          >
            <div className="flex justify-end mb-3"><button aria-label="关闭阅读设置" onClick={()=>setShowSettings(false)} className="p-1"><X size={18}/></button></div>
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
                      {[1.5, 1.6, 1.8, 2.0, 2.4].map((lh) => (
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
