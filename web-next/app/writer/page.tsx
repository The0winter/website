'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { 
  PenTool, BookOpen, BarChart3, 
  Plus, Upload, X, Edit3, Save, Settings, AlertCircle, CheckCircle2, Sparkles, Trash2
} from 'lucide-react';
import { booksApi, chaptersApi, Book, Chapter } from '@/lib/api';

export default function WriterDashboard() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  
  // --- 1. 所有的 State 必须放在最前面 ---
  const [myBooks, setMyBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);

  // 弹窗开关
  const [showCreateBookModal, setShowCreateBookModal] = useState(false);
  const [showChapterEditor, setShowChapterEditor] = useState(false);
  const [showBookManager, setShowBookManager] = useState(false);
  const [showPublishConfirm, setShowPublishConfirm] = useState(false);

  // 选中项
  const [currentBookId, setCurrentBookId] = useState<string>('');
  const [currentChapterId, setCurrentChapterId] = useState<string | null>(null);

  // 🔥 修复点：把 activeChapters 移到这里，放在 return 之前！
  const [activeChapters, setActiveChapters] = useState<Chapter[]>([]);

  // 表单数据
  const [formBookTitle, setFormBookTitle] = useState('');
  const [formBookDescription, setFormBookDescription] = useState('');
  const [formChapterTitle, setFormChapterTitle] = useState('');
  const [formChapterContent, setFormChapterContent] = useState('');

  const [toast, setToast] = useState<{msg: string, type: 'success' | 'info' | 'error'} | null>(null);

  // --- 获取数据 ---
