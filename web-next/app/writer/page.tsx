'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { 
  PenTool, BookOpen, BarChart3, 
  Plus, Upload, X, Edit3, Save, Settings, AlertCircle, CheckCircle2, Sparkles, Trash2,
  Shield, LogIn // 👈 新增图标
} from 'lucide-react';
import { booksApi, chaptersApi, Book, Chapter } from '@/lib/api';

export default function WriterDashboard() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  
  // ================= State 定义区域 =================
  
  // 1. 基础数据
  const [myBooks, setMyBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeChapters, setActiveChapters] = useState<Chapter[]>([]);

  // 2. 弹窗控制
  const [showCreateBookModal, setShowCreateBookModal] = useState(false);
  const [showChapterEditor, setShowChapterEditor] = useState(false);
  const [showBookManager, setShowBookManager] = useState(false);
  const [showPublishConfirm, setShowPublishConfirm] = useState(false);
  const [chapterToDelete, setChapterToDelete] = useState<string | null>(null);
  
  // 👮 管理员专用 State
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [userList, setUserList] = useState<any[]>([]); 

  // 3. 选中项与表单
  const [currentBookId, setCurrentBookId] = useState<string>('');
  const [currentChapterId, setCurrentChapterId] = useState<string | null>(null);

  const [formBookTitle, setFormBookTitle] = useState('');
  const [formBookDescription, setFormBookDescription] = useState('');
  
  // 分类逻辑
  const ALL_CATEGORIES = ['玄幻', '仙侠', '都市', '历史', '科幻', '奇幻', '体育', '军事', '悬疑'];
  const visibleCategories = ALL_CATEGORIES.slice(0, 4);
  const hiddenCategories = ALL_CATEGORIES.slice(4);
  const [formBookCategory, setFormBookCategory] = useState(ALL_CATEGORIES[0]);
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);

  const [formChapterTitle, setFormChapterTitle] = useState('');
  const [formChapterContent, setFormChapterContent] = useState('');

  const [toast, setToast] = useState<{msg: string, type: 'success' | 'info' | 'error'} | null>(null);

  // ================= 数据获取逻辑 =================

  const fetchMyData = useCallback(async () => {
    if (!user) return;
    try {
      setLoading(true);
      // 获取当前登录用户（可能是管理员影子登录后的身份）的书籍
      const books = await booksApi.getMyBooks(user.id);
      setMyBooks(books); 
    } catch (error) {
      console.error('Failed to load books:', error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  // 👮 加载用户列表 (只有打开管理员弹窗时才调用)
  const fetchUserList = async () => {
    if (!user) return;
    try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/admin/users`, {
            headers: { 
                'Authorization': `Bearer ${localStorage.getItem('token') || ''}`, // 如果你有token的话
                'x-user-id': user.id 
            }
        });
        if (res.ok) {
            const data = await res.json();
            setUserList(data);
        } else {
            setToast({ msg: '获取用户列表失败 (权限不足?)', type: 'error' });
        }
    } catch (e) {
        console.error(e);
        setToast({ msg: '网络错误', type: 'error' });
    }
  };

  // ================= Effect 监听 =================

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
        router.push('/login');
    } else {
        fetchMyData();
    }
  }, [user, authLoading, router, fetchMyData]);

  // 监听打开书籍管理器，加载章节
  useEffect(() => {
    if (showBookManager && currentBookId) {
        chaptersApi.getByBookId(currentBookId)
            .then(setActiveChapters)
            .catch(console.error);
    }
  }, [showBookManager, currentBookId]);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // ================= 核心业务逻辑 =================

// 🚀 核心：影子登录逻辑 (修复版)
  const handleShadowLogin = async (targetUserId: string, targetName: string) => {
    // 1. 安全检查：如果 user 为空或者是 null，直接拦截
    // 这里的判断能让 TS 知道后续 user 一定存在
    if (!user || (user as any).role !== 'admin') {
        alert('你不是管理员，无法操作');
        return;
    }
    
    if (!confirm(`⚠️ 确认切换身份\n\n即将以 [ ${targetName} ] 的视角登录。`)) return;

    try {
        // 2. 发送请求
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/admin/impersonate/${targetUserId}`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                // 🛠️ 修复 1：加个 ! 告诉 TS "我确信 user 存在"
                'x-user-id': user!.id 
            }
        });

        if (!res.ok) {
            const errText = await res.text(); 
            throw new Error(errText || '请求失败');
        }
        
        const data = await res.json();
        const newId = data.user.id; 

        // 🛠️ 修复 2 (最关键)：必须使用 'novelhub_user' 这个 Key！
        // 你的 api.txt 和 AuthContext 里都只认这个名字。
        // 如果名字不对，刷新页面后 api 就会读不到 ID，导致掉线。
        localStorage.setItem('novelhub_user', newId);
        
        // 顺便更新一下 user 对象，防止闪烁
        localStorage.setItem('user', JSON.stringify(data.user));

        alert(`✅ 切换成功！\n\n当前身份：${data.user.username}\n即将刷新页面...`);
        
        // 3. 刷新页面，让 AuthContext 重新通过 novelhub_user 读取新身份
        window.location.reload();

    } catch (e: any) {
        console.error(e);
        setToast({ msg: `切换失败: ${e.message}`, type: 'error' });
    }
  };

  const activeBook = myBooks.find(b => b.id === currentBookId);

