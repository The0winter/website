'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
// 引入 Upload 图标
import { Upload, Loader2 } from 'lucide-react';
// 引入你之前用过的上传函数 (假设在 utils 或 lib 下，如果没有请把之前上传封面的那个函数拷过来)
import uploadImageToCloudinary from '@/lib/upload';
import { 
  User, Mail, Calendar, LogOut, 
  BookOpen, PenTool, Shield, Lock, X, CheckCircle2, AlertCircle, ChevronRight 
} from 'lucide-react';
import { authApi } from '@/lib/api';

export default function ProfilePage() {
  const { user, profile, loading, logout } = useAuth();
  const router = useRouter();

  // ================= State 定义 =================
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState<{msg: string, type: 'success' | 'error'} | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  // 📸 处理头像上传
  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    // 限制大小 (比如 2MB)
    if (file.size > 2 * 1024 * 1024) {
        setToast({ msg: '图片太大，请上传 2MB 以内的图片', type: 'error' });
        return;
    }

    try {
        setAvatarUploading(true);
        
        // 1. 上传到 Cloudinary
        const url = await uploadImageToCloudinary(file);
        if (!url) throw new Error('上传失败');

        // 2. 调用后端更新数据库
        const updatedUser = await authApi.updateUser(user.id, { avatar: url });
        
        if (updatedUser.error) {
            throw new Error(updatedUser.error);
        }

        // 3. 更新本地存储和状态，让页面立刻刷新
        // 注意：这里最简单的办法是更新 localStorage 然后重载页面，或者调用 AuthContext 的 update 方法
        const storedUser = JSON.parse(localStorage.getItem('user') || '{}');
        const newUser = { ...storedUser, avatar: url };
        localStorage.setItem('user', JSON.stringify(newUser));
        
        setToast({ msg: '头像更新成功！', type: 'success' });
        
        // 强制刷新页面以更新所有地方的头像 (简单粗暴但有效)
        setTimeout(() => window.location.reload(), 1000);

    } catch (err: any) {
        setToast({ msg: err.message || '头像上传失败', type: 'error' });
    } finally {
        setAvatarUploading(false);
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

  // ================= 逻辑处理 =================
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
    <div className="min-h-screen bg-gray-50 pb-12 font-sans">
      
      {/* 全局 Toast 提示 */}
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

      {/* ✅ 移动端布局优化重点：
         1. padding 缩小: px-4 sm:px-6
         2. py 缩小: py-6 md:py-12
      */}
      <div className="py-6 px-4 md:py-12 md:px-6 lg:px-8 max-w-4xl mx-auto space-y-6">
        
{/* ================= 顶部：个人信息卡片 ================= */}
        <div className="bg-white shadow-sm rounded-2xl overflow-hidden border border-gray-100 relative group">
            {/* 1. 背景图高度改小: h-16 (原h-24) */}
            <div className="h-16 md:h-28 bg-gradient-to-r from-blue-500 to-indigo-600"></div>
            
            {/* 2. Padding 改小: p-4 (原p-6) */}
            <div className="p-4 md:px-6 md:pb-6 relative">
                <div className="flex flex-col md:flex-row items-center md:items-start">
                    
                    {/* 头像 - 尺寸和上边距都改小 */}
                    {/* -mt-10 (原-12), h-20 w-20 (原h-24 w-24) */}
                    <div className="relative -mt-10 md:-mt-14 mb-3 md:mb-6 group/avatar">
                    <div className="h-20 w-20 md:h-32 md:w-32 rounded-full border-[4px] border-white bg-white shadow-md flex items-center justify-center text-2xl md:text-4xl font-bold text-indigo-600 select-none overflow-hidden relative">
                        
                        {/* A. 如果正在上传，显示转圈 */}
                        {avatarUploading ? (
                            <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-20">
                                <Loader2 className="h-8 w-8 text-white animate-spin" />
                            </div>
                        ) : null}

                        {/* B. 如果有头像，显示图片；否则显示首字母 */}
                        {user.avatar ? (
                            <img src={user.avatar} alt="Avatar" className="w-full h-full object-cover" />
                        ) : (
                            (user.username || 'User').substring(0, 1).toUpperCase()
                        )}

                        {/* C. 悬停遮罩层 + 上传 Input */}
                        <label className="absolute inset-0 bg-black/40 opacity-0 group-hover/avatar:opacity-100 transition-opacity flex flex-col items-center justify-center cursor-pointer text-white z-10">
                            <Upload className="h-6 w-6 md:h-8 md:w-8 mb-1" />
                            <span className="text-[10px] md:text-xs font-bold">更换头像</span>
                            {/* 隐藏的文件输入框 */}
                            <input 
                                type="file" 
                                className="hidden" 
                                accept="image/*" 
                                onChange={handleAvatarUpload}
                                disabled={avatarUploading}
                            />
                        </label>
                    </div>
                    
                    {/* 移动端提示 (因为手机没有悬停状态，加一个小相机图标提示用户可以点) */}
                    <div className="absolute bottom-0 right-0 md:hidden bg-white rounded-full p-1.5 shadow-sm border border-gray-100 pointer-events-none">
                        <Upload className="h-3 w-3 text-gray-500" />
                    </div>
                </div>
                        <div className="h-20 w-20 md:h-32 md:w-32 rounded-full border-[4px] border-white bg-white shadow-md flex items-center justify-center text-2xl md:text-4xl font-bold text-indigo-600 select-none overflow-hidden">
                            {(user.username || 'User').substring(0, 1).toUpperCase()}
                        </div>
                    </div>

                    {/* 文字信息区域 */}
                    <div className="flex-1 w-full md:ml-6 md:mt-3 text-center md:text-left">
                        <div className="flex flex-col md:flex-row justify-between items-center md:items-start w-full">
                            <div>
                                <h1 className="text-xl md:text-3xl font-bold text-gray-900 flex flex-col md:flex-row items-center gap-2 md:gap-3">
                                    {user.username}
                                    {/* 角色徽章 */}
                                    <span className={`px-2 py-0.5 text-[10px] md:text-xs rounded-full font-medium border flex items-center gap-1 mt-1 md:mt-0
                                        ${profile?.role === 'writer' 
                                            ? 'bg-amber-50 text-amber-700 border-amber-200' 
                                            : 'bg-blue-50 text-blue-700 border-blue-200' 
                                        }`}>
                                        {profile?.role === 'writer' ? <PenTool className="h-3 w-3" /> : <BookOpen className="h-3 w-3" />}
                                        {profile?.role === 'writer' ? '签约作家' : '热爱阅读'}
                                    </span>
                                </h1>
                                
                                <div className="mt-1 md:mt-2 space-y-1 flex flex-col items-center md:items-start">
                                    <p className="text-gray-500 text-xs md:text-sm flex items-center gap-2">
                                        <Mail className="h-3.5 w-3.5" /> {user.email}
                                    </p>
                                    {/* ❌ 已删除 ID 显示部分 */}
                                </div>
                            </div>

                            {/* 退出登录按钮 (PC端保持不变) */}
                            <button 
                                onClick={handleLogout}
                                className="hidden md:flex items-center gap-2 px-4 py-2 text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors text-sm font-medium"
                            >
                                <LogOut className="h-4 w-4" /> 退出登录
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        {/* ================= 中间：功能入口区 ================= */}
        {/* 移动端单列，PC端双列 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
            
            {/* 我的书架 */}
            <Link href="/library" className="group relative bg-white p-5 md:p-6 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all active:scale-[0.98] duration-200">
                <div className="flex items-center gap-4">
                    <div className="h-10 w-10 md:h-12 md:w-12 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform">
                        <BookOpen className="h-5 w-5 md:h-6 md:w-6" />
                    </div>
                    <div className="flex-1">
                        <h3 className="text-base md:text-lg font-bold text-gray-900">我的书架</h3>
                        <p className="text-gray-500 text-xs md:text-sm">查看收藏和阅读历史</p>
                    </div>
                    {/* 移动端添加一个右箭头，增加可点击感 */}
                    <ChevronRight className="h-5 w-5 text-gray-300 md:hidden" />
                </div>
                <div className="hidden md:block mt-4 text-blue-600 text-sm font-medium group-hover:underline">前往书架 &rarr;</div>
            </Link>

            {/* 作家工作台 */}
            <Link href="/writer" className="group relative bg-gradient-to-br from-amber-50 to-orange-50 p-5 md:p-6 rounded-2xl border border-amber-100 shadow-sm hover:shadow-md transition-all active:scale-[0.98] duration-200">
                <div className="flex items-center gap-4">
                    <div className="h-10 w-10 md:h-12 md:w-12 bg-amber-100 text-amber-600 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform">
                        <PenTool className="h-5 w-5 md:h-6 md:w-6" />
                    </div>
                    <div className="flex-1">
                        <h3 className="text-base md:text-lg font-bold text-amber-900">作家工作台</h3>
                        <p className="text-amber-700/70 text-xs md:text-sm">开始创作你的小说</p>
                    </div>
                    <ChevronRight className="h-5 w-5 text-amber-300 md:hidden" />
                </div>
                <div className="hidden md:block mt-4 text-amber-700 text-sm font-medium group-hover:underline">进入创作中心 &rarr;</div>
            </Link>
        </div>

        {/* ================= 底部：账户安全 ================= */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
             <div className="p-4 md:p-6 border-b border-gray-50">
                <h3 className="text-base md:text-lg font-bold text-gray-900 flex items-center gap-2">
                    <Shield className="h-5 w-5 text-blue-600" /> 账户安全
                </h3>
             </div>
            
            <div className="divide-y divide-gray-50">
                {/* 修改密码行 - 移动端加大点击区域 */}
                <div 
                    onClick={() => setShowPasswordModal(true)}
                    className="flex justify-between items-center p-4 md:px-6 hover:bg-gray-50 transition cursor-pointer active:bg-gray-100"
                >
                    <div className="flex flex-col">
                        <span className="text-gray-700 font-medium text-sm md:text-base">登录密码</span>
                        <span className="text-gray-400 text-xs md:hidden">点击修改密码</span>
                    </div>
                    <div className="flex items-center gap-2">
                         {/* PC端显示的按钮 */}
                         <span className="hidden md:inline-block text-blue-600 text-sm font-bold bg-blue-50 px-3 py-1 rounded-lg">
                            修改
                        </span>
                        {/* 移动端显示的箭头 */}
                        <ChevronRight className="h-5 w-5 text-gray-300 md:hidden" />
                    </div>
                </div>

                <div className="flex justify-between items-center p-4 md:px-6">
                    <span className="text-gray-700 font-medium text-sm md:text-base">绑定邮箱</span>
                    <span className="text-green-600 bg-green-50 px-2 py-0.5 rounded text-xs md:text-sm flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" /> 已绑定
                    </span>
                </div>
            </div>
        </div>

        {/* ✅ 移动端专属：底部退出按钮 
            为了方便单手操作，我们在移动端将退出按钮放在最底部，做一个大大的宽按钮
        */}
        <div className="md:hidden pt-4">
            <button 
                onClick={handleLogout}
                className="w-full flex items-center justify-center gap-2 px-4 py-3.5 text-red-600 bg-white border border-red-100 shadow-sm rounded-xl font-bold active:bg-red-50 transition-colors"
            >
                <LogOut className="h-5 w-5" /> 退出登录
            </button>
            <p className="text-center text-gray-300 text-xs mt-4">Version 1.0.0</p>
        </div>

      </div>

      {/* ================= 修改密码 Modal (响应式优化) ================= */}
      {showPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm p-0 md:p-4 animate-in fade-in duration-200">
            {/* Modal 容器：
                Mobile: 底部弹窗 (rounded-t-2xl)
                Desktop: 中心弹窗 (rounded-2xl)
            */}
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
                        <label className="block text-sm font-bold text-gray-700 mb-1">当前旧密码</label>
                        <input 
                            type="password" 
                            value={oldPassword}
                            onChange={(e) => setOldPassword(e.target.value)}
                            className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none text-gray-900 transition"
                            placeholder="请输入正在使用的密码"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">设置新密码</label>
                        <input 
                            type="password" 
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none text-gray-900 transition"
                            placeholder="新密码（至少6位）"
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
                            className={`w-full px-4 py-3 bg-gray-50 border rounded-xl focus:bg-white focus:ring-2 outline-none text-gray-900 transition ${
                                confirmPassword && newPassword !== confirmPassword 
                                ? 'border-red-300 focus:ring-red-500' 
                                : 'border-gray-200 focus:ring-blue-500'
                            }`}
                            placeholder="请再次输入新密码"
                            required
                            minLength={6}
                        />
                        {confirmPassword && newPassword !== confirmPassword && (
                             <p className="text-xs text-red-500 mt-1 pl-1">两次输入的密码不一致</p>
                        )}
                    </div>

                    <div className="pt-2 flex gap-3 pb-safe"> 
                        {/* pb-safe 是为了适配 iPhone 底部黑条，如果是原生 App 开发常需要，Web 一般留点 padding 就行 */}
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
                            {isSubmitting ? '提交中...' : '确认修改'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
      )}

    </div>
  );
}