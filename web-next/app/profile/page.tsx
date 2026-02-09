'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  User, Mail, LogOut, BookOpen, PenTool, Shield, Lock, 
  X, CheckCircle2, AlertCircle, ChevronRight, Upload, Loader2, Camera 
} from 'lucide-react';
import uploadImageToCloudinary from '@/lib/upload';
import { authApi } from '@/lib/api';

export default function ProfilePage() {
  const router = useRouter();
  const { user, profile, loading, logout, setUser } = useAuth();

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
        
        if (updatedUserFromBackend.error) {
            throw new Error(updatedUserFromBackend.error);
        }

        // 3. 更新前端状态
        const newUser = { ...user, avatar: url };
        if (setUser) {
            setUser(newUser);
        }
        localStorage.setItem('user', JSON.stringify(newUser));
        setToast({ msg: '头像更新成功！', type: 'success' });

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
    <div className="min-h-screen bg-gray-50 pb-safe font-sans">
      
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

      {/* 主内容区域 */}
      <div className="py-6 px-4 md:py-12 md:px-6 lg:px-8 max-w-4xl mx-auto space-y-6">
        
        {/* ================= 顶部：个人信息卡片 ================= */}
        <div className="bg-white shadow-sm rounded-2xl overflow-hidden border border-gray-100 relative">
            {/* 背景图 */}
            <div className="h-24 md:h-32 bg-gradient-to-r from-blue-600 to-indigo-700"></div>
            
            <div className="px-4 pb-4 md:px-8 md:pb-8 relative">
                <div className="flex flex-col md:flex-row items-center md:items-end -mt-12 md:-mt-16 gap-4 md:gap-6">
                    
                    {/* 头像区域 */}
                    <div className="relative group/avatar shrink-0">
                        <div className="h-24 w-24 md:h-32 md:w-32 rounded-full border-4 border-white bg-white shadow-lg flex items-center justify-center text-3xl font-bold text-indigo-600 overflow-hidden relative z-10">
                            
                            {/* Loading 遮罩 */}
                            {avatarUploading && (
                                <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-20">
                                    <Loader2 className="h-8 w-8 text-white animate-spin" />
                                </div>
                            )}

                            {/* 头像图片 */}
                            {user.avatar ? (
                                <img src={user.avatar} alt="Avatar" className="w-full h-full object-cover" />
                            ) : (
                                (user.username || 'User').substring(0, 1).toUpperCase()
                            )}
                            
                            {/* 上传 Input (覆盖整个头像) */}
                            <label className="absolute inset-0 cursor-pointer flex flex-col items-center justify-center bg-black/0 hover:bg-black/30 transition-colors z-20">
                                <input 
                                    type="file" 
                                    className="hidden" 
                                    accept="image/*" 
                                    onChange={handleAvatarUpload}
                                    disabled={avatarUploading}
                                />
                                {/* PC端悬停显示相机 */}
                                <Camera className="h-8 w-8 text-white opacity-0 group-hover/avatar:opacity-100 transition-opacity drop-shadow-md" />
                            </label>
                        </div>

                        {/* 移动端右下角小相机图标 (提示可点击) */}
                        <div className="absolute bottom-0 right-0 md:hidden z-30 bg-white rounded-full p-1.5 shadow-md border border-gray-100 pointer-events-none">
                            <Camera className="h-3.5 w-3.5 text-gray-600" />
                        </div>
                    </div>

                    {/* 用户信息 */}
                    <div className="flex-1 text-center md:text-left md:mb-2 space-y-1">
                        <h1 className="text-2xl md:text-3xl font-bold text-gray-900 flex flex-col md:flex-row items-center gap-2">
                            {user.username}
                            <span className={`px-2.5 py-0.5 text-xs rounded-full font-medium border flex items-center gap-1 mt-1 md:mt-0 ${
                                profile?.role === 'writer' 
                                    ? 'bg-amber-50 text-amber-700 border-amber-200' 
                                    : 'bg-blue-50 text-blue-700 border-blue-200'
                            }`}>
                                {profile?.role === 'writer' ? <PenTool className="h-3 w-3" /> : <BookOpen className="h-3 w-3" />}
                                {profile?.role === 'writer' ? '签约作家' : '普通读者'}
                            </span>
                        </h1>
                        <p className="text-gray-500 text-sm flex items-center justify-center md:justify-start gap-1.5">
                            <Mail className="h-3.5 w-3.5" /> {user.email}
                        </p>
                    </div>

                    {/* PC端退出按钮 */}
                    <div className="hidden md:block md:mb-4">
                        <button 
                            onClick={handleLogout}
                            className="flex items-center gap-2 px-4 py-2 text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition text-sm font-medium"
                        >
                            <LogOut className="h-4 w-4" /> 退出登录
                        </button>
                    </div>
                </div>
            </div>
        </div>

        {/* ================= 功能入口 ================= */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Link href="/library" className="group flex items-center p-4 bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition active:scale-[0.99]">
                <div className="h-12 w-12 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center mr-4 group-hover:scale-110 transition-transform">
                    <BookOpen className="h-6 w-6" />
                </div>
                <div className="flex-1">
                    <h3 className="font-bold text-gray-900">我的书架</h3>
                    <p className="text-xs text-gray-500 mt-0.5">继续阅读你的收藏</p>
                </div>
                <ChevronRight className="h-5 w-5 text-gray-300 group-hover:text-blue-500 transition-colors" />
            </Link>

            <Link href="/writer" className="group flex items-center p-4 bg-gradient-to-br from-white to-amber-50/50 rounded-xl border border-amber-100 shadow-sm hover:shadow-md transition active:scale-[0.99]">
                <div className="h-12 w-12 bg-amber-100 text-amber-600 rounded-lg flex items-center justify-center mr-4 group-hover:scale-110 transition-transform">
                    <PenTool className="h-6 w-6" />
                </div>
                <div className="flex-1">
                    <h3 className="font-bold text-gray-900">作家专区</h3>
                    <p className="text-xs text-gray-500 mt-0.5">发布与管理作品</p>
                </div>
                <ChevronRight className="h-5 w-5 text-gray-300 group-hover:text-amber-500 transition-colors" />
            </Link>
        </div>

        {/* ================= 账户安全 ================= */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
             <div className="px-5 py-4 border-b border-gray-50 flex items-center gap-2">
                <Shield className="h-5 w-5 text-green-600" />
                <h3 className="font-bold text-gray-900">账户安全</h3>
             </div>
            
            <div className="divide-y divide-gray-50">
                <div 
                    onClick={() => setShowPasswordModal(true)}
                    className="flex justify-between items-center px-5 py-4 hover:bg-gray-50 transition cursor-pointer active:bg-gray-100"
                >
                    <div>
                        <div className="font-medium text-gray-700 text-sm">登录密码</div>
                        <div className="text-xs text-gray-400 mt-0.5">建议定期修改密码以保护账户安全</div>
                    </div>
                    <ChevronRight className="h-5 w-5 text-gray-300" />
                </div>

                <div className="flex justify-between items-center px-5 py-4">
                    <div>
                        <div className="font-medium text-gray-700 text-sm">绑定邮箱</div>
                        <div className="text-xs text-gray-400 mt-0.5">{user.email}</div>
                    </div>
                    <span className="text-green-600 bg-green-50 px-2 py-0.5 rounded text-xs font-medium flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" /> 已验证
                    </span>
                </div>
            </div>
        </div>

        {/* 移动端底部退出按钮 */}
        <div className="md:hidden pb-8 pt-2">
            <button 
                onClick={handleLogout}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 text-gray-500 bg-white border border-gray-200 shadow-sm rounded-xl font-medium active:bg-gray-50 transition-colors"
            >
                <LogOut className="h-5 w-5" /> 退出登录
            </button>
            <p className="text-center text-gray-300 text-xs mt-4">v1.0.0</p>
        </div>

      </div>

      {/* ================= 修改密码 Modal ================= */}
      {showPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm p-0 md:p-4 animate-in fade-in duration-200">
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