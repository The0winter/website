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
    <div className="min-h-screen bg-gray-50 font-sans">
      
      {/* 全局 Toast (保持不变) */}
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

      {/* 主内容区域：
          1. 移除了 py-6 px-4 等所有内边距，确保内容贴边。
          2. 保留 max-w-2xl mx-auto 确保在大屏上居中。
      */}
      <div className="max-w-2xl mx-auto">
        
        {/* 核心大框：
            1. 新增 min-h-screen：强制高度至少占满整个屏幕，实现“上下贯通”。
            2. 移除 rounded-3xl：既已贯通，去掉圆角更自然（也符合“顶到边界”的视觉）。
            3. 保留 shadow-xl 和 bg-white。
        */}
        <div className="bg-white min-h-screen shadow-xl overflow-hidden border-x border-gray-100">

            {/* ================= 顶部：个人信息区域 ================= */}
            <div className="relative group/card">
                
                {/* 这里的代码完全保持原样，没有任何功能改动 */}
                <div className="relative h-32 md:h-48 bg-gradient-to-b from-blue-100 to-white overflow-hidden">
                    <div className="absolute top-0 right-0 -mt-8 -mr-8 h-48 w-48 bg-blue-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-pulse"></div>
                    <div className="absolute bottom-0 left-0 -mb-8 -ml-8 h-48 w-48 bg-indigo-100 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-pulse delay-1000"></div>
                </div>
                
                <div className="px-4 pb-4 md:px-8 md:pb-8 relative">
                    <div className="flex flex-col md:flex-row items-center md:items-end -mt-16 md:-mt-16 gap-4 md:gap-6 relative z-10">
                        
                        {/* 头像 */}
                        <div className="relative group/avatar shrink-0">
                            <div className="h-24 w-24 md:h-32 md:w-32 rounded-full border-[5px] border-white bg-white shadow-md flex items-center justify-center text-3xl font-bold text-indigo-600 overflow-hidden relative z-10">
                                {avatarUploading && (
                                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-20">
                                        <Loader2 className="h-8 w-8 text-white animate-spin" />
                                    </div>
                                )}
                                {user.avatar ? (
                                    <img src={user.avatar} alt="Avatar" className="w-full h-full object-cover scale-[1.02] group-hover/avatar:scale-110 transition-transform duration-500" />
                                ) : (
                                    (user.username || 'User').substring(0, 1).toUpperCase()
                                )}
                                <label className="absolute inset-0 cursor-pointer flex flex-col items-center justify-center bg-black/0 hover:bg-black/20 transition-colors z-20">
                                    <input 
                                        type="file" 
                                        className="hidden" 
                                        accept="image/*" 
                                        onChange={handleAvatarUpload}
                                        disabled={avatarUploading}
                                    />
                                    <Camera className="h-9 w-9 text-white opacity-0 group-hover/avatar:opacity-100 transition-all duration-300 drop-shadow-lg scale-90 group-hover/avatar:scale-100" />
                                </label>
                            </div>
                            <div className="absolute bottom-0 right-0 md:hidden z-30 bg-white text-blue-600 rounded-full p-2 shadow-[0_2px_8px_rgba(0,0,0,0.1)] border border-gray-50 pointer-events-none">
                                <Camera className="h-4 w-4" />
                            </div>
                        </div>

                        {/* 用户名等 */}
                        <div className="flex-1 text-center md:text-left md:mb-4 space-y-1">
                            <h1 className="text-2xl md:text-3xl font-bold text-gray-900 flex flex-col md:flex-row items-center gap-2 font-display tracking-tight">
                                {user.username}
                                <span className={`px-2.5 py-0.5 text-xs rounded-full font-medium border flex items-center gap-1 mt-1 md:mt-0 shadow-sm ${
                                    profile?.role === 'writer' 
                                        ? 'bg-amber-50 text-amber-700 border-amber-100' 
                                        : 'bg-blue-50 text-blue-700 border-blue-100'
                                }`}>
                                    {profile?.role === 'writer' ? <PenTool className="h-3 w-3" /> : <BookOpen className="h-3 w-3" />}
                                    {profile?.role === 'writer' ? '签约作家' : '普通读者'}
                                </span>
                            </h1>
                            <p className="text-gray-500 text-sm flex items-center justify-center md:justify-start gap-1.5 font-medium">
                                <Mail className="h-3.5 w-3.5 text-gray-400" /> {user.email}
                            </p>
                        </div>

                        <div className="hidden md:block md:mb-6">
                            <button 
                                onClick={handleLogout}
                                className="group/btn flex items-center gap-2 px-5 py-2 text-gray-500 bg-white/50 hover:bg-gray-50 border border-gray-200 hover:border-gray-300 rounded-xl transition-all text-sm font-bold shadow-sm"
                            >
                                <LogOut className="h-4 w-4 text-gray-400 group-hover/btn:text-gray-600 transition-colors" /> 退出
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* ================= 功能入口 (保持原样) ================= */}
            <div className="px-6 pb-2 grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                <Link href="/library" className="group flex items-center p-4 bg-gray-50 rounded-2xl hover:bg-gray-100 transition border border-transparent hover:border-gray-200">
                    <div className="h-10 w-10 bg-white text-blue-600 rounded-lg flex items-center justify-center mr-4 shadow-sm group-hover:scale-110 transition-transform">
                        <BookOpen className="h-5 w-5" />
                    </div>
                    <div className="flex-1">
                        <h3 className="font-bold text-gray-900 text-sm">我的书架</h3>
                        <p className="text-xs text-gray-500 mt-0.5">继续阅读你的收藏</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-gray-300 group-hover:text-blue-500 transition-colors" />
                </Link>

                <Link href="/writer" className="group flex items-center p-4 bg-gray-50 rounded-2xl hover:bg-amber-50 transition border border-transparent hover:border-amber-100">
                    <div className="h-10 w-10 bg-white text-amber-600 rounded-lg flex items-center justify-center mr-4 shadow-sm group-hover:scale-110 transition-transform">
                        <PenTool className="h-5 w-5" />
                    </div>
                    <div className="flex-1">
                        <h3 className="font-bold text-gray-900 text-sm">作家专区</h3>
                        <p className="text-xs text-gray-500 mt-0.5">发布与管理作品</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-gray-300 group-hover:text-amber-500 transition-colors" />
                </Link>
            </div>

            {/* ================= 账户安全 (保持原样) ================= */}
            <div className="mt-2">
                <div className="px-8 py-4 flex items-center gap-2 mt-4">
                    <Shield className="h-4 w-4 text-green-600" />
                    <h3 className="font-bold text-gray-900 text-sm">账户安全</h3>
                </div>
                
                <div className="divide-y divide-gray-50 border-t border-gray-50">
                    <div 
                        onClick={() => setShowPasswordModal(true)}
                        className="flex justify-between items-center px-8 py-4 hover:bg-gray-50 transition cursor-pointer active:bg-gray-100"
                    >
                        <div>
                            <div className="font-medium text-gray-700 text-sm">登录密码</div>
                            <div className="text-xs text-gray-400 mt-0.5">建议定期修改密码以保护账户安全</div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-gray-300" />
                    </div>

                    <div className="flex justify-between items-center px-8 py-4">
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

            {/* 移动端退出按钮 */}
            <div className="md:hidden px-6 pb-6 pt-4">
                <button 
                    onClick={handleLogout}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 text-gray-500 bg-gray-50 border border-gray-100 rounded-xl font-medium active:bg-gray-100 transition-colors text-sm"
                >
                    <LogOut className="h-4 w-4" /> 退出登录
                </button>
            </div>
            
            {/* 版本号移到里面，避免被截断 */}
            <p className="text-center text-gray-300 text-xs py-6">v1.0.0</p>

        </div> {/* End of 大容器 */}

      </div>

      {/* ================= 修改密码 Modal (保持不变) ================= */}
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