// 替换掉原来的 openChapterEditor 函数
  const openChapterEditor = async (type: 'new' | 'edit', chapter?: Chapter) => {
    // 1. 如果是新建章节
    if (type === 'new') {
        setCurrentChapterId(null);
        setFormChapterTitle('');
        setFormChapterContent('');
        setShowChapterEditor(true);
    } 
    // 2. 如果是编辑已有章节
    else if (chapter) {
        setCurrentChapterId(chapter.id);
        setFormChapterTitle(chapter.title);
        
        // --- 核心修改开始 ---
        // 先显示加载中，防止用户看到空白不知所措
        setFormChapterContent('正在从云端加载章节内容...'); 
        setShowChapterEditor(true); // 先打开窗口

        try {
            // 单独请求这一章的详情（后端这个接口会返回 content）
            // 注意：这里直接用 fetch 最稳妥，确保能连上你的后端
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/chapters/${chapter.id}`, {
                headers: {
                    // 如果你的后端开启了简单的防盗链检查，这里可能需要带上
                    // 不过通常浏览器 fetch 会自动处理 referer
                }
            });
            
            if (!res.ok) throw new Error('加载失败');
            
            const data = await res.json();
            
            // 拿到真正的 content 后填进去
            // 为了防止用户手快已经关了窗口，这里可以加个判断，或者直接设置
            setFormChapterContent(data.content || ''); 
            
        } catch (e) {
            console.error(e);
            setFormChapterContent('❌ 内容加载失败，请检查网络后重试。');
            setToast({ msg: '章节内容获取失败', type: 'error' });
        }
        // --- 核心修改结束 ---
    }
  };

  const saveChapterCore = async (status: 'ongoing' | 'completed') => {
    if (!formChapterTitle.trim()) {
        alert('章节标题不能为空');
        return false;
    }

    try {
        const chapterData = {
            title: formChapterTitle,
            content: formChapterContent,
            bookId: currentBookId,
            chapter_number: 1, // 后端需自动处理递增
        };

        if (currentChapterId) {
            await chaptersApi.update(currentChapterId, chapterData);
        } else {
            await chaptersApi.create(chapterData);
        }
        
        fetchMyData(); 
        if (currentBookId) {
            const updatedChapters = await chaptersApi.getByBookId(currentBookId);
            setActiveChapters(updatedChapters);
        }
        return true;
    } catch (err) {
        console.error(err);
        setToast({ msg: '保存失败', type: 'error' });
        return false;
    }
  };

  const handleSaveDraft = async () => {
    if (await saveChapterCore('ongoing')) {
        setToast({ msg: '保存成功！', type: 'success' });
    }
  };

  const handlePublishTrigger = () => {
    if (!formChapterTitle.trim()) return alert('标题不能为空');
    setShowPublishConfirm(true);
  };

  const handleConfirmPublish = async () => {
    if (await saveChapterCore('completed')) {
        setShowPublishConfirm(false);
        setShowChapterEditor(false);
        setToast({ msg: '发布成功！', type: 'success' });
    }
  };

  const handleDeleteChapter = (chapterId: string) => {
    setChapterToDelete(chapterId); 
  };

  const executeDeleteChapter = async () => {
    if (!chapterToDelete) return;
    try {
        await chaptersApi.delete(chapterToDelete);
        setToast({ msg: '删除成功', type: 'success' });
        setActiveChapters(prev => prev.filter(c => c.id !== chapterToDelete));
        fetchMyData(); 
    } catch (e) {
        setToast({ msg: '删除失败，请重试', type: 'error' });
    } finally {
        setChapterToDelete(null);
    }
  };

  const handleCreateBook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formBookTitle.trim() || !user) return;
    try {
        await booksApi.create({
            title: formBookTitle,
            description: formBookDescription,
            cover_image: '',
            category: formBookCategory, 
            author: user.username || '匿名作家', 
            author_id: user.id, 
        } as any);
        
        setShowCreateBookModal(false);
        setFormBookTitle('');
        setFormBookDescription('');
        setFormBookCategory(ALL_CATEGORIES[0]);
        setShowCategoryDropdown(false);
        
        setToast({ msg: '新书创建成功！', type: 'success' });
        fetchMyData();
    } catch (e) {
        console.error(e);
        setToast({ msg: '创建失败', type: 'error' });
    }
  };

  // ✅ 新增：更新书籍信息函数
  const handleUpdateBook = async () => {
    if (!currentBookId || !formBookTitle.trim()) return;
    try {
      // 如果你的 api.ts 里没有 update 方法，请确认添加，或者暂时用 fetch 代替
      await booksApi.update(currentBookId, {
          title: formBookTitle,
          description: formBookDescription,
      });
      setToast({ msg: '书籍信息已保存', type: 'success' });
      fetchMyData(); // 刷新列表
    } catch (e) {
      setToast({ msg: '保存失败', type: 'error' });
    }
  };

  const handleDeleteBook = async () => {
    const confirmName = prompt('输入书名确认删除：');
    const book = myBooks.find(b => b.id === currentBookId);
    if (book && confirmName === book.title) {
        try {
            await booksApi.delete(currentBookId);
            setShowBookManager(false);
            setToast({ msg: '书籍已删除', type: 'success' });
            fetchMyData();
        } catch (e) {
            alert('删除失败');
        }
    }
  };

  if (authLoading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  if (!user) return null;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col md:flex-row font-sans">
      
      {/* Toast 提示 */}
      {toast && (
        <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-[100] animate-in fade-in slide-in-from-top-4 w-[90%] md:w-auto text-center">
          <div className={`px-4 py-3 md:px-6 md:py-3 rounded-full shadow-lg text-white font-medium flex items-center justify-center gap-2 ${
            toast.type === 'success' ? 'bg-green-600' : toast.type === 'error' ? 'bg-red-600' : 'bg-blue-600'
          }`}>
            {toast.type === 'success' ? <CheckCircle2 className="h-5 w-5"/> : <AlertCircle className="h-5 w-5"/>}
            <span className="text-sm md:text-base">{toast.msg}</span>
          </div>
        </div>
      )}

      {/* ❌ 已删除：移动端专属顶部栏 (<header className="md:hidden...">) */}

      {/* 侧边栏 (保持 Desktop 不变) */}
      <aside className="w-64 bg-white border-r border-gray-200 hidden md:flex flex-col fixed h-full z-10">
        <div className="p-6 border-b border-gray-100">
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <PenTool className="h-6 w-6 text-blue-600" />
            创作中心
          </h2>
        </div>
        <nav className="flex-1 p-4 space-y-2">
          <button className="w-full flex items-center gap-3 px-4 py-3 text-blue-600 bg-blue-50 rounded-lg font-medium">
            <BookOpen className="h-5 w-5" /> 作品管理
          </button>
          
          {(user as any).role === 'admin' && (
            <button 
                onClick={() => { setShowAdminModal(true); fetchUserList(); }}
                className="w-full flex items-center gap-3 px-4 py-3 text-purple-600 hover:bg-purple-50 rounded-lg font-medium transition mt-2"
            >
                <Shield className="h-5 w-5" /> 用户管理 (Admin)
            </button>
          )}
        </nav>
        <div className="p-4 border-t border-gray-100">
           <div className="flex items-center gap-3 px-4 py-2">
              <div className={`h-8 w-8 rounded-full flex items-center justify-center font-bold ${
                  (user as any).role === 'admin' ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600'
              }`}>
                {((user as any).username || 'U')[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{(user as any).username || '未命名用户'}</p>
                <p className="text-xs text-gray-500">{(user as any).role === 'admin' ? '超级管理员' : '作家'}</p>
              </div>
           </div>
        </div>
      </aside>

      {/* 主内容区 (调整 mobile padding，去掉 header 后顶部不需要留那么多空隙了) */}
      <main className="flex-1 md:ml-64 p-4 md:p-8 pb-20 md:pb-8">
        
        {/* 为了方便移动端管理员操作，如果你删了顶部栏，我在“我的作品”标题旁加个小的盾牌入口（仅Admin可见） */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden min-h-[80vh] md:min-h-0">
            <div className="p-4 md:p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50 md:bg-white">
                <div className="flex items-center gap-2">
                    <h3 className="font-bold text-lg text-gray-900">我的作品</h3>
                    {/* 🛡️ 补位：移动端管理员入口 (原本在顶部栏，现在挪到这里，不占空间) */}
                    {(user as any).role === 'admin' && (
                        <button 
                            onClick={() => { setShowAdminModal(true); fetchUserList(); }}
                            className="md:hidden p-1.5 bg-purple-50 text-purple-600 rounded-lg"
                        >
                            <Shield className="h-4 w-4" />
                        </button>
                    )}
                </div>
                
                <button 
                    onClick={() => setShowCreateBookModal(true)}
                    className="flex items-center gap-2 bg-blue-600 text-white px-3 py-1.5 md:px-4 md:py-2 text-sm md:text-base rounded-lg hover:bg-blue-700 transition shadow-md shadow-blue-500/20 active:scale-95"
                >
                    <Plus className="h-4 w-4" /> <span className="hidden md:inline">创建新书</span><span className="md:hidden">新建</span>
                </button>
            </div>

            <div className="divide-y divide-gray-100">
                {loading ? (
                    <div className="p-12 text-center text-gray-400">正在从云端获取作品...</div>
                ) : myBooks.length === 0 ? (
                    <div className="p-12 text-center text-gray-500 flex flex-col items-center gap-4">
                        <BookOpen className="h-12 w-12 text-gray-200" />
                        <p>暂无作品，快去创建第一本书吧！</p>
                    </div>
                ) : (
                    myBooks.map((book) => (
                        <div key={book.id} className="p-4 md:p-6 flex gap-4 md:gap-6 hover:bg-gray-50 transition group items-start">
                            {/* 封面图 */}
                            <div className="w-20 h-28 md:w-24 md:h-32 bg-gray-200 rounded-md md:rounded-lg shadow-sm flex-shrink-0 flex items-center justify-center text-gray-400 overflow-hidden">
                                {book.cover_image ? <img src={book.cover_image} className="w-full h-full object-cover"/> : <BookOpen className="h-8 w-8 opacity-50" />}
                            </div>
                            
                            <div className="flex-1 flex flex-col justify-between min-h-[7rem] md:min-h-[8rem]">
                                <div>
                                    <div className="flex justify-between items-start">
                                        <h4 className="text-base md:text-xl font-bold text-gray-900 mb-1 line-clamp-1">{book.title}</h4>
                                        <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full md:hidden">
                                            {book.category || '未分类'}
                                        </span>
                                    </div>
                                    <p className="text-xs md:text-sm text-gray-500 mt-1 line-clamp-2 md:line-clamp-2">{book.description || '暂无简介'}</p>
                                </div>
                                
                                <div className="flex flex-wrap gap-2 md:gap-3 mt-3">
                                    <button 
                                        onClick={() => { setCurrentBookId(book.id); openChapterEditor('new'); }}
                                        className="flex-1 md:flex-none flex items-center justify-center gap-1 px-3 py-1.5 md:px-4 md:py-2 bg-blue-50 text-blue-600 text-xs md:text-sm font-medium rounded-lg active:bg-blue-100 transition border border-blue-100"
                                    >
                                        <Upload className="h-3 w-3 md:h-4 md:w-4" /> 快速发布
                                    </button>
                                    <button 
                                        onClick={() => { setCurrentBookId(book.id); setFormBookTitle(book.title);
                                        setFormBookDescription(book.description || '');setShowBookManager(true); }}
                                        className="flex-1 md:flex-none flex items-center justify-center gap-1 px-3 py-1.5 md:px-4 md:py-2 bg-gray-100 text-gray-700 text-xs md:text-sm font-medium rounded-lg active:bg-gray-200 transition border border-gray-200"
                                    >
                                        <Settings className="h-3 w-3 md:h-4 md:w-4" /> 管理
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
      </main>

      {/* ===================== 弹窗区域 (保持不变) ===================== */}
      {/* 1. 书籍管理器 */}
      {showBookManager && activeBook && (
        <div className="fixed inset-0 z-40 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm p-0 md:p-4 animate-in fade-in duration-200">
           <div className="bg-white rounded-t-2xl md:rounded-2xl shadow-2xl w-full max-w-2xl h-[85vh] md:max-h-[85vh] flex flex-col overflow-hidden animate-in slide-in-from-bottom-10 md:slide-in-from-bottom-0">
              <div className="p-4 md:p-6 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
                 <div>
                    <h3 className="text-lg md:text-xl font-bold text-gray-900 truncate max-w-[200px]">{activeBook.title}</h3>
                    <p className="text-xs text-gray-500">目录管理</p>
                 </div>
                 <button onClick={() => setShowBookManager(false)} className="p-2 bg-gray-200 rounded-full"><X className="h-5 w-5 text-gray-600" /></button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-white space-y-3">
                {/* ✅ 新增开始：可折叠的书籍信息编辑区 */}
                 {/* ✅ 修复版：可折叠的书籍信息编辑区 */}
                 <details className="group mb-6 bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                    <summary className="flex items-center justify-between p-4 cursor-pointer list-none select-none bg-gray-50 hover:bg-gray-100 transition-colors">
                        <span className="text-base font-extrabold text-gray-900 flex items-center gap-2">
                            📝 修改书籍信息 
                            <span className="text-xs font-normal text-gray-500">(点击展开)</span>
                        </span>
                        {/* 箭头图标也优化一下 */}
                        <div className="transition-transform duration-200 group-open:rotate-180 text-gray-400">▼</div>
                    </summary>
                    
                    <div className="p-5 border-t border-gray-100 bg-white animate-in slide-in-from-top-2 duration-200">
                        <div className="space-y-4">
                            <div>
                                <label className="text-sm font-bold text-gray-700 mb-1.5 block">书名</label>
                                <input 
                                    value={formBookTitle}
                                    onChange={(e) => setFormBookTitle(e.target.value)}
                                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 font-bold outline-none focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all"
                                    placeholder="请输入书名"
                                />
                            </div>
                            <div>
                                <label className="text-sm font-bold text-gray-700 mb-1.5 block">简介</label>
                                <textarea 
                                    value={formBookDescription}
                                    onChange={(e) => setFormBookDescription(e.target.value)}
                                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 text-sm font-medium outline-none focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all h-28 resize-none leading-relaxed"
                                    placeholder="请输入简介内容..."
                                />
                            </div>
                            <button 
                                onClick={handleUpdateBook}
                                className="w-full py-3 bg-blue-600 text-white text-sm font-bold rounded-xl hover:bg-blue-700 hover:shadow-lg hover:shadow-blue-500/30 active:scale-[0.98] transition-all"
                            >
                                保存修改
                            </button>
                        </div>
                    </div>
                 </details>
                 {/* ✅ 新增结束 */}
                 {activeChapters.length === 0 ? (
                     <div className="text-center text-gray-400 py-8">暂无章节</div>
                 ) : (
                    activeChapters.map((chapter) => (
                        <div key={chapter.id} className="flex items-center justify-between p-3 md:p-4 bg-gray-50 rounded-xl border border-gray-100 active:border-blue-200 transition">
                            <div className="flex-1 mr-2">
                                <p className="font-bold text-gray-900 text-sm md:text-base line-clamp-1">{chapter.title}</p>
                                <p className="text-xs text-gray-400 mt-0.5">字数: {chapter.word_count || 0}</p>
                            </div>
                            <div className="flex gap-2">
                                <button onClick={() => openChapterEditor('edit', chapter)} className="p-2 bg-white border border-gray-200 text-blue-600 rounded-lg"><Edit3 className="h-4 w-4" /></button>
                                <button onClick={() => handleDeleteChapter(chapter.id)} className="p-2 bg-white border border-gray-200 text-red-600 rounded-lg"><Trash2 className="h-4 w-4" /></button>
                            </div>
                        </div>
                    ))
                 )}
              </div>
              <div className="p-4 bg-red-50 border-t border-red-100 flex justify-between items-center pb-8 md:pb-4">
                 <span className="text-xs text-red-600 font-bold">⚠️ 危险区域</span>
                 <button onClick={handleDeleteBook} className="flex items-center gap-1 md:gap-2 px-3 py-1.5 md:px-4 md:py-2 bg-white border border-red-200 text-red-600 text-xs md:text-sm font-medium rounded-lg active:bg-red-50 transition"><Trash2 className="h-3 w-3 md:h-4 md:w-4" /> 删除本书</button>
              </div>
           </div>
        </div>
      )}

      {/* 2. 章节编辑器 */}
      {showChapterEditor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white md:bg-black/60 md:backdrop-blur-sm p-0 md:p-4 animate-in zoom-in-95 duration-200">
           <div className="bg-white w-full h-full md:rounded-2xl md:shadow-2xl md:max-w-5xl md:h-[90vh] flex flex-col overflow-hidden">
              <div className="px-4 py-3 md:px-6 md:py-4 border-b border-gray-200 flex justify-between items-center bg-white shrink-0">
                 <div className="flex items-center gap-2 md:gap-3">
                    <button onClick={() => setShowChapterEditor(false)} className="p-1 -ml-2 text-gray-500 active:bg-gray-100 rounded-full">
                        <X className="h-6 w-6" />
                    </button>
                    <h3 className="text-base md:text-lg font-bold text-gray-900">{currentChapterId ? '编辑' : '新章节'}</h3>
                 </div>
                 <div className="flex items-center gap-2 md:gap-3">
                    <button onClick={handleSaveDraft} className="flex items-center gap-1 md:gap-2 px-3 py-1.5 md:px-5 md:py-2 bg-gray-100 text-gray-700 text-sm md:text-base font-bold rounded-full active:bg-gray-200 transition">
                        <Save className="h-4 w-4" /> <span className="hidden md:inline">草稿</span>
                    </button>
                    <button onClick={handlePublishTrigger} className="flex items-center gap-1 md:gap-2 px-4 py-1.5 md:px-6 md:py-2 bg-blue-600 text-white text-sm md:text-base font-bold rounded-full active:bg-blue-700 transition shadow-lg shadow-blue-500/30">
                        <Upload className="h-4 w-4" /> 发布
                    </button>
                 </div>
              </div>
              <div className="flex-1 overflow-y-auto bg-gray-50 md:bg-gray-50/50 p-0 md:p-8">
                 <div className="max-w-3xl mx-auto h-full flex flex-col md:space-y-6 bg-white md:bg-transparent">
                    <div className="bg-white p-4 md:p-6 md:rounded-xl md:shadow-sm md:border md:border-gray-100 shrink-0">
                       <input 
                            type="text" 
                            value={formChapterTitle}
                            onChange={(e) => setFormChapterTitle(e.target.value)}
                            className="w-full p-2 border-b-2 border-gray-100 focus:border-blue-600 outline-none text-lg md:text-xl font-bold text-gray-900 placeholder-gray-300 bg-transparent transition-colors"
                            placeholder="请输入章节标题"
                       />
                    </div>
                    <div className="bg-white p-4 md:p-6 md:rounded-xl md:shadow-sm md:border md:border-gray-100 flex-1 flex flex-col min-h-[50vh]">
                       <textarea 
                          value={formChapterContent}
                          onChange={(e) => setFormChapterContent(e.target.value)}
                          className="flex-1 w-full resize-none outline-none text-gray-800 font-normal text-base md:text-lg leading-loose placeholder-gray-300 bg-transparent"
                          placeholder="在这里开始你的创作..."
                       ></textarea>
                    </div>
                 </div>
              </div>
           </div>
        </div>
      )}

      {/* 3. 发布确认弹窗 */}
      {showPublishConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in zoom-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center">
                <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4 text-blue-600">
                    <Sparkles className="h-8 w-8" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">确认发布？</h3>
                <div className="flex gap-3">
                    <button onClick={() => setShowPublishConfirm(false)} className="flex-1 py-3 bg-gray-100 text-gray-700 font-bold rounded-xl active:bg-gray-200">再想想</button>
                    <button onClick={handleConfirmPublish} className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl active:bg-blue-700">确认发布</button>
                </div>
            </div>
        </div>
      )}

      {/* 4. 创建新书弹窗 */}
      {showCreateBookModal && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm p-0 md:p-4 animate-in fade-in duration-200">
           <div className="bg-white rounded-t-2xl md:rounded-2xl shadow-2xl w-full max-w-md p-6 animate-in slide-in-from-bottom-10 md:slide-in-from-bottom-0">
              <h3 className="text-xl md:text-2xl font-bold mb-6 text-gray-900 flex items-center gap-2">
                 <Sparkles className="h-6 w-6 text-purple-500" /> 创建新作品
              </h3>
              <form onSubmit={handleCreateBook} className="space-y-4 md:space-y-6">
                 <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">书名</label>
                    <input 
                        type="text" 
                        value={formBookTitle}
                        onChange={(e) => setFormBookTitle(e.target.value)}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none text-gray-900 font-bold placeholder-gray-400" 
                        placeholder="请输入书名" 
                    />
                 </div>

                 <div className="relative">
                    <label className="block text-sm font-bold text-gray-700 mb-2">选择分类</label>
                    <div className="flex flex-wrap gap-2">
                        {visibleCategories.map((cat) => (
                            <button
                                key={cat}
                                type="button"
                                onClick={() => {
                                    setFormBookCategory(cat);
                                    setShowCategoryDropdown(false);
                                }}
                                className={`px-3 py-2 rounded-lg text-sm font-bold transition-all duration-200 border ${
                                    formBookCategory === cat
                                        ? 'bg-blue-600 text-white border-blue-600 shadow-md'
                                        : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:text-blue-500'
                                }`}
                            >
                                {cat}
                            </button>
                        ))}
                        {hiddenCategories.length > 0 && (
                            <div className="relative inline-block">
                                <button
                                    type="button"
                                    onClick={() => setShowCategoryDropdown(!showCategoryDropdown)}
                                    className={`px-3 py-2 rounded-lg text-sm font-bold border bg-white text-gray-600 border-gray-200`}
                                >
                                    ...
                                </button>
                                {showCategoryDropdown && (
                                    <div className="absolute bottom-full mb-2 right-0 w-48 bg-white border border-gray-200 rounded-xl shadow-xl p-2 z-50 grid grid-cols-2 gap-2">
                                        {hiddenCategories.map((cat) => (
                                            <button
                                                key={cat}
                                                type="button"
                                                onClick={() => {
                                                    setFormBookCategory(cat);
                                                    setShowCategoryDropdown(false);
                                                }}
                                                className="px-3 py-2 rounded-lg text-sm font-bold border border-transparent hover:bg-gray-50"
                                            >
                                                {cat}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                 </div>

                 <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">简介</label>
                    <textarea 
                        value={formBookDescription}
                        onChange={(e) => setFormBookDescription(e.target.value)}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none resize-none text-gray-900 font-medium h-24 md:h-32" 
                        placeholder="简单介绍一下你的故事..."
                    ></textarea>
                 </div>
                 <div className="flex gap-4 mt-8 pb-safe md:pb-0">
                    <button type="button" onClick={() => setShowCreateBookModal(false)} className="flex-1 py-3 bg-gray-100 text-gray-700 font-bold rounded-xl active:bg-gray-200">取消</button>
                    <button type="submit" className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl active:bg-blue-700 shadow-lg">立即创建</button>
                 </div>
              </form>
           </div>
        </div>
      )}

      {/* 5. 章节删除确认弹窗 */}
      {chapterToDelete && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in zoom-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center">
                <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4 text-red-600">
                    <Trash2 className="h-8 w-8" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">确定删除？</h3>
                <p className="text-sm text-gray-500 mb-6">删除后无法恢复，请慎重操作。</p>
                <div className="flex gap-3">
                    <button onClick={() => setChapterToDelete(null)} className="flex-1 py-2.5 bg-gray-100 text-gray-700 font-bold rounded-xl">取消</button>
                    <button onClick={executeDeleteChapter} className="flex-1 py-2.5 bg-red-600 text-white font-bold rounded-xl shadow-lg">删除</button>
                </div>
            </div>
        </div>
      )}

      {/* 6. 管理员：用户列表弹窗 */}
      {showAdminModal && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
           <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden">
              <div className="p-4 md:p-6 border-b border-gray-100 bg-purple-50 flex justify-between items-center">
                 <h3 className="text-lg md:text-xl font-bold text-purple-900 flex items-center gap-2">
                    <Shield className="h-5 w-5 md:h-6 md:w-6" /> <span className="hidden md:inline">超级管理员控制台</span><span className="md:hidden">Admin</span>
                 </h3>
                 <button onClick={() => setShowAdminModal(false)}><X className="h-6 w-6 text-gray-500" /></button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-white overflow-x-auto">
                 <table className="w-full text-left border-collapse min-w-[600px] md:min-w-0">
                    <thead>
                        <tr className="text-sm text-gray-500 border-b border-gray-100">
                            <th className="py-3 font-medium">用户名</th>
                            <th className="py-3 font-medium">邮箱</th>
                            <th className="py-3 font-medium">角色</th>
                            <th className="py-3 font-medium">注册时间</th>
                            <th className="py-3 font-medium text-right">操作</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                        {userList.map(u => (
                            <tr key={u.id || u._id} className="hover:bg-gray-50 group">
                                <td className="py-4 font-bold text-gray-900">{u.username}</td>
                                <td className="py-4 text-gray-500 text-sm">{u.email}</td>
                                <td className="py-4">
                                    <span className={`px-2 py-1 rounded text-xs font-bold ${
                                        u.role === 'admin' ? 'bg-purple-100 text-purple-700' :
                                        u.role === 'writer' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                                    }`}>
                                        {u.role === 'admin' ? '管理员' : u.role === 'writer' ? '作家' : '读者'}
                                    </span>
                                </td>
                                <td className="py-4 text-gray-400 text-xs">
                                    {new Date(u.created_at).toLocaleDateString()}
                                </td>
                                <td className="py-4 text-right">
                                    {u.id !== user!.id && u.role !== 'admin' && (
                                        <button 
                                            onClick={() => handleShadowLogin(u.id || u._id, u.username)}
                                            className="inline-flex items-center gap-1 px-3 py-1.5 bg-purple-600 text-white text-xs font-bold rounded-lg hover:bg-purple-700 shadow-md shadow-purple-200 transition"
                                        >
                                            <LogIn className="h-3 w-3" /> 登入
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                 </table>
              </div>
           </div>
        </div>
      )}

    </div>
  );
}