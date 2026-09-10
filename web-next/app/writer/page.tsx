'use client';
import { safeFetch as fetch } from '@/lib/request';


import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { 
  PenTool, BookOpen, BarChart3, 
  Plus, Upload, X, Edit3, Save, Settings, AlertCircle, CheckCircle2, Sparkles, Trash2,
  Shield, LogIn, Image as ImageIcon, Loader2, Ban, Unlock, Search, LayoutDashboard
} from 'lucide-react';
import { booksApi, chaptersApi, Book, Chapter } from '@/lib/api';
import Cropper from 'react-easy-crop';
import { getCroppedImg } from '@/lib/canvasUtils'; 

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

export default function WriterDashboard() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const LIMITS = { TITLE: 100, DESC: 500, CONTENT: 50000 };
  
  // ================= State 定义区域 =================
  
// 核心：视图控制 'works' | 'admin' | 'adminBooks'
  const [currentView, setCurrentView] = useState<'works' | 'admin' | 'adminBooks'>('works');

  // 作品相关
  const [myBooks, setMyBooks] = useState<Book[]>([]);
  const [worksPage, setWorksPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [activeChapters, setActiveChapters] = useState<Chapter[]>([]);
  const [savingChapter,setSavingChapter]=useState(false);
  const [publishDraftId,setPublishDraftId]=useState<string|null>(null);

  // 弹窗控制
  const [showCreateBookModal, setShowCreateBookModal] = useState(false);
  const [bookCreationKey,setBookCreationKey]=useState(()=>crypto.randomUUID());
  const [creatingBook,setCreatingBook]=useState(false);
  const [showChapterEditor, setShowChapterEditor] = useState(false);
  const [showBookManager, setShowBookManager] = useState(false);
  const [showPublishConfirm, setShowPublishConfirm] = useState(false);
  const [chapterToDelete, setChapterToDelete] = useState<string | null>(null);
  
  // 👮 管理员页面专用 State
  const [userList, setUserList] = useState<Array<{id:string;_id?:string;username:string;email:string;role:string;isBanned:boolean;created_at:string;weekly_score?:number;stats?:{today_views?:number;today_uploads?:number;history?:Array<{views?:number;uploads?:number}>}}>>([]); 
  const [adminSearch, setAdminSearch] = useState(''); // 搜索词
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminHotBooks, setAdminHotBooks] = useState<Book[]>([]);
  const [adminBookSearch, setAdminBookSearch] = useState('');
  const [adminBookSearchResults, setAdminBookSearchResults] = useState<Book[]>([]);
  const [adminBooksLoading, setAdminBooksLoading] = useState(false);
  const [adminBookSearchLoading, setAdminBookSearchLoading] = useState(false);
  const [bookManagerBook, setBookManagerBook] = useState<Book | null>(null);
  const [chapterSortOrder, setChapterSortOrder] = useState<'desc' | 'asc'>('desc'); 
  const [chapterSearchKeyword, setChapterSearchKeyword] = useState('');

  // 表单与选中项
  const [currentBookId, setCurrentBookId] = useState<string>('');
  const [currentChapterId, setCurrentChapterId] = useState<string | null>(null);
  const [formBookTitle, setFormBookTitle] = useState('');
  const [formBookDescription, setFormBookDescription] = useState('');
  const [formBookCategory, setFormBookCategory] = useState('玄幻');
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [formChapterTitle, setFormChapterTitle] = useState('');
  const [formChapterContent, setFormChapterContent] = useState('');
  
  const [toast, setToast] = useState<{msg: string, type: 'success' | 'info' | 'error'} | null>(null);

  // 封面上传
  const [uploading, setUploading] = useState(false);
  const [formBookCover, setFormBookCover] = useState('');
  const [newBookCoverFile, setNewBookCoverFile] = useState<File | null>(null);
  const [newBookCoverPreview, setNewBookCoverPreview] = useState('');
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<{x:number;y:number;width:number;height:number}|null>(null);
  const [cropperImgSrc, setCropperImgSrc] = useState<string | null>(null);
  const [isCroppingFor, setIsCroppingFor] = useState<'new' | 'edit' | null>(null);

  const ALL_CATEGORIES = ['玄幻', '仙侠', '都市', '历史', '科幻', '奇幻', '体育', '军事', '悬疑'];
  const visibleCategories = ALL_CATEGORIES.slice(0, 4);
  const hiddenCategories = ALL_CATEGORIES.slice(4);

  // ================= 逻辑函数 =================

    // 专门用于删除云端图片的函数
  const deleteImageFromCloudinary = async (imageUrl: string) => {
    if (!imageUrl || !imageUrl.includes('cloudinary')) return;
    try {
      await fetch(`/api/upload/cover`, {
        method: 'DELETE',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token') || ''}` 
        },
        body: JSON.stringify({ url: imageUrl }),
      });
    } catch (e) {
      console.error('删除云端旧图片失败', e);
    }
  };

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
    } catch (e) {
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
      const hotBookIds = new Set(adminHotBooks.map((book) => book.id));
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
  }, [user, adminHotBooks]);

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

  const uploadImageToCloudinary = async (file: File): Promise<string | null> => {
    try {
      setUploading(true);
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`/api/upload/cover`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token') || ''}`, 'x-user-id': user!.id },
        body: formData,
      });
      if (!res.ok) throw new Error('上传失败');
      const data = await res.json();
      return data.url;
    } catch (e) {
      setToast({ msg: '图片上传失败', type: 'error' });
      return null;
    } finally {
      setUploading(false);
    }
  };

  // ... 裁剪、登录等逻辑保持不变 (此处为了简洁省略，实际使用时请保留) ...
  const onSelectFile = (e: React.ChangeEvent<HTMLInputElement>, type: 'new' | 'edit') => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.addEventListener('load', () => {
        setCropperImgSrc(reader.result?.toString() || '');
        setIsCroppingFor(type);
        setZoom(1); setCrop({ x: 0, y: 0 });
      });
      reader.readAsDataURL(file);
    }
  };

  const onCropComplete = useCallback((croppedArea: {x:number;y:number;width:number;height:number}, croppedAreaPixels: {x:number;y:number;width:number;height:number}) => setCroppedAreaPixels(croppedAreaPixels), []);

