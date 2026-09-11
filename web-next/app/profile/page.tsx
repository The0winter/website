'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import AccountLoading from '@/components/AccountLoading';
import MobileBottomNav from '@/components/MobileBottomNav';
import AdminModeNotice from '@/components/AdminModeNotice';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  Mail, LogOut, BookOpen, PenTool, Shield, Lock,
  X, CheckCircle2, AlertCircle, ChevronRight, Loader2, Camera
} from 'lucide-react';
import uploadImageToCloudinary from '@/lib/upload';
import { authApi } from '@/lib/api';
import './profile.css';

export default function ProfilePage() {
  const router = useRouter();
  const { user, profile, loading, adminMode, logout, setUser } = useAuth();

  // ================= State 定义 =================
  const [leaving,setLeaving]=useState(false);
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

    if (file.size > 1.5 * 1024 * 1024) {
        setToast({ msg: '图片太大，请上传 1.5MB 以内的图片', type: 'error' });
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
        setToast({ msg: '头像更新成功！', type: 'success' });

    } catch (caught: unknown) { const err = caught instanceof Error ? caught : new Error('操作失败');
        setToast({ msg: err.message || '头像上传失败', type: 'error' });
    } finally {
        setAvatarUploading(false);
    }
  };

  const handleLogout = async () => {
    if (confirm('确定要退出登录吗？')) {
        setLeaving(true);
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
    if (newPassword.length < 8 || new TextEncoder().encode(newPassword).length > 72) {
        setToast({ msg: '新密码至少8位且最多72字节', type: 'error' });
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
            setUser(null);
            router.replace('/login');
            setToast({ msg: '密码修改成功！', type: 'success' });
            setShowPasswordModal(false);
            setOldPassword('');
            setNewPassword('');
            setConfirmPassword('');
        } else {
            setToast({ msg: res.error || '修改失败', type: 'error' });
        }
    } catch {
        setToast({ msg: '网络错误，请稍后重试', type: 'error' });
    } finally {
        setIsSubmitting(false);
    }
  };

  // ================= Effect =================
  useEffect(() => {
    if (loading) return; 
    if (!user && !leaving) {
      router.replace('/login');
    }
  }, [user, loading, router, leaving]);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  if (loading || !user) return <AccountLoading checking={loading} />;

