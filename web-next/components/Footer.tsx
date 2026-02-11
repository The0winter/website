'use client';

import Link from 'next/link';
// 去掉了 Github 图标的引用
import { Mail, ExternalLink } from 'lucide-react';

export default function Footer() {
  // 🔥 修改 1: 链接列表已清空
  const friendLinks: { name: string; url: string }[] = [
    // 以后要加链接时，像这样写：
    // { name: '某某小说网', url: 'https://example.com' },
  ];

  return (
    <footer className="bg-white dark:bg-[#1a1a1a] border-t border-gray-200 dark:border-[#333] transition-colors duration-300 mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          
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
              <li><Link href="/writer" className="hover:text-blue-600 transition-colors">作家专区</Link></li>
              <li><Link href="/sitemap.xml" className="hover:text-blue-600 transition-colors">站点地图</Link></li>
            </ul>
          </div>

          {/* 3. 友情链接 (SEO 核心区域) */}
          <div className="space-y-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-gray-900 dark:text-gray-100 flex items-center gap-2">
              友情链接 <ExternalLink className="w-3 h-3 opacity-50"/>
            </h3>
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-gray-500 dark:text-gray-400">
              
              {/* 如果没有链接，这里就是空的 */}
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
        {/* Footer 底部区域修改 */}
        <div className="mt-8 pt-8 border-t border-gray-100 dark:border-[#333] flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="text-center md:text-left">
            <p className="text-xs text-gray-400">
              &copy; {new Date().getFullYear()} 九天小说. 
              {/* 删掉 All rights reserved，改成下面这句： */}
              <span className="ml-1 opacity-80">Design by Jiutian.</span>
            </p>
            {/* 新增：免责声明 (字体极小，既免责又不抢眼) */}
            <p className="text-[10px] text-gray-500 mt-1 max-w-md scale-90 origin-left">
              本站所有小说为转载作品，所有章节均由网友上传，转载至本站只是为了宣传本书让更多读者欣赏。
            </p>
          </div>
          
          <div className="flex items-center gap-6 text-gray-400">
             {/* 既然有 Cloudflare 邮件路由，这里可以直接写 support 或 help */}
            <a href="mailto:support@jiutianxiaoshuo.com" className="hover:text-blue-600 transition-colors flex items-center gap-2 text-xs">
              <Mail className="w-4 h-4" /> 联系站长
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}