// inside WriterDashboard component...

  const fetchMyData = useCallback(async () => {
    if (!user) return;
    try {
      setLoading(true);
      
      // 🔴 修改前：const books = await booksApi.getMyBooks();
      // ✅ 修改后：把 user.id 传进去！
      const books = await booksApi.getMyBooks(user.id);
      
      setMyBooks(books); 
    } catch (error) {
      console.error('Failed to load books:', error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    // Wait for loading to finish before checking user
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
        // 加载该书的章节
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

  // ⚠️ 只有所有 Hook 都声明完了，才能进行提前返回
  // Show loading spinner while checking auth
  if (authLoading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  if (!user) return null;

  // --- 逻辑处理函数 ---
  const activeBook = myBooks.find(b => b.id === currentBookId);

  const openChapterEditor = (type: 'new' | 'edit', chapter?: Chapter) => {
    if (type === 'new') {
        setCurrentChapterId(null);
        setFormChapterTitle('');
        setFormChapterContent('');
    } else if (chapter) {
        setCurrentChapterId(chapter.id);
        setFormChapterTitle(chapter.title);
        setFormChapterContent(chapter.content);
    }
    setShowChapterEditor(true);
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
            // status: status 
        };

        if (currentChapterId) {
            await chaptersApi.update(currentChapterId, chapterData);
        } else {
            await chaptersApi.create(chapterData);
        }
        
        // 刷新书籍列表（更新字数等）
        fetchMyData(); 
        // 同时也刷新当前的章节列表（以便在管理器中立即看到）
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

  const handleDeleteChapter = async (chapterId: string) => {
    if (!confirm('确定删除?')) return;
    try {
        await chaptersApi.delete(chapterId);
        setToast({ msg: '删除成功', type: 'success' });
        // 刷新当前章节列表
        setActiveChapters(prev => prev.filter(c => c.id !== chapterId));
        fetchMyData(); // 刷新总数据
    } catch (e) {
        alert('删除失败');
    }
  };

  const handleCreateBook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formBookTitle.trim()) return;

    try {
        // ✅ 修改后的代码：显式加上 author_id
        // 在 handleCreateBook 函数里
        await booksApi.create({
            title: formBookTitle,
            description: formBookDescription,
            cover_image: '',
            category: '未分类',
            // 👇 关键：直接把名字发过去！
            author: user.username || '匿名作家', 
            // 👇 ID 也要发，为了后续权限验证
            author_id: user.id, 
        } as any);
        
        setShowCreateBookModal(false);
        setFormBookTitle('');
        setFormBookDescription('');
        setToast({ msg: '新书创建成功！', type: 'success' });
        fetchMyData(); 
    } catch (e) {
        console.error(e);
        setToast({ msg: '创建失败', type: 'error' });
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

  return (
    <div className="min-h-screen bg-gray-100 flex font-sans">
      
      {toast && (
        <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-[60] animate-in fade-in slide-in-from-top-4">
          <div className={`px-6 py-3 rounded-full shadow-lg text-white font-medium flex items-center gap-2 ${
            toast.type === 'success' ? 'bg-green-600' : toast.type === 'error' ? 'bg-red-600' : 'bg-blue-600'
          }`}>
            {toast.type === 'success' ? <CheckCircle2 className="h-5 w-5"/> : <AlertCircle className="h-5 w-5"/>}
            {toast.msg}
          </div>
        </div>
      )}

      {/* 侧边栏 */}
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
        </nav>
        <div className="p-4 border-t border-gray-100">
           <div className="flex items-center gap-3 px-4 py-2">
              <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold">
                {((user as any).username || 'U')[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{(user as any).username || '未命名用户'}</p>
                <p className="text-xs text-gray-500">作家</p>
              </div>
           </div>
        </div>
      </aside>

      <main className="flex-1 md:ml-64 p-8">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                <h3 className="font-bold text-lg text-gray-900">我的作品</h3>
                <button 
                    onClick={() => setShowCreateBookModal(true)}
                    className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition shadow-md shadow-blue-500/20"
                >
                    <Plus className="h-4 w-4" /> 创建新书
                </button>
            </div>

            <div className="divide-y divide-gray-100">
                {loading ? (
                    <div className="p-12 text-center text-gray-400">正在从云端获取作品...</div>
                ) : myBooks.length === 0 ? (
                    <div className="p-12 text-center text-gray-500">暂无作品，快去创建第一本书吧！</div>
                ) : (
                    myBooks.map((book) => (
                        <div key={book.id} className="p-6 flex flex-col md:flex-row gap-6 hover:bg-gray-50 transition group">
                            <div className="w-24 h-32 bg-gradient-to-br from-gray-200 to-gray-300 rounded-lg shadow-sm flex-shrink-0 flex items-center justify-center text-gray-500">
                                {book.cover_image ? <img src={book.cover_image} className="w-full h-full object-cover rounded-lg"/> : <BookOpen className="h-8 w-8 opacity-50" />}
                            </div>
                            <div className="flex-1 flex flex-col justify-between">
                                <div>
                                    <h4 className="text-xl font-bold text-gray-900 mb-1">{book.title}</h4>
                                    <p className="text-sm text-gray-500 mt-2 line-clamp-2">{book.description || '暂无简介'}</p>
                                </div>
                                <div className="flex gap-3 mt-4">
                                    <button 
                                        onClick={() => { setCurrentBookId(book.id); openChapterEditor('new'); }}
                                        className="flex items-center gap-1.5 px-4 py-2 bg-blue-50 text-blue-600 font-medium rounded-lg hover:bg-blue-100 transition"
                                    >
                                        <Upload className="h-4 w-4" /> 快速发布
                                    </button>
                                    <button 
                                        onClick={() => { setCurrentBookId(book.id); setShowBookManager(true); }}
                                        className="flex items-center gap-1.5 px-4 py-2 bg-gray-100 text-gray-700 font-medium rounded-lg hover:bg-gray-200 transition"
                                    >
                                        <Settings className="h-4 w-4" /> 管理/编辑
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
      </main>

      {/* 书籍管理器 */}
      {showBookManager && activeBook && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
           <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
              <div className="p-6 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
                 <h3 className="text-xl font-bold text-gray-900">{activeBook.title} - 目录管理</h3>
                 <button onClick={() => setShowBookManager(false)}><X className="h-5 w-5 text-gray-500" /></button>
              </div>
              <div className="flex-1 overflow-y-auto p-6 bg-white space-y-3">
                 {/* 渲染 activeChapters */}
                 {activeChapters.length === 0 ? (
                     <div className="text-center text-gray-400 py-8">暂无章节</div>
                 ) : (
                    activeChapters.map((chapter) => (
                        <div key={chapter.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-100 hover:border-blue-200 transition">
                            <div>
                                <p className="font-bold text-gray-900">{chapter.title}</p>
                            </div>
                            <div className="flex gap-2">
                                <button onClick={() => openChapterEditor('edit', chapter)} className="p-2 text-blue-600 hover:bg-blue-100 rounded-lg"><Edit3 className="h-4 w-4" /></button>
                                <button onClick={() => handleDeleteChapter(chapter.id)} className="p-2 text-red-600 hover:bg-red-100 rounded-lg"><Trash2 className="h-4 w-4" /></button>
                            </div>
                        </div>
                    ))
                 )}
              </div>
              <div className="p-4 bg-red-50 border-t border-red-100 flex justify-between items-center">
                 <span className="text-xs text-red-600 font-bold">⚠️ 危险操作区域</span>
                 <button onClick={handleDeleteBook} className="flex items-center gap-2 px-4 py-2 bg-white border border-red-200 text-red-600 text-sm font-medium rounded-lg hover:bg-red-600 hover:text-white transition"><Trash2 className="h-4 w-4" /> 删除本书</button>
              </div>
           </div>
        </div>
      )}

      {/* 章节编辑器 */}
      {showChapterEditor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in zoom-in-95 duration-200">
           <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl h-[90vh] flex flex-col overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center bg-white">
                 <div className="flex items-center gap-3">
                    <button onClick={() => setShowChapterEditor(false)} className="text-gray-400 hover:text-gray-600"><X className="h-6 w-6" /></button>
                    <h3 className="text-lg font-bold text-gray-900">{currentChapterId ? '编辑章节' : '发布新章节'}</h3>
                 </div>
                 <div className="flex items-center gap-3">
                    <button onClick={handleSaveDraft} className="flex items-center gap-2 px-5 py-2 bg-gray-100 text-gray-700 font-bold rounded-full hover:bg-gray-200 transition">
                        <Save className="h-4 w-4" /> 仅保存
                    </button>
                    <button onClick={handlePublishTrigger} className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white font-bold rounded-full hover:bg-blue-700 transition">
                        <Upload className="h-4 w-4" /> 发布
                    </button>
                 </div>
              </div>
              <div className="flex-1 overflow-y-auto bg-gray-50 p-8">
                 <div className="max-w-3xl mx-auto space-y-6">
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                       <input 
                            type="text" 
                            value={formChapterTitle}
                            onChange={(e) => setFormChapterTitle(e.target.value)}
                            className="w-full p-2 border-b-2 border-gray-200 focus:border-blue-600 outline-none text-xl font-bold text-gray-900 placeholder-gray-300 bg-transparent"
                            placeholder="请输入章节标题"
                       />
                    </div>
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col h-[60vh]">
                       <textarea 
                          value={formChapterContent}
                          onChange={(e) => setFormChapterContent(e.target.value)}
                          className="flex-1 w-full resize-none outline-none text-gray-900 font-medium text-lg leading-relaxed placeholder-gray-300 bg-transparent"
                          placeholder="在这里开始你的创作..."
                       ></textarea>
                    </div>
                 </div>
              </div>
           </div>
        </div>
      )}

      {/* 发布确认弹窗 */}
      {showPublishConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in zoom-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center">
                <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4 text-blue-600">
                    <Sparkles className="h-8 w-8" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">确认发布？</h3>
                <div className="flex gap-3">
                    <button onClick={() => setShowPublishConfirm(false)} className="flex-1 py-2.5 bg-gray-100 text-gray-700 font-bold rounded-xl">再想想</button>
                    <button onClick={handleConfirmPublish} className="flex-1 py-2.5 bg-blue-600 text-white font-bold rounded-xl">确认发布</button>
                </div>
            </div>
        </div>
      )}

      {/* 创建新书弹窗 */}
      {showCreateBookModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
           <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8">
              <h3 className="text-2xl font-bold mb-6 text-gray-900 flex items-center gap-2">
                 <Sparkles className="h-6 w-6 text-purple-500" /> 创建新作品
              </h3>
              <form onSubmit={handleCreateBook} className="space-y-6">
                 <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">书名</label>
                    <input 
                        type="text" 
                        value={formBookTitle}
                        onChange={(e) => setFormBookTitle(e.target.value)}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none text-gray-900 font-bold placeholder-gray-400" 
                        placeholder="书名" 
                        autoFocus 
                    />
                 </div>
                 <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">简介</label>
                    <textarea 
                        value={formBookDescription}
                        onChange={(e) => setFormBookDescription(e.target.value)}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none resize-none text-gray-900 font-medium h-32" 
                        placeholder="简介..."
                    ></textarea>
                 </div>
                 <div className="flex gap-4 mt-8">
                    <button type="button" onClick={() => setShowCreateBookModal(false)} className="flex-1 py-3 bg-gray-100 text-gray-700 font-bold rounded-xl">取消</button>
                    <button type="submit" className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 shadow-lg">立即创建</button>
                 </div>
              </form>
           </div>
        </div>
      )}

    </div>
  );
}