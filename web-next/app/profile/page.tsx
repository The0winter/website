'use client';

import { useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  User, Mail, Calendar, LogOut, 
  BookOpen, PenTool, Shield 
} from 'lucide-react';

export default function ProfilePage() {
  const { user, profile, loading, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return; 
    if (!user) {
      router.push('/login'); 
    }
  }, [user, loading, router]);

  const handleLogout = async () => {
    if (confirm('确定要退出登录吗？')) {
        await logout();
        router.push('/'); 
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
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto space-y-6">
        
        {/* 顶部：个人信息卡片 */}
        <div className="bg-white shadow-sm rounded-2xl overflow-hidden border border-gray-100">
            <div className="h-32 bg-gradient-to-r from-blue-500 to-indigo-600"></div>
            
            <div className="px-8 pb-8 relative">
                {/* 头像 */}
                <div className="relative -mt-16 mb-6">
                    <div className="h-32 w-32 rounded-full border-4 border-white bg-white shadow-md flex items-center justify-center text-4xl font-bold text-indigo-600 select-none overflow-hidden">
                        {/* ✅ 修改 1: 优化头像逻辑，支持中文首字和英文大写 */}
                        {(user.username || 'User').substring(0, 1).toUpperCase()}
                    </div>
                </div>

                {/* 文字信息 */}
                <div className="flex justify-between items-start">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
                            {user.username}
                            {/* 角色徽章 - 这里我保留了区分，但你可以根据需要决定是否全显示为作家 */}
                            <span className={`px-3 py-1 text-xs rounded-full font-medium border flex items-center gap-1
                                ${profile?.role === 'writer' 
                                    ? 'bg-amber-50 text-amber-700 border-amber-200' 
                                    : 'bg-blue-50 text-blue-700 border-blue-200' // 普通用户改成蓝色好看点
                                }`}>
                                {profile?.role === 'writer' ? <PenTool className="h-3 w-3" /> : <BookOpen className="h-3 w-3" />}
                                {profile?.role === 'writer' ? '签约作家' : '热爱阅读'}
                            </span>
                        </h1>
                        <p className="text-gray-500 mt-1 flex items-center gap-2">
                            <Mail className="h-4 w-4" /> {user.email}
                        </p>
                        <p className="text-gray-400 text-sm mt-1 flex items-center gap-2">
                            <Calendar className="h-4 w-4" /> ID: {user.id.slice(0, 8)}... {/* ID太长了，截取一下比较美观 */}
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
            
            {/* 左侧：我的书架 */}
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

            {/* ✅ 修改 2: 移除 if/else 判断，直接展示作家中心入口 */}
            <Link href="/writer" className="group block bg-gradient-to-br from-amber-50 to-orange-50 p-6 rounded-2xl border border-amber-100 shadow-sm hover:shadow-md transition-all">
                <div className="flex items-center gap-4 mb-4">
                    <div className="h-12 w-12 bg-amber-100 text-amber-600 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform">
                        <PenTool className="h-6 w-6" />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-amber-900">作家工作台</h3>
                        <p className="text-amber-700/70 text-sm">开始创作你的小说</p> {/* 文案也改得更鼓励创作一点 */}
                    </div>
                </div>
                <div className="text-amber-700 text-sm font-medium group-hover:underline">进入创作中心 &rarr;</div>
            </Link>

        </div>

        {/* 底部：账户安全 */}
        <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm opacity-60 grayscale">
            <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                <Shield className="h-5 w-5 text-gray-400" /> 账户安全 (开发中)
            </h3>
            <div className="space-y-4">
                <div className="flex justify-between items-center py-2 border-b border-gray-100">
                    <span className="text-gray-600">修改密码</span>
                    <button disabled className="text-gray-400 text-sm cursor-not-allowed">修改</button>
                </div>
                <div className="flex justify-between items-center py-2">
                    <span className="text-gray-600">绑定邮箱</span>
                    <span className="text-gray-400 text-sm">已绑定</span>
                </div>
            </div>
        </div>

      </div>
    </div>
  );
}