'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  User, Mail, Calendar, LogOut, 
  BookOpen, PenTool, Shield, Lock, X, CheckCircle2, AlertCircle // 👈 新增图标
} from 'lucide-react';
import { authApi } from '@/lib/api'; // 👈 记得导入 authApi

export default function ProfilePage() {
  const { user, profile, loading, logout } = useAuth();
  const router = useRouter();

  // ================= State 定义 =================
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState<{msg: string, type: 'success' | 'error'} | null>(null);

  // ================= Effect =================
  useEffect(() => {
    if (loading) return; 
    if (!user) {
      router.push('/login'); 
    }
  }, [user, loading, router]);

  // Toast 自动消失
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
    if (!oldPassword || !newPassword) {
        setToast({ msg: '请填写所有字段', type: 'error' });
        return;
    }
    if (newPassword.length < 6) {
        setToast({ msg: '新密码至少需要6位', type: 'error' });
        return;
    }

    setIsSubmitting(true);
    try {
        // 调用我们刚刚在 api.ts 里写的方法
        const res = await authApi.changePassword(user.id, oldPassword, newPassword);
        
        if (res.success) {
            setToast({ msg: '密码修改成功！', type: 'success' });
            setShowPasswordModal(false);
            setOldPassword('');
            setNewPassword('');
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
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8 font-sans">
      
      {/* 全局 Toast 提示 */}
      {toast && (
        <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-[60] animate-in fade-in slide-in-from-top-4">
          <div className={`px-6 py-3 rounded-full shadow-lg text-white font-medium flex items-center gap-2 ${
            toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'
          }`}>
            {toast.type === 'success' ? <CheckCircle2 className="h-5 w-5"/> : <AlertCircle className="h-5 w-5"/>}
            {toast.msg}
          </div>
        </div>
      )}

      <div className="max-w-3xl mx-auto space-y-6">
        
        {/* 顶部：个人信息卡片 */}
        <div className="bg-white shadow-sm rounded-2xl overflow-hidden border border-gray-100">
            <div className="h-32 bg-gradient-to-r from-blue-500 to-indigo-600"></div>
            
            <div className="px-8 pb-8 relative">
                {/* 头像 */}
                <div className="relative -mt-16 mb-6">
                    <div className="h-32 w-32 rounded-full border-4 border-white bg-white shadow-md flex items-center justify-center text-4xl font-bold text-indigo-600 select-none overflow-hidden">
                        {(user.username || 'User').substring(0, 1).toUpperCase()}
                    </div>
                </div>

                {/* 文字信息 */}
                <div className="flex justify-between items-start">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
                            {user.username}
                            <span className={`px-3 py-1 text-xs rounded-full font-medium border flex items-center gap-1
                                ${profile?.role === 'writer' 
                                    ? 'bg-amber-50 text-amber-700 border-amber-200' 
                                    : 'bg-blue-50 text-blue-700 border-blue-200' 
                                }`}>
                                {profile?.role === 'writer' ? <PenTool className="h-3 w-3" /> : <BookOpen className="h-3 w-3" />}
                                {profile?.role === 'writer' ? '签约作家' : '热爱阅读'}
                            </span>
                        </h1>
                        <p className="text-gray-500 mt-1 flex items-center gap-2">
                            <Mail className="h-4 w-4" /> {user.email}
                        </p>
                        <p className="text-gray-400 text-sm mt-1 flex items-center gap-2">
                            <Calendar className="h-4 w-4" /> 
                            ID: {(user.id || (user as any)._id || '').toString().slice(0, 8)}... 
                        </p>
                    </div>

                    <button 
                        onClick={handleLogout}
                        className="flex items-center gap-2 px-4 py-2 text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors text-sm font-medium"
                    >
                        <LogOut className="h-4 w-4" /> 退出登录
                    </button>
                </div>
            </div>
        </div>

        {/* 中间：功能入口区 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Link href="/library" className="group block bg-white p-6 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all">
                <div className="flex items-center gap-4 mb-4">
                    <div className="h-12 w-12 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform">
                        <BookOpen className="h-6 w-6" />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-gray-900">我的书架</h3>
                        <p className="text-gray-500 text-sm">查看收藏和阅读历史</p>
                    </div>
                </div>
                <div className="text-blue-600 text-sm font-medium group-hover:underline">前往书架 &rarr;</div>
            </Link>

            <Link href="/writer" className="group block bg-gradient-to-br from-amber-50 to-orange-50 p-6 rounded-2xl border border-amber-100 shadow-sm hover:shadow-md transition-all">
                <div className="flex items-center gap-4 mb-4">
                    <div className="h-12 w-12 bg-amber-100 text-amber-600 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform">
                        <PenTool className="h-6 w-6" />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-amber-900">作家工作台</h3>
                        <p className="text-amber-700/70 text-sm">开始创作你的小说</p>
                    </div>
                </div>
                <div className="text-amber-700 text-sm font-medium group-hover:underline">进入创作中心 &rarr;</div>
            </Link>
        </div>

        {/* 底部：账户安全 (✅ 已解锁) */}
        <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
            <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                <Shield className="h-5 w-5 text-blue-600" /> 账户安全
            </h3>
            <div className="space-y-4">
                <div className="flex justify-between items-center py-2 border-b border-gray-100">
                    <span className="text-gray-600">登录密码</span>
                    {/* ✅ 点击按钮触发弹窗 */}
                    <button 
                        onClick={() => setShowPasswordModal(true)}
                        className="text-blue-600 text-sm font-bold hover:text-blue-800 hover:bg-blue-50 px-3 py-1 rounded-lg transition"
                    >
                        修改
                    </button>
                </div>
                <div className="flex justify-between items-center py-2">
                    <span className="text-gray-600">绑定邮箱</span>
                    <span className="text-gray-400 text-sm flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" /> 已绑定
                    </span>
                </div>
            </div>
        </div>

      </div>

      {/* ================= 修改密码 Modal ================= */}
      {showPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
                    <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                        <Lock className="h-5 w-5 text-blue-600" /> 修改密码
                    </h3>
                    <button onClick={() => setShowPasswordModal(false)} className="text-gray-400 hover:text-gray-600 transition">
                        <X className="h-5 w-5" />
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

                    <div className="pt-2 flex gap-3">
                        <button 
                            type="button" 
                            onClick={() => setShowPasswordModal(false)}
                            className="flex-1 py-3 bg-gray-100 text-gray-700 font-bold rounded-xl hover:bg-gray-200 transition"
                        >
                            取消
                        </button>
                        <button 
                            type="submit" 
                            disabled={isSubmitting}
                            className={`flex-1 py-3 text-white font-bold rounded-xl shadow-lg transition flex items-center justify-center gap-2
                                ${isSubmitting ? 'bg-blue-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 hover:shadow-blue-500/30'}
                            `}
                        >
                            {isSubmitting ? (
                                <>
                                    <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin"/>
                                    提交中...
                                </>
                            ) : '确认修改'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
      )}

    </div>
  );
}