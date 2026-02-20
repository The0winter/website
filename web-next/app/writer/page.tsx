'use client';

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

// ================= 杩蜂綘鏇茬嚎鍥剧粍锟?(绾疭VG瀹炵幇锛岄浂渚濊禆) =================
const MiniChart = ({ data, color = "#3b82f6" }: { data: number[], color?: string }) => {
    if (!data || data.length < 2) return <div className="text-[10px] text-gray-300">鏁版嵁涓嶈冻</div>;
    
    const max = Math.max(...data, 1);
    const height = 24; // 楂樺害 24px
    const width = 60;  // 瀹藉害 60px
    const step = width / (data.length - 1);
    
    // 鐢熸垚 SVG 璺緞
    const points = data.map((val, i) => {
        const x = i * step;
        const y = height - (val / max) * height;
        return `${x},${y}`;
    }).join(' ');

    return (
        <svg width={width} height={height} className="overflow-visible">
            {/* 鎶樼嚎 */}
            <polyline fill="none" stroke={color} strokeWidth="1.5" points={points} strokeLinecap="round" strokeLinejoin="round" />
            {/* 鏈€鍚庝竴涓偣鐨勫渾锟?*/}
            <circle cx={width} cy={height - (data[data.length-1] / max) * height} r="2" fill={color} />
        </svg>
    );
};

export default function WriterDashboard() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const LIMITS = { TITLE: 100, DESC: 500, CONTENT: 50000 };
  
  // ================= State 瀹氫箟鍖哄煙 =================
  
