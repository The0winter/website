'use client';

import Link from './PrefetchLink';
import AccountLink from './AccountLink';
import ThemeToggle from './ThemeToggle';
import UserAvatar from './UserAvatar';
import BookSearch from './BookSearch';
import { useRouter, usePathname } from 'next/navigation';
import Image from 'next/image';
import { LogOut, PenTool } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useReadingSettings } from '@/contexts/ReadingSettingsContext'; 

export default function DesktopNavigation() {
  const { user, logout, loading: authLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  
  const { theme } = useReadingSettings();
  const isDark = theme === 'dark';
  // Only established desktop pages opt in; new routes never inherit old chrome.
  const needsNavigation = ['/', '/profile', '/writer', '/authorsList'].includes(pathname || '')
    || /^\/(book|author)\/[^/]+\/?$/.test(pathname || '');
  if (!needsNavigation || (pathname === '/profile' && (authLoading || !user))) return null;

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
    <nav data-site-chrome="true" aria-label="桌面导航" className={`hidden md:block ${navBg} border-b ${navBorder} sticky top-0 z-50 transition-colors duration-300`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        <div className="hidden md:flex justify-between h-16">
          {/* Logo */}
          <div className="flex items-center">
            <Link href="/" className="flex items-center">
              <Image 
                src="/icon.png"       // 对应 public/icon.png
                alt="Logo" 
                width={32}            // 对应 h-8 (32px)
                height={32} 
                className="w-8 h-8 object-contain" // object-contain 防止图片变形
                priority              // 优先加载 Logo，防止闪烁
              />
              <span className={`ml-2 text-xl font-bold ${textPrimary}`}>
                九天小说站
              </span>
            </Link>
          </div>

          {/* 书库实时搜索 */}
          <div className="flex-1 flex items-center justify-center px-8">
            <BookSearch appearance="navbar" dark={isDark}/>
          </div>

          <div className="flex items-center space-x-4">
            <AccountLink
              href="/library" 
              className={`${textSecondary} ${hoverText} px-3 py-2 rounded-md text-sm font-medium transition-colors`}
            >
              书架
            </AccountLink>

            {user ? (
              <div className="flex items-center space-x-4">
                <Link 
                    href="/writer"
                    className={`flex items-center space-x-1 ${textSecondary} ${hoverText} transition-colors`}
                  >
                    <PenTool className="h-5 w-5" />
                    <span>创作管理</span>
                  </Link>
                
                <ThemeToggle/>
                <Link 
                  href="/profile" 
                  className={`flex items-center space-x-2 px-3 py-2 rounded-md transition-colors ${isDark ? 'hover:bg-[#333]' : 'hover:bg-gray-100'}`}
                >
                  <UserAvatar user={user} dark={isDark}/>
                  <span className={`${textSecondary} font-medium`}>{user.username}</span>
                </Link>
                
                <button aria-label="退出登录" onClick={handleLogout} className={`p-2 transition-colors hover:text-red-600 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  <LogOut className="h-5 w-5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center space-x-2">
                <ThemeToggle/>
                <Link href="/login" className={`${textSecondary} ${hoverText} px-3 py-2 rounded-md text-sm font-medium`}>登录</Link>
                <Link href="/register" className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700">注册</Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
