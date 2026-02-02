'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { Search, User, LogOut, BookOpen, PenTool } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
// ✅ 1. 解除注释，引入设置 Context
import { useReadingSettings } from '@/contexts/ReadingSettingsContext'; 

export default function Navbar() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [searchQuery, setSearchQuery] = useState('');

  // ✅ 2. 获取全局主题 (theme)
  // 假设你的 Context 里提供了 theme 状态 ('light' | 'dark')
  const { theme } = useReadingSettings(); 
  const isDark = theme === 'dark'; // 判断是否为夜间模式

  // ✅ 3. 在阅读页面时不渲染导航栏
  if (pathname?.startsWith('/read/')) {
    return null;
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      router.push(`/search?q=${encodeURIComponent(searchQuery)}`);
    }
  };

  const handleLogout = async () => {
    await logout();
    router.push('/');
  };

  // 定义动态样式变量
  const navBg = isDark ? 'bg-[#1a1a1a]' : 'bg-white';
  const navBorder = isDark ? 'border-[#333333]' : 'border-gray-200';
  const textPrimary = isDark ? 'text-gray-200' : 'text-gray-900';
  const textSecondary = isDark ? 'text-gray-400' : 'text-gray-600';
  const hoverText = 'hover:text-blue-600';

  return (
    <nav className={`${navBg} border-b ${navBorder} sticky top-0 z-50 transition-colors duration-300`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          
          {/* Logo 区域 */}
          <div className="flex items-center">
            <Link href="/" className="flex items-center">
              <BookOpen className="h-8 w-8 text-blue-600" />
              <span className={`ml-2 text-xl font-bold ${textPrimary}`}>
                九天小说
              </span>
            </Link>
          </div>

          {/* 搜索框 */}
          <div className="flex-1 flex items-center justify-center px-8">
            <form onSubmit={handleSearch} className="w-full max-w-lg relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索书籍、作者..."
                // ✅ 3. 核心修改：
                // - bg-transparent: 让背景适应深色
                // - text-gray-900 / text-gray-100: 解决字体太淡的问题
                // - placeholder: 调整提示文字颜色
                // - border: 调整边框颜色
                className={`w-full pl-10 pr-4 py-2 rounded-full border transition-colors focus:outline-none focus:ring-1 focus:ring-blue-500
                  ${isDark 
                    ? 'bg-[#2a2a2a] border-[#444] text-gray-100 placeholder-gray-500 focus:border-blue-500' 
                    : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus:border-blue-500'
                  }
                `}
              />
              <Search className={`absolute left-3 top-2.5 h-5 w-5 ${isDark ? 'text-gray-500' : 'text-gray-400'}`} />
            </form>
          </div>

          {/* 右侧按钮 */}
          <div className="flex items-center space-x-4">
            <Link 
              href="/library" 
              className={`${textSecondary} ${hoverText} px-3 py-2 rounded-md text-sm font-medium transition-colors`}
            >
              书架
            </Link>

            {user ? (
              <div className="flex items-center space-x-4">
                {user.role === 'writer' && (
                  <Link 
                    href="/writer"
                    className={`flex items-center space-x-1 ${textSecondary} ${hoverText} transition-colors`}
                  >
                    <PenTool className="h-5 w-5" />
                    <span>作家专区</span>
                  </Link>
                )}
                
                <Link 
                  href="/profile" 
                  className={`flex items-center space-x-2 px-3 py-2 rounded-md transition-colors ${isDark ? 'hover:bg-[#333]' : 'hover:bg-gray-100'}`}
                >
                  <div className={`h-8 w-8 rounded-full flex items-center justify-center ${isDark ? 'bg-[#333]' : 'bg-gray-200'}`}>
                    <User className={`h-5 w-5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`} />
                  </div>
                  <span className={`${textSecondary} font-medium`}>{user.username}</span>
                </Link>
                
                <button
                  onClick={handleLogout}
                  className={`p-2 transition-colors hover:text-red-600 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}
                >
                  <LogOut className="h-5 w-5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center space-x-2">
                <Link 
                  href="/login"
                  className={`${textSecondary} ${hoverText} px-3 py-2 rounded-md text-sm font-medium transition-colors`}
                >
                  登录
                </Link>
                <Link
                  href="/register"
                  className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700 transition-colors"
                >
                  注册
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}