// 鏍稿績锛氳鍥炬帶锟?'works' | 'admin' | 'adminBooks'
  const [currentView, setCurrentView] = useState<'works' | 'admin' | 'adminBooks'>('works');

  // 浣滃搧鐩稿叧
  const [myBooks, setMyBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeChapters, setActiveChapters] = useState<Chapter[]>([]);

  // 寮圭獥鎺у埗
  const [showCreateBookModal, setShowCreateBookModal] = useState(false);
  const [showChapterEditor, setShowChapterEditor] = useState(false);
  const [showBookManager, setShowBookManager] = useState(false);
  const [showPublishConfirm, setShowPublishConfirm] = useState(false);
  const [chapterToDelete, setChapterToDelete] = useState<string | null>(null);
  
  // 馃懏 绠＄悊鍛橀〉闈笓锟?State
  const [userList, setUserList] = useState<any[]>([]); 
  const [adminSearch, setAdminSearch] = useState(''); // 鎼滅储锟?
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminHotBooks, setAdminHotBooks] = useState<Book[]>([]);
  const [adminBookSearch, setAdminBookSearch] = useState('');
  const [adminBookSearchResults, setAdminBookSearchResults] = useState<Book[]>([]);
  const [adminBooksLoading, setAdminBooksLoading] = useState(false);
  const [adminBookSearchLoading, setAdminBookSearchLoading] = useState(false);
  const [bookManagerBook, setBookManagerBook] = useState<Book | null>(null);

  // 琛ㄥ崟涓庨€変腑锟?
  const [currentBookId, setCurrentBookId] = useState<string>('');
  const [currentChapterId, setCurrentChapterId] = useState<string | null>(null);
  const [formBookTitle, setFormBookTitle] = useState('');
  const [formBookDescription, setFormBookDescription] = useState('');
  const [formBookCategory, setFormBookCategory] = useState('鐜勫够');
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [formChapterTitle, setFormChapterTitle] = useState('');
  const [formChapterContent, setFormChapterContent] = useState('');
  
  const [toast, setToast] = useState<{msg: string, type: 'success' | 'info' | 'error'} | null>(null);

  // 灏侀潰涓婁紶
  const [uploading, setUploading] = useState(false);
  const [formBookCover, setFormBookCover] = useState('');
  const [newBookCoverFile, setNewBookCoverFile] = useState<File | null>(null);
  const [newBookCoverPreview, setNewBookCoverPreview] = useState('');
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<any>(null);
  const [cropperImgSrc, setCropperImgSrc] = useState<string | null>(null);
  const [isCroppingFor, setIsCroppingFor] = useState<'new' | 'edit' | null>(null);

  const ALL_CATEGORIES = ['鐜勫够', '浠欎緺', '閮藉競', '鍘嗗彶', '绉戝够', '濂囧够', '浣撹偛', '鍐涗簨', '鎮枒'];
  const visibleCategories = ALL_CATEGORIES.slice(0, 4);
  const hiddenCategories = ALL_CATEGORIES.slice(4);

  // ================= 閫昏緫鍑芥暟 =================

  const fetchMyData = useCallback(async () => {
    if (!user) return;
    try {
      setLoading(true);
      const books = await booksApi.getMyBooks(user.id);
      setMyBooks(books); 
    } catch (error) {
      console.error('Failed to load books:', error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  // 馃懏 鍔犺浇鐢ㄦ埛鍒楄〃 (鏀寔鎼滅储)
  const fetchUserList = useCallback(async (search = '') => {
    if (!user) return;
    setAdminLoading(true);
    try {
        // 锟?鍗囩骇锛氬甫锟?search 鍙傛暟
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/admin/users?search=${encodeURIComponent(search)}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token') || ''}` }
        });
        if (res.ok) {
            const data = await res.json();
            setUserList(data);
        } else {
            setToast({ msg: '鑾峰彇鐢ㄦ埛鍒楄〃澶辫触', type: 'error' });
        }
    } catch (e) {
        setToast({ msg: '缃戠粶閿欒', type: 'error' });
    } finally {
        setAdminLoading(false);
    }
  }, [user]);

  const fetchAdminHotBooks = useCallback(async () => {
    if (!user || (user as any).role !== 'admin') return;
    setAdminBooksLoading(true);
    try {
      const books = await booksApi.getAll({ orderBy: 'daily_views', order: 'desc', limit: 10 });
      setAdminHotBooks(books);
    } catch (error) {
      console.error('Failed to load hot books:', error);
      setToast({ msg: '鑾峰彇鐑棬涔︾睄澶辫触', type: 'error' });
    } finally {
      setAdminBooksLoading(false);
    }
  }, [user]);

  const fetchAdminBookSearchResults = useCallback(async (rawKeyword: string) => {
    if (!user || (user as any).role !== 'admin') return;
    const keyword = rawKeyword.trim().toLowerCase();
    if (!keyword) {
      setAdminBookSearchResults([]);
      return;
    }

    setAdminBookSearchLoading(true);
    try {
      const books = await booksApi.getAll({ orderBy: 'daily_views', order: 'desc' });
      const hotBookIds = new Set(adminHotBooks.map((book) => book.id));
      const filtered = books.filter((book) => {
        if (hotBookIds.has(book.id)) return false;
        const authorName =
          typeof book.author === 'string'
            ? book.author
            : (book.author_id && typeof book.author_id === 'object' && 'username' in book.author_id
                ? (book.author_id as any).username
                : '');
        const target = `${book.title || ''} ${authorName || ''}`.toLowerCase();
        return target.includes(keyword);
      });
      setAdminBookSearchResults(filtered);
    } catch (error) {
      console.error('Failed to search books:', error);
      setToast({ msg: '鎼滅储涔︾睄澶辫触', type: 'error' });
    } finally {
      setAdminBookSearchLoading(false);
    }
  }, [user, adminHotBooks]);

  // 鐩戝惉鎼滅储璇嶅彉锟?(闃叉姈)
  useEffect(() => {
      if (currentView === 'admin') {
          const timer = setTimeout(() => {
              fetchUserList(adminSearch);
          }, 500); // 500ms 闃叉姈
          return () => clearTimeout(timer);
      }
  }, [adminSearch, currentView, fetchUserList]);

  useEffect(() => {
    if (currentView === 'adminBooks' && (user as any)?.role === 'admin') {
      fetchAdminHotBooks();
    }
  }, [currentView, user, fetchAdminHotBooks]);

  useEffect(() => {
    if (currentView !== 'adminBooks' || (user as any)?.role !== 'admin') return;
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
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/upload/cover`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token') || ''}`, 'x-user-id': user!.id },
        body: formData,
      });
      if (!res.ok) throw new Error('涓婁紶澶辫触');
      const data = await res.json();
      return data.url;
    } catch (e) {
      setToast({ msg: '鍥剧墖涓婁紶澶辫触', type: 'error' });
      return null;
    } finally {
      setUploading(false);
    }
  };

  // ... 瑁佸壀銆佺櫥褰曠瓑閫昏緫淇濇寔涓嶅彉 (姝ゅ涓轰簡绠€娲佺渷鐣ワ紝瀹為檯浣跨敤鏃惰淇濈暀) ...
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

  const onCropComplete = useCallback((croppedArea: any, croppedAreaPixels: any) => setCroppedAreaPixels(croppedAreaPixels), []);

  const handleSaveCrop = async () => {
    if (!cropperImgSrc || !croppedAreaPixels) return;
    try {
      setUploading(true);
      const croppedBlob = await getCroppedImg(cropperImgSrc, croppedAreaPixels);
      if (!croppedBlob) throw new Error('Canvas create failed');
      const file = new File([croppedBlob], "cover.jpg", { type: "image/jpeg" });
      const url = await uploadImageToCloudinary(file);
      if (url) {
        if (isCroppingFor === 'new') setNewBookCoverPreview(url);
        else if (isCroppingFor === 'edit') setFormBookCover(url);
        setToast({ msg: '瑁佸壀鎴愬姛', type: 'success' });
      }
      setCropperImgSrc(null); setIsCroppingFor(null);
    } catch (e) { setToast({ msg: '瑁佸壀澶辫触', type: 'error' }); } finally { setUploading(false); }
  };

  // 褰卞瓙鐧诲綍
  const handleShadowLogin = async (targetUserId: string, targetName: string) => {
    if (!user || (user as any).role !== 'admin') return alert('鏉冮檺涓嶈冻');
    if (!confirm(`鈿狅笍 纭鍒囨崲韬唤锟?[ ${targetName} ] ?`)) return;
    try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/admin/impersonate/${targetUserId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-user-id': user!.id , 'Authorization': `Bearer ${localStorage.getItem('token') || ''}` }
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        localStorage.setItem('token', data.token);
        localStorage.setItem('novelhub_user', data.user.id);
        localStorage.setItem('user', JSON.stringify(data.user));
        window.location.reload();
    } catch (e: any) { setToast({ msg: `鍒囨崲澶辫触: ${e.message}`, type: 'error' }); }
  };

  const findBookById = useCallback((bookId: string) => {
    if (!bookId) return undefined;
    if (bookManagerBook?.id === bookId) return bookManagerBook;
    return myBooks.find((b) => b.id === bookId)
      || adminHotBooks.find((b) => b.id === bookId)
      || adminBookSearchResults.find((b) => b.id === bookId);
  }, [bookManagerBook, myBooks, adminHotBooks, adminBookSearchResults]);

  const activeBook = findBookById(currentBookId);

  // 灏佸彿閫昏緫
  const handleBanUser = async (targetUserId: string, currentStatus: boolean, username: string) => {
    const action = currentStatus ? '瑙ｅ皝' : '灏佺';
    if (!confirm(`鈿狅笍 纭畾锟?${action} 鐢ㄦ埛 [ ${username} ] 鍚楋紵`)) return;
    try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/admin/users/${targetUserId}/ban`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token') || ''}` },
            body: JSON.stringify({ isBanned: !currentStatus })
        });
        if (res.ok) {
            setToast({ msg: `${action}鎴愬姛`, type: 'success' });
            fetchUserList(adminSearch); // 鍒锋柊
        } else {
            setToast({ msg: '鎿嶄綔澶辫触', type: 'error' });
        }
    } catch (e) { setToast({ msg: '缃戠粶閿欒', type: 'error' }); }
  };

  // 涔︾睄绔犺妭閫昏緫 (鐪佺暐閲嶅浠ｇ爜锛岄€昏緫涓庝箣鍓嶄竴锟? ...
  const openChapterEditor = async (type: 'new' | 'edit', chapter?: Chapter) => {
      if (type === 'new') { setCurrentChapterId(null); setFormChapterTitle(''); setFormChapterContent(''); setShowChapterEditor(true); }
      else if (chapter) {
          setCurrentChapterId(chapter.id); setFormChapterTitle(chapter.title); setFormChapterContent('鍔犺浇锟?..'); setShowChapterEditor(true);
          try {
              // 锟?姝ｇ‘鍐欐硶锛氬甫锟?Token
            const token = localStorage.getItem('token'); // 鑾峰彇鐧诲綍鍑瘉

            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/chapters/${chapter.id}`, {
            headers: {
                'Content-Type': 'application/json',
                // 濡傛灉锟?token锛屽氨甯︿笂锛涙病鏈夊氨鏄┖瀛楃涓诧紙娓稿锟?
                'Authorization': token ? `Bearer ${token}` : ''
            }
            });
              if(!res.ok) throw new Error('err');
              const data = await res.json(); setFormChapterContent(data.content || '');
          } catch(e) { setFormChapterContent('鍔犺浇澶辫触'); }
      }
  };
  const saveChapterCore = async (status: 'ongoing' | 'completed') => {
      if (!formChapterTitle.trim()) { setToast({msg:'鏍囬涓虹┖', type:'error'}); return false;}
      if (formChapterTitle.length > LIMITS.TITLE) { setToast({msg:'鏍囬杩囬暱', type:'error'}); return false;}
      if (formChapterContent.length > LIMITS.CONTENT) { setToast({msg:'姝ｆ枃杩囬暱', type:'error'}); return false;}
      try {
          const data = { title: formChapterTitle, content: formChapterContent, bookId: currentBookId, chapter_number: 1 };
          if (currentChapterId) await chaptersApi.update(currentChapterId, data);
          else await chaptersApi.create(data);
          fetchMyData(); 
          if(currentBookId) chaptersApi.getByBookId(currentBookId).then(setActiveChapters);
          return true;
      } catch(e) { setToast({msg:'淇濆瓨澶辫触', type:'error'}); return false; }
  };
  const handleSaveDraft = async () => { if(await saveChapterCore('ongoing')) setToast({msg:'淇濆瓨鎴愬姛', type:'success'}); };
  const handlePublishTrigger = () => { if(!formChapterTitle.trim()) return; setShowPublishConfirm(true); };
  const handleConfirmPublish = async () => { if(await saveChapterCore('completed')) { setShowPublishConfirm(false); setShowChapterEditor(false); setToast({msg:'鍙戝竷鎴愬姛', type:'success'}); }};
  const handleDeleteChapter = (cid: string) => setChapterToDelete(cid);
  const executeDeleteChapter = async () => { if(!chapterToDelete) return; await chaptersApi.delete(chapterToDelete); setActiveChapters(prev => prev.filter(c => c.id !== chapterToDelete)); setChapterToDelete(null); setToast({msg:'鍒犻櫎鎴愬姛', type:'success'}); };
  const handleCreateBook = async (e: React.FormEvent) => {
      e.preventDefault();
      if(!formBookTitle.trim() || !user) return;
      try {
          let url = '';
          if(newBookCoverPreview.startsWith('http')) url = newBookCoverPreview;
          else if(newBookCoverFile) { const u = await uploadImageToCloudinary(newBookCoverFile); if(u) url = u; else return; }
          await booksApi.create({ title: formBookTitle, description: formBookDescription, cover_image: url, category: formBookCategory, author: user.username, author_id: user.id } as any);
          setShowCreateBookModal(false); setFormBookTitle(''); setFormBookDescription(''); setFormBookCategory(ALL_CATEGORIES[0]); setNewBookCoverFile(null); setNewBookCoverPreview('');
          setToast({msg:'鍒涘缓鎴愬姛', type:'success'}); fetchMyData();
      } catch(e) { setToast({msg:'鍒涘缓澶辫触', type:'error'}); }
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
    setToast({ msg: '淇濆瓨鎴愬姛', type: 'success' });
    fetchMyData();
    if ((user as any)?.role === 'admin') {
      fetchAdminHotBooks();
      if (adminBookSearch.trim()) fetchAdminBookSearchResults(adminBookSearch);
    }
  };

  const handleDeleteBook = async () => {
    const book = activeBook;
    if (!book) return;
    const n = prompt('杈撳叆涔﹀悕纭鍒犻櫎:');
    if (n !== book.title) return;

    await booksApi.delete(currentBookId);
    setShowBookManager(false);
    setBookManagerBook(null);
    setAdminHotBooks((prev) => prev.filter((b) => b.id !== currentBookId));
    setAdminBookSearchResults((prev) => prev.filter((b) => b.id !== currentBookId));
    fetchMyData();
    if ((user as any)?.role === 'admin') {
      fetchAdminHotBooks();
      if (adminBookSearch.trim()) fetchAdminBookSearchResults(adminBookSearch);
    }
    setToast({ msg: '鍒犻櫎鎴愬姛', type: 'success' });
  };

  const getBookAuthorName = (book: Book) => {
    if (typeof book.author === 'string' && book.author.trim()) return book.author;
    if (book.author_id && typeof book.author_id === 'object' && 'username' in book.author_id) {
      return (book.author_id as any).username || '未知作者';
    }
    return '未知作者';
  };

  const openBookManager = (book: Book) => {
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
    if (!user) router.push('/login');
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

      {/* ================= 渚ц竟锟?(瀵艰埅鏍稿績) ================= */}
      <aside className="w-64 bg-white border-r border-gray-200 hidden md:flex flex-col fixed h-full z-10">
        <div className="p-6 border-b border-gray-100">
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <PenTool className="h-6 w-6 text-blue-600" />
            鍒涗綔涓績
          </h2>
        </div>
        <nav className="flex-1 p-4 space-y-2">
          {/* 鍒囨崲鍒颁綔鍝佺锟?*/}
          <button 
            onClick={() => setCurrentView('works')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition ${currentView === 'works' ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-50'}`}
          >
            <BookOpen className="h-5 w-5" /> 浣滃搧绠＄悊
          </button>
          
          {/* 鍒囨崲鍒版帶鍒跺彴 (浠呯鐞嗗憳) */}
          {(user as any).role === 'admin' && (
            <button 
                onClick={() => setCurrentView('admin')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition mt-2 ${currentView === 'admin' ? 'bg-purple-50 text-purple-600' : 'text-gray-600 hover:bg-purple-50 hover:text-purple-600'}`}
            >
                <LayoutDashboard className="h-5 w-5" /> 瓒呯骇鎺у埗锟?
            </button>
          )}
          {(user as any).role === 'admin' && (
            <button
                onClick={() => setCurrentView('adminBooks')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition mt-2 ${currentView === 'adminBooks' ? 'bg-amber-50 text-amber-700' : 'text-gray-600 hover:bg-amber-50 hover:text-amber-700'}`}
            >
                <BarChart3 className="h-5 w-5" /> 涔︾睄鎬荤紪锟?            </button>
          )}
        </nav>
        <div className="p-4 border-t border-gray-100">
           <div className="flex items-center gap-3 px-4 py-2">
              <div className={`h-8 w-8 rounded-full flex items-center justify-center font-bold ${(user as any).role === 'admin' ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600'}`}>
                {((user as any).username || 'U')[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{(user as any).username}</p>
                <p className="text-xs text-gray-500">{(user as any).role === 'admin' ? '超级管理员' : '创作者'}</p>
              </div>
           </div>
        </div>
      </aside>

      {/* ================= 涓诲唴瀹瑰尯锟?================= */}
      <main className="flex-1 md:ml-64 p-4 md:p-8 pb-20 md:pb-8">
        
        {/* 1. 浣滃搧绠＄悊瑙嗗浘 */}
        {currentView === 'works' && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden min-h-[80vh] md:min-h-0 animate-in fade-in">
                <div className="p-4 md:p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50 md:bg-white">
                    <h3 className="font-bold text-lg text-gray-900">鎴戠殑浣滃搧</h3>
                    <button onClick={() => setShowCreateBookModal(true)} className="flex items-center gap-2 bg-blue-600 text-white px-3 py-1.5 md:px-4 md:py-2 text-sm md:text-base rounded-lg hover:bg-blue-700 transition shadow-md shadow-blue-500/20 active:scale-95 cursor-pointer">
                        <Plus className="h-4 w-4" /> <span className="hidden md:inline">鍒涘缓鏂颁功</span><span className="md:hidden">鏂板缓</span>
                    </button>
                </div>

                <div className="divide-y divide-gray-100">
                    {loading ? ( <div className="p-12 text-center text-gray-400">鍔犺浇锟?..</div> ) : myBooks.length === 0 ? (
                        <div className="p-12 text-center text-gray-500 flex flex-col items-center gap-4">
                            <BookOpen className="h-12 w-12 text-gray-200" /> <p>鏆傛棤浣滃搧</p>
                        </div>
                    ) : (
                        myBooks.map((book) => (
                            <div key={book.id} className="p-4 md:p-6 flex gap-4 md:gap-6 hover:bg-gray-50 transition group items-start">
                                <div className="w-20 h-28 md:w-24 md:h-32 bg-gray-200 rounded-md md:rounded-lg shadow-sm flex-shrink-0 flex items-center justify-center text-gray-400 overflow-hidden relative">
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
                                            <Settings className="h-3 w-3 md:h-4 md:w-4" /> <span>绠＄悊</span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        )}

        {/* 2. 锟?瓒呯骇绠＄悊鍛樻帶鍒跺彴瑙嗗浘 (鏂伴〉锟? */}
        {currentView === 'admin' && (user as any).role === 'admin' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
                {/* 椤堕儴锛氭爣棰樹笌鎼滅储 */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                            <Shield className="h-7 w-7 text-purple-600" /> 鎺у埗锟?
                        </h2>
                        <p className="text-sm text-gray-500 mt-1">
                            绠＄悊鐢ㄦ埛鐘舵€侊紝鏌ョ湅娲昏穬鏁版嵁 (Top 15 娲昏穬鐢ㄦ埛)
                        </p>
                    </div>
                    {/* 鎼滅储锟?*/}
                    <div className="relative w-full md:w-80">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                        <input 
                            type="text" 
                            placeholder="鎼滅储鐢ㄦ埛鍚嶆垨閭..." 
                            value={adminSearch}
                            onChange={(e) => setAdminSearch(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition shadow-sm text-gray-900 placeholder-gray-500 bg-gray-50/50"
                        />
                    </div>
                </div>

                {/* 鐢ㄦ埛鍒楄〃鍗＄墖 */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse min-w-[800px]">
                            <thead>
                                <tr className="bg-gray-50/50 border-b border-gray-200 text-xs text-gray-500 uppercase tracking-wider">
                                    <th className="px-6 py-4 font-semibold">鐢ㄦ埛</th>
                                    <th className="px-6 py-4 font-semibold">瑙掕壊/鐘讹拷</th>
                                    <th className="px-6 py-4 font-semibold">鏈懆娲昏穬瓒嬪娍 (娴忚/涓婁紶)</th>
                                    <th className="px-6 py-4 font-semibold text-right">鎿嶄綔</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {adminLoading ? (
                                    <tr><td colSpan={4} className="p-8 text-center text-gray-400">鍔犺浇锟?..</td></tr>
                                ) : userList.length === 0 ? (
                                    <tr><td colSpan={4} className="p-8 text-center text-gray-400">鏈壘鍒扮敤锟</td></tr>
                                ) : userList.map(u => {
                                    // 鍑嗗鍥捐〃鏁版嵁
                                    const stats = u.stats || {};
                                    const history = stats.history || [];
                                    
                                    // 馃洝锟?2. 鑾峰彇浠婃棩瀹炴椂鏁版嵁
                                    const todayViews = stats.today_views || 0;
                                    const todayUploads = stats.today_uploads || 0;

                                    // 馃洝锟?3. 鎷兼帴鏁版嵁锛氬巻鍙叉暟锟?+ 浠婃棩鏁版嵁 (璁╃鐞嗗憳鑳界湅鍒板綋澶╃殑瀹炴椂鍙樺寲)
                                    // 娉ㄦ剰锛歁iniChart 鍙渶瑕佹暟瀛楁暟锟?
                                    const viewData = [...history.map((h: any) => h.views || 0), todayViews];
                                    const uploadData = [...history.map((h: any) => h.uploads || 0), todayUploads];
                                    
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
                                                            <Ban className="h-3 w-3" /> 宸插皝锟?
                                                        </span>
                                                    ) : (
                                                        <span className="text-xs text-green-600 flex items-center gap-1">
                                                            <CheckCircle2 className="h-3 w-3" /> 姝ｅ父
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex gap-6">
                                                    <div className="flex flex-col gap-1">
                                                        {/* 杩欓噷淇敼锟?title锛屽鍔犱簡鍏蜂綋鐨勬暟瀛楁樉锟?*/}
                                                        <span className="text-[10px] text-gray-400 uppercase font-bold">
                                                            娴忚锟?({todayViews}) 
                                                        </span>
                                                        <MiniChart data={viewData} color="#3b82f6" />
                                                    </div>
                                                    <div className="flex flex-col gap-1">
                                                        <span className="text-[10px] text-gray-400 uppercase font-bold">
                                                            涓婁紶锟?({todayUploads})
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
                                                                onClick={() => handleShadowLogin(u.id || u._id, u.username)}
                                                                className="p-2 text-purple-600 hover:bg-purple-50 rounded-lg border border-transparent hover:border-purple-100 transition"
                                                                title="褰卞瓙鐧诲綍"
                                                            >
                                                                <LogIn className="h-4 w-4" />
                                                            </button>
                                                            <button 
                                                                onClick={() => handleBanUser(u.id || u._id, u.isBanned, u.username)}
                                                                className={`p-2 rounded-lg border border-transparent transition ${u.isBanned ? 'text-green-600 hover:bg-green-50 hover:border-green-100' : 'text-red-600 hover:bg-red-50 hover:border-red-100'}`}
                                                                title={u.isBanned ? "瑙ｅ皝" : "灏佸彿"}
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
                    {/* 搴曢儴鎻愮ず */}
                    <div className="bg-gray-50 px-6 py-3 border-t border-gray-200 text-xs text-gray-500 flex justify-between">
                         <span>鏄剧ず鍩轰簬娲昏穬搴︽帓搴忕殑锟?15 鍚嶇敤锟</span>
                         <span>鏁版嵁姣忔棩鍑屾櫒鏇存柊</span>
                    </div>
                </div>
            </div>
        )}

        {currentView === 'adminBooks' && (user as any).role === 'admin' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                            <BarChart3 className="h-7 w-7 text-amber-600" /> 涔︾睄鎬荤紪锟?                        </h2>
                        <p className="text-sm text-gray-500 mt-1">
                            榛樿灞曠ず浠婃棩鏈€锟?Top 10锛屽彲鎼滅储鍏朵綑涔︾睄骞惰繘琛屽畬鏁寸紪杈戯拷?                        </p>
                    </div>
                    <div className="relative w-full md:w-96">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                        <input
                            type="text"
                            placeholder="鎼滅储 Top10 涔嬪鐨勪功鍚嶆垨浣滐拷?.."
                            value={adminBookSearch}
                            onChange={(e) => setAdminBookSearch(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none transition shadow-sm text-gray-900 placeholder-gray-500 bg-gray-50/50"
                        />
                    </div>
                </div>

                {adminBookSearch.trim() && (
                  <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                    <div className="p-4 md:p-6 border-b border-gray-100 bg-gray-50/60">
                        <h3 className="font-bold text-lg text-gray-900">鎼滅储缁撴灉锛堜笉锟?Top 10锟</h3>
                    </div>
                    <div className="divide-y divide-gray-100">
                        {adminBookSearchLoading ? (
                            <div className="p-10 text-center text-gray-400">鎼滅储锟?..</div>
                        ) : adminBookSearchResults.length === 0 ? (
                            <div className="p-10 text-center text-gray-500">鏈壘鍒板尮閰嶄功锟</div>
                        ) : (
                            adminBookSearchResults.map((book) => (
                                <div key={book.id} className="p-4 md:p-6 flex gap-4 md:gap-6 hover:bg-gray-50 transition group items-start">
                                    <div className="w-20 h-28 md:w-24 md:h-32 bg-gray-200 rounded-md md:rounded-lg shadow-sm flex-shrink-0 flex items-center justify-center text-gray-400 overflow-hidden relative">
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
                                                <Settings className="h-3 w-3 md:h-4 md:w-4" /> <span>绠＄悊</span>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                  </div>
                )}

                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                    <div className="p-4 md:p-6 border-b border-gray-100 bg-gray-50/60">
                        <h3 className="font-bold text-lg text-gray-900">浠婃棩鏈€锟?Top 10</h3>
                    </div>
                    <div className="divide-y divide-gray-100">
                        {adminBooksLoading ? (
                            <div className="p-12 text-center text-gray-400">鍔犺浇锟?..</div>
                        ) : adminHotBooks.length === 0 ? (
                            <div className="p-12 text-center text-gray-500">鏆傛棤鐑棬涔︾睄</div>
                        ) : (
                            adminHotBooks.map((book) => (
                                <div key={book.id} className="p-4 md:p-6 flex gap-4 md:gap-6 hover:bg-gray-50 transition group items-start">
                                    <div className="w-20 h-28 md:w-24 md:h-32 bg-gray-200 rounded-md md:rounded-lg shadow-sm flex-shrink-0 flex items-center justify-center text-gray-400 overflow-hidden relative">
                                        {book.cover_image ? <img src={book.cover_image} className="w-full h-full object-cover" /> : <BookOpen className="h-8 w-8 opacity-50" />}
                                    </div>
                                    <div className="flex-1 flex flex-col justify-between min-h-[7rem] md:min-h-[8rem]">
                                        <div>
                                            <div className="flex justify-between items-start gap-3">
                                                <h4 className="text-base md:text-xl font-bold text-gray-900 mb-1 line-clamp-1">{book.title}</h4>
                                                <span className="text-[11px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">浠婃棩鐑害 {book.daily_views || 0}</span>
                                            </div>
                                            <p className="text-xs md:text-sm text-gray-500 mt-1 line-clamp-2">{book.description || '暂无简介'}</p>
                                            <p className="text-xs text-gray-400 mt-1">浣滆€咃細{getBookAuthorName(book)}</p>
                                        </div>
                                        <div className="flex gap-2 md:gap-3 mt-3">
                                            <button onClick={() => { setCurrentBookId(book.id); openChapterEditor('new'); }} className="w-32 flex items-center justify-center gap-1 px-3 py-2 bg-white text-blue-600 text-sm font-bold rounded-lg border border-blue-100 shadow-sm hover:bg-blue-50 hover:border-blue-300 hover:shadow-md active:scale-95 transition-all cursor-pointer">
                                                <Upload className="h-3 w-3 md:h-4 md:w-4" /> <span>快速发布</span>
                                            </button>
                                            <button onClick={() => openBookManager(book)} className="w-32 flex items-center justify-center gap-1 px-3 py-2 bg-white text-gray-700 text-sm font-bold rounded-lg border border-gray-200 shadow-sm hover:bg-gray-50 hover:border-gray-300 hover:shadow-md active:scale-95 transition-all cursor-pointer">
                                                <Settings className="h-3 w-3 md:h-4 md:w-4" /> <span>绠＄悊</span>
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

      {/* ===================== 寮圭獥鍖哄煙 (淇濇寔涓嶅彉) ===================== */}
      {/* 1. 涔︾睄绠＄悊锟?*/}
{/* 5. 涔︾睄绠＄悊锟?(澶т慨锛氬己鍒朵袱锟?+ 瀹藉睆 + 寮轰氦锟? */}
      {/* 5. 涔︾睄绠＄悊锟?(缁堟瀬淇锛氱珷鑺傚弻锟?+ 榛樿鏀惰捣 + 榧犳爣鎵嬪娍) */}
      {showBookManager && activeBook && (
        <div className="fixed inset-0 z-40 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm p-0 md:p-4 animate-in fade-in duration-200">
           {/* 寮圭獥瀹藉害 max-w-5xl 淇濊瘉澶熷 */}
           <div className="bg-white rounded-t-2xl md:rounded-2xl shadow-2xl w-full max-w-5xl h-[90vh] md:max-h-[85vh] flex flex-col overflow-hidden animate-in slide-in-from-bottom-10 md:slide-in-from-bottom-0">
              
              {/* 椤堕儴鏍囬锟?*/}
              <div className="p-4 md:p-6 border-b border-gray-100 bg-gray-50 flex justify-between items-center shrink-0">
                 <div>
                    <h3 className="text-lg md:text-xl font-bold text-gray-900 truncate max-w-[200px]">{activeBook.title}</h3>
                    <p className="text-xs text-gray-500">鐩綍涓庤锟</p>
                 </div>
                 <button onClick={() => setShowBookManager(false)} className="p-2 bg-gray-200 hover:bg-gray-300 rounded-full transition-colors cursor-pointer"><X className="h-5 w-5 text-gray-600" /></button>
              </div>

              {/* 涓棿婊氬姩锟?*/}
              <div className="flex-1 overflow-y-auto p-4 md:p-8 bg-white space-y-6">
                
                 {/* 馃敶 闂2淇锛氬垹鎺変簡 open 灞炴€э紝榛樿鏀惰捣锟?*/}
                 <details className="group bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                    {/* 馃敶 闂1淇锛氬己鍒跺姞锟?cursor-pointer锛岄紶鏍囨斁涓婂幓蹇呭彉灏忔墜 */}
                    <summary className="flex items-center justify-between p-4 cursor-pointer list-none select-none bg-gray-50 hover:bg-blue-50 transition-colors group-open:bg-blue-50/50">
                        <span className="text-base font-extrabold text-gray-900 flex items-center gap-2">
                            <Settings className="h-5 w-5 text-blue-600" /> 涔︾睄淇℃伅璁剧疆 
                            <span className="text-xs font-normal text-gray-500 group-open:hidden">(鐐瑰嚮灞曞紑)</span>
                        </span>
                        <div className="transition-transform duration-200 group-open:rotate-180 text-gray-400">锟</div>
                    </summary>
                    
                    <div className="p-6 border-t border-gray-100 bg-white animate-in slide-in-from-top-2 duration-200">
                        <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-8">
                            
                        {/* 宸︿晶锛氬皝闈慨鏀瑰尯 (宸叉坊鍔犲垹闄ゅ姛锟? */}
                        <div className="flex flex-col items-center gap-3">
                            <div className="w-40 h-56 bg-gray-100 rounded-lg border-2 border-dashed border-gray-300 overflow-hidden relative group shadow-sm hover:border-blue-500 transition-all cursor-pointer">
                                
                                {/* 1. 鍔犺浇涓姸锟?*/}
                                {uploading ? (
                                    <div className="absolute inset-0 flex items-center justify-center bg-gray-50">
                                        <Loader2 className="h-8 w-8 text-blue-600 animate-spin" />
                                    </div>
                                ) : formBookCover ? (
                                    // 2. 鏈夊皝闈㈡椂鏄剧ず鍥剧墖
                                    <>
                                        <img src={formBookCover} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                                        
                                        {/* 锟?鏂板锛氬垹闄ゅ皝闈㈡寜锟?(鍙充笂瑙掔孩鑹插瀮鍦炬《) */}
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation(); // 闃叉瑙﹀彂涓婁紶
                                                e.preventDefault();
                                                if (confirm('纭畾瑕佺Щ闄よ繖寮犲皝闈㈠悧锟?璁板緱鐐瑰彸涓嬭淇濆瓨)')) {
                                                    setFormBookCover(''); // 娓呯┖鐘讹拷?
                                                }
                                            }}
                                            className="absolute top-2 right-2 z-20 p-2 bg-red-600/90 text-white rounded-full hover:bg-red-700 shadow-sm opacity-0 group-hover:opacity-100 transition-all hover:scale-110"
                                            title="绉婚櫎灏侀潰"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </>
                                ) : (
                                    // 3. 鏃犲皝闈㈡椂鏄剧ず鍗犱綅锟?
                                    <div className="w-full h-full flex flex-col items-center justify-center text-gray-400">
                                        <ImageIcon className="h-10 w-10 mb-2 opacity-50" />
                                        <span className="text-xs font-medium">鏆傛棤灏侀潰</span>
                                    </div>
                                )}
                                
                                {/* 4. 瑕嗙洊灞傦細鐐瑰嚮涓婁紶/瑁佸壀 (z-10 淇濊瘉鍦ㄥ浘鐗囦箣涓婏紝浣嗗湪鍒犻櫎鎸夐挳涔嬩笅) */}
                                <label className="absolute inset-0 z-10 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col items-center justify-center cursor-pointer text-white">
                                    {/* 濡傛灉鏈夊垹闄ゆ寜閽紝绋嶅井寰€涓嬫尓涓€鐐癸紝閬垮紑鍙充笂锟?*/}
                                    <div className="flex flex-col items-center transform translate-y-2">
                                        <Upload className="h-8 w-8 mb-2 animate-bounce" />
                                        <span className="text-sm font-bold">鐐瑰嚮鏇存崲</span>
                                    </div>
                                    {/* 鈿狅笍 璁板緱妫€鏌ヨ繖閲屾槸涓嶆槸 onSelectFile 锟?*/}
                                    <input type="file" className="hidden" accept="image/*" onChange={(e) => onSelectFile(e, 'edit')} />
                                </label>
                            </div>
                            <p className="text-xs text-gray-400">鏀寔 JPG, PNG (鎺ㄨ崘 3:4)</p>
                        </div>

                            {/* 鍙充晶锛氳〃鍗曞尯 */}
                            <div className="space-y-5">
                                <div>
                                    <label className="text-sm font-bold text-gray-700 mb-1.5 block">涔﹀悕</label>
                                    <input 
                                        value={formBookTitle}
                                        onChange={(e) => setFormBookTitle(e.target.value)}
                                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 font-bold text-lg outline-none focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all hover:bg-white hover:border-gray-300"
                                    />
                                </div>
                                <div>
                                    <label className="text-sm font-bold text-gray-700 mb-1.5 block">绠€锟</label>
                                    <textarea 
                                        value={formBookDescription}
                                        onChange={(e) => setFormBookDescription(e.target.value)}
                                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 text-sm font-medium outline-none focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all hover:bg-white hover:border-gray-300 h-32 resize-none leading-relaxed"
                                        placeholder="璇疯緭鍏ョ畝锟?.."
                                    />
                                </div>
                                <div className="flex justify-end pt-2">
                                    <button 
                                        onClick={handleUpdateBook}
                                        disabled={uploading}
                                        className="px-8 py-3 bg-blue-600 text-white text-sm font-bold rounded-xl hover:bg-blue-700 hover:shadow-lg hover:shadow-blue-500/30 hover:-translate-y-0.5 active:scale-95 transition-all disabled:opacity-50 flex items-center gap-2 cursor-pointer"
                                    >
                                        <Save className="h-4 w-4" />
                                        淇濆瓨鎵€鏈変慨锟?
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                 </details>

                 {/* 绔犺妭鍒楄〃鏍囬 */}
                 <div className="flex items-center justify-between px-1">
                    <h4 className="font-bold text-gray-900 text-lg">绔犺妭鍒楄〃 ({activeChapters.length})</h4>
                 </div>

                 {/* 馃敶 闂3淇锛氳繖閲屽彉鎴愪簡 grid-cols-2锛佷袱鍒楀竷灞€锟?*/}
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     {activeChapters.length === 0 ? (
                         <div className="col-span-full text-center text-gray-400 py-12 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                             鏆傛棤绔犺妭锛屽揩鍘诲垱浣滃惂
                         </div>
                     ) : (
                        activeChapters.map((chapter) => (
                            <div key={chapter.id} className="group flex items-center justify-between p-4 bg-white hover:bg-blue-50 rounded-xl border border-gray-100 hover:border-blue-200 transition-all shadow-sm hover:shadow-md cursor-default">
                               {/* 鎵惧埌 activeChapters.map 閲岄潰鐨勮繖锟?div */}
                                <div className="flex-1 mr-4 min-w-0">
                                    <div className="flex items-center gap-2">
                                        {/* 锟?涔嬪墠杩欓噷鏈変釜 span 鏄剧ず #x锛岀幇鍦ㄥ交搴曞垹鎺変簡 */}
                                        
                                        {/* 鍙繚鐣欐爣锟?*/}
                                        <p className="font-bold text-gray-900 text-sm md:text-base truncate group-hover:text-blue-700 transition-colors">
                                            {chapter.title}
                                        </p>
                                    </div>
                                    <p className="text-xs text-gray-400 mt-1 pl-1">瀛楁暟: {chapter.word_count || 0}</p>
                                </div>
                                <div className="flex gap-2 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                    <button onClick={() => openChapterEditor('edit', chapter)} className="p-2 bg-white border border-gray-200 text-blue-600 rounded-lg hover:bg-blue-600 hover:text-white transition-all hover:scale-105 shadow-sm cursor-pointer">
                                        <Edit3 className="h-4 w-4" />
                                    </button>
                                    <button onClick={() => handleDeleteChapter(chapter.id)} className="p-2 bg-white border border-gray-200 text-red-600 rounded-lg hover:bg-red-600 hover:text-white transition-all hover:scale-105 shadow-sm cursor-pointer">
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                </div>
                            </div>
                        ))
                     )}
                 </div>
              </div>

              {/* 搴曢儴鍗遍櫓锟?*/}
              <div className="p-4 bg-red-50 border-t border-red-100 flex justify-between items-center pb-8 md:pb-4 shrink-0">
                 <span className="text-xs text-red-600 font-bold flex items-center gap-1">
                     <AlertCircle className="h-4 w-4" /> 鍗遍櫓鍖哄煙
                 </span>
                 <button onClick={handleDeleteBook} className="flex items-center gap-1 md:gap-2 px-4 py-2 bg-white border border-red-200 text-red-600 text-xs md:text-sm font-medium rounded-lg hover:bg-red-600 hover:text-white hover:shadow-red-500/20 active:scale-95 transition-all cursor-pointer">
                     <Trash2 className="h-3 w-3 md:h-4 md:w-4" /> 鍒犻櫎鏈功
                 </button>
              </div>
           </div>
        </div>
      )} 

        {/* 2. 绔犺妭缂栬緫锟?*/}
      {showChapterEditor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white md:bg-black/60 md:backdrop-blur-sm p-0 md:p-4 animate-in zoom-in-95 duration-200">
           <div className="bg-white w-full h-full md:rounded-2xl md:shadow-2xl md:max-w-5xl md:h-[90vh] flex flex-col overflow-hidden">
              {/* 馃煝 淇锛氳ˉ鍥炰涪澶辩殑椤堕儴鎿嶄綔锟?(鍏抽棴銆佹爣棰樸€佸彂甯冩寜锟? */}
              <div className="px-4 py-3 md:px-6 md:py-4 border-b border-gray-200 flex justify-between items-center bg-white shrink-0">
                 <div className="flex items-center gap-2 md:gap-3">
                    {/* 鍏抽棴鎸夐挳 */}
                    <button 
                        onClick={() => setShowChapterEditor(false)} 
                        className="p-1 -ml-2 text-gray-500 active:bg-gray-100 hover:bg-gray-100 rounded-full transition-colors cursor-pointer"
                        title="鍏抽棴"
                    >
                        <X className="h-6 w-6" />
                    </button>
                    <h3 className="text-base md:text-lg font-bold text-gray-900">
                        {currentChapterId ? '缂栬緫绔犺妭' : '鏂板缓绔犺妭'}
                    </h3>
                 </div>
                 
                 {/* 鍙充晶鎸夐挳锟?*/}
                 <div className="flex items-center gap-2 md:gap-3">
                    <button 
                        onClick={handleSaveDraft} 
                        className="flex items-center gap-1 md:gap-2 px-3 py-1.5 md:px-5 md:py-2 bg-gray-100 text-gray-700 text-sm md:text-base font-bold rounded-full active:bg-gray-200 hover:bg-gray-200 transition cursor-pointer"
                    >
                        <Save className="h-4 w-4" /> <span className="hidden md:inline">瀛樿崏锟</span>
                    </button>
                    <button 
                        onClick={handlePublishTrigger} 
                        className="flex items-center gap-1 md:gap-2 px-4 py-1.5 md:px-6 md:py-2 bg-blue-600 text-white text-sm md:text-base font-bold rounded-full active:bg-blue-700 hover:bg-blue-700 transition shadow-lg shadow-blue-500/30 cursor-pointer"
                    >
                        <Upload className="h-4 w-4" /> 鍙戝竷
                    </button>
                 </div>
              </div>
              {/* 馃煝 淇缁撴潫 */}
              
              <div className="flex-1 overflow-y-auto bg-gray-50 md:bg-gray-50/50 p-0 md:p-8">
                 <div className="max-w-3xl mx-auto h-full flex flex-col md:space-y-6 bg-white md:bg-transparent">
                    
                    {/* 馃洝锟?鏍囬鍖哄煙 */}
                    <div className="bg-white p-4 md:p-6 md:rounded-xl md:shadow-sm md:border md:border-gray-100 shrink-0 relative group">
                       <input 
                            type="text" 
                            value={formChapterTitle}
                            // 1. 鍘熺敓闄愬埗杈撳叆闀垮害
                            maxLength={LIMITS.TITLE} 
                            onChange={(e) => setFormChapterTitle(e.target.value)}
                            className="w-full p-2 border-b-2 border-gray-100 focus:border-blue-600 outline-none text-lg md:text-xl font-bold text-gray-900 placeholder-gray-300 bg-transparent transition-colors pr-16" // pr-16 鐣欏嚭绌洪棿
                            placeholder="请输入章节标题"
                       />
                       {/* 2. 鏍囬瀛楁暟鎻愮ず (杈撳叆鏃舵樉锟? */}
                       <span className="absolute right-6 bottom-8 text-xs text-gray-400 font-mono pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
                           {formChapterTitle.length}/{LIMITS.TITLE}
                       </span>
                    </div>

                    {/* 馃洝锟?姝ｆ枃鍖哄煙 */}
                    <div className="bg-white p-4 md:p-6 md:rounded-xl md:shadow-sm md:border md:border-gray-100 flex-1 flex flex-col min-h-[50vh] relative">
                       <textarea 
                          value={formChapterContent}
                          onChange={(e) => setFormChapterContent(e.target.value)}
                          // 娉ㄦ剰锛氳繖閲屾垜涓嶅缓璁姞 maxLength={LIMITS.CONTENT} 锟?textarea 涓婏紝
                          // 鍥犱负娴忚鍣ㄥ鐞嗗ぇ鏂囨湰锟?maxLength 浼氬崱椤裤€傛渶濂芥槸鐢ㄤ笅闈㈢殑鈥滆秴閲忓彉绾⑩€濇潵鎻愮ず锟?
                          className="flex-1 w-full resize-none outline-none text-gray-800 font-normal text-base md:text-lg leading-loose placeholder-gray-300 bg-transparent pb-8" // pb-8 鐣欏簳閮ㄧ┖锟?
                          placeholder="鍦ㄨ繖閲屽紑濮嬩綘鐨勫垱锟?.."
                       ></textarea>

                       {/* 3. 姝ｆ枃瀹炴椂瀛楁暟缁熻浠〃锟?*/}
                       <div className={`absolute bottom-4 right-6 text-xs font-bold transition-colors duration-300 ${
                           formChapterContent.length > LIMITS.CONTENT * 0.9 
                             ? 'text-red-500' // 鎺ヨ繎涓婇檺鍙樼孩
                             : 'text-gray-300'
                       }`}>
                           <span className="font-mono">
                               {formChapterContent.length}
                           </span> 
                           <span className="mx-1">/</span>
                           <span>{LIMITS.CONTENT}</span>
                           
                           {/* 濡傛灉瓒呴暱锛屾樉绀鸿鍛婂浘锟?*/}
                           {formChapterContent.length > LIMITS.CONTENT && (
                               <span className="ml-2 inline-flex items-center gap-1 bg-red-100 text-red-600 px-2 py-0.5 rounded-full">
                                   <AlertCircle className="h-3 w-3" /> 瀛楁暟瓒呴檺
                               </span>
                           )}
                       </div>
                    </div>
                 </div>
              </div>
           </div>
        </div>
      )}

      {/* 3. 鍙戝竷纭寮圭獥 */}
      {showPublishConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in zoom-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center">
                <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4 text-blue-600">
                    <Sparkles className="h-8 w-8" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">纭鍙戝竷锟</h3>
                <div className="flex gap-3">
                    <button onClick={() => setShowPublishConfirm(false)} className="flex-1 py-3 bg-gray-100 text-gray-700 font-bold rounded-xl active:bg-gray-200">鍐嶆兂锟</button>
                    <button onClick={handleConfirmPublish} className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl active:bg-blue-700">纭鍙戝竷</button>
                </div>
            </div>
        </div>
      )}

        {/* 4. 鍒涘缓鏂颁功寮圭獥 */}
        {showCreateBookModal && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm p-0 md:p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-t-2xl md:rounded-2xl shadow-2xl w-full max-w-md p-6 animate-in slide-in-from-bottom-10 md:slide-in-from-bottom-0">
                <h3 className="text-xl md:text-2xl font-bold mb-6 text-gray-900 flex items-center gap-2">
                <Sparkles className="h-6 w-6 text-purple-500" /> 鍒涘缓鏂颁綔锟?
                </h3>
                <form onSubmit={handleCreateBook} className="space-y-4 md:space-y-6">
    
                {/* 1. 灏侀潰涓婁紶锟?*/}
                <div className="flex justify-center">
                    <label className="relative cursor-pointer group">
                        <div className="w-28 h-36 bg-gray-100 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center overflow-hidden hover:border-blue-500 transition">
                            {newBookCoverPreview ? (
                                <img src={newBookCoverPreview} className="w-full h-full object-cover" />
                            ) : (
                                <div className="text-center text-gray-400">
                                    <ImageIcon className="h-8 w-8 mx-auto mb-1" />
                                    <span className="text-xs">涓婁紶灏侀潰</span>
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

                {/* 2. 涔﹀悕杈撳叆 (宸蹭紭鍖栵細娣诲姞瀛楁暟缁熻涓庨檺锟? */}
                <div>
                    <div className="flex justify-between items-center mb-2">
                        <label className="block text-sm font-bold text-gray-700">涔﹀悕</label>
                        {/* 鍙充晶璁℃暟鍣細骞虫椂鐏拌壊锛岃秴闄愬彉锟?*/}
                        <span className={`text-xs font-mono transition-colors ${
                            formBookTitle.length >= LIMITS.TITLE ? 'text-red-500 font-bold' : 'text-gray-400'
                        }`}>
                            {formBookTitle.length} / {LIMITS.TITLE}
                        </span>
                    </div>
                    <input 
                        type="text" 
                        value={formBookTitle}
                        maxLength={LIMITS.TITLE} // 馃洝锟?纭檺锟?
                        onChange={(e) => setFormBookTitle(e.target.value)}
                        // 馃憞 淇濇寔鍘熸湁锟?className 瀹屽叏涓嶅彉
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none text-gray-900 font-bold placeholder-gray-400 transition-all" 
                        placeholder="请输入书名" 
                    />
                </div>

                {/* ... 涓棿鐨勫垎绫婚€夋嫨浠ｇ爜淇濇寔涓嶅彉 ... */}

                {/* 4. 绠€浠嬭緭锟?(宸蹭紭鍖栵細娣诲姞瀛楁暟缁熻涓庨檺锟? */}
                <div>
                    <div className="flex justify-between items-center mb-2">
                        <label className="block text-sm font-bold text-gray-700">绠€锟</label>
                        {/* 鍙充晶璁℃暟锟?*/}
                        <span className={`text-xs font-mono transition-colors ${
                            formBookDescription.length >= LIMITS.DESC ? 'text-red-500 font-bold' : 'text-gray-400'
                        }`}>
                            {formBookDescription.length} / {LIMITS.DESC}
                        </span>
                    </div>
                    <textarea 
                        value={formBookDescription}
                        maxLength={LIMITS.DESC} // 馃洝锟?纭檺锟?
                        onChange={(e) => setFormBookDescription(e.target.value)}
                        // 馃憞 淇濇寔鍘熸湁锟?className 瀹屽叏涓嶅彉
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none resize-none text-gray-900 font-medium h-24 md:h-32 transition-all" 
                        placeholder="绠€鍗曚粙缁嶄竴涓嬩綘鐨勬晠锟?.."
                    ></textarea>
                </div>
                {/* 5. 搴曢儴鎸夐挳 */}
                <div className="flex gap-4 mt-8 pb-safe md:pb-0">
                    <button type="button" onClick={() => setShowCreateBookModal(false)} className="flex-1 py-3 bg-gray-100 text-gray-700 font-bold rounded-xl active:bg-gray-200">鍙栨秷</button>
                    <button type="submit" disabled={uploading} className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl active:bg-blue-700 shadow-lg flex justify-center items-center gap-2">
                        {uploading && <Loader2 className="h-4 w-4 animate-spin" />}
                        {uploading ? '涓婁紶锟?..' : '绔嬪嵆鍒涘缓'}
                    </button>
                </div>
            </form>
            </div>
        </div>
        )}

      {/* 5. 绔犺妭鍒犻櫎纭寮圭獥 */}
      {chapterToDelete && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in zoom-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center">
                <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4 text-red-600">
                    <Trash2 className="h-8 w-8" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">纭畾鍒犻櫎锟</h3>
                <p className="text-sm text-gray-500 mb-6">鍒犻櫎鍚庢棤娉曟仮澶嶏紝璇锋厧閲嶆搷浣滐拷</p>
                <div className="flex gap-3">
                    <button onClick={() => setChapterToDelete(null)} className="flex-1 py-2.5 bg-gray-100 text-gray-700 font-bold rounded-xl">鍙栨秷</button>
                    <button onClick={executeDeleteChapter} className="flex-1 py-2.5 bg-red-600 text-white font-bold rounded-xl shadow-lg">鍒犻櫎</button>
                </div>
            </div>
        </div>
      )}



    {/* ================= 瑁佸壀鍣ㄥ脊锟?================= */}
      {cropperImgSrc && (
        <div className="fixed inset-0 z-[100] bg-black/90 flex flex-col animate-in fade-in duration-200">
            {/* 椤堕儴鎿嶄綔锟?*/}
            <div className="flex justify-between items-center p-4 text-white z-10 bg-black/50">
                <button onClick={() => setCropperImgSrc(null)} className="flex items-center gap-1 text-gray-300 hover:text-white">
                    <X className="h-6 w-6" /> 鍙栨秷
                </button>
                <h3 className="font-bold">璋冩暣灏侀潰 (3:4)</h3>
                <button 
                    onClick={handleSaveCrop} 
                    disabled={uploading}
                    className="px-4 py-1.5 bg-blue-600 rounded-full font-bold hover:bg-blue-500 disabled:opacity-50 flex items-center gap-2"
                >
                    {uploading && <Loader2 className="h-4 w-4 animate-spin" />}
                    纭畾
                </button>
            </div>

            {/* 瑁佸壀鍖哄煙 */}
            <div className="relative flex-1 bg-black w-full h-full overflow-hidden">
                <Cropper
                    image={cropperImgSrc}
                    crop={crop}
                    zoom={zoom}
                    aspect={3 / 4} // 馃憟 閿佸畾 3:4 姣斾緥 (閫傚悎灏忚灏侀潰)
                    onCropChange={setCrop}
                    onCropComplete={onCropComplete}
                    onZoomChange={setZoom}
                    classes={{
                        containerClassName: 'h-full w-full',
                    }}
                />
            </div>

            {/* 搴曢儴婊戝潡 */}
            <div className="p-6 bg-black/80 flex items-center justify-center gap-4 z-10 pb-10 md:pb-6">
                <span className="text-xs text-gray-400 font-bold">缂╂斁</span>
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


