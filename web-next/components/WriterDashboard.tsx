'use client';
import BookCover from '@/components/BookCover';
import WorkCreator from './WorkCreator';
import WorkActions from './WorkActions';
import WritingWorkspace from './WritingWorkspace';
import WriterStatistics from './WriterStatistics';
import './writer-desktop.css';
import {LoadingLogo, LoadingText} from './BrandLoading';
import { safeFetch as fetch } from '@/lib/request';


import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, PenTool, BookOpen, BarChart3,
  Plus, Settings, AlertCircle, CheckCircle2,
  Shield, Ban, Unlock, Search, LayoutDashboard
} from 'lucide-react';
import { booksApi, Book } from '@/lib/api';
import {writerEntry} from '@/lib/writer-entry';
import '@/app/writer/writer-mobile.css';

// ================= 迷你曲线图组件 (纯SVG实现，零依赖) =================
const MiniChart = ({ data, color = "#3b82f6" }: { data: number[], color?: string }) => {
    if (!data || data.length < 2) return <div className="text-[10px] text-gray-300">数据不足</div>;

    const max = Math.max(...data, 1);
    const height = 24; // 高度 24px
    const width = 60;  // 宽度 60px
    const step = width / (data.length - 1);

    // 生成 SVG 路径
    const points = data.map((val, i) => {
        const x = i * step;
        const y = height - (val / max) * height;
        return `${x},${y}`;
    }).join(' ');

    return (
        <svg width={width} height={height} className="overflow-visible">
            {/* 折线 */}
            <polyline fill="none" stroke={color} strokeWidth="1.5" points={points} strokeLinecap="round" strokeLinejoin="round" />
            {/* 最后一个点的圆点 */}
            <circle cx={width} cy={height - (data[data.length-1] / max) * height} r="2" fill={color} />
        </svg>
    );
};

