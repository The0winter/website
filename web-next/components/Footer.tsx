'use client';

import Link from 'next/link';
import { Mail, ExternalLink } from 'lucide-react';
import { usePathname } from 'next/navigation'; // 1. 引入路径获取钩子

export default function Footer() {
  const pathname = usePathname(); // 2. 获取当前路由路径

  // 3. 如果当前路径是 /writer（创作中心），则直接不渲染 Footer
  if (pathname?.startsWith('/writer')) {
    return null;
  }

  const friendLinks: { name: string; url: string }[] = [];

  return (
    <footer className="bg-white dark:bg-[#1a1a1a] border-t border-gray-200 dark:border-[#333] transition-colors duration-300 mt-auto">
      {/* 调整了移动端的上下 padding (py-4)，保留网页端的 py-12 */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 md:py-12">
        
        {/* 桌面端显示的三列信息，移动端直接隐藏 (hidden md:grid) */}
        <div className="hidden md:grid md:grid-cols-3 gap-8">
          {/* 1. 网站简介 */}
          <div className="space-y-4">
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              九天小说站
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed max-w-xs">
              致力打造最舒适的阅读体验。
              <br />
              基于 MERN Stack 技术栈构建。
            </p>
          </div>

          {/* 2. 快速导航 */}
          <div className="space-y-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-gray-900 dark:text-gray-100">
              快速导航
            </h3>
            <ul className="space-y-2 text-sm text-gray-500 dark:text-gray-400">
              <li><Link href="/library" className="hover:text-blue-600 transition-colors">我的书架</Link></li>
              <li><Link href="/ranking" className="hover:text-blue-600 transition-colors">排行榜</Link></li>
              <li><Link href="/writer" className="hover:text-blue-600 transition-colors">创作管理</Link></li>
              <li><Link href="/sitemap.xml" className="hover:text-blue-600 transition-colors">站点地图</Link></li>
            </ul>
          </div>

          {/* 3. 友情链接 */}
          <div className="space-y-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-gray-900 dark:text-gray-100 flex items-center gap-2">
              友情链接 <ExternalLink className="w-3 h-3 opacity-50"/>
            </h3>
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-gray-500 dark:text-gray-400">
              {friendLinks.map((link, index) => (
                <a 
                  key={index} 
                  href={link.url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="hover:text-blue-600 hover:underline transition-colors"
                >
                  {link.name}
                </a>
              ))}
              <span className="text-xs text-gray-400 self-center">
                (申请友链请联系底部邮箱)
              </span>
            </div>
          </div>
        </div>

        {/* 底部区域（移动端精简展示） */}
        <div className="mt-0 md:mt-8 pt-2 md:pt-8 md:border-t md:border-gray-100 dark:md:border-[#333] flex flex-col md:flex-row justify-between items-center gap-2 md:gap-4">
          <div className="text-center md:text-left flex flex-col items-center md:items-start">
            <p className="text-[10px] md:text-xs text-gray-400">
              &copy; {new Date().getFullYear()} 九天小说站. 
              <span className="ml-1 opacity-80">Design by Jiutian.</span>
            </p>
            {/* 免责声明 */}
            <p className="text-[10px] text-gray-400 md:text-gray-500 mt-1 max-w-md md:scale-90 md:origin-left text-center md:text-left">
              九天小说站 - 专注极速阅读体验
            </p>
          </div>
          
          <div className="flex items-center gap-6 text-gray-400 mt-1 md:mt-0">
            <a href="mailto:support@jiutianxiaoshuo.com" className="hover:text-blue-600 transition-colors flex items-center gap-1 md:gap-2 text-[10px] md:text-xs">
              <Mail className="w-3 h-3 md:w-4 md:h-4" /> 联系站长
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}