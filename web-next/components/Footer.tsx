'use client';

import Link from 'next/link';
import { Mail, Github, ExternalLink } from 'lucide-react';

export default function Footer() {
  // 这里填入你以后交换到的友情链接
  // 暂时先放几个高质量的导航站或大站撑门面
  const friendLinks = [
    { name: '起点中文网', url: 'https://www.qidian.com' },
    { name: '纵横小说', url: 'https://www.zongheng.com' },
    { name: '笔趣阁 (示例)', url: '#' }, 
    // 等你找到朋友了，就在这里加： { name: '朋友的小说站', url: 'https://...' }
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
              海量热门小说免费阅读，每日更新，致力打造最舒适的阅读体验。
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
              <li><Link href="/rank" className="hover:text-blue-600 transition-colors">排行榜</Link></li>
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
              {friendLinks.map((link, index) => (
                <a 
                  key={index} 
                  href={link.url} 
                  target="_blank" 
                  rel="noopener noreferrer" // ⚠️ 自己的朋友不用加 nofollow，否则对方会生气
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

        <div className="mt-8 pt-8 border-t border-gray-100 dark:border-[#333] flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-xs text-gray-400 text-center md:text-left">
            &copy; {new Date().getFullYear()} 九天小说. All rights reserved.
          </p>
          <div className="flex items-center gap-6 text-gray-400">
            <a href="mailto:admin@jiutianxiaoshuo.com" className="hover:text-blue-600 transition-colors flex items-center gap-2 text-xs">
              <Mail className="w-4 h-4" /> 联系站长
            </a>
            <a href="https://github.com" target="_blank" className="hover:text-blue-600 transition-colors flex items-center gap-2 text-xs">
              <Github className="w-4 h-4" /> 源码
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}