const handleSaveCrop = async () => {
    if (!cropperImgSrc || !croppedAreaPixels) return;
    try {
      setUploading(true);
      const croppedBlob = await getCroppedImg(cropperImgSrc, croppedAreaPixels);
      if (!croppedBlob) throw new Error('Canvas create failed');
      const file = new File([croppedBlob], "cover.jpg", { type: "image/jpeg" });
      const url = await uploadImageToCloudinary(file);
      
      if (url) {
        if (isCroppingFor === 'new') {
          // 如果之前已经传过预览图了，现在又裁了一张新的，就把之前那张预览图删掉
          if (newBookCoverPreview) await deleteImageFromCloudinary(newBookCoverPreview);
          setNewBookCoverPreview(url);
          setToast({ msg: '裁剪并上传成功', type: 'success' });
        } else if (isCroppingFor === 'edit') {
          // 如果是在编辑书籍，覆盖前先把老封面删掉
          if (formBookCover) await deleteImageFromCloudinary(formBookCover);
          setFormBookCover(url);

          // 👇 新增核心逻辑：立刻把新封面 URL 保存到数据库
          if (currentBookId) {
              await booksApi.update(currentBookId, { cover_image: url });
              
              // 同步更新本地状态，防止后面点“保存修改”时被旧数据覆盖
              setBookManagerBook((prev) => prev ? { ...prev, cover_image: url } : prev);
              
              // 自动刷新外部列表数据，让外面的封面也立刻生效
              fetchMyData();
              if (user?.role === 'admin') {
                  fetchAdminHotBooks();
                  if (adminBookSearch.trim()) fetchAdminBookSearchResults(adminBookSearch);
              }
          }
          setToast({ msg: '封面已更新并自动保存', type: 'success' });
        }
      }
      setCropperImgSrc(null); setIsCroppingFor(null);
    } catch (e) { 
      setToast({ msg: '裁剪失败', type: 'error' });
    } finally { 
      setUploading(false); 
    }
  };

  // 影子登录
  const findBookById = useCallback((bookId: string) => {
    if (!bookId) return undefined;
    if (bookManagerBook?.id === bookId) return bookManagerBook;
    return myBooks.find((b) => b.id === bookId)
      || adminHotBooks.find((b) => b.id === bookId)
      || adminBookSearchResults.find((b) => b.id === bookId);
  }, [bookManagerBook, myBooks, adminHotBooks, adminBookSearchResults]);

  const activeBook = findBookById(currentBookId);

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
    } catch (e) { setToast({ msg: '网络错误', type: 'error' }); }
  };

  // 书籍章节逻辑 (省略重复代码，逻辑与之前一致) ...
  const openChapterEditor = async (type: 'new' | 'edit', chapter?: Chapter) => {
      setPublishDraftId(null);
      setToast(null);
      if (type === 'new') { setCurrentChapterId(null); setFormChapterTitle(''); setFormChapterContent(''); setShowChapterEditor(true); }
      else if (chapter) {
          setCurrentChapterId(chapter.id); setFormChapterTitle(chapter.title); setFormChapterContent('加载中...'); setShowChapterEditor(true);
          try {
              // ✅ 正确写法：带上 Token
            const token = localStorage.getItem('token'); // 获取登录凭证

            const res = await fetch(`/api/chapters/${chapter.id}`, {
            headers: {
                'Content-Type': 'application/json',
                // 如果有 token，就带上；没有就是空字符串（游客）
                'Authorization': token ? `Bearer ${token}` : ''
            }
            });
              if(!res.ok) throw new Error('err');
              const data = await res.json(); setFormChapterContent(data.content || '');
          } catch(e) { setFormChapterContent('加载失败'); }
      }
  };
  const saveChapterCore = async (status: 'ongoing' | 'completed') => {
      if(savingChapter)return false;
      if (!formChapterTitle.trim()) { setToast({msg:'标题为空', type:'error'}); return false;}
      if (formChapterTitle.length > LIMITS.TITLE) { setToast({msg:'标题过长', type:'error'}); return false;}
      if (formChapterContent.length > LIMITS.CONTENT) { setToast({msg:'正文过长', type:'error'}); return false;}
      setSavingChapter(true);
      try {
          let draftId=publishDraftId;
          if(!draftId||status==='ongoing'){
            const response=await fetch(`/api/books/${currentBookId}/draft`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:formChapterTitle,content:formChapterContent,targetChapterId:currentChapterId})});
            const draft=await response.json();if(!response.ok)throw new Error(draft.error||'草稿保存失败');
            draftId=draft.id;
          }
          if(status==='completed'){
            setPublishDraftId(draftId);
            const response=await fetch(`/api/books/${currentBookId}/draft/publish`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({draftId})});
            const chapter=await response.json();if(!response.ok)throw new Error(chapter.error||'发布失败，可重试');
            setCurrentChapterId(chapter.id);setPublishDraftId(null);
            fetchMyData();
            chaptersApi.getByBookId(currentBookId).then(setActiveChapters).catch(()=>setToast({msg:'发布成功，目录刷新失败，请重新打开管理',type:'error'}));
          }
          return true;
      } catch(e) { setToast({msg:e instanceof Error?e.message:'保存失败', type:'error'}); return false; }
      finally{setSavingChapter(false);}
  };
  const handleSaveDraft = async () => { if(await saveChapterCore('ongoing')) setToast({msg:'草稿已保存，仅本人可见', type:'success'}); };
  const continueDraft = async () => {
    try{
      const response=await fetch(`/api/books/${currentBookId}/draft`);const draft=await response.json();
      if(!response.ok)throw new Error(draft.error||'草稿读取失败');
      if(!draft){setToast({msg:'此作品暂无草稿',type:'success'});return;}
      setCurrentChapterId(draft.targetChapterId||null);setFormChapterTitle(draft.title);setFormChapterContent(draft.content);setPublishDraftId(null);setShowChapterEditor(true);
    }catch(e){setToast({msg:e instanceof Error?e.message:'草稿读取失败',type:'error'});}
  };
  const discardDraft = async () => {
    if(!confirm('确定放弃此作品的未发布草稿？已发布章节不受影响。'))return;
    try{const response=await fetch(`/api/books/${currentBookId}/draft`,{method:'DELETE'});if(!response.ok)throw new Error('草稿删除失败');setPublishDraftId(null);setToast({msg:'已放弃草稿',type:'success'});}catch(e){setToast({msg:e instanceof Error?e.message:'草稿删除失败',type:'error'});}
  };
  const handlePublishTrigger = () => { if(!formChapterTitle.trim()) return; setShowPublishConfirm(true); };
  const handleConfirmPublish = async () => { if(await saveChapterCore('completed')) { setShowPublishConfirm(false); setShowChapterEditor(false); setToast({msg:'发布成功', type:'success'}); }};
  const handleDeleteChapter = (cid: string) => setChapterToDelete(cid);
  const executeDeleteChapter = async () => { if(!chapterToDelete) return; await chaptersApi.delete(chapterToDelete); setActiveChapters(prev => prev.filter(c => c.id !== chapterToDelete)); setChapterToDelete(null); setToast({msg:'删除成功', type:'success'}); };
  const handleCreateBook = async (e: React.FormEvent) => {
      e.preventDefault();
      if(!formBookTitle.trim() || !user || creatingBook) return;
      setCreatingBook(true);
      try {
          let url = '';
          if(newBookCoverPreview.startsWith('/api/media/')) url = newBookCoverPreview;
          else if(newBookCoverFile) { const u = await uploadImageToCloudinary(newBookCoverFile); if(u) {url=u;setNewBookCoverPreview(u);} else return; }
          await booksApi.create({ title: formBookTitle, description: formBookDescription, cover_image: url, category: formBookCategory, author: user.username, author_id: user.id },bookCreationKey);
          setShowCreateBookModal(false); setFormBookTitle(''); setFormBookDescription(''); setFormBookCategory(ALL_CATEGORIES[0]); setNewBookCoverFile(null); setNewBookCoverPreview('');
          setToast({msg:'创建成功', type:'success'}); fetchMyData();
      } catch(e) { setToast({msg:e instanceof Error?e.message:'创建失败', type:'error'}); }
      finally{setCreatingBook(false);}
  };
  const handleUpdateBook = async () => {
    if (!currentBookId) return;
    await booksApi.update(currentBookId, {
      title: formBookTitle,
      description: formBookDescription,
      cover_image: formBookCover
    });
    setBookManagerBook((prev) => prev ? {
      ...prev,
      title: formBookTitle,
      description: formBookDescription,
      cover_image: formBookCover
    } : prev);
    setToast({ msg: '保存成功', type: 'success' });
    fetchMyData();
    if (user?.role === 'admin') {
      fetchAdminHotBooks();
      if (adminBookSearch.trim()) fetchAdminBookSearchResults(adminBookSearch);
    }
  };

  const handleDeleteBook = async () => {
    const book = activeBook;
    if (!book) return;
    const n = prompt('输入书名确认删除:');
    if (n !== book.title) return;

    await booksApi.delete(currentBookId);
    setShowBookManager(false);
    setBookManagerBook(null);
    setAdminHotBooks((prev) => prev.filter((b) => b.id !== currentBookId));
    setAdminBookSearchResults((prev) => prev.filter((b) => b.id !== currentBookId));
    fetchMyData();
    if (user?.role === 'admin') {
      fetchAdminHotBooks();
      if (adminBookSearch.trim()) fetchAdminBookSearchResults(adminBookSearch);
    }
    setToast({ msg: '删除成功', type: 'success' });
  };

  const getBookAuthorName = (book: Book) => {
    if (typeof book.author === 'string' && book.author.trim()) return book.author;
    if (book.author_id && typeof book.author_id === 'object' && 'username' in book.author_id) {
      return (book.author_id as {username?:string;_id?:string;id?:string}).username || '未知作者';
    }
    return '未知作者';
  };

