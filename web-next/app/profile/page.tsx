'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  Mail, LogOut, BookOpen, PenTool, Lock, 
  X, CheckCircle2, AlertCircle, ChevronRight, Loader2, Camera 
} from 'lucide-react';
import uploadImageToCloudinary from '@/lib/upload';
import { authApi } from '@/lib/api';

export default function ProfilePage() {
  const router = useRouter();
  
  // 🔽 修复1：去掉 setUser (防止报错)，只取原本就有的 logout
  const { user, profile, loading, logout } = useAuth();

  // ================= State 定义 =================
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState<{msg: string, type: 'success' | 'error'} | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);

  // ================= 逻辑处理 =================
  
  // 📸 处理头像上传
  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (avatarUploading) return;
    const file = e.target.files?.[0];
    if (!file || !user) return;

    if (file.size > 2 * 1024 * 1024) {
        setToast({ msg: '图片太大，请上传 2MB 以内的图片', type: 'error' });
        return;
    }

    try {
        setAvatarUploading(true);
        // 1. 上传图片拿到 URL
        const url = await uploadImageToCloudinary(file);
        
        // 2. 更新后端
        const updatedUserFromBackend = await authApi.updateUser(user.id, { avatar: url });
        
        // 🔽 修复2：修正变量名，把 res.error 改成 updatedUserFromBackend.error
        if (updatedUserFromBackend.error) {
            throw new Error(updatedUserFromBackend.error);
        }

        // 3. 更新本地存储
        const storedUser = JSON.parse(localStorage.getItem('user') || '{}');
        const newUser = { ...storedUser, avatar: url };
        localStorage.setItem('user', JSON.stringify(newUser));

        setToast({ msg: '头像更新成功！', type: 'success' });
        
        // 🔽 修复3：因为没有 setUser，我们用回你原来的刷新页面方法，这样最安全
        setTimeout(() => window.location.reload(), 1000);

    } catch (err: any) {
        setToast({ msg: err.message || '头像上传失败', type: 'error' });
    } finally {
        setAvatarUploading(false);
    }
  };

  const handleLogout = async () => {
    if (confirm('确定要退出登录吗？')) {
        await logout();
        router.push('/'); 
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    if (!oldPassword || !newPassword || !confirmPassword) {
        setToast({ msg: '请填写所有字段', type: 'error' });
        return;
    }
    if (newPassword.length < 6) {
        setToast({ msg: '新密码至少需要6位', type: 'error' });
        return;
    }
    if (newPassword !== confirmPassword) {
        setToast({ msg: '两次输入的新密码不一致！', type: 'error' });
        return;
    }
    if (oldPassword === newPassword) {
        setToast({ msg: '新密码不能和旧密码相同', type: 'error' });
        return;
    }

    setIsSubmitting(true);
    try {
        const res = await authApi.changePassword(user.id, oldPassword, newPassword);
        if (res.success) {
            setToast({ msg: '密码修改成功！', type: 'success' });
            setShowPasswordModal(false);
            setOldPassword('');
            setNewPassword('');
            setConfirmPassword('');
        } else {
            setToast({ msg: res.error || '修改失败', type: 'error' });
        }
    } catch (err) {
        setToast({ msg: '网络错误，请稍后重试', type: 'error' });
    } finally {
        setIsSubmitting(false);
    }
  };

  // ================= Effect =================
  useEffect(() => {
    if (loading) return; 
    if (!user) {
      router.push('/login'); 
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-3">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="text-gray-500 text-sm">正在获取用户信息...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-gray-100 py-8 px-4 md:py-12 font-sans flex justify-center items-start">
      
      {/* 全局 Toast */}
      {toast && (
        <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-[60] animate-in fade-in slide-in-from-top-4 w-[90%] max-w-sm text-center">
          <div className={`px-4 py-3 rounded-xl shadow-xl text-white font-medium flex items-center justify-center gap-2 ${
            toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'
          }`}>
            {toast.type === 'success' ? <CheckCircle2 className="h-5 w-5"/> : <AlertCircle className="h-5 w-5"/>}
            {toast.msg}
          </div>
        </div>
      )}

      {/* 🔽 修复4：这就是你要求的“白色书页 + 阴影”长条布局 */}
      <div className="w-full max-w-3xl bg-white shadow-[0_20px_60px_-15px_rgba(0,0,0,0.1)] min-h-[85vh] relative overflow-hidden flex flex-col">
        
        {/* 页眉区域 */}
        <div className="h-48 bg-gradient-to-r from-blue-600 to-indigo-700 relative">
             <div className="absolute inset-0 bg-white/5 opacity-50" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '24px 24px' }}></div>
        </div>

        {/* 个人信息 */}
        <div className="px-8 pb-8 -mt-20 relative z-10 border-b border-gray-100">
             <div className="flex flex-col items-start">
                
                {/* 头像 */}
                <div className="relative group/avatar">
                    <div className="h-36 w-36 rounded-full border-[6px] border-white bg-white shadow-lg flex items-center justify-center overflow-hidden relative">
                         {avatarUploading && (
                            <div className="absolute inset-0 bg-black/40 flex items-center justify-center z-20">
                                <Loader2 className="h-10 w-10 text-white animate-spin" />
                            </div>
                        )}
                        {/* 🔽 修复5：加问号 user?.avatar 解决 TS 报错 */}
                        {user?.avatar ? (
                            <img src={user.avatar} alt="Avatar" className="w-full h-full object-cover group-hover/avatar:scale-105 transition-transform duration-500" />
                        ) : (
                            <span className="text-4xl font-bold text-indigo-600">{(user?.username || 'U').substring(0, 1).toUpperCase()}</span>
                        )}
                        
                        <label className="absolute inset-0 cursor-pointer flex flex-col items-center justify-center bg-black/0 hover:bg-black/20 transition-colors z-20">
                            <input type="file" className="hidden" accept="image/*" onChange={handleAvatarUpload} disabled={avatarUploading} />
                            <Camera className="h-10 w-10 text-white opacity-0 group-hover/avatar:opacity-100 transition-opacity drop-shadow-md" />
                        </label>
                    </div>
                </div>

                {/* 名字与邮箱 */}
                <div className="mt-4 space-y-1 w-full flex justify-between items-end">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
                            {/* 🔽 修复6：加问号 user?.username */}
                            {user?.username}
                            <span className={`px-2.5 py-0.5 text-xs rounded-full font-medium border flex items-center gap-1 ${
                                profile?.role === 'writer' 
                                    ? 'bg-amber-50 text-amber-700 border-amber-200' 
                                    : 'bg-blue-50 text-blue-700 border-blue-200'
                            }`}>
                                {profile?.role === 'writer' ? '签约作家' : '普通读者'}
                            </span>
                        </h1>
                        <p className="text-gray-500 font-medium flex items-center gap-2 mt-1">
                            {/* 🔽 修复7：加问号 user?.email */}
                            <Mail className="h-4 w-4" /> {user?.email}
                        </p>
                    </div>

                    <button onClick={handleLogout} className="hidden md:flex text-gray-400 hover:text-red-600 transition-colors items-center gap-1 text-sm font-medium">
                        <LogOut className="h-4 w-4" /> 退出
                    </button>
                </div>
             </div>
        </div>

        {/* 核心功能流 */}
        <div className="flex-1 py-6">
            
            <div className="px-8 mb-2 text-xs font-bold text-gray-400 uppercase tracking-wider">创作与阅读</div>
            
            <Link href="/library" className="group flex items-center px-8 py-5 hover:bg-gray-50 transition-colors border-l-4 border-transparent hover:border-blue-500">
                <div className="h-12 w-12 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center mr-5 group-hover:scale-110 transition-transform shadow-sm">
                    <BookOpen className="h-6 w-6" />
                </div>
                <div className="flex-1">
                    <h3 className="text-lg font-bold text-gray-900 group-hover:text-blue-600 transition-colors">我的书架</h3>
                    <p className="text-sm text-gray-500 mt-0.5">查看收藏历史与阅读进度</p>
                </div>
                <ChevronRight className="h-5 w-5 text-gray-300 group-hover:text-blue-500 group-hover:translate-x-1 transition-all" />
            </Link>

            <Link href="/writer" className="group flex items-center px-8 py-5 hover:bg-gray-50 transition-colors border-l-4 border-transparent hover:border-amber-500">
                <div className="h-12 w-12 bg-amber-50 text-amber-600 rounded-lg flex items-center justify-center mr-5 group-hover:scale-110 transition-transform shadow-sm">
                    <PenTool className="h-6 w-6" />
                </div>
                <div className="flex-1">
                    <h3 className="text-lg font-bold text-gray-900 group-hover:text-amber-600 transition-colors">作家专区</h3>
                    <p className="text-sm text-gray-500 mt-0.5">发布作品，管理你的小说创作</p>
                </div>
                <ChevronRight className="h-5 w-5 text-gray-300 group-hover:text-amber-500 group-hover:translate-x-1 transition-all" />
            </Link>

            <div className="my-6 border-t border-gray-100 mx-8"></div>

            <div className="px-8 mb-2 text-xs font-bold text-gray-400 uppercase tracking-wider">账户安全</div>

            <div 
                onClick={() => setShowPasswordModal(true)}
                className="group flex items-center px-8 py-4 hover:bg-gray-50 transition-colors cursor-pointer border-l-4 border-transparent hover:border-gray-300"
            >
                <div className="h-10 w-10 bg-gray-50 text-gray-600 rounded-lg flex items-center justify-center mr-5">
                    <Lock className="h-5 w-5" />
                </div>
                <div className="flex-1">
                    <div className="font-bold text-gray-900">登录密码</div>
                    <div className="text-xs text-gray-400 mt-0.5">定期修改密码以保护安全</div>
                </div>
                <div className="px-3 py-1 bg-gray-100 text-gray-600 text-xs font-bold rounded hover:bg-gray-200 transition">修改</div>
            </div>

            <div className="flex items-center px-8 py-4 hover:bg-gray-50 transition-colors border-l-4 border-transparent">
                <div className="h-10 w-10 bg-gray-50 text-gray-600 rounded-lg flex items-center justify-center mr-5">
                    <Mail className="h-5 w-5" />
                </div>
                <div className="flex-1">
                    <div className="font-bold text-gray-900">绑定邮箱</div>
                    <div className="text-xs text-gray-400 mt-0.5">{user?.email}</div>
                </div>
                <span className="text-green-600 bg-green-50 px-2 py-0.5 rounded text-xs font-bold flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" /> 已验证
                </span>
            </div>

        </div>

        <div className="bg-gray-50/50 h-16 flex items-center justify-center border-t border-gray-100 mt-auto">
             <span className="text-xs text-gray-300 font-mono">ID: {user?.id}</span>
        </div>
      </div>

        {/* 移动端悬浮退出按钮 */}
        <div className="md:hidden fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
            <button 
                onClick={handleLogout}
                className="flex items-center gap-2 px-6 py-3 text-white bg-gray-900 shadow-xl rounded-full font-bold active:scale-95 transition-all"
            >
                <LogOut className="h-4 w-4" /> 退出登录
            </button>
        </div>

      {/* ================= 修改密码 Modal (这里完全没变) ================= */}
      {showPasswordModal && (
        <div className="fixed inset-0 z-[100] flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm p-0 md:p-4 animate-in fade-in duration-200">
            <div className="bg-white w-full md:w-full md:max-w-md rounded-t-2xl md:rounded-2xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom-10 md:zoom-in-95 duration-200">
                <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
                    <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                        <Lock className="h-5 w-5 text-blue-600" /> 修改密码
                    </h3>
                    <button onClick={() => setShowPasswordModal(false)} className="p-1 -mr-2 text-gray-400 hover:text-gray-600 transition">
                        <X className="h-6 w-6" />
                    </button>
                </div>
                
                <form onSubmit={handleChangePassword} className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">旧密码</label>
                        <input 
                            type="password" 
                            value={oldPassword}
                            onChange={(e) => setOldPassword(e.target.value)}
                            className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none text-gray-900 text-sm transition"
                            placeholder="输入当前密码"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">新密码</label>
                        <input 
                            type="password" 
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none text-gray-900 text-sm transition"
                            placeholder="设置新密码（至少6位）"
                            required
                            minLength={6}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">确认新密码</label>
                        <input 
                            type="password" 
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            className={`w-full px-4 py-3 bg-gray-50 border rounded-xl focus:bg-white focus:ring-2 outline-none text-gray-900 text-sm transition ${
                                confirmPassword && newPassword !== confirmPassword 
                                ? 'border-red-300 focus:ring-red-500' 
                                : 'border-gray-200 focus:ring-blue-500'
                            }`}
                            placeholder="再次输入新密码"
                            required
                            minLength={6}
                        />
                        {confirmPassword && newPassword !== confirmPassword && (
                             <p className="text-xs text-red-500 mt-1 pl-1">两次输入的密码不一致</p>
                        )}
                    </div>

                    <div className="pt-4 flex gap-3 pb-safe md:pb-0">
                        <button 
                            type="button" 
                            onClick={() => setShowPasswordModal(false)}
                            className="flex-1 py-3 bg-gray-100 text-gray-700 font-bold rounded-xl hover:bg-gray-200 transition active:scale-95"
                        >
                            取消
                        </button>
                        <button 
                            type="submit" 
                            disabled={isSubmitting}
                            className={`flex-1 py-3 text-white font-bold rounded-xl shadow-lg transition flex items-center justify-center gap-2 active:scale-95
                                ${isSubmitting ? 'bg-blue-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 hover:shadow-blue-500/30'}
                            `}
                        >
                            {isSubmitting ? '处理中...' : '确认修改'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
      )}

    </div>
  );
}