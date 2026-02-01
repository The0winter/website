'use client'; // 👈 必须放在第一行

import { useEffect, useState, Suspense } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { 
  ChevronLeft, ChevronRight, Settings, BookOpen, List, 
  Book as BookIcon, Bookmark, BookmarkCheck, Moon, X, 
  ArrowUpDown, Check, Sun 
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
  
  // ⚙️ 全局设置 (Context)
  // theme 这里只负责 'light' 或 'dark' (夜间模式开关)
  const { theme, setTheme } = useReadingSettings();

  // 📖 本地阅读偏好 (Local State)
  // themeColor 负责白天的皮肤 (羊皮纸、绿、蓝等)
  const [themeColor, setThemeColor] = useState<'gray' | 'cream' | 'green' | 'blue'>('cream');
  const [fontFamily, setFontFamily] = useState<'sans' | 'serif' | 'kai'>('sans');
  const [fontSizeNum, setFontSizeNum] = useState(20);
  const [lineHeight, setLineHeight] = useState(1.8);      // 新增：行间距
  const [paraSpacing, setParaSpacing] = useState(4);      // 新增：段间距
  const [pageWidth, setPageWidth] = useState<'auto' | '640' | '800' | '900' | '1000' | '1280'>('900');
  const [autoSubscribe, setAutoSubscribe] = useState(false);
  const [chapterSay, setChapterSay] = useState(true);

  // 🎨 配色方案配置表
  const themeMap = {
    cream:  { name: '羊皮纸', bg: '#f6f1e7', text: '#333333', line: '#d4cbb3' },
    gray:   { name: '雅致灰', bg: '#f0f0f0', text: '#222222', line: '#dcdcdc' },
    green:  { name: '护眼绿', bg: '#dcedc8', text: '#222222', line: '#c5e1a5' },
    blue:   { name: '极光蓝', bg: '#e3edfc', text: '#222222', line: '#d0e0f8' },
    // 夜间模式的参数独立定义
    dark:   { name: '夜间',   bg: '#1a1a1a', text: '#d0d0d0', line: '#333333' },
  };

  // 🛠️ 核心逻辑：计算当前"真实"生效的颜色
  // 如果全局开了夜间模式 (dark)，就强制用 dark 配色
  // 否则，使用用户选中的 themeColor 配色
  const isActuallyDark = theme === 'dark';
  const activeTheme = isActuallyDark ? themeMap.dark : themeMap[themeColor];

  // 段间距映射表（数值 -> 像素）
  const paraSpacingMap: Record<number, string> = {
    2: '0.5rem',
    4: '1rem',
    6: '1.5rem',
    8: '2rem',
  };

  // 初始化数据
// 1. 核心数据加载 (只依赖 bookId，不受用户登录状态影响，保证只跑一次)
  useEffect(() => {
    if (bookId) {
      initData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]); 

  // 2. 用户状态检查 (依赖 user，用户登录后再查书签)
  useEffect(() => {
    if (bookId && user) {
      checkBookmark();
    }
  }, [bookId, user]);

  // 🔥 新增：监听目录打开，自动滚动到当前章节
  useEffect(() => {
    if (showCatalog) {
      // 稍微延迟一点点，确保 DOM 已经渲染出来
      const timer = setTimeout(() => {
        const activeElement = document.getElementById('active-chapter-anchor');
        if (activeElement) {
          activeElement.scrollIntoView({ block: 'center', behavior: 'auto' });
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [showCatalog]);

  // ...

// 🔥 核心修复：监听 URL 变化，每次切换章节都去服务器单独“取字”
  useEffect(() => {
    const fetchChapterContent = async () => {
      // 1. 如果目录还没加载完，先不动作
      if (allChapters.length === 0) return;

      const targetId = chapterIdParam || allChapters[0].id;
      
      // 2. 开启加载状态（用户会看到转圈，而不是空白或上一章的残影）
      setLoading(true);

      try {
        // 3. 调用后端“单章详情接口”（这个接口我们专门保留了 content，是有字的！）
        // 请确保你的后端 server/index.js 里有 app.get('/api/chapters/:id') 这个接口
        const res = await fetch(`https://website-production-6edf.up.railway.app/api/chapters/${targetId}`);
        
        if (res.ok) {
          const fullChapter = await res.json();
          setChapter(fullChapter); // ✅ 把带字的完整章节放进去
        } else {
          console.error('章节内容获取失败');
        }
      } catch (error) {
        console.error('网络请求出错:', error);
      } finally {
        // 4. 关掉加载动画，显示正文
        setLoading(false);
      }
    };

    fetchChapterContent();
  }, [chapterIdParam, allChapters]);

const initData = async () => {
    // setLoading(true); // 默认已经是 true 了
    try {
      const [bookData, chaptersData] = await Promise.all([
        booksApi.getById(bookId),
        chaptersApi.getByBookId(bookId),
      ]);
      if (bookData) setBook(bookData);
      if (chaptersData) setAllChapters(chaptersData);
      
      // 🔥 核心修复：接力棒逻辑
      // 如果书里有章节，就不要在这里结束 Loading！
      // 让下面的 useEffect (fetchChapterContent) 去负责结束 Loading
      if (!chaptersData || chaptersData.length === 0) {
          setLoading(false); // 只有真的是空书，才在这里结束
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      setLoading(false); // 出错了，必须结束 Loading 以显示错误页
    }
    // ❌ 删掉之前的 finally { setLoading(false) }，绝对不能在这里无条件取消 loading！
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

  // 切换夜间模式
  const toggleNightMode = () => {
    setTheme(isActuallyDark ? 'light' : 'dark');
  };

  // 跳转章节
  const goToChapter = (targetChapterId: string) => {
    router.push(`/read/${bookId}?chapterId=${targetChapterId}`);
    window.scrollTo(0, 0);
  };

  // 上一章/下一章计算
  const currentChapterIndex = allChapters.findIndex((ch) => ch.id === chapter?.id);
  const prevChapter = currentChapterIndex > 0 ? allChapters[currentChapterIndex - 1] : null;
  const nextChapter = currentChapterIndex < allChapters.length - 1 ? allChapters[currentChapterIndex + 1] : null;

  // 字体映射
  const fontFamilyValue = {
    sans: '"PingFang SC", "Microsoft YaHei", sans-serif',
    serif: '"Songti SC", "SimSun", serif',
    kai: '"Kaiti SC", "KaiTi", serif',
  }[fontFamily];

  const displayChapters = catalogReversed ? [...allChapters].reverse() : allChapters;

  // --- 渲染部分 ---

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-[#f6f1e7]">
      <BookOpen className="h-12 w-12 text-gray-700 animate-pulse" />
    </div>
  );

  if (!book || !chapter) return (
    <div className="min-h-screen flex items-center justify-center bg-[#f6f1e7]">
      <div className="text-center">
        <h2 className="text-2xl font-bold mb-4">加载失败或书籍无内容</h2>
        <Link href={`/book/${bookId}`} className="text-blue-600 underline">返回详情页</Link>
      </div>
    </div>
  );

  return (
    <div 
      className="min-h-screen w-full transition-colors duration-300"
      style={{ backgroundColor: activeTheme.bg }}
    >
      <div 
        className="mx-auto relative transition-all duration-300"
        style={{ maxWidth: pageWidth === 'auto' ? '800px' : `${pageWidth}px` }} 
      >
        <article 
          className="w-full min-h-screen px-10 py-20 shadow-xl transition-colors duration-300"
          style={{ backgroundColor: activeTheme.bg, color: activeTheme.text }}
        >
          {/* 标题区 */}
          <div className="mb-10 border-b pb-6" style={{ borderColor: activeTheme.line }}>
            <h1 className="text-4xl font-bold mb-4">
              {chapter.title.startsWith('第') ? chapter.title : `第${chapter.chapter_number}章 ${chapter.title}`}
            </h1>
            <div className="text-sm opacity-60 flex gap-4">
              <span>{book.title}</span>
              <span>|</span>
              <span>{book.author || '未知'}</span>
              <span>|</span>
              <span>字数：{chapter.content?.length || 0}</span>
            </div>
          </div>

          {/* 正文内容 */}
          <div 
            className="text-justify"
            style={{ 
              fontFamily: fontFamilyValue, 
              fontSize: `${fontSizeNum}px`,
              lineHeight: lineHeight  // 应用行间距
            }}
          >
            {(chapter.content || '').split('\n').map((para, i) => {
              const text = para.trim();
              // 脏数据过滤
              if (!text || text.includes('作者：') || /^\d{4}-\d{2}-\d{2}/.test(text)) return null;
              if (text === chapter.title.trim()) return null;
              
              return (
                <p 
                  key={i} 
                  style={{ 
                    textIndent: '2em',
                    marginBottom: paraSpacingMap[paraSpacing] || '1rem'  // 应用段间距
                  }}
                >
                  {text}
                </p>
              );
            })}
          </div>

          {/* 底部导航 */}
          <div className="mt-20 flex justify-between border-t pt-10" style={{ borderColor: activeTheme.line }}>
            <button 
              disabled={!prevChapter}
              onClick={() => prevChapter && goToChapter(prevChapter.id)}
              className="px-6 py-2 border rounded hover:opacity-70 disabled:opacity-30 transition-all"
              style={{ borderColor: activeTheme.line }}
            >上一章</button>
            
            <Link 
              href={`/book/${bookId}`} 
              className="px-6 py-2 border rounded hover:opacity-70 transition-all" 
              style={{ borderColor: activeTheme.line }}
            >
              返回详情
            </Link>
            
            <button 
              disabled={!nextChapter}
              onClick={() => nextChapter && goToChapter(nextChapter.id)}
              className="px-6 py-2 border rounded hover:opacity-70 disabled:opacity-30 transition-all"
              style={{ borderColor: activeTheme.line }}
            >下一章</button>
          </div>
        </article>

        {/* 侧边工具栏 (大屏显示) */}
        <aside 
          className="fixed right-10 top-1/3 hidden xl:flex flex-col gap-4 p-3 rounded-xl shadow-lg border transition-all duration-300" 
          style={{ backgroundColor: activeTheme.bg, borderColor: activeTheme.line }}
        >
          <button onClick={() => setShowCatalog(true)} className="p-3 hover:bg-black/5 rounded-lg" title="目录">
            <List style={{ color: activeTheme.text }} />
          </button>
          
          <button onClick={toggleBookmark} className="p-3 hover:bg-black/5 rounded-lg" title="书签">
            {isBookmarked ? <BookmarkCheck className="text-red-500" /> : <Bookmark style={{ color: activeTheme.text }} />}
          </button>
          
          <button onClick={toggleNightMode} className="p-3 hover:bg-black/5 rounded-lg" title="夜间模式">
            {isActuallyDark ? <Sun className="text-yellow-500" /> : <Moon style={{ color: activeTheme.text }} />}
          </button>
          
          <button onClick={() => setShowSettings(true)} className="p-3 hover:bg-black/5 rounded-lg" title="设置">
            <Settings style={{ color: activeTheme.text }} />
          </button>
        </aside>
      </div>

      {/* 目录弹窗 */}
      {showCatalog && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-6" onClick={() => setShowCatalog(false)}>
          <div 
            className="w-full max-w-4xl h-[80vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden transition-colors" 
            style={{ backgroundColor: activeTheme.bg, color: activeTheme.text }} 
            onClick={e => e.stopPropagation()}
          >
            <div className="p-6 border-b flex justify-between items-center shrink-0" style={{ borderColor: activeTheme.line }}>
              <h2 className="text-2xl font-bold">目录 ({allChapters.length}章)</h2>
              <div className="flex gap-4">
                <button onClick={() => setCatalogReversed(!catalogReversed)} className="flex items-center gap-1 text-sm border px-3 py-1 rounded hover:bg-black/5" style={{ borderColor: activeTheme.line }}>
                  <ArrowUpDown className="w-4 h-4"/> {catalogReversed ? '正序' : '倒序'}
                </button>
                <button onClick={() => setShowCatalog(false)}><X className="w-6 h-6 opacity-60 hover:opacity-100"/></button>
              </div>
            </div>
            
            {/* 👇 增加了 gap-y-6 让两列之间上下拉开距离 */}
            <div className="flex-1 overflow-y-auto p-8 grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-6 content-start custom-scrollbar">
              {displayChapters.map(ch => {
                const isActive = ch.id === chapter.id;
                return (
                  <button 
                    key={ch.id} 
                    // 🔥 新增这一行：如果是当前章节，就给它打个标记
                    id={isActive ? 'active-chapter-anchor' : undefined}
                    onClick={() => { goToChapter(ch.id); setShowCatalog(false); }}
                    className={`text-left py-4 border-b border-dashed text-lg truncate flex justify-between items-center group transition-all
                      ${isActive ? 'font-bold' : 'hover:pl-2'}`}
                    style={{ 
                      borderColor: activeTheme.line,
                      color: isActive ? '#ed424b' : activeTheme.text 
                    }}
                  >
                    <span>{ch.title.startsWith('第') ? ch.title : `第${ch.chapter_number}章 ${ch.title}`}</span>
                    {isActive && <span className="text-xs bg-[#ed424b] text-white px-2 py-0.5 rounded">当前</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 设置弹窗 */}
      {showSettings && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center" onClick={() => setShowSettings(false)}>
          <div 
            className="w-[500px] max-h-[85vh] overflow-y-auto p-8 rounded-2xl shadow-2xl space-y-8 transition-colors" 
            style={{ 
              backgroundColor: isActuallyDark ? '#222' : '#fff', 
              color: isActuallyDark ? '#eee' : '#333' 
            }} 
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between border-b pb-4" style={{ borderColor: isActuallyDark ? '#444' : '#eee' }}>
              <h2 className="text-xl font-bold">阅读设置</h2>
              <button onClick={() => setShowSettings(false)}><X /></button>
            </div>
            
            {/* 1. 主题选择 (夜间模式下禁用并置灰) */}
            <div className="flex items-center gap-6">
              <span className="w-20 font-medium opacity-60">阅读主题</span>
              <div className="flex gap-4">
                {Object.entries(themeMap).filter(([k]) => k !== 'dark').map(([key, val]) => (
                  <button 
                    key={key} 
                    disabled={isActuallyDark}
                    onClick={() => setThemeColor(key as any)}
                    className={`w-10 h-10 rounded-full border-2 flex items-center justify-center transition-all 
                      ${themeColor === key && !isActuallyDark ? 'ring-2 ring-blue-500 ring-offset-2' : ''}`}
                    style={{ 
                      backgroundColor: val.bg, 
                      borderColor: isActuallyDark ? '#444' : '#ddd',
                      opacity: isActuallyDark ? 0.3 : 1, // 夜间模式下变淡
                      cursor: isActuallyDark ? 'not-allowed' : 'pointer'
                    }}
                  >
                    {themeColor === key && !isActuallyDark && <Check className="w-5 h-5 text-red-500" />}
                  </button>
                ))}
              </div>
            </div>

            {/* 2. 字号调节 */}
            <div className="flex items-center gap-6">
              <span className="w-20 font-medium opacity-60">字号大小</span>
              <div 
                className="flex items-center gap-4 rounded-full px-4 py-2 flex-1 justify-between transition-colors"
                style={{ backgroundColor: isActuallyDark ? '#333' : '#f3f4f6' }}
              >
                <button onClick={() => setFontSizeNum(Math.max(12, fontSizeNum - 2))} className="hover:text-blue-500 font-bold px-2">A-</button>
                <span className="font-bold">{fontSizeNum}</span>
                <button onClick={() => setFontSizeNum(Math.min(48, fontSizeNum + 2))} className="hover:text-blue-500 font-bold px-2">A+</button>
              </div>
            </div>

            {/* 3. 字体选择 */}
            <div className="flex items-center gap-6">
              <span className="w-20 font-medium opacity-60">正文字体</span>
              <div 
                className="flex gap-2 p-1 rounded-lg w-full transition-colors"
                style={{ backgroundColor: isActuallyDark ? '#333' : '#f3f4f6' }}
              >
                {['sans', 'serif', 'kai'].map((f) => (
                  <button 
                    key={f} 
                    onClick={() => setFontFamily(f as any)}
                    className={`flex-1 py-1.5 rounded-md text-sm transition-all 
                      ${fontFamily === f ? 'shadow text-red-500 font-bold' : 'opacity-60 hover:opacity-100'}`}
                    style={{ 
                      backgroundColor: fontFamily === f ? (isActuallyDark ? '#555' : '#fff') : 'transparent' 
                    }}
                  >
                    {f === 'sans' ? '黑体' : f === 'serif' ? '宋体' : '楷体'}
                  </button>
                ))}
              </div>
            </div>
            
            {/* 4. 页面宽度 */}
            <div className="flex items-center gap-6">
              <span className="w-20 font-medium opacity-60">页面宽度</span>
              <div className="flex flex-wrap gap-2">
                 {['auto', '640', '800', '900', '1000', '1280'].map(w => (
                    <button
                      key={w}
                      onClick={() => setPageWidth(w as any)}
                      className={`px-3 py-1 text-sm border rounded-md transition-colors`}
                      style={{
                        borderColor: pageWidth === w ? '#ef4444' : (isActuallyDark ? '#555' : '#e5e7eb'),
                        color: pageWidth === w ? '#ef4444' : 'inherit',
                        backgroundColor: pageWidth === w ? (isActuallyDark ? 'transparent' : '#fef2f2') : 'transparent'
                      }}
                    >
                      {w === 'auto' ? '自动' : w}
                    </button>
                  ))}
              </div>
            </div>

            {/* 5. 行间距 */}
            <div className="flex items-center gap-6">
              <span className="w-20 font-medium opacity-60">行间距</span>
              <div 
                className="flex gap-2 p-1 rounded-lg w-full transition-colors"
                style={{ backgroundColor: isActuallyDark ? '#333' : '#f3f4f6' }}
              >
                {([
                  { label: '紧凑', value: 1.6 },
                  { label: '适中', value: 1.8 },
                  { label: '宽松', value: 2.0 },
                  { label: '超宽', value: 2.4 },
                ]).map((item) => (
                  <button 
                    key={item.value} 
                    onClick={() => setLineHeight(item.value)}
                    className={`flex-1 py-1.5 rounded-md text-sm transition-all 
                      ${lineHeight === item.value ? 'shadow text-red-500 font-bold' : 'opacity-60 hover:opacity-100'}`}
                    style={{ 
                      backgroundColor: lineHeight === item.value ? (isActuallyDark ? '#555' : '#fff') : 'transparent' 
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 6. 段间距 */}
            <div className="flex items-center gap-6">
              <span className="w-20 font-medium opacity-60">段间距</span>
              <div 
                className="flex gap-2 p-1 rounded-lg w-full transition-colors"
                style={{ backgroundColor: isActuallyDark ? '#333' : '#f3f4f6' }}
              >
                {([
                  { label: '紧密', value: 2 },
                  { label: '标准', value: 4 },
                  { label: '疏松', value: 6 },
                  { label: '超大', value: 8 },
                ]).map((item) => (
                  <button 
                    key={item.value} 
                    onClick={() => setParaSpacing(item.value)}
                    className={`flex-1 py-1.5 rounded-md text-sm transition-all 
                      ${paraSpacing === item.value ? 'shadow text-red-500 font-bold' : 'opacity-60 hover:opacity-100'}`}
                    style={{ 
                      backgroundColor: paraSpacing === item.value ? (isActuallyDark ? '#555' : '#fff') : 'transparent' 
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}

// 2. 导出组件 (包裹 Suspense)
export default function ReaderPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">正在进入阅读模式...</div>}>
      <ReaderContent />
    </Suspense>
  );
}