export default function WriterDashboard({entry}: {entry: string}) {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const entryParams = new URLSearchParams(entry);
  const entryAction = entryParams.get('action');
  const destination = writerEntry(entry);
  const [writingReference, setWritingReference] = useState(destination.reference);
  const [adminWork, setAdminWork] = useState<Book | null>(null);
  const fromCreationCenter = entryParams.get('from') === 'creation';
  const requestedPage = Number(entryParams.get('page') || 1);

  const closeCreate = () => { setShowCreateBookModal(false); if (entryAction === 'new') router.replace('/writer'); };


  // ================= State 定义区域 =================

// 核心：视图控制 'works' | 'admin' | 'adminBooks'
  const [currentView, setCurrentView] = useState<'works' | 'statistics' | 'admin' | 'adminBooks'>(entryAction === 'statistics' ? 'statistics' : 'works');

  // 作品相关
  const [myBooks, setMyBooks] = useState<Book[]>([]);
  const [worksPage, setWorksPage] = useState(Number.isSafeInteger(requestedPage) && requestedPage > 0 && requestedPage <= 100000 ? requestedPage : 1);
  const [loading, setLoading] = useState(true);
  const [showCreateBookModal, setShowCreateBookModal] = useState(destination.kind === 'new');
  const [returningToWorks, setReturningToWorks] = useState(false);
  const [bookCreationKey,setBookCreationKey]=useState(()=>crypto.randomUUID());

  // 👮 管理员页面专用 State
  const [userList, setUserList] = useState<Array<{id:string;_id?:string;username:string;email:string;role:string;isBanned:boolean;created_at:string;weekly_score?:number;stats?:{today_views?:number;today_uploads?:number;history?:Array<{views?:number;uploads?:number}>}}>>([]);
  const [adminSearch, setAdminSearch] = useState(''); // 搜索词
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminHotBooks, setAdminHotBooks] = useState<Book[]>([]);
  const [adminBookSearch, setAdminBookSearch] = useState('');
  const [adminBookSearchResults, setAdminBookSearchResults] = useState<Book[]>([]);
  const [adminBooksLoading, setAdminBooksLoading] = useState(false);
  const [adminBookSearchLoading, setAdminBookSearchLoading] = useState(false);
  const [toast, setToast] = useState<{msg: string, type: 'success' | 'info' | 'error'} | null>(null);

  const fetchMyData = useCallback(async () => {
    if (!user) return;
    try {
      setLoading(true);
      const books = await booksApi.getMyBooks(user.id, worksPage);
      setMyBooks(books);
    } catch (error) {
      console.error('Failed to load books:', error);
    } finally {
      setLoading(false);
    }
  }, [user, worksPage]);

  const [adminUserPage,setAdminUserPage]=useState(1);
  const [adminUserTotal,setAdminUserTotal]=useState(0);
  // 👮 加载用户列表 (支持搜索)
  const fetchUserList = useCallback(async (search = '') => {
    if (!user) return;
    setAdminLoading(true);
    try {
        // ✅ 升级：带上 search 参数
        const res = await fetch(`/api/admin/users?search=${encodeURIComponent(search)}&page=${adminUserPage}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token') || ''}` }
        });
        if (res.ok) {
            const data = await res.json();
            setUserList(data);setAdminUserTotal(Number(res.headers.get('X-Total-Count')));
        } else {
            setToast({ msg: '获取用户列表失败', type: 'error' });
        }
    } catch {
        setToast({ msg: '网络错误', type: 'error' });
    } finally {
        setAdminLoading(false);
    }
  }, [user,adminUserPage]);

  const fetchAdminHotBooks = useCallback(async () => {
    if (!user || user.role !== 'admin') return;
    setAdminBooksLoading(true);
    try {
      const books = await booksApi.getAll({ orderBy: 'daily_views', order: 'desc', limit: 10 });
      setAdminHotBooks(books);
    } catch (error) {
      console.error('Failed to load hot books:', error);
      setToast({ msg: '获取热门书籍失败', type: 'error' });
    } finally {
      setAdminBooksLoading(false);
    }
  }, [user]);

  const fetchAdminBookSearchResults = useCallback(async (rawKeyword: string) => {
    if (!user || user.role !== 'admin') return;
    const keyword = rawKeyword.trim().toLowerCase();
    if (!keyword) {
      setAdminBookSearchResults([]);
      return;
    }

    setAdminBookSearchLoading(true);
    try {
      const books = await booksApi.getAll({ orderBy: 'daily_views', order: 'desc', q: keyword });
      const filtered = books.filter((book) => {
        const authorName = typeof book.author === 'string'
            ? book.author
            : (book.author_id && typeof book.author_id === 'object' && 'username' in book.author_id
                ? (book.author_id as {username?:string;_id?:string;id?:string}).username
                : '');
        const target = `${book.title || ''} ${authorName || ''}`.toLowerCase();
        return target.includes(keyword);
        });
      setAdminBookSearchResults(filtered);
    } catch (error) {
      console.error('Failed to search books:', error);
      setToast({ msg: '搜索书籍失败', type: 'error' });
    } finally {
      setAdminBookSearchLoading(false);
    }
  }, [user]);

  // 监听搜索词变化 (防抖)
  useEffect(() => {
      if (currentView === 'admin') {
          const timer = setTimeout(() => {
              fetchUserList(adminSearch);
          }, 500); // 500ms 防抖
          return () => clearTimeout(timer);
      }
  }, [adminSearch, currentView, fetchUserList]);

  useEffect(() => {
    if (currentView === 'adminBooks' && user?.role === 'admin') {
      fetchAdminHotBooks();
    }
  }, [currentView, user, fetchAdminHotBooks]);

  useEffect(() => {
    if (currentView !== 'adminBooks' || user?.role !== 'admin') return;
    const keyword = adminBookSearch.trim();
    if (!keyword) {
      setAdminBookSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      fetchAdminBookSearchResults(keyword);
    }, 500);
    return () => clearTimeout(timer);
  }, [adminBookSearch, currentView, user, fetchAdminBookSearchResults]);

  // 封号逻辑
  const handleBanUser = async (targetUserId: string, currentStatus: boolean, username: string) => {
    const action = currentStatus ? '解封' : '封禁';
    if (!confirm(`⚠️ 确定要 ${action} 用户 [ ${username} ] 吗？`)) return;
    try {
        const res = await fetch(`/api/admin/users/${targetUserId}/ban`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token') || ''}` },
            body: JSON.stringify({ isBanned: !currentStatus })
        });
        if (res.ok) {
            setToast({ msg: `${action}成功`, type: 'success' });
            fetchUserList(adminSearch); // 刷新
        } else {
            setToast({ msg: '操作失败', type: 'error' });
        }
    } catch { setToast({ msg: '网络错误', type: 'error' }); }
  };

  const getBookAuthorName = (book: Book) => {
    if (typeof book.author === 'string' && book.author.trim()) return book.author;
    if (book.author_id && typeof book.author_id === 'object' && 'username' in book.author_id) {
      return (book.author_id as {username?:string;_id?:string;id?:string}).username || '未知作者';
    }
    return '未知作者';
  };

  const openBookManager = (book: Book) => setAdminWork(book);

  // Effect
  useEffect(() => {
    if (authLoading) return;
    if (!user) router.replace('/login');
    else fetchMyData();
  }, [user, authLoading, router, fetchMyData]);

  useEffect(() => { if(toast) { const t = setTimeout(()=>setToast(null),3000); return ()=>clearTimeout(t); } }, [toast]);

  const creator = <WorkCreator key={bookCreationKey} draftKey={bookCreationKey} embedded={false} onClose={closeCreate} onComplete={() => {
          if (entryAction === 'new') {setReturningToWorks(true); router.replace('/writer'); return;}
          closeCreate();
          setToast({msg:'作品已创建', type:'success'});
          if (worksPage !== 1) setWorksPage(1);
          else void fetchMyData();
        }}/>;
  if (user?.role === 'admin' && adminWork) return <div className="writer-admin-work">
    <header className="writer-admin-work-header"><button type="button" aria-label="返回书籍总编辑" onClick={() => setAdminWork(null)}><ArrowLeft size={20}/></button><h1>{adminWork.title}</h1><WorkActions book={adminWork} onChanged={() => {
      void booksApi.getById(adminWork.id).then(book => setAdminWork(book)).catch(() => setAdminWork(null));
      void fetchAdminHotBooks(); if (adminBookSearch.trim()) void fetchAdminBookSearchResults(adminBookSearch);
    }}/></header>
    <WritingWorkspace reference={`b_${adminWork.id}`} embedded moderation onExit={() => setAdminWork(null)}/>
  </div>;
  if (user && writingReference) return <WritingWorkspace key={user.id + writingReference} reference={writingReference} onExit={() => {if (destination.reference) router.replace('/writer'); else {setWritingReference(''); void fetchMyData();}}}/>;
  if (user && returningToWorks) return <div className="writer-page min-h-screen flex items-center justify-center" role="status"><LoadingText>作品已创建，正在返回我的作品</LoadingText></div>;
  if (user && showCreateBookModal) return creator;

  if (authLoading || !user) return <div className="writer-page min-h-screen flex flex-col gap-4 items-center justify-center" role="status"><LoadingLogo/><p><LoadingText>正在准备创作中心</LoadingText></p></div>;

  return (
    <div className="writer-page min-h-screen bg-gray-50 flex flex-col md:flex-row font-sans">
      <header className="writer-mobile-header"><button type="button" aria-label={fromCreationCenter ? '返回创作中心' : '返回阅读'} onClick={() => fromCreationCenter ? router.back() : router.push('/')}><ArrowLeft size={20}/></button><div><span>九天 · 创作者空间</span><h1>{currentView === 'statistics' ? '作品数据' : '作品管理'}</h1></div><PenTool size={23} aria-hidden="true"/></header>
      {/* Toast */}
      {toast && (
        <div className="writer-toast fixed top-4 left-1/2 transform -translate-x-1/2 z-[110] animate-in fade-in slide-in-from-top-4">
          <div className={`px-6 py-3 rounded-full shadow-lg text-white font-medium flex items-center gap-2 ${toast.type === 'success' ? 'bg-green-600' : toast.type === 'error' ? 'bg-red-600' : 'bg-blue-600'}`}>
            {toast.type === 'success' ? <CheckCircle2 className="h-5 w-5"/> : <AlertCircle className="h-5 w-5"/>}
            <span>{toast.msg}</span>
          </div>
        </div>
      )}

      {/* ================= 侧边栏 (导航核心) ================= */}
      <aside className="w-64 bg-white border-r border-gray-200 hidden md:flex flex-col fixed h-full z-10">
        <div className="p-6 border-b border-gray-100">
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <PenTool className="h-6 w-6 text-blue-600" />
            创作中心
          </h2>
        </div>
        <nav className="flex-1 p-4 space-y-2">
          {/* 切换到作品管理 */}
          <button
            onClick={() => setCurrentView('works')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition ${currentView === 'works' ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-50'}`}
          >
            <BookOpen className="h-5 w-5" /> 作品管理
          </button>

          <button onClick={() => setCurrentView('statistics')} className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-gray-600"><BarChart3 className="h-5 w-5"/>作品数据</button>
          {/* 切换到控制台 (仅管理员) */}
          {user.role === 'admin' && (
            <button
                onClick={() => setCurrentView('admin')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition mt-2 ${currentView === 'admin' ? 'bg-purple-50 text-purple-600' : 'text-gray-600 hover:bg-purple-50 hover:text-purple-600'}`}
            >
                <LayoutDashboard className="h-5 w-5" /> 超级控制台
            </button>
          )}
          {user.role === 'admin' && (
            <button
                onClick={() => setCurrentView('adminBooks')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition mt-2 ${currentView === 'adminBooks' ? 'bg-amber-50 text-amber-700' : 'text-gray-600 hover:bg-amber-50 hover:text-amber-700'}`}
            >
                <BarChart3 className="h-5 w-5" /> 书籍总编辑
            </button>
          )}
        </nav>
        <div className="p-4 border-t border-gray-100">
           <div className="flex items-center gap-3 px-4 py-2">
              <div className={`h-8 w-8 rounded-full flex items-center justify-center font-bold ${user.role === 'admin' ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600'}`}>
                {(user.username || 'U')[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{user.username}</p>
                <p className="text-xs text-gray-500">{user.role === 'admin' ? '超级管理员' : '创作者'}</p>
              </div>
           </div>
        </div>
      </aside>

      {/* ================= 主内容区域 ================= */}
      <main className="writer-main flex-1 md:ml-64 p-4 md:p-8 pb-20 md:pb-8">

        {currentView === 'statistics' && <WriterStatistics/>}
        {/* 1. 作品管理视图 */}
        {currentView === 'works' && (
            <div className="writer-works-shell bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden min-h-[80vh] md:min-h-0 animate-in fade-in">
                <div className="writer-works-heading p-4 md:p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50 md:bg-white">
                    <h3 className="font-bold text-lg text-gray-900">我的作品</h3>
                    <button onClick={() => {setBookCreationKey(crypto.randomUUID());setShowCreateBookModal(true);}} className="flex items-center gap-2 bg-blue-600 text-white px-3 py-1.5 md:px-4 md:py-2 text-sm md:text-base rounded-lg hover:bg-blue-700 transition shadow-md shadow-blue-500/20 active:scale-95 cursor-pointer">
                        <Plus className="h-4 w-4" /> <span className="hidden md:inline">创建新书</span><span className="md:hidden">新建</span>
                    </button>
                </div>

                <div className="divide-y divide-gray-100">
                    <div className="flex items-center justify-center gap-4 p-4"><button disabled={loading || worksPage===1} onClick={()=>setWorksPage(worksPage-1)}>上一页</button><span>第 {worksPage} 页</span><button disabled={loading || myBooks.length<20} onClick={()=>setWorksPage(worksPage+1)}>下一页</button></div>
                    {loading ? ( <div className="p-12 text-center text-gray-400">加载中...</div> ) : myBooks.length === 0 ? (
                        <div className="p-12 text-center text-gray-500 flex flex-col items-center gap-4">
                            <BookOpen className="h-12 w-12 text-gray-200" /> <p>暂无作品</p>
                        </div>
                    ) : (
                        myBooks.map((book) => (
                            <div key={book.id} className="writer-work p-4 md:p-6 flex gap-4 md:gap-6 hover:bg-gray-50 transition group items-start">
                                <div className="writer-work-cover w-20 aspect-[3/4] h-auto md:w-24 md:aspect-[3/4] bg-gray-200 rounded-md md:rounded-lg shadow-sm flex-shrink-0 flex items-center justify-center text-gray-400 overflow-hidden relative">
                                    {book.cover_image ? <BookCover src={book.cover_image} className="w-full h-full object-cover" /> : <BookOpen className="h-8 w-8 opacity-50" />}
                                </div>
                                <div className="writer-work-info flex-1 flex flex-col justify-between min-h-[7rem] md:min-h-[8rem]">
                                    <div>
                                        <div className="flex justify-between items-start">
                                            <h4 className="text-base md:text-xl font-bold text-gray-900 mb-1 line-clamp-1">{book.title}{book.visibility === 'private' && <span className="work-private ml-3">私密</span>}</h4>
                                            <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full md:hidden">{book.category || '未分类'}</span>
                                        </div>
                                        <p className="text-xs md:text-sm text-gray-500 mt-1 line-clamp-2">{book.description || '暂无简介'}</p>
                                    </div>
                                    <div className="writer-work-actions">
                                        <WorkActions book={book} onChanged={() => {if(myBooks.length === 1 && worksPage > 1) setWorksPage(worksPage - 1); else void fetchMyData();}}/>
                                        <button onClick={() => setWritingReference(book.manuscriptKey ? `m_${book.manuscriptKey}` : `b_${book.id}`)} className="writer-continue">创作</button>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        )}

        {/* 2. ✅ 超级管理员控制台视图 (新页面) */}
        {currentView === 'admin' && user.role === 'admin' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
                {/* 顶部：标题与搜索 */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                            <Shield className="h-7 w-7 text-purple-600" /> 控制台
                        </h2>
                        <p className="text-sm text-gray-500 mt-1">
                            管理用户状态，查看活跃数据
                        </p>
                    </div>
                    <nav aria-label="用户分页" className="flex gap-4"><button disabled={adminLoading||adminUserPage===1} onClick={()=>setAdminUserPage(adminUserPage-1)}>上一页</button><span>第 {adminUserPage} 页</span><button disabled={adminLoading||adminUserPage*15>=adminUserTotal} onClick={()=>setAdminUserPage(adminUserPage+1)}>下一页</button></nav>
                    {/* 搜索框 */}
                    <div className="relative w-full md:w-80">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                        <input
                            type="text"
                            placeholder="搜索用户名或邮箱..."
                            value={adminSearch}
                            onChange={(e) => {setAdminUserPage(1);setAdminSearch(e.target.value);}}
                            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition shadow-sm text-gray-900 placeholder-gray-500 bg-gray-50/50"
                        />
                    </div>
                </div>

                {/* 用户列表卡片 */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse min-w-[800px]">
                            <thead>
                                <tr className="bg-gray-50/50 border-b border-gray-200 text-xs text-gray-500 uppercase tracking-wider">
                                    <th className="px-6 py-4 font-semibold">用户</th>
                                    <th className="px-6 py-4 font-semibold">角色/状态</th>
                                    <th className="px-6 py-4 font-semibold">本周活跃趋势 (浏览/上传)</th>
                                    <th className="px-6 py-4 font-semibold text-right">操作</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {adminLoading ? (
                                    <tr><td colSpan={4} className="p-8 text-center text-gray-400">加载中...</td></tr>
                                ) : userList.length === 0 ? (
                                    <tr><td colSpan={4} className="p-8 text-center text-gray-400">未找到用户</td></tr>
                                ) : userList.map(u => {
                                    // 准备图表数据
                                    const stats = u.stats || {};
                                    const history = stats.history || [];

                                    // 🛡️ 2. 获取今日实时数据
                                    const todayViews = stats.today_views || 0;
                                    const todayUploads = stats.today_uploads || 0;

                                    // 🛡️ 3. 拼接数据：历史数据 + 今日数据 (让管理员能看到当天的实时变化)
                                    // 注意：MiniChart 只需要数字数组
                                    const viewData = [...history.map((h: {views?:number;uploads?:number}) => h.views || 0), todayViews];
                                    const uploadData = [...history.map((h: {views?:number;uploads?:number}) => h.uploads || 0), todayUploads];

                                    return (
                                        <tr key={u.id || u._id} className={`group hover:bg-gray-50 transition ${u.isBanned ? 'bg-red-50/30' : ''}`}>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-3">
                                                    <div className={`h-10 w-10 rounded-full flex items-center justify-center font-bold text-white shadow-sm ${u.role === 'admin' ? 'bg-gradient-to-br from-purple-500 to-indigo-600' : 'bg-gradient-to-br from-blue-400 to-blue-600'}`}>
                                                        {u.username[0].toUpperCase()}
                                                    </div>
                                                    <div>
                                                        <p className="font-bold text-gray-900">{u.username}</p>
                                                        <p className="text-xs text-gray-500">{u.email}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex flex-col gap-1 items-start">
                                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${u.role==='admin'?'bg-purple-50 text-purple-600 border-purple-100':'bg-blue-50 text-blue-600 border-blue-100'}`}>
                                                        {u.role.toUpperCase()}
                                                    </span>
                                                    {u.isBanned ? (
                                                        <span className="flex items-center gap-1 text-xs font-bold text-red-600">
                                                            <Ban className="h-3 w-3" /> 已封禁
                                                        </span>
                                                    ) : (
                                                        <span className="text-xs text-green-600 flex items-center gap-1">
                                                            <CheckCircle2 className="h-3 w-3" /> 正常
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex gap-6">
                                                    <div className="flex flex-col gap-1">
                                                        {/* 这里修改了 title，增加了具体的数字显示 */}
                                                        <span className="text-[10px] text-gray-400 uppercase font-bold">
                                                            浏览量 ({todayViews})
                                                        </span>
                                                        <MiniChart data={viewData} color="#3b82f6" />
                                                    </div>
                                                    <div className="flex flex-col gap-1">
                                                        <span className="text-[10px] text-gray-400 uppercase font-bold">
                                                            上传量 ({todayUploads})
                                                        </span>
                                                        <MiniChart data={uploadData} color="#10b981" />
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <div className="flex justify-end gap-2 opacity-60 group-hover:opacity-100 transition">
                                                    {u.id !== user!.id && u.role !== 'admin' && (
                                                        <>
                                                            <button
                                                                onClick={() => handleBanUser(u.id, u.isBanned, u.username)}
                                                                className={`p-2 rounded-lg border border-transparent transition ${u.isBanned ? 'text-green-600 hover:bg-green-50 hover:border-green-100' : 'text-red-600 hover:bg-red-50 hover:border-red-100'}`}
                                                                title={u.isBanned ? "解封" : "封号"}
                                                            >
                                                                {u.isBanned ? <Unlock className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    {/* 底部提示 */}
                    <div className="bg-gray-50 px-6 py-3 border-t border-gray-200 text-xs text-gray-500 flex justify-between">
                         <span>显示基于活跃度排序的前 15 名用户</span>
                         <span>数据每日凌晨更新</span>
                    </div>
                </div>
            </div>
        )}

        {currentView === 'adminBooks' && user.role === 'admin' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 flex flex-col">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                            <BarChart3 className="h-7 w-7 text-amber-600" /> 书籍总编辑
                        </h2>
                        <p className="text-sm text-gray-500 mt-1">
                            默认展示今日最火 Top 10，可搜索其余书籍并进行完整编辑。
                        </p>
                    </div>
                    <div className="relative w-full md:w-96">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                        <input
                            type="text"
                            placeholder="搜索书名或作者..."
                            value={adminBookSearch}
                            onChange={(e) => setAdminBookSearch(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none transition shadow-sm text-gray-900 placeholder-gray-500 bg-gray-50/50"
                        />
                    </div>
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden order-2">
                    <div className="p-4 md:p-6 border-b border-gray-100 bg-gray-50/60">
                        <h3 className="font-bold text-lg text-gray-900">今日最火 Top 10</h3>
                    </div>
                    <div className="divide-y divide-gray-100">
                        {adminBooksLoading ? (
                            <div className="p-12 text-center text-gray-400">加载中...</div>
                        ) : adminHotBooks.length === 0 ? (
                            <div className="p-12 text-center text-gray-500">暂无热门书籍</div>
                        ) : (
                            adminHotBooks.map((book) => (
                                <div key={book.id} className="p-4 md:p-6 flex gap-4 md:gap-6 hover:bg-gray-50 transition group items-start">
                                    <div className="w-20 aspect-[3/4] h-auto md:w-24 md:aspect-[3/4] bg-gray-200 rounded-md md:rounded-lg shadow-sm flex-shrink-0 flex items-center justify-center text-gray-400 overflow-hidden relative">
                                        {book.cover_image ? <BookCover src={book.cover_image} className="w-full h-full object-cover" /> : <BookOpen className="h-8 w-8 opacity-50" />}
                                    </div>
                                    <div className="flex-1 flex flex-col justify-between min-h-[7rem] md:min-h-[8rem]">
                                        <div>
                                            <div className="flex justify-between items-start gap-3">
                                                <h4 className="text-base md:text-xl font-bold text-gray-900 mb-1 line-clamp-1">{book.title}{book.visibility === 'private' && <span className="work-private ml-3">私密</span>}</h4>
                                                <span className="text-[11px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">今日热度 {book.daily_views || 0}</span>
                                            </div>
                                            <p className="text-xs md:text-sm text-gray-500 mt-1 line-clamp-2">{book.description || '暂无简介'}</p>
                                            <p className="text-xs text-gray-400 mt-1">作者：{getBookAuthorName(book)}</p>
                                        </div>
                                        <div className="flex gap-2 md:gap-3 mt-3">
                                            <button onClick={() => openBookManager(book)} className="w-32 flex items-center justify-center gap-1 px-3 py-2 bg-white text-gray-700 text-sm font-bold rounded-lg border border-gray-200 shadow-sm hover:bg-gray-50 hover:border-gray-300 hover:shadow-md active:scale-95 transition-all cursor-pointer">
                                                <Settings className="h-3 w-3 md:h-4 md:w-4" /> <span>管理</span>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                <div className={`bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden order-1 ${adminBookSearch.trim() ? 'block' : 'hidden'}`}>
                <div className="p-4 md:p-6 border-b border-gray-100 bg-gray-50/60">
                    <h3 className="font-bold text-lg text-gray-900">搜索结果（不含 Top 10）</h3>
                </div>
                <div className="divide-y divide-gray-100">
                    {adminBookSearchLoading ? (
                        <div className="p-10 text-center text-gray-400">搜索中...</div>
                    ) : adminBookSearchResults.length === 0 ? (
                        <div className="p-10 text-center text-gray-500">未找到匹配书籍</div>
                    ) : (
                            adminBookSearchResults.map((book) => (
                                <div key={book.id} className="p-4 md:p-6 flex gap-4 md:gap-6 hover:bg-gray-50 transition group items-start">
                                    <div className="w-20 aspect-[3/4] h-auto md:w-24 md:aspect-[3/4] bg-gray-200 rounded-md md:rounded-lg shadow-sm flex-shrink-0 flex items-center justify-center text-gray-400 overflow-hidden relative">
                                        {book.cover_image ? <BookCover src={book.cover_image} className="w-full h-full object-cover" /> : <BookOpen className="h-8 w-8 opacity-50" />}
                                    </div>
                                    <div className="flex-1 flex flex-col justify-between min-h-[7rem] md:min-h-[8rem]">
                                        <div>
                                            <h4 className="text-base md:text-xl font-bold text-gray-900 mb-1 line-clamp-1">{book.title}{book.visibility === 'private' && <span className="work-private ml-3">私密</span>}</h4>
                                            <p className="text-xs md:text-sm text-gray-500 mt-1 line-clamp-2">{book.description || '暂无简介'}</p>
                                            <p className="text-xs text-gray-400 mt-1">作者：{getBookAuthorName(book)} / 今日热度：{book.daily_views || 0}</p>
                                        </div>
                                        <div className="flex gap-2 md:gap-3 mt-3">
                                            <button onClick={() => openBookManager(book)} className="w-32 flex items-center justify-center gap-1 px-3 py-2 bg-white text-gray-700 text-sm font-bold rounded-lg border border-gray-200 shadow-sm hover:bg-gray-50 hover:border-gray-300 hover:shadow-md active:scale-95 transition-all cursor-pointer">
                                                <Settings className="h-3 w-3 md:h-4 md:w-4" /> <span>管理</span>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        )}
      </main>
    </div>
  );
}
