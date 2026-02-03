'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
// 1. 引入 X 图标
import { Search, User, LogOut, BookOpen, PenTool, Library, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useReadingSettings } from '@/contexts/ReadingSettingsContext'; 

export default function Navbar() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [searchQuery, setSearchQuery] = useState('');
  
  // 2. 新增移动端搜索框开关状态
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);

  const { theme } = useReadingSettings(); 
  const isDark = theme === 'dark';

  if (pathname?.startsWith('/read/')) {
    return null;
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      router.push(`/search?q=${encodeURIComponent(searchQuery)}`);
      // 搜索提交后关闭移动端搜索框
      setIsMobileSearchOpen(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    router.push('/');
  };

  const navBg = isDark ? 'bg-[#1a1a1a]' : 'bg-white';
  const navBorder = isDark ? 'border-[#333333]' : 'border-gray-200';
  const textPrimary = isDark ? 'text-gray-200' : 'text-gray-900';
  const textSecondary = isDark ? 'text-gray-400' : 'text-gray-600';
  const hoverText = 'hover:text-blue-600';

  return (
    <nav className={`${navBg} border-b ${navBorder} sticky top-0 z-50 transition-colors duration-300`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* ==================== 1. 电脑端布局 (hidden md:flex) 保持不变 ==================== */}
        <div className="hidden md:flex justify-between h-16">
          {/* Logo */}
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
                
                <button onClick={handleLogout} className={`p-2 transition-colors hover:text-red-600 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  <LogOut className="h-5 w-5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center space-x-2">
                <Link href="/login" className={`${textSecondary} ${hoverText} px-3 py-2 rounded-md text-sm font-medium`}>登录</Link>
                <Link href="/register" className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700">注册</Link>
              </div>
            )}
          </div>
        </div>

        {/* ==================== 2. 手机端布局 (md:hidden) ==================== */}
        {/* 改动：将布局改为 flex-col 以容纳下方的搜索框 */}
        <div className="md:hidden flex flex-col">
            <div className="flex justify-between items-center h-14">
                {/* 左侧：精简 Logo */}
                <Link href="/" className="flex items-center gap-2">
                   <BookOpen className="w-5 h-5 text-blue-600" />
                   <span className={`font-black text-lg tracking-tighter ${textPrimary}`}>九天</span>
                </Link>

                {/* 右侧：图标组 */}
                <div className={`flex items-center gap-5 ${textSecondary}`}>
                   {/* 搜索图标 (改动：点击展开/收起搜索框) */}
                   <button 
                     onClick={() => setIsMobileSearchOpen(!isMobileSearchOpen)}
                     className="focus:outline-none"
                   >
                     {isMobileSearchOpen ? (
                       <X className="w-5 h-5" /> // 展开时显示关闭图标
                     ) : (
                       <Search className="w-5 h-5" /> // 收起时显示搜索图标
                     )}
                   </button>
                   
                   {/* 书架图标 */}
                   <Link href="/library"><Library className="w-5 h-5" /></Link>
                   
                   {/* 用户头像 */}
                   <Link href={user ? "/profile" : "/login"}>
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center ${isDark ? 'bg-[#333]' : 'bg-gray-100'}`}>
                          <User className="w-4 h-4" />
                      </div>
                   </Link>
                </div>
            </div>

            {/* 🔥 新增：移动端折叠搜索框 */}
            {isMobileSearchOpen && (
              <div className="pb-3 animate-in slide-in-from-top-5 fade-in duration-200">
                <form onSubmit={handleSearch} className="relative">
                  <input
                    autoFocus // 自动聚焦
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="搜索书籍、作者..."
                    className={`w-full pl-10 pr-4 py-2 rounded-lg border transition-colors focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm
                      ${isDark 
                        ? 'bg-[#2a2a2a] border-[#444] text-gray-100 placeholder-gray-500' 
                        : 'bg-gray-50 border-gray-300 text-gray-900 placeholder-gray-400'
                      }
                    `}
                  />
                  <Search className={`absolute left-3 top-2.5 h-4 w-4 ${isDark ? 'text-gray-500' : 'text-gray-400'}`} />
                  
                  {/* 可选：输入框内的搜索按钮 */}
                  <button type="submit" className="absolute right-2 top-1.5 bg-blue-600 text-white px-3 py-0.5 rounded text-xs">
                    搜索
                  </button>
                </form>
              </div>
            )}
        </div>

      </div>
    </nav>
  );
}