return (
    <div className="profile-page min-h-screen font-sans">
      
      {/* 全局 Toast (保持不变) */}
      {toast && (
        <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-[60] animate-in fade-in slide-in-from-top-4 w-[90%] max-w-sm text-center">
          <div className={`px-4 py-3 rounded-xl shadow-sm border font-medium flex items-center justify-center gap-2 ${
            toast.type === 'success' ? 'profile-toast-success' : 'profile-toast-error'
          }`}>
            {toast.type === 'success' ? <CheckCircle2 className="h-5 w-5"/> : <AlertCircle className="h-5 w-5"/>}
            {toast.msg}
          </div>
        </div>
      )}

      <div className="profile-shell max-w-2xl mx-auto">
        
        <div className="profile-card overflow-hidden">

            {/* ================= 顶部：个人信息区域 ================= */}
            <div className="relative group/card">
                
                <div className="profile-cover relative h-32 md:h-48 overflow-hidden" />
                
                <div className="px-4 pb-4 md:px-8 md:pb-8 relative">
                    <div className="flex flex-col md:flex-row items-center md:items-end -mt-16 md:-mt-16 gap-4 md:gap-6 relative z-10">
                        
                        {/* 头像 */}
                        <div className="relative group/avatar shrink-0">
                            <div className="profile-avatar h-24 w-24 md:h-32 md:w-32 rounded-full border-[5px] border-[var(--home-surface)] bg-[var(--home-surface)] shadow-md flex items-center justify-center text-3xl font-bold text-[var(--home-accent)] overflow-hidden relative z-10">
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
                            <div className="profile-camera absolute bottom-0 right-0 md:hidden z-30 bg-[var(--home-surface)] text-[var(--home-accent)] rounded-full p-2 shadow-[0_2px_8px_rgba(0,0,0,0.1)] border border-[var(--home-border)] pointer-events-none">
                                <Camera className="h-4 w-4" />
                            </div>
                        </div>

                        {/* 用户名等 */}
                        <div className="profile-identity flex-1 text-center md:text-left md:mb-4 space-y-1">
                            <h1 className="text-2xl md:text-3xl font-bold text-[var(--home-text)] flex flex-col md:flex-row items-center gap-2 font-display tracking-tight">
                                {user.username}
                                <span className={`px-2.5 py-0.5 text-xs rounded-full font-medium border flex items-center gap-1 mt-1 md:mt-0 shadow-sm ${
                                    profile?.role === 'admin'
                                        ? 'bg-[var(--home-accent-soft)] text-[var(--home-accent)] border-[var(--home-border)]'
                                        : 'bg-[var(--home-soft)] text-[#96734c] border-[var(--home-border)]'
                                }`}>
                                    {profile?.role === 'admin' ? <Shield className="h-3 w-3" /> : <PenTool className="h-3 w-3" />}
                                    {profile?.role === 'admin' ? '超级管理员' : '创作者'}
                                </span>
                            </h1>
                            <p className="text-[var(--home-muted)] text-sm flex items-center justify-center md:justify-start gap-1.5 font-medium">
                                <Mail className="h-3.5 w-3.5 text-[var(--home-muted)]" /> {user.email}
                            </p>
                        </div>

                        <div className="hidden md:block md:mb-6">
                            <button 
                                onClick={handleLogout}
                                className="group/btn flex items-center gap-2 px-5 py-2 text-[var(--home-muted)] bg-[var(--home-surface)] hover:bg-[var(--home-soft)] border border-[var(--home-border)] hover:border-[var(--home-border)] rounded-xl transition-all text-sm font-bold shadow-sm"
                            >
                                <LogOut className="h-4 w-4 text-[var(--home-muted)] group-hover/btn:text-[var(--home-text)] transition-colors" /> 退出
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* ================= 功能入口 ================= */}
            <div className="profile-shortcuts px-4 md:px-6 pb-2 grid grid-cols-2 gap-3 mt-4">
                
                <Link href="/library" className="group flex items-center p-3 sm:p-4 bg-[var(--home-soft)] hover:bg-[var(--home-accent-soft)] border border-[var(--home-border)] rounded-2xl transition">
                    {/* 修改：手机端图标变小 (h-8 w-8)，右边距变小 (mr-2) */}
                    <div className="h-8 w-8 sm:h-10 sm:w-10 bg-[var(--home-surface)] text-[var(--home-accent)] rounded-xl flex items-center justify-center shadow-sm border border-[var(--home-border)] mr-2 sm:mr-4 group-hover:scale-110 transition-transform shrink-0">
                        <BookOpen className="h-4 w-4 sm:h-5 sm:w-5" />
                    </div>
                    <div className="flex-1 min-w-0"> {/* min-w-0 防止文字撑开布局 */}
                        <h3 className="font-bold text-[var(--home-text)] text-sm truncate">我的书架</h3>
                        <p className="text-xs text-[var(--home-muted)] truncate">阅读历史</p>
                    </div>
                    {/* 修改：手机端隐藏箭头，节省空间 */}
                    <ChevronRight className="h-4 w-4 text-[var(--home-muted)] group-hover:text-[var(--home-muted)] hidden sm:block shrink-0" />
                </Link>

                <Link href="/writer" className="group flex items-center p-3 sm:p-4 bg-[var(--home-soft)] hover:bg-[var(--home-accent-soft)] border border-[var(--home-border)] hover:border-[var(--home-border)] rounded-2xl transition">
                    <div className="h-8 w-8 sm:h-10 sm:w-10 bg-[var(--home-surface)] text-[#a17d55] rounded-xl flex items-center justify-center shadow-sm border border-[var(--home-border)] mr-2 sm:mr-4 group-hover:scale-110 transition-transform shrink-0">
                        <PenTool className="h-4 w-4 sm:h-5 sm:w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <h3 className="font-bold text-[var(--home-text)] text-sm truncate">创作管理</h3>
                        <p className="text-xs text-[var(--home-muted)] truncate">创作中心</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-[var(--home-muted)] group-hover:text-[var(--home-muted)] hidden sm:block shrink-0" />
                </Link>
            </div>

            {adminMode && <div className="px-6 pt-4 text-[var(--home-text)]"><AdminModeNotice/></div>}

            {/* ================= 账户安全 (保持原样) ================= */}
            <div className="mt-2">
                <div className="px-8 py-4 flex items-center gap-2 mt-4">
                    <Shield className="h-4 w-4 text-[#6a7d60]" />
                    <h3 className="font-bold text-[var(--home-text)] text-sm">账户安全</h3>
                </div>
                
                <div className="divide-y divide-[var(--home-border)] border-t border-[var(--home-border)]">
                    <div 
                        onClick={() => setShowPasswordModal(true)}
                        className="flex justify-between items-center px-8 py-4 hover:bg-[var(--home-soft)] transition cursor-pointer active:bg-[var(--home-soft)]"
                    >
                        <div>
                            <div className="font-medium text-[var(--home-text)] text-sm">登录密码</div>
                            <div className="text-xs text-[var(--home-muted)] mt-0.5">建议定期修改密码以保护账户安全</div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-[var(--home-muted)]" />
                    </div>

                    <div className="flex justify-between items-center px-8 py-4">
                        <div>
                            <div className="font-medium text-[var(--home-text)] text-sm">绑定邮箱</div>
                            <div className="text-xs text-[var(--home-muted)] mt-0.5">{user.email}</div>
                        </div>
                        <span className="text-[#6a7d60] bg-[#edf1e8] px-2 py-0.5 rounded text-xs font-medium flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" /> 已验证
                        </span>
                    </div>
                </div>
            </div>

            {/* 移动端退出按钮 */}
            <div className="profile-logout md:hidden px-6 pb-6 pt-4">
                <button 
                    onClick={handleLogout}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 text-[var(--home-muted)] bg-[var(--home-soft)] border border-[var(--home-border)] rounded-xl font-medium active:bg-[var(--home-soft)] transition-colors text-sm"
                >
                    <LogOut className="h-4 w-4" /> 退出登录
                </button>
            </div>
            
            {/* 版本号移到里面，避免被截断 */}
            <p className="text-center text-[var(--home-muted)] text-xs py-6">v1.0.0</p>

        </div> {/* End of 大容器 */}

      </div>

      <MobileBottomNav/>

      {/* ================= 修改密码 Modal (保持不变) ================= */}
      {showPasswordModal && (
        <div role="dialog" aria-modal="true" aria-labelledby="password-title" className="profile-dialog fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm p-0 md:p-4 animate-in fade-in duration-200">
            <div className="bg-[var(--home-surface)] w-full md:w-full md:max-w-md rounded-t-2xl md:rounded-2xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom-10 md:zoom-in-95 duration-200">
                <div className="px-6 py-4 border-b border-[var(--home-border)] bg-[var(--home-soft)] flex justify-between items-center">
                    <h3 id="password-title" className="text-lg font-bold text-[var(--home-text)] flex items-center gap-2">
                        <Lock className="h-5 w-5 text-[var(--home-accent)]" /> 修改密码
                    </h3>
                    <button aria-label="关闭修改密码" onClick={() => setShowPasswordModal(false)} className="p-1 -mr-2 text-[var(--home-muted)] hover:text-[var(--home-text)] transition">
                        <X className="h-6 w-6" />
                    </button>
                </div>
                
                <form onSubmit={handleChangePassword} className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-bold text-[var(--home-text)] mb-1">旧密码</label>
                        <input 
                            type="password" 
                            value={oldPassword}
                            onChange={(e) => setOldPassword(e.target.value)}
                            className="w-full px-4 py-3 bg-[var(--home-soft)] border border-[var(--home-border)] rounded-xl focus:bg-[var(--home-surface)] focus:ring-2 focus:ring-[var(--home-accent)] outline-none text-[var(--home-text)] text-sm transition"
                            placeholder="输入当前密码"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-[var(--home-text)] mb-1">新密码</label>
                        <input 
                            type="password" 
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            className="w-full px-4 py-3 bg-[var(--home-soft)] border border-[var(--home-border)] rounded-xl focus:bg-[var(--home-surface)] focus:ring-2 focus:ring-[var(--home-accent)] outline-none text-[var(--home-text)] text-sm transition"
                            placeholder="设置新密码（至少8位）"
                            required
                            minLength={8}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-[var(--home-text)] mb-1">确认新密码</label>
                        <input 
                            type="password" 
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            className={`w-full px-4 py-3 bg-[var(--home-soft)] border rounded-xl focus:bg-[var(--home-surface)] focus:ring-2 outline-none text-[var(--home-text)] text-sm transition ${
                                confirmPassword && newPassword !== confirmPassword 
                                ? 'border-red-300 focus:ring-red-500' 
                                : 'border-[var(--home-border)] focus:ring-[var(--home-accent)]'
                            }`}
                            placeholder="再次输入新密码"
                            required
                            minLength={8}
                        />
                        {confirmPassword && newPassword !== confirmPassword && (
                             <p className="text-xs text-red-500 mt-1 pl-1">两次输入的密码不一致</p>
                        )}
                    </div>

                    <div className="pt-4 flex gap-3 pb-safe md:pb-0">
                        <button 
                            type="button" 
                            onClick={() => setShowPasswordModal(false)}
                            className="flex-1 py-3 bg-[var(--home-soft)] text-[var(--home-text)] font-bold rounded-xl hover:bg-[var(--home-accent-soft)] transition active:scale-95"
                        >
                            取消
                        </button>
                        <button 
                            type="submit" 
                            disabled={isSubmitting}
                            className={`flex-1 py-3 text-white font-bold rounded-xl shadow-sm transition flex items-center justify-center gap-2 active:scale-95
                                bg-[var(--home-accent)] hover:brightness-95 disabled:opacity-50 disabled:cursor-not-allowed
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
