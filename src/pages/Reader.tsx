import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Settings, BookOpen, List, Book as BookIcon, Bookmark, BookmarkCheck, Moon, X, ArrowUpDown, Check } from 'lucide-react';
import { booksApi, chaptersApi, bookmarksApi, Book, Chapter } from '../lib/api';
import { useReadingSettings } from '../contexts/ReadingSettingsContext';
import { useAuth } from '../contexts/AuthContext';

export default function Reader() {
  const { bookId, chapterId } = useParams<{ bookId: string; chapterId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [book, setBook] = useState<Book | null>(null);
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [allChapters, setAllChapters] = useState<Chapter[]>([]);
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showCatalog, setShowCatalog] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [catalogReversed, setCatalogReversed] = useState(false);
  const { theme, setTheme } = useReadingSettings();

  // 设置弹窗本地状态（驱动 UI 选中效果）
  const [themeColor, setThemeColor] = useState<'gray' | 'cream' | 'yellow' | 'green' | 'blue' | 'dark'>('cream');
  const [fontFamily, setFontFamily] = useState<'sans' | 'serif' | 'kai'>('sans');
  const [fontSizeNum, setFontSizeNum] = useState(20);
  const [pageWidth, setPageWidth] = useState<'auto' | '640' | '800' | '900' | '1000' | '1280'>('900');
  const [turnPageMode, setTurnPageMode] = useState<'chapter' | 'scroll'>('chapter');
  const [autoSubscribe, setAutoSubscribe] = useState(false);
  const [chapterSay, setChapterSay] = useState(true);

  useEffect(() => {
    if (bookId && chapterId) {
      fetchChapterData();
      if (user && bookId) {
        checkBookmark();
      }
    }
  }, [bookId, chapterId, user]);

  useEffect(() => {
    if (showCatalog || showSettings) {
      // Calculate scrollbar width to prevent layout shift
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
      // Hide overflow but preserve scrollbar space
      document.body.style.overflow = 'hidden';
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    } else {
      document.body.style.overflow = '';
      document.body.style.paddingRight = '';
    }
    return () => {
      document.body.style.overflow = '';
      document.body.style.paddingRight = '';
    };
  }, [showCatalog, showSettings]);

  const fetchChapterData = async () => {
    try {
      const [bookData, chapterData, chaptersData] = await Promise.all([
        booksApi.getById(bookId!),
        chaptersApi.getById(chapterId!),
        chaptersApi.getByBookId(bookId!),
      ]);

      if (bookData) setBook(bookData);
      if (chapterData) setChapter(chapterData);
      if (chaptersData) setAllChapters(chaptersData);
    } catch (error) {
      console.error('Error fetching chapter data:', error);
    } finally {
      setLoading(false);
    }
  };

  const checkBookmark = async () => {
      try {
        // 尝试去后端检查是否收藏
        const bookmarked = await bookmarksApi.check(user!.id, bookId!);
        setIsBookmarked(bookmarked);
      } catch (error: any) {
        // ✅ 关键修复：如果是 404 错误，说明没找到收藏记录 -> 这不是 Bug，只是没收藏而已
        if (error.response && error.response.status === 404) {
          setIsBookmarked(false); // 没收藏，设置为 false，不报错
        } else {
          // 只有真的是其他错误（比如断网、500错误）才打印出来
          console.error('Error checking bookmark:', error);
        }
      }
    };

  const toggleBookmark = async () => {
    if (!user) {
      navigate('/login');
      return;
    }

    try {
      if (isBookmarked) {
        await bookmarksApi.delete(user.id, bookId!);
        setIsBookmarked(false);
      } else {
        await bookmarksApi.create(user.id, bookId!);
        setIsBookmarked(true);
      }
    } catch (error) {
      console.error('Error toggling bookmark:', error);
    }
  };

  const currentChapterIndex = allChapters.findIndex((ch) => ch.id === chapterId);
  const prevChapter = currentChapterIndex > 0 ? allChapters[currentChapterIndex - 1] : null;
  const nextChapter =
    currentChapterIndex < allChapters.length - 1 ? allChapters[currentChapterIndex + 1] : null;

  const goToChapter = (targetChapterId: string) => {
    navigate(`/read/${bookId}/${targetChapterId}`);
    window.scrollTo(0, 0);
  };

  const fontFamilyMap: Record<typeof fontFamily, string> = {
    sans: '"PingFang SC", "Microsoft YaHei", "Heiti SC", sans-serif',
    serif: '"Songti SC", "SimSun", "Georgia", serif',
    kai: '"Kaiti SC", "KaiTi", serif',
  };

  const toggleNightMode = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  // 计算章节字数
  const chapterWordCount = chapter?.content?.length || 0;
  const wordCountDisplay = chapterWordCount > 0 ? chapterWordCount.toLocaleString() : '0';

  // 格式化更新时间
  const formatUpdateTime = (dateString?: string) => {
    if (!dateString) return '未知';
    const date = new Date(dateString);
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#f6f1e7' }}>
        <BookOpen className="h-12 w-12 text-gray-700 animate-pulse" />
      </div>
    );
  }

  if (!book || !chapter) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#f6f1e7' }}>
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-800 mb-2">章节未找到</h2>
          <Link to="/" className="text-gray-600 hover:underline">
            返回首页
          </Link>
        </div>
      </div>
    );
  }

  // 根据主题获取背景色和文字颜色
  const getBackgroundColor = () => {
    if (theme === 'dark') {
      return '#2d2d2d'; // 深灰护眼背景
    }
    return '#f6f1e7'; // 羊皮纸色
  };


  const displayChapters = catalogReversed ? [...allChapters].reverse() : allChapters;

  const handleChapterClick = (ch: Chapter) => {
    goToChapter(ch.id);
    setShowCatalog(false);
  };

  return (
    <>
      {/* 两层背景：外层“桌面”+ 内层“纸张” */}
      <div
        className="min-h-screen w-full transition-colors duration-200"
        style={{ backgroundColor: theme === 'dark' ? '#1f1f1f' : '#f2eee2' }}
      >
        {/* 主容器 Wrapper：负责控制宽度和居中 */}
        <div 
          className="w-full mx-auto relative transition-all duration-300 ease-in-out"
          style={{ maxWidth: pageWidth === 'auto' ? '48rem' : `${pageWidth}px` }} // 正确：宽度限制加在最外层
        >
          {/* 正文区域（纸张）：填满父容器 */}
          <article
            className="w-full min-h-screen shadow-2xl rounded-sm px-8 py-16"
            style={{ backgroundColor: theme === 'dark' ? '#2b2b2b' : '#f6f1e7' }}
          >
            {/* 标题区 */}
            <div className="mb-8">
              <h1 className="text-3xl font-bold mb-4" style={{ color: theme === 'dark' ? '#e0e0e0' : '#333333' }}>
                第{chapter.chapter_number}章：{chapter.title}
              </h1>
              {/* 元数据行 */}
              <div className="text-sm space-x-3" style={{ color: theme === 'dark' ? 'rgba(224, 224, 224, 0.6)' : 'rgba(51, 51, 51, 0.7)' }}>
                <span>{book.title}</span>
                <span style={{ color: theme === 'dark' ? 'rgba(224, 224, 224, 0.3)' : 'rgba(51, 51, 51, 0.25)' }}>|</span>
                <span>{book.author || book.profiles?.username || '未知作者'}</span>
                <span style={{ color: theme === 'dark' ? 'rgba(224, 224, 224, 0.3)' : 'rgba(51, 51, 51, 0.25)' }}>|</span>
                <span>字数：{wordCountDisplay}</span>
                <span style={{ color: theme === 'dark' ? 'rgba(224, 224, 224, 0.3)' : 'rgba(51, 51, 51, 0.25)' }}>|</span>
                <span>更新：{formatUpdateTime(chapter.published_at)}</span>
              </div>
            </div>

            {/* 正文区 */}
            <div
              className="w-full leading-loose text-justify"
              style={{ fontFamily: fontFamilyMap[fontFamily], fontSize: fontSizeNum, lineHeight: '1.8', color: theme === 'dark' ? '#d0d0d0' : '#333333' }}
            >
              {chapter.content.split('\n').map((paragraph, index) => (
                paragraph.trim() && (
                  <p key={index} className="mb-4">
                    {paragraph}
                  </p>
                )
              ))}
            </div>

            {/* 底部导航 */}
            <div className="mt-16 pt-8" style={{ borderTop: `1px solid ${theme === 'dark' ? '#444444' : '#d4cbb3'}` }}>
              <div className="flex justify-center items-center gap-4">
                {prevChapter ? (
                  <button
                    onClick={() => goToChapter(prevChapter.id)}
                    className="flex items-center space-x-2 px-8 py-3 rounded-md font-medium transition-colors"
                    style={{
                      borderWidth: '2px',
                      borderColor: theme === 'dark' ? '#555555' : '#d4cbb3',
                      color: theme === 'dark' ? '#d0d0d0' : '#333333',
                      backgroundColor: 'transparent'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = theme === 'dark' ? '#3a3a3a' : '#f2eee2';
                      e.currentTarget.style.borderColor = theme === 'dark' ? '#666666' : '#c4b9a0';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                      e.currentTarget.style.borderColor = theme === 'dark' ? '#555555' : '#d4cbb3';
                    }}
                  >
                    <ChevronLeft className="h-5 w-5" />
                    <span>上一章</span>
                  </button>
                ) : (
                  <div className="px-8 py-3"></div>
                )}

                <Link
                  to={`/book/${bookId}`}
                  className="px-8 py-3 rounded-md font-medium transition-colors"
                  style={{
                    borderWidth: '2px',
                    borderColor: theme === 'dark' ? '#555555' : '#d4cbb3',
                    color: theme === 'dark' ? '#d0d0d0' : '#333333',
                    backgroundColor: 'transparent'
                  }}
                >
                  返回详情页
                </Link>

                {nextChapter ? (
                  <button
                    onClick={() => goToChapter(nextChapter.id)}
                    className="flex items-center space-x-2 px-8 py-3 rounded-md font-medium transition-colors"
                    style={{
                      borderWidth: '2px',
                      borderColor: theme === 'dark' ? '#555555' : '#d4cbb3',
                      color: theme === 'dark' ? '#d0d0d0' : '#333333',
                      backgroundColor: 'transparent'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = theme === 'dark' ? '#3a3a3a' : '#f2eee2';
                      e.currentTarget.style.borderColor = theme === 'dark' ? '#666666' : '#c4b9a0';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                      e.currentTarget.style.borderColor = theme === 'dark' ? '#555555' : '#d4cbb3';
                    }}
                  >
                    <span>下一章</span>
                    <ChevronRight className="h-5 w-5" />
                  </button>
                ) : (
                  <div className="px-8 py-3"></div>
                )}
              </div>
            </div>
          </article>

          {/* 侧边栏容器（绝对定位，在纸张外侧） */}
          <aside className="absolute right-[-100px] top-0 h-full hidden xl:block">
            {/* 工具栏（在绝对容器内使用 sticky） */}
            <div className="sticky top-24 z-10 rounded-lg shadow-md p-4 flex flex-col gap-3" style={{ backgroundColor: theme === 'dark' ? '#2b2b2b' : '#f6f1e7' }}>
              {/* 目录按钮 */}
              <button
                onClick={() => setShowCatalog(true)}
                className="w-12 h-12 flex items-center justify-center rounded-lg transition-colors"
                style={{ color: theme === 'dark' ? '#d0d0d0' : '#333333' }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = theme === 'dark' ? '#3a3a3a' : '#f2eee2';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
                title="目录"
              >
                <List className="h-6 w-6" />
              </button>

              {/* 书籍详情按钮 */}
              <Link
                to={`/book/${bookId}`}
                className="w-12 h-12 flex items-center justify-center rounded-lg transition-colors"
                style={{ color: theme === 'dark' ? '#d0d0d0' : '#333333' }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = theme === 'dark' ? '#3a3a3a' : '#f2eee2';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
                title="书籍详情"
              >
                <BookIcon className="h-6 w-6" />
              </Link>

              {/* 加入书架按钮 */}
              <button
                onClick={toggleBookmark}
                className="w-12 h-12 flex items-center justify-center rounded-lg transition-colors"
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = theme === 'dark' ? '#3a3a3a' : '#f2eee2';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
                title={isBookmarked ? '已加入书架' : '加入书架'}
              >
                {isBookmarked ? (
                  <BookmarkCheck className="h-6 w-6 text-blue-600" />
                ) : (
                  <Bookmark className="h-6 w-6" style={{ color: theme === 'dark' ? '#d0d0d0' : '#333333' }} />
                )}
              </button>

              {/* 夜间模式按钮 */}
              <button
                onClick={toggleNightMode}
                className="w-12 h-12 flex items-center justify-center rounded-lg hover:bg-[#f2eee2] transition-colors"
                title="夜间模式"
              >
                <Moon className={`h-6 w-6 ${theme === 'dark' ? 'text-yellow-400' : 'text-[#333333]'}`} />
              </button>

              {/* 设置按钮 */}
              <button
                onClick={() => setShowSettings(true)}
                className="w-12 h-12 flex items-center justify-center rounded-lg transition-colors"
                style={{ color: theme === 'dark' ? '#d0d0d0' : '#333333' }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = theme === 'dark' ? '#3a3a3a' : '#f2eee2';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
                title="设置"
              >
                <Settings className="h-6 w-6" />
              </button>
            </div>
          </aside>
        </div>
      </div>

      {/* 目录弹窗层 */}
      {showCatalog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => setShowCatalog(false)}
          />
          <div
            className="relative z-10 w-full max-w-4xl max-h-[85vh] flex flex-col rounded-lg shadow-2xl overflow-hidden"
            style={{ backgroundColor: getBackgroundColor() }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div
              className={`flex flex-wrap items-center justify-between gap-4 px-5 py-4 border-b shrink-0 ${
                theme === 'dark' ? 'border-gray-600' : 'border-gray-300'
              }`}
            >
              <div className="flex items-baseline gap-2">
                <h2 className={`text-2xl font-bold ${theme === 'dark' ? 'text-gray-100' : 'text-gray-900'}`}>
                  目录
                </h2>
                <span className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                  共 {allChapters.length} 章
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCatalogReversed((r) => !r)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    theme === 'dark'
                      ? 'text-gray-300 hover:bg-gray-700'
                      : 'text-gray-700 hover:bg-gray-200'
                  }`}
                  title={catalogReversed ? '切换为正序' : '切换为倒序'}
                >
                  <ArrowUpDown className="h-4 w-4" />
                  {catalogReversed ? '倒序' : '正序'}
                </button>
                <button
                  onClick={() => setShowCatalog(false)}
                  className={`w-10 h-10 flex items-center justify-center rounded-md transition-colors ${
                    theme === 'dark'
                      ? 'hover:bg-gray-700 text-gray-300'
                      : 'hover:bg-gray-200 text-gray-700'
                  }`}
                  title="关闭"
                  aria-label="关闭"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Body: 可单独滚动的章节列表 */}
            <div className="flex-1 overflow-y-auto min-h-0">
              {displayChapters.length === 0 ? (
                <p className={`p-6 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>暂无章节</p>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 p-4">
                  {displayChapters.map((ch) => {
                    const isCurrent = ch.id === chapterId;
                    return (
                      <button
                        key={ch.id}
                        type="button"
                        onClick={() => handleChapterClick(ch)}
                        className={`text-left px-4 py-3 rounded-md transition-colors ${
                          theme === 'dark'
                            ? isCurrent
                              ? 'bg-gray-700 text-amber-400 font-semibold'
                              : 'text-gray-300 hover:bg-gray-700/70 hover:text-red-400'
                            : isCurrent
                              ? 'bg-amber-100/80 text-amber-800 font-semibold'
                              : 'text-gray-700 hover:bg-gray-100 hover:text-red-600'
                        }`}
                      >
                        第{ch.chapter_number}章：{ch.title}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 设置弹窗 */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => setShowSettings(false)}
          />
          <div
            className="relative z-10 w-full max-w-lg rounded-xl shadow-2xl overflow-hidden bg-[#faf9f6]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 头部 */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-200">
              <h2 className="text-2xl font-bold text-gray-900">设置</h2>
              <button
                onClick={() => setShowSettings(false)}
                className="w-10 h-10 flex items-center justify-center rounded-full bg-gray-200 hover:bg-gray-300 text-gray-600 hover:text-gray-800 transition-colors"
                title="关闭"
                aria-label="关闭"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* 内容区 */}
            <div className="px-6 py-5 space-y-6 overflow-y-auto max-h-[70vh]">
              {/* 阅读主题 */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <label className="text-gray-500 text-sm font-medium shrink-0 w-24">阅读主题</label>
                <div className="flex flex-wrap gap-3">
                  {(
                    [
                      { key: 'gray' as const, bg: '#e8e8e8' },
                      { key: 'cream' as const, bg: '#f5f0e1' },
                      { key: 'yellow' as const, bg: '#fff9e6' },
                      { key: 'green' as const, bg: '#e8f5e9' },
                      { key: 'blue' as const, bg: '#e3f2fd' },
                      { key: 'dark' as const, bg: '#2d2d2d' },
                    ] as const
                  ).map(({ key, bg }) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setThemeColor(key)}
                      className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                        themeColor === key ? 'ring-2 ring-red-500 ring-offset-2 ring-offset-[#faf9f6]' : ''
                      }`}
                      style={{ backgroundColor: bg }}
                      title={key}
                    >
                      {themeColor === key && <Check className="h-5 w-5 text-red-500" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* 正文字体 */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <label className="text-gray-500 text-sm font-medium shrink-0 w-24">正文字体</label>
                <div className="flex gap-2">
                  {(['sans', 'serif', 'kai'] as const).map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setFontFamily(key)}
                      className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                        fontFamily === key
                          ? 'border-2 border-red-500 text-red-500 bg-white'
                          : 'border border-gray-300 bg-gray-200 text-gray-500 hover:bg-gray-300'
                      }`}
                    >
                      {key === 'sans' ? '黑体' : key === 'serif' ? '宋体' : '楷体'}
                    </button>
                  ))}
                </div>
              </div>

              {/* 字体大小 */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <label className="text-gray-500 text-sm font-medium shrink-0 w-24">字体大小</label>
                <div className="flex items-stretch rounded-lg overflow-hidden border border-gray-300 bg-gray-100">
                  <button
                    type="button"
                    onClick={() => setFontSizeNum((n) => Math.max(14, n - 1))}
                    className="px-5 py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium text-sm transition-colors"
                  >
                    A-
                  </button>
                  <div className="min-w-[4rem] flex items-center justify-center bg-gray-100 text-gray-800 font-medium px-4 border-x border-gray-300">
                    {fontSizeNum}
                  </div>
                  <button
                    type="button"
                    onClick={() => setFontSizeNum((n) => Math.min(24, n + 1))}
                    className="px-5 py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium text-sm transition-colors"
                  >
                    A+
                  </button>
                </div>
              </div>

              {/* 页面宽度 */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <label className="text-gray-500 text-sm font-medium shrink-0 w-24">页面宽度</label>
                <div className="flex flex-wrap gap-2">
                  {(['auto', '640', '800', '900', '1000', '1280'] as const).map((w) => (
                    <button
                      key={w}
                      type="button"
                      onClick={() => setPageWidth(w)}
                      className={`px-3 py-2 rounded-full text-sm font-medium transition-colors ${
                        pageWidth === w
                          ? 'border-2 border-red-500 text-red-500 bg-white'
                          : 'border border-gray-300 bg-gray-200 text-gray-500 hover:bg-gray-300'
                      }`}
                    >
                      {w === 'auto' ? '自动' : w}
                    </button>
                  ))}
                </div>
              </div>

              {/* 翻页模式 */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <label className="text-gray-500 text-sm font-medium shrink-0 w-24">翻页模式</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setTurnPageMode('chapter')}
                    className={`px-5 py-3 rounded-lg text-sm font-medium transition-colors ${
                      turnPageMode === 'chapter'
                        ? 'border-2 border-red-500 text-red-500 bg-white'
                        : 'border border-gray-300 bg-gray-200 text-gray-500 hover:bg-gray-300'
                    }`}
                  >
                    章节翻页
                  </button>
                  <button
                    type="button"
                    onClick={() => setTurnPageMode('scroll')}
                    className={`px-5 py-3 rounded-lg text-sm font-medium transition-colors ${
                      turnPageMode === 'scroll'
                        ? 'border-2 border-red-500 text-red-500 bg-white'
                        : 'border border-gray-300 bg-gray-200 text-gray-500 hover:bg-gray-300'
                    }`}
                  >
                    滚动翻页
                  </button>
                </div>
              </div>

              {/* 自动订阅下一章 */}
              <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                <label className="text-gray-500 text-sm font-medium shrink-0 w-24 pt-1">自动订阅下一章</label>
                <div className="flex-1 flex items-start gap-3">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={autoSubscribe}
                    onClick={() => setAutoSubscribe((v) => !v)}
                    className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
                      autoSubscribe ? 'bg-red-500' : 'bg-gray-300'
                    }`}
                  >
                    <span
                      className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-[left] duration-200 ${
                        autoSubscribe ? 'left-6' : 'left-1'
                      }`}
                    />
                  </button>
                  <p className="text-gray-500 text-sm">开启后，您在阅读当前作品过程中，系统将为您自动订阅下一章</p>
                </div>
              </div>

              {/* 本章说 */}
              <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                <label className="text-gray-500 text-sm font-medium shrink-0 w-24 pt-1">本章说</label>
                <div className="flex-1 flex items-start gap-3">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={chapterSay}
                    onClick={() => setChapterSay((v) => !v)}
                    className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
                      chapterSay ? 'bg-red-500' : 'bg-gray-300'
                    }`}
                  >
                    <span
                      className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-[left] duration-200 ${
                        chapterSay ? 'left-6' : 'left-1'
                      }`}
                    />
                  </button>
                  <p className="text-gray-500 text-sm">当前会正常显示所有本章说</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