const openBookManager = (book: Book) => {
  setActiveChapters([]); // 👇 第一时间清空旧数据，杜绝幽灵章节
  setChapterSearchKeyword(''); // 👇 重置搜索词
  setChapterSortOrder('desc'); // 👇 默认恢复倒序
  
  setCurrentBookId(book.id);
  setBookManagerBook(book);
  setFormBookTitle(book.title);
  setFormBookDescription(book.description || '');
  setFormBookCover(book.cover_image || '');
  setShowBookManager(true);
};

  // Effect
  useEffect(() => {
    if (authLoading) return;
    if (!user) router.replace('/login');
    else fetchMyData();
  }, [user, authLoading, router, fetchMyData]);

  useEffect(() => {
    if (showBookManager && currentBookId) {
        const book = findBookById(currentBookId);
        if (book) { setFormBookCover(book.cover_image || ''); setFormBookTitle(book.title); setFormBookDescription(book.description || ''); }
        chaptersApi.getByBookId(currentBookId).then(setActiveChapters).catch(console.error);
    }
  }, [showBookManager, currentBookId, findBookById]);

  useEffect(() => {
    if (!showBookManager) setBookManagerBook(null);
  }, [showBookManager]);

  useEffect(() => { if(toast) { const t = setTimeout(()=>setToast(null),3000); return ()=>clearTimeout(t); } }, [toast]);

  if (authLoading || !user) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-blue-600"/></div>;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col md:flex-row font-sans">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-[110] animate-in fade-in slide-in-from-top-4">
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
      <main className="flex-1 md:ml-64 p-4 md:p-8 pb-20 md:pb-8">
        
        {/* 1. 作品管理视图 */}
        {currentView === 'works' && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden min-h-[80vh] md:min-h-0 animate-in fade-in">
                <div className="p-4 md:p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50 md:bg-white">
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
                            <div key={book.id} className="p-4 md:p-6 flex gap-4 md:gap-6 hover:bg-gray-50 transition group items-start">
                                <div className="w-20 aspect-[3/4] h-auto md:w-24 md:aspect-[3/4] bg-gray-200 rounded-md md:rounded-lg shadow-sm flex-shrink-0 flex items-center justify-center text-gray-400 overflow-hidden relative">
                                    {book.cover_image ? <img src={book.cover_image} className="w-full h-full object-cover" /> : <BookOpen className="h-8 w-8 opacity-50" />}
                                </div>
                                <div className="flex-1 flex flex-col justify-between min-h-[7rem] md:min-h-[8rem]">
                                    <div>
                                        <div className="flex justify-between items-start">
                                            <h4 className="text-base md:text-xl font-bold text-gray-900 mb-1 line-clamp-1">{book.title}</h4>
                                            <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full md:hidden">{book.category || '未分类'}</span>
                                        </div>
                                        <p className="text-xs md:text-sm text-gray-500 mt-1 line-clamp-2">{book.description || '暂无简介'}</p>
                                    </div>
                                    <div className="flex gap-2 md:gap-3 mt-3">
                                        <button onClick={() => { setCurrentBookId(book.id); openChapterEditor('new'); }} className="w-32 flex items-center justify-center gap-1 px-3 py-2 bg-white text-blue-600 text-sm font-bold rounded-lg border border-blue-100 shadow-sm hover:bg-blue-50 hover:border-blue-300 hover:shadow-md active:scale-95 transition-all cursor-pointer"
                                        >
                                            <Upload className="h-3 w-3 md:h-4 md:w-4" /> <span>快速发布</span>
                                        </button>
                                        <button onClick={() => openBookManager(book)} className="w-32 flex items-center justify-center gap-1 px-3 py-2 bg-white text-gray-700 text-sm font-bold rounded-lg border border-gray-200 shadow-sm hover:bg-gray-50 hover:border-gray-300 hover:shadow-md active:scale-95 transition-all cursor-pointer"
                                        >
                                            <Settings className="h-3 w-3 md:h-4 md:w-4" /> <span>管理</span>
                                        </button>
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
                                        {book.cover_image ? <img src={book.cover_image} className="w-full h-full object-cover" /> : <BookOpen className="h-8 w-8 opacity-50" />}
                                    </div>
                                    <div className="flex-1 flex flex-col justify-between min-h-[7rem] md:min-h-[8rem]">
                                        <div>
                                            <div className="flex justify-between items-start gap-3">
                                                <h4 className="text-base md:text-xl font-bold text-gray-900 mb-1 line-clamp-1">{book.title}</h4>
                                                <span className="text-[11px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">今日热度 {book.daily_views || 0}</span>
                                            </div>
                                            <p className="text-xs md:text-sm text-gray-500 mt-1 line-clamp-2">{book.description || '暂无简介'}</p>
                                            <p className="text-xs text-gray-400 mt-1">作者：{getBookAuthorName(book)}</p>
                                        </div>
                                        <div className="flex gap-2 md:gap-3 mt-3">
                                            <button onClick={() => { setCurrentBookId(book.id); openChapterEditor('new'); }} className="w-32 flex items-center justify-center gap-1 px-3 py-2 bg-white text-blue-600 text-sm font-bold rounded-lg border border-blue-100 shadow-sm hover:bg-blue-50 hover:border-blue-300 hover:shadow-md active:scale-95 transition-all cursor-pointer">
                                                <Upload className="h-3 w-3 md:h-4 md:w-4" /> <span>快速发布</span>
                                            </button>
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
                                        {book.cover_image ? <img src={book.cover_image} className="w-full h-full object-cover" /> : <BookOpen className="h-8 w-8 opacity-50" />}
                                    </div>
                                    <div className="flex-1 flex flex-col justify-between min-h-[7rem] md:min-h-[8rem]">
                                        <div>
                                            <h4 className="text-base md:text-xl font-bold text-gray-900 mb-1 line-clamp-1">{book.title}</h4>
                                            <p className="text-xs md:text-sm text-gray-500 mt-1 line-clamp-2">{book.description || '暂无简介'}</p>
                                            <p className="text-xs text-gray-400 mt-1">作者：{getBookAuthorName(book)} / 今日热度：{book.daily_views || 0}</p>
                                        </div>
                                        <div className="flex gap-2 md:gap-3 mt-3">
                                            <button onClick={() => { setCurrentBookId(book.id); openChapterEditor('new'); }} className="w-32 flex items-center justify-center gap-1 px-3 py-2 bg-white text-blue-600 text-sm font-bold rounded-lg border border-blue-100 shadow-sm hover:bg-blue-50 hover:border-blue-300 hover:shadow-md active:scale-95 transition-all cursor-pointer">
                                                <Upload className="h-3 w-3 md:h-4 md:w-4" /> <span>快速发布</span>
                                            </button>
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

      {/* ===================== 弹窗区域 (保持不变) ===================== */}
      {/* 1. 书籍管理器 */}
{/* 5. 书籍管理器 (大修：强制两列 + 宽屏 + 强交互) */}
      {/* 5. 书籍管理器 (终极修正：章节双列 + 默认收起 + 鼠标手势) */}
      {showBookManager && activeBook && (
        <div className="fixed inset-0 z-40 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm p-0 md:p-4 animate-in fade-in duration-200">
           {/* 弹窗宽度 max-w-5xl 保证够宽 */}
           <div className="bg-white rounded-t-2xl md:rounded-2xl shadow-2xl w-full max-w-5xl h-[90vh] md:max-h-[85vh] flex flex-col overflow-hidden animate-in slide-in-from-bottom-10 md:slide-in-from-bottom-0">
              
              {/* 顶部标题栏 */}
              <div className="p-4 md:p-6 border-b border-gray-100 bg-gray-50 flex justify-between items-center shrink-0">
                 <div>
                    <h3 className="text-lg md:text-xl font-bold text-gray-900 truncate max-w-[200px]">{activeBook.title}</h3>
                    <p className="text-xs text-gray-500">目录与设置</p>
                 </div>
                 <button onClick={() => setShowBookManager(false)} className="p-2 bg-gray-200 hover:bg-gray-300 rounded-full transition-colors cursor-pointer"><X className="h-5 w-5 text-gray-600" /></button>
              </div>

              {/* 中间滚动区 */}
              <div className="flex-1 overflow-y-auto p-4 md:p-8 bg-white space-y-6">
                
                 {/* 🔴 问题2修复：删掉了 open 属性，默认收起！ */}
                 <details className="group bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                    {/* 🔴 问题1修复：强制加上 cursor-pointer，鼠标放上去必变小手 */}
                    <summary className="flex items-center justify-between p-4 cursor-pointer list-none select-none bg-gray-50 hover:bg-blue-50 transition-colors group-open:bg-blue-50/50">
                        <span className="text-base font-extrabold text-gray-900 flex items-center gap-2">
                            <Settings className="h-5 w-5 text-blue-600" /> 书籍信息设置 
                            <span className="text-xs font-normal text-gray-500 group-open:hidden">(点击展开)</span>
                        </span>
                        <div className="transition-transform duration-200 group-open:rotate-180 text-gray-400">▼</div>
                    </summary>
                    
                    <div className="p-6 border-t border-gray-100 bg-white animate-in slide-in-from-top-2 duration-200">
                        <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-8">
                            
                        {/* 左侧：封面修改区 (已添加删除功能) */}
                        <div className="flex flex-col items-center gap-3">
                            <div className="w-40 h-56 bg-gray-100 rounded-lg border-2 border-dashed border-gray-300 overflow-hidden relative group shadow-sm hover:border-blue-500 transition-all cursor-pointer">  
                                
                                {/* 1. 加载中状态 */}
                                {uploading ? (
                                    <div className="absolute inset-0 flex items-center justify-center bg-gray-50">
                                        <Loader2 className="h-8 w-8 text-blue-600 animate-spin" />
                                    </div>
                                ) : formBookCover ? (
                                    // 2. 有封面时显示图片
                                    <>
                                        <img src={formBookCover} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                                        
                                        {/* ✅ 新增：删除封面按钮 (右上角红色垃圾桶) */}
                                        <button
                                            type="button"
                                            onClick={async (e) => {
                                                e.stopPropagation(); // 防止触发上传
                                                e.preventDefault();
                                                if (confirm('确定要移除这张封面吗？(图片将从云端永久删除)')) {
                                                    setUploading(true); // 开启 loading
                                                    await deleteImageFromCloudinary(formBookCover); // 呼叫后端删除图片
                                                    setFormBookCover(''); // 清空前端状态

                                                    // 👇 新增核心逻辑：云端图片删除后，立刻把数据库里的封面也清空
                                                    if (currentBookId) {
                                                        await booksApi.update(currentBookId, { cover_image: '' });
                                                        setBookManagerBook((prev) => prev ? { ...prev, cover_image: '' } : prev);
                                                        
                                                        // 同步刷新外部列表
                                                        fetchMyData();
                                                        if (user?.role === 'admin') {
                                                            fetchAdminHotBooks();
                                                            if (adminBookSearch.trim()) fetchAdminBookSearchResults(adminBookSearch);
                                                        }
                                                    }

                                                    setUploading(false); // 关闭 loading
                                                    setToast({ msg: '封面已移除', type: 'success' });
                                                }
                                            }}
                                            className="absolute top-2 right-2 z-20 p-2 bg-red-600/90 text-white rounded-full hover:bg-red-700 shadow-sm opacity-0 group-hover:opacity-100 transition-all hover:scale-110"
                                            title="移除封面"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </>
                                ) : (
                                    // 3. 无封面时显示占位符
                                    <div className="w-full h-full flex flex-col items-center justify-center text-gray-400">
                                        <ImageIcon className="h-10 w-10 mb-2 opacity-50" />
                                        <span className="text-xs font-medium">暂无封面</span>
                                    </div>
                                )}
                                
                                {/* 4. 覆盖层：点击上传/裁剪 (z-10 保证在图片之上，但在删除按钮之下) */}
                                <label className="absolute inset-0 z-10 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col items-center justify-center cursor-pointer text-white">
                                    {/* 如果有删除按钮，稍微往下挪一点，避开右上角 */}
                                    <div className="flex flex-col items-center transform translate-y-2">
                                        <Upload className="h-8 w-8 mb-2 animate-bounce" />
                                        <span className="text-sm font-bold">点击更换</span>
                                    </div>
                                    {/* ⚠️ 记得检查这里是不是 onSelectFile ！ */}
                                    <input type="file" className="hidden" accept="image/*" onChange={(e) => onSelectFile(e, 'edit')} />
                                </label>
                            </div>
                            <p className="text-xs text-gray-400">支持 JPG, PNG (推荐 3:4)</p>
                        </div>

                            {/* 右侧：表单区 */}
                            <div className="space-y-5">
                                <div>
                                    <label className="text-sm font-bold text-gray-700 mb-1.5 block">书名</label>
                                    <input 
                                        value={formBookTitle}
                                        onChange={(e) => setFormBookTitle(e.target.value)}
                                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 font-bold text-lg outline-none focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all hover:bg-white hover:border-gray-300"
                                    />
                                </div>
                                <div>
                                    <label className="text-sm font-bold text-gray-700 mb-1.5 block">简介</label>
                                    <textarea 
                                        value={formBookDescription}
                                        onChange={(e) => setFormBookDescription(e.target.value)}
                                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 text-sm font-medium outline-none focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all hover:bg-white hover:border-gray-300 h-32 resize-none leading-relaxed"
                                        placeholder="请输入简介..."
                                    />
                                </div>
                                <div className="flex justify-end pt-2">
                                    <button 
                                        onClick={handleUpdateBook}
                                        disabled={uploading}
                                        className="px-8 py-3 bg-blue-600 text-white text-sm font-bold rounded-xl hover:bg-blue-700 hover:shadow-lg hover:shadow-blue-500/30 hover:-translate-y-0.5 active:scale-95 transition-all disabled:opacity-50 flex items-center gap-2 cursor-pointer"
                                    >
                                        <Save className="h-4 w-4" />
                                        保存所有修改
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                 </details>

                 {/* 章节列表标题与操作区 */}
                 <div className="flex flex-col md:flex-row items-start md:items-center justify-between px-1 mb-4 gap-3">
                    <h4 className="font-bold text-gray-900 text-lg shrink-0">章节列表 ({activeChapters.length})</h4>
                    <button onClick={continueDraft} className="text-sm text-blue-600">继续草稿</button>
                    <button onClick={discardDraft} className="text-sm text-gray-500">放弃草稿</button>
                    <div className="flex items-center gap-2 w-full md:w-auto">
                        {/* 章节搜索框 */}
                        <div className="relative flex-1 md:w-48">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                            <input
                                type="text"
                                placeholder="搜索章节..."
                                value={chapterSearchKeyword}
                                onChange={(e) => setChapterSearchKeyword(e.target.value)}
                                className="w-full pl-8 pr-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                            />
                        </div>
                        {/* 排序切换按钮 */}
                        <button
                            onClick={() => setChapterSortOrder(prev => prev === 'desc' ? 'asc' : 'desc')}
                            className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 hover:text-gray-900 transition-colors flex items-center justify-center shrink-0 text-sm font-bold cursor-pointer"
                        >
                            {chapterSortOrder === 'desc' ? '倒序 ↓' : '正序 ↑'}
                        </button>
                    </div>
                 </div>

                 {/* 章节渲染区 (加入了动态过滤和排序逻辑) */}
                 {(() => {
                    // 1. 过滤 & 排序
                    const displayChapters = activeChapters
                        .filter(c => c.title.toLowerCase().includes(chapterSearchKeyword.toLowerCase()))
                        .sort((a, b) => {
                            const numA = a.chapter_number || 0;
                            const numB = b.chapter_number || 0;
                            return chapterSortOrder === 'desc' ? numB - numA : numA - numB;
                        });

                    return (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {displayChapters.length === 0 ? (
                                <div className="col-span-full text-center text-gray-400 py-12 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                                    {activeChapters.length === 0 ? '加载中或暂无章节...' : '未搜索到匹配的章节'}
                                </div>
                            ) : (
                                displayChapters.map((chapter) => (
                                    <div key={chapter.id} className="group flex items-center justify-between p-4 bg-white hover:bg-blue-50 rounded-xl border border-gray-100 hover:border-blue-200 transition-all shadow-sm hover:shadow-md cursor-default">
                                        <div className="flex-1 mr-4 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <p className="font-bold text-gray-900 text-sm md:text-base truncate group-hover:text-blue-700 transition-colors">
                                                    {chapter.title}
                                                </p>
                                            </div>
                                            <p className="text-xs text-gray-400 mt-1 pl-1">字数: {chapter.word_count || 0}</p>
                                        </div>
                                        <div className="flex gap-2 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                            <button aria-label={`编辑章节：${chapter.title}`} onClick={() => openChapterEditor('edit', chapter)} className="p-2 bg-white border border-gray-200 text-blue-600 rounded-lg hover:bg-blue-600 hover:text-white transition-all hover:scale-105 shadow-sm cursor-pointer">
                                                <Edit3 className="h-4 w-4" />
                                            </button>
                                            <button aria-label={`删除章节：${chapter.title}`} onClick={() => handleDeleteChapter(chapter.id)} className="p-2 bg-white border border-gray-200 text-red-600 rounded-lg hover:bg-red-600 hover:text-white transition-all hover:scale-105 shadow-sm cursor-pointer">
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    );
                 })()}
              </div>

              {/* 底部危险区 */}
              <div className="p-4 bg-red-50 border-t border-red-100 flex justify-between items-center pb-8 md:pb-4 shrink-0">
                 <span className="text-xs text-red-600 font-bold flex items-center gap-1">
                     <AlertCircle className="h-4 w-4" /> 危险区域
                 </span>
                 <button onClick={handleDeleteBook} className="flex items-center gap-1 md:gap-2 px-4 py-2 bg-white border border-red-200 text-red-600 text-xs md:text-sm font-medium rounded-lg hover:bg-red-600 hover:text-white hover:shadow-red-500/20 active:scale-95 transition-all cursor-pointer">
                     <Trash2 className="h-3 w-3 md:h-4 md:w-4" /> 删除本书
                 </button>
              </div>
           </div>
        </div>
      )} 

        {/* 2. 章节编辑器 */}
      {showChapterEditor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white md:bg-black/60 md:backdrop-blur-sm p-0 md:p-4 animate-in zoom-in-95 duration-200">
           <div className="bg-white w-full h-full md:rounded-2xl md:shadow-2xl md:max-w-5xl md:h-[90vh] flex flex-col overflow-hidden">
              {/* 🟢 修复：补回丢失的顶部操作栏 (关闭、标题、发布按钮) */}
              <div className="px-4 py-3 md:px-6 md:py-4 border-b border-gray-200 flex justify-between items-center bg-white shrink-0">
                 <div className="flex items-center gap-2 md:gap-3">
                    {/* 关闭按钮 */}
                    <button 
                        onClick={() => setShowChapterEditor(false)} 
                        className="p-1 -ml-2 text-gray-500 active:bg-gray-100 hover:bg-gray-100 rounded-full transition-colors cursor-pointer"
                        title="关闭"
                    >
                        <X className="h-6 w-6" />
                    </button>
                    <h3 className="text-base md:text-lg font-bold text-gray-900">
                        {currentChapterId ? '编辑章节' : '新建章节'}
                    </h3>
                 </div>
                 
                 {/* 右侧按钮组 */}
                 <div className="flex items-center gap-2 md:gap-3">
                    <button 
                        onClick={handleSaveDraft} 
                        aria-label="存草稿" disabled={savingChapter}
                        className="flex items-center gap-1 md:gap-2 px-3 py-1.5 md:px-5 md:py-2 bg-gray-100 text-gray-700 text-sm md:text-base font-bold rounded-full active:bg-gray-200 hover:bg-gray-200 transition cursor-pointer"
                    >
                        <Save className="h-4 w-4" /> <span className="hidden md:inline">存草稿</span>
                    </button>
                    <button 
                        onClick={handlePublishTrigger} 
                        disabled={savingChapter}
                        className="flex items-center gap-1 md:gap-2 px-4 py-1.5 md:px-6 md:py-2 bg-blue-600 text-white text-sm md:text-base font-bold rounded-full active:bg-blue-700 hover:bg-blue-700 transition shadow-lg shadow-blue-500/30 cursor-pointer"
                    >
                        <Upload className="h-4 w-4" /> 发布
                    </button>
                 </div>
              </div>
              {/* 🟢 修复结束 */}
              
              <div className="flex-1 overflow-y-auto bg-gray-50 md:bg-gray-50/50 p-0 md:p-8">
                 <div className="max-w-3xl mx-auto h-full flex flex-col md:space-y-6 bg-white md:bg-transparent">
                    
                    {/* 🛡️ 标题区域 */}
                    <div className="bg-white p-4 md:p-6 md:rounded-xl md:shadow-sm md:border md:border-gray-100 shrink-0 relative group">
                       <input 
                            type="text" 
                            value={formChapterTitle}
                            // 1. 原生限制输入长度
                            maxLength={LIMITS.TITLE} 
                            onChange={(e) => {setFormChapterTitle(e.target.value);setPublishDraftId(null);}}
                            className="w-full p-2 border-b-2 border-gray-100 focus:border-blue-600 outline-none text-lg md:text-xl font-bold text-gray-900 placeholder-gray-300 bg-transparent transition-colors pr-16" // pr-16 留出空间
                            placeholder="请输入章节标题"
                       />
                       {/* 2. 标题字数提示 (输入时显示) */}
                       <span className="absolute right-6 bottom-8 text-xs text-gray-400 font-mono pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
                           {formChapterTitle.length}/{LIMITS.TITLE}
                       </span>
                    </div>

                    {/* 🛡️ 正文区域 */}
                    <div className="bg-white p-4 md:p-6 md:rounded-xl md:shadow-sm md:border md:border-gray-100 flex-1 flex flex-col min-h-[50vh] relative">
                       <textarea 
                          value={formChapterContent}
                          onChange={(e) => {setFormChapterContent(e.target.value);setPublishDraftId(null);}}
                          // 注意：这里我不建议加 maxLength={LIMITS.CONTENT} 到 textarea 上，
                          // 因为浏览器处理大文本的 maxLength 会卡顿。最好是用下面的“超量变红”来提示。
                          className="flex-1 w-full resize-none outline-none text-gray-800 font-normal text-base md:text-lg leading-loose placeholder-gray-300 bg-transparent pb-8" // pb-8 留底部空间
                          placeholder="在这里开始你的创作..."
                       ></textarea>

                       {/* 3. 正文实时字数统计仪表盘 */}
                       <div className={`absolute bottom-4 right-6 text-xs font-bold transition-colors duration-300 ${
                           formChapterContent.length > LIMITS.CONTENT * 0.9 
                             ? 'text-red-500' // 接近上限变红
                             : 'text-gray-300'
                       }`}>
                           <span className="font-mono">
                               {formChapterContent.length}
                           </span> 
                           <span className="mx-1">/</span>
                           <span>{LIMITS.CONTENT}</span>
                           
                           {/* 如果超长，显示警告图标 */}
                           {formChapterContent.length > LIMITS.CONTENT && (
                               <span className="ml-2 inline-flex items-center gap-1 bg-red-100 text-red-600 px-2 py-0.5 rounded-full">
                                   <AlertCircle className="h-3 w-3" /> 字数超限
                               </span>
                           )}
                       </div>
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
                    <button disabled={savingChapter} onClick={handleConfirmPublish} className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl active:bg-blue-700">确认发布</button>
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
    
                {/* 1. 封面上传区 */}
                <div className="flex justify-center">
                    <label className="relative cursor-pointer group">
                        <div className="w-28 h-36 bg-gray-100 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center overflow-hidden hover:border-blue-500 transition">
                            {newBookCoverPreview ? (
                                <img src={newBookCoverPreview} className="w-full h-full object-cover" />
                            ) : (
                                <div className="text-center text-gray-400">
                                    <ImageIcon className="h-8 w-8 mx-auto mb-1" />
                                    <span className="text-xs">上传封面</span>
                                </div>
                            )}
                            <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                                <Upload className="h-6 w-6 text-white" />
                            </div>
                        </div>
                        <input 
                            type="file" 
                            className="hidden" 
                            accept="image/*"
                            onChange={(e) => onSelectFile(e, 'edit')}
                        />
                    </label>
                </div>

                {/* 2. 书名输入 (已优化：添加字数统计与限制) */}
                <div>
                    <div className="flex justify-between items-center mb-2">
                        <label className="block text-sm font-bold text-gray-700">书名</label>
                        {/* 右侧计数器：平时灰色，超限变红 */}
                        <span className={`text-xs font-mono transition-colors ${
                            formBookTitle.length >= LIMITS.TITLE ? 'text-red-500 font-bold' : 'text-gray-400'
                        }`}>
                            {formBookTitle.length} / {LIMITS.TITLE}
                        </span>
                    </div>
                    <input 
                        type="text" 
                        value={formBookTitle}
                        maxLength={LIMITS.TITLE} // 🛡️ 硬限制
                        onChange={(e) => setFormBookTitle(e.target.value)}
                        // 👇 保持原有的 className 完全不变
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none text-gray-900 font-bold placeholder-gray-400 transition-all" 
                        placeholder="请输入书名" 
                    />
                </div>

                {/* ... 中间的分类选择代码保持不变 ... */}

                {/* 4. 简介输入 (已优化：添加字数统计与限制) */}
                <div>
                    <div className="flex justify-between items-center mb-2">
                        <label className="block text-sm font-bold text-gray-700">简介</label>
                        {/* 右侧计数器 */}
                        <span className={`text-xs font-mono transition-colors ${
                            formBookDescription.length >= LIMITS.DESC ? 'text-red-500 font-bold' : 'text-gray-400'
                        }`}>
                            {formBookDescription.length} / {LIMITS.DESC}
                        </span>
                    </div>
                    <textarea 
                        value={formBookDescription}
                        maxLength={LIMITS.DESC} // 🛡️ 硬限制
                        onChange={(e) => setFormBookDescription(e.target.value)}
                        // 👇 保持原有的 className 完全不变
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none resize-none text-gray-900 font-medium h-24 md:h-32 transition-all" 
                        placeholder="简单介绍一下你的故事..."
                    ></textarea>
                </div>
                {/* 5. 底部按钮 */}
                <div className="flex gap-4 mt-8 pb-safe md:pb-0">
                    <button type="button" onClick={() => setShowCreateBookModal(false)} className="flex-1 py-3 bg-gray-100 text-gray-700 font-bold rounded-xl active:bg-gray-200">取消</button>
                    <button type="submit" disabled={uploading} className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl active:bg-blue-700 shadow-lg flex justify-center items-center gap-2">
                        {uploading && <Loader2 className="h-4 w-4 animate-spin" />}
                        {uploading ? '上传中...' : '立即创建'}
                    </button>
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



    {/* ================= 裁剪器弹窗 ================= */}
      {cropperImgSrc && (
        <div className="fixed inset-0 z-[100] bg-black/90 flex flex-col animate-in fade-in duration-200">
            {/* 顶部操作栏 */}
            <div className="flex justify-between items-center p-4 text-white z-10 bg-black/50">
                <button onClick={() => setCropperImgSrc(null)} className="flex items-center gap-1 text-gray-300 hover:text-white">
                    <X className="h-6 w-6" /> 取消
                </button>
                <h3 className="font-bold">调整封面 (3:4)</h3>
                <button 
                    onClick={handleSaveCrop} 
                    disabled={uploading}
                    className="px-4 py-1.5 bg-blue-600 rounded-full font-bold hover:bg-blue-500 disabled:opacity-50 flex items-center gap-2"
                >
                    {uploading && <Loader2 className="h-4 w-4 animate-spin" />}
                    确定
                </button>
            </div>

            {/* 裁剪区域 */}
            <div className="relative flex-1 bg-black w-full h-full overflow-hidden">
                <Cropper
                    image={cropperImgSrc}
                    crop={crop}
                    zoom={zoom}
                    aspect={3 / 4} // 👈 锁定 3:4 比例 (适合小说封面)
                    onCropChange={setCrop}
                    onCropComplete={onCropComplete}
                    onZoomChange={setZoom}
                    classes={{
                        containerClassName: 'h-full w-full',
                    }}
                />
            </div>

            {/* 底部滑块 */}
            <div className="p-6 bg-black/80 flex items-center justify-center gap-4 z-10 pb-10 md:pb-6">
                <span className="text-xs text-gray-400 font-bold">缩放</span>
                <input
                    type="range"
                    value={zoom}
                    min={1}
                    max={3}
                    step={0.1}
                    aria-labelledby="Zoom"
                    onChange={(e) => setZoom(Number(e.target.value))}
                    className="w-64 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
            </div>
        </div>
      )}
    </div>
  );
}
