'use client'; 

import { useEffect, useState, Suspense } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { API_BASE_URL } from '@/lib/api';
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

import AdBanner from '@/components/AdBanner';

// 🔥 [新增 1] 全局章节缓存池
const chapterCache = new Map<string, any>();
// 🔥 [新增] 全局书籍缓存池 (防止切换章节时书名/封面闪烁)
const bookCache = new Map<string, any>();


  // 🔥 [新增] 广告配置 
  const topAdConfig = {
    key: '548bdf520cc853ae859d72284e7eaa96', 
    format: 'iframe',
    height: 90,
    width: 728,
    params: {}
  };

  const mobileTopAdConfig = {
  key: 'b1d0573321880440cdb2f56b7fa2db9a', // <--- 填入新申请的 Key
  format: 'iframe',
  height: 50,         // 高度改成 50
  width: 320,         // 宽度改成 320
  params: {}
};

  const bottomAdConfig = {
    key:  'c499a0debce3cc11988efbef57ec87d0',
    format: 'iframe',
    height: 250,
    width: 300,
    params: {}
  };


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
  //const searchParams = useSearchParams();
  const router = useRouter();
  const isDesktop = useIsDesktop(); 
  
  const bookId = params.id as string;
  const chapterIdParam = params.chapterId as string;
  const { user } = useAuth();
  const [allChapters, setAllChapters] = useState<Chapter[]>([]);
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [book, setBook] = useState<Book | null>(() => bookCache.get(bookId) || null);
  const [chapter, setChapter] = useState<Chapter | null>(() => chapterCache.get(chapterIdParam) || null);
  
  // 只有当缓存里【既没有书也没有章节】时，才显示 loading
  // 如果有缓存，loading 初始值就是 false，直接渲染正文
  const [loading, setLoading] = useState(() => {
     return !bookCache.has(bookId) || !chapterCache.has(chapterIdParam);
  });
  
  const [showCatalog, setShowCatalog] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [catalogReversed, setCatalogReversed] = useState(false);

  // 导航栏显示状态 (移动端专用)
  const [showNav, setShowNav] = useState(false);
  const [lastScrollY, setLastScrollY] = useState(0);
  const { theme, setTheme } = useReadingSettings();

  // --- 修复：桌面端逻辑 (进场/切章节时自动显示导航栏) ---
  useEffect(() => {
    if (isDesktop) {
      // 电脑端：只要是进页面或切章节，强制显示导航栏
      setShowNav(true);
    } else {
      // 移动端：切章节时确保菜单收起 (保持沉浸体验)
      setShowNav(false);
    }
  }, [isDesktop, chapterIdParam]); // 依赖项：设备变了 或 章节变了 都触发

  const [themeColor, setThemeColor] = useState<'gray' | 'cream' | 'green' | 'blue'>('cream');
  const [fontFamily, setFontFamily] = useState<'sans' | 'serif' | 'kai'>('sans');
  const [fontSizeNum, setFontSizeNum] = useState(20);
  const [lineHeight, setLineHeight] = useState(1.6);
  const [paraSpacing, setParaSpacing] = useState(4); 
  const [pageWidth, setPageWidth] = useState(1000);

  const [showHint, setShowHint] = useState(false); // 新手引导提示

  // 网页端默认参数调整：加载时如果是大屏，调整默认字号 (改小了) 和行距
  useEffect(() => {
    if (window.innerWidth >= 1024) {
      setFontSizeNum(22); 
      setLineHeight(1.8); 
      setPageWidth(1000);
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

// --- 极速加载逻辑 (优化版：带缓存 + 预加载支持) ---
  useEffect(() => {
    let isActive = true;

    const loadData = async () => {

      const token = localStorage.getItem('token');
      const authHeaders = {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      };
      let targetId = chapterIdParam;

if (targetId) {
        // 1. 优先检查缓存
        if (chapterCache.has(targetId) && bookCache.has(bookId)) {
           // ⚡️ 如果书和章节都有缓存，什么都不用做！
           // 因为我们在 useState 初始化时已经拿到了
           setLoading(false);
           // 但为了保险（防止初始化后数据变了），还是默默更新一下 state
           setChapter(chapterCache.get(targetId));
           setBook(bookCache.get(bookId));
           window.scrollTo(0, 0);
        } 
        else {
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

        // [第二步] 后台默默加载目录 (保持不变)
        if (allChapters.length === 0) {
          try {
            const chaptersRes = await chaptersApi.getByBookId(bookId);
            if (isActive && chaptersRes) setAllChapters(chaptersRes);
          } catch(e) {}
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
                    setChapter(chapterCache.get(firstId));
                 } else {
                    const chRes = await fetch(`https://jiutianxiaoshuo.com/api/chapters/${firstId}`, { headers: authHeaders });
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
  }, [bookId, chapterIdParam]); // 依赖项不变 

  // ============================================================
  // ▼▼▼ 🔥 [新增 2] 静默预加载下一章 (Prefetching) ▼▼▼
  // ============================================================
  useEffect(() => {
    // 只有当：1.当前章节已加载 2.目录已加载 时，才执行预加载
    if (chapter && allChapters.length > 0) {
      const currentIndex = allChapters.findIndex((ch) => ch.id === chapter.id);
      
      // 找到下一章
      if (currentIndex !== -1 && currentIndex < allChapters.length - 1) {
        const nextChapter = allChapters[currentIndex + 1];
        
        // 检查：如果缓存里【没有】下一章，才去下载
        if (!chapterCache.has(nextChapter.id)) {
          console.log(`[预加载] 开始静默下载: 第${nextChapter.chapter_number}章...`);

          const token = localStorage.getItem('token');
          
          fetch(`https://jiutianxiaoshuo.com/api/chapters/${nextChapter.id}`, {
              headers: {
                  'Content-Type': 'application/json',
                  ...(token ? { 'Authorization': `Bearer ${token}` } : {})
              }
          })
            .then(res => res.json())
            .then(data => {
              // 下载成功，存入缓存 (注意：不要 setChapter，只存不显)
              chapterCache.set(nextChapter.id, data);
              console.log(`[预加载] 完成！下一章已就绪。`);
              
              // (可选) 简单的内存清理：如果缓存超过 20 章，删掉最早的一个，防止内存溢出
              // ... 前面的代码
              if (chapterCache.size > 20) {
                  const firstKey = chapterCache.keys().next().value;
                  // 只有当 firstKey 真的存在时才执行删除
                  if (firstKey) {
                      chapterCache.delete(firstKey);
                  }
              }
            })
            .catch(err => console.error("[预加载] 失败 (不影响当前阅读)", err));
        }
      }
    }
  }, [chapter, allChapters]); // 当当前章节变化时，触发下一次预加载

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
   // 改成路径式跳转 /book/书ID/章节ID
    router.push(`/book/${bookId}/${targetChapterId}`, { scroll: false });};
  const currentChapterIndex = allChapters.findIndex((ch) => ch.id === chapter?.id);
  const prevChapter = currentChapterIndex > 0 ? allChapters[currentChapterIndex - 1] : null;
  const nextChapter = currentChapterIndex < allChapters.length - 1 ? allChapters[currentChapterIndex + 1] : null;

  // ============================================================
  // ▼▼▼ 新增：键盘左右键翻页 (← 上一章 / → 下一章) ▼▼▼
  // ============================================================
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 1. 如果用户正在输入框(评论)里打字，按方向键是为了移动光标，不要翻页
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        return;
      }

      // 2. 左键 -> 上一章
      if (e.key === 'ArrowLeft' && prevChapter) {
        goToChapter(prevChapter.id);
      }
      // 3. 右键 -> 下一章
      else if (e.key === 'ArrowRight' && nextChapter) {
        goToChapter(nextChapter.id);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [prevChapter, nextChapter]); // 依赖项：当上一章/下一章变化时，重新绑定
  
  // ... 下面是 const fontFamilyValue = ...

  const fontFamilyValue = {
    sans: '"PingFang SC", "Microsoft YaHei", sans-serif',
    serif: '"Songti SC", "SimSun", serif',
    kai: '"Kaiti SC", "KaiTi", serif',
  }[fontFamily];
  const displayChapters = catalogReversed ? [...allChapters].reverse() : allChapters;

if (loading) return (
    <div 
      className="min-h-screen flex items-center justify-center transition-colors duration-300" 
      style={{ backgroundColor: activeTheme.bg }} // <--- 关键：Loading 背景色必须和阅读背景一致
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
          className="w-full flex items-center justify-between px-12 pointer-events-auto shadow-sm transition-colors duration-300"
          style={{
            maxWidth: isDesktop ? `${pageWidth}px` : '100%',
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

            <Link href={user ? '/profile' : '/login'} className="flex items-center gap-3 hover:bg-black/5 py-1 px-3 rounded-full transition-colors">
              <div className="text-right hidden xl:block">
                <div className="text-sm font-bold">{user ? (user.username || '书友') : '点击登录'}</div>
                {user && <div className="text-xs opacity-60">个人中心</div>}
              </div>
              <div className="w-10 h-10 rounded-full bg-gray-200 overflow-hidden border border-gray-300 flex items-center justify-center shrink-0">
                 {(user as any)?.avatar ? (
                    <img 
                      src={(user as any).avatar} 
                      alt="avatar" 
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        // 如果图片加载失败 (404)，自动把 src 变成一个透明图或默认图，防止报错很难看
                        e.currentTarget.src = 'https://ui-avatars.com/api/?name=User&background=random'; 
                        // 或者直接隐藏它：e.currentTarget.style.display = 'none';
                      }}
                    />
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
        {/* 左侧：Logo 和 名称 (点击回首页) */}
        <Link href="/" className="flex items-center gap-2 -ml-1 p-1 relative z-10 active:opacity-60">
           <BookOpen className="w-5 h-5 text-blue-600" />
           <span className="font-bold text-lg tracking-tight">九天</span>
        </Link>

        {/* 中间：章节标题 (绝对定位居中) */}
        <div className="absolute left-1/2 -translate-x-1/2 text-sm font-bold max-w-[50%] truncate opacity-90">
            {chapter.title}
        </div>

        {/* 右侧：用户头像 */}
        <Link href={user ? '/profile' : '/login'} className="rounded-full overflow-hidden border border-black/10 relative z-10">
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
        2.5 移动端 新·底部工具栏
        顺序：[设置] - [详情] - [目录] - [夜间]
        ===========================================
      */}
      <div
        className="lg:hidden fixed bottom-0 left-0 right-0 z-50 h-16 flex items-center justify-between px-6 border-t transition-all duration-300 pb-safe"
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
             lg:mx-auto lg:mt-16 lg:mb-10 lg:rounded-b-sm lg:rounded-t-none lg:pt-8 lg:px-12
            ${isDesktop ? 'shadow-[0_4px_20px_rgba(0,0,0,0.04)]' : ''} 
          `}
          style={{ 
            maxWidth: isDesktop ? `${pageWidth}px` : undefined,
            backgroundColor: activeTheme.bg, 
            color: activeTheme.text 
          }}
        >
          {/* 标题区 */}
          <div className="mb-5 px-2"> 
            <h1 className="text-3xl md:text-4xl font-bold tracking-wide leading-tight" style={{ color: activeTheme.text }}>
              {chapter.title.startsWith('第') ?
                chapter.title : `第${chapter.chapter_number}章 ${chapter.title}`}
            </h1>
          </div>

          {/* ========================================================= */}
          {/* 1. 💻 PC 端广告 (728x90) - 放在标题之下 */}
          {/* 关键修改：加上 hidden lg:flex，防止手机加载它 */}
          {/* ========================================================= */}
          <div className="hidden lg:flex my-6 justify-center">
              <div className="min-h-[90px] w-[728px] flex justify-center items-center bg-black/5 rounded-lg overflow-hidden">
                {/* 确保这里用的是 728 的 Key */}
                <AdBanner atOptions={topAdConfig} />
              </div>
          </div>

          {/* ========================================================= */}
          {/* 2. 📱 手机端广告 (320x50) - 放在标题之下 */}
          {/* 关键修改：保持 lg:hidden，防止电脑加载它 */}
          {/* ========================================================= */}
          <div className="lg:hidden mb-6 flex justify-center">
              <div className="min-h-[50px] w-[320px] flex justify-center items-center bg-black/5 rounded overflow-hidden">
                {/* 确保这里用的是 320 的 Key */}
                <AdBanner atOptions={mobileTopAdConfig} />
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
              
              // === 🧹 智能清洗逻辑 (新增) ===
              
              // 1. 空行直接跳过
              if (!text) return null;

              // 2. 过滤元数据 (日期、作者、来源网站广告)
              // 匹配: "2025-12-10" 或 "作者：" 或 "69书吧"
              if (/^\d{4}-\d{2}-\d{2}/.test(text) || text.includes('作者：') || text.includes('69书吧') || text.includes('www.')) {
                return null;
              }

              // 3. 过滤重复标题 (核心修改)
              // 将“当前行”和“章节标题”都去掉标点和空格，进行模糊比对
              const cleanLine = text.replace(/\s+|[()（）]/g, '');
              const cleanTitle = chapter.title.replace(/\s+|[()（）]/g, '');

              // 如果这行字包含了标题，或者标题包含了这行字（且这行字长度大于3），视为重复标题
              // 比如：Line="第500章 繁育税..." Title="第500章 繁育税" -> 匹配，隐藏
              if ((cleanLine.includes(cleanTitle) || cleanTitle.includes(cleanLine)) && cleanLine.length > 3) {
                 // 这里加一个保险：如果这行字特别长（比如超过50字），那可能是正文正好提到了标题，就不删
                 if (text.length < 50) return null;
              }

              // 4. 过滤单纯的 "第xxx章" 这种只有两三个字的行 (通常是爬虫残留)
              if (/^第\d+章$/.test(text)) {
                 return null;
              }

              // === 清洗结束，渲染正文 ===
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

{/* 🔥 底部双广告位布局 */}
          <div className="mt-12 mb-8 px-4">
             <div className="flex flex-col md:flex-row justify-center items-center gap-6">
                
                {/* 左边的广告 */}
                <div className="min-h-[250px] min-w-[300px] flex justify-center items-center bg-black/5 rounded-lg overflow-hidden">
                   {/* 使用同一个配置 */}
                   <AdBanner atOptions={bottomAdConfig} />
                </div>

                {/* 右边的广告 (仅电脑显示) */}
                <div className="hidden md:flex min-h-[250px] min-w-[300px] justify-center items-center bg-black/5 rounded-lg overflow-hidden">
                   {/* 🔥 直接复用同一个配置！效果完全一样 */}
                   <AdBanner atOptions={bottomAdConfig} /> 
                </div>

             </div>
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
                    {[1.4, 1.6, 1.8, 2.0].map((lh) => (
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