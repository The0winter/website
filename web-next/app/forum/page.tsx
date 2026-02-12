'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  MessageCircle, HelpCircle, Flame, Compass, BookOpen, Feather, Scroll, 
  ArrowRight, ThumbsUp, Settings, Search
} from 'lucide-react';
import { forumApi, ForumPost } from '@/lib/api';

// 热门话题
const HOT_TOPICS = [
  "官方通报南京博物院事件",
  "梦舟飞船又一次试验成功",
  "日本众议院选举投票结束",
  "Seedance2.0使用影视飓风...",
  "黑神话钟馗发布6分钟实机...",
];

// 🎨 主题配置：现代极简白
const theme = {
    bg: 'bg-[#f8f9fa]',       // 极淡的灰白，区分卡片和背景，护眼且现代
    card: 'bg-white',         // 纯白卡片
    textMain: 'text-gray-900', // 纯黑文字
    textSub: 'text-gray-500',  // 次要文字灰色
    accent: 'text-gray-900',   // 强调色：黑（极简风通常用黑/深灰作为强调）
    hover: 'hover:bg-gray-50', // 悬停淡灰
    border: 'border-gray-100', // 极细的边框
};

export default function ForumPage() {
  const [activeTab, setActiveTab] = useState<'recommend' | 'hot' | 'follow'>('recommend');
  const [posts, setPosts] = useState<ForumPost[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPosts = async () => {
      try {
        setLoading(true);
        const data = await forumApi.getPosts(activeTab);
        setPosts(data);
      } catch (error) {
        console.error('获取帖子失败:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchPosts();
  }, [activeTab]);

  return (
    // 🔥 全局字体设置：font-sans (黑体/无衬线)
    <div className={`min-h-screen ${theme.bg} pb-10 font-sans`}>

      {/* === 顶部导航栏 === */}
      <div className={`sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b ${theme.border}`}>
        <div className="max-w-[1000px] mx-auto px-4 h-16 flex items-center justify-between">
          
          {/* 左侧：Logo 或 搜索 */}
          <div className="w-10">
              {/* 这里可以放个搜索图标或者留空 */}
              <button className="p-2 text-gray-400 hover:text-gray-900 transition-colors">
                  <Search className="w-5 h-5" />
              </button>
          </div>

          {/* 中间：Tab 导航 */}
          <nav className="flex items-center gap-10 h-full"> 
            {[
              { id: 'follow', label: '关注' },
              { id: 'recommend', label: '推荐' },
              { id: 'hot', label: '热榜' }
            ].map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`relative h-full flex items-center px-1 font-medium text-[16px] transition-colors duration-200
                    ${isActive ? 'text-gray-900 font-bold' : 'text-gray-500 hover:text-gray-800'}`
                  }
                >
                  {tab.label}
                  {/* 极简指示器：底部小黑条 */}
                  {isActive && (
                    <div className="absolute bottom-0 left-0 w-full h-[2px] bg-gray-900 rounded-full"></div>
                  )}
                </button>
              )
            })}
          </nav>

          {/* 右侧：设置入口 (预留位置) */}
          <div className="w-10 flex justify-end">
              <button className="p-2 text-gray-400 hover:text-gray-900 transition-colors" title="阅读设置">
                  <Settings className="w-5 h-5" />
              </button>
          </div>
        </div>
      </div>

      {/* === 主体内容区 === */}
      <div className="max-w-[1000px] mx-auto px-4 md:px-0 mt-6 grid grid-cols-1 md:grid-cols-[1fr_296px] gap-6">
        
        {/* === 左侧：内容流 === */}
        <div className="flex flex-col gap-4">
          
          {loading && (
             <div className={`${theme.card} p-12 text-center text-gray-400 border ${theme.border} rounded-xl`}>
                内容加载中...
             </div>
          )}

          {!loading && posts.map((post: any) => {
            const realId = post.id || post._id;
            if (!realId) return null;

            return (
            <div 
                key={realId} 
                className={`${theme.card} p-6 rounded-xl border border-transparent hover:border-gray-200 shadow-sm hover:shadow-lg transition-all duration-300 group`}
            >
                {/* 1. 标题：加大加粗，纯黑 */}
                <Link href={`/forum/question/${realId}`}>
                  <h2 className="text-[19px] font-bold text-gray-900 mb-2 leading-snug cursor-pointer group-hover:text-blue-600 transition-colors">
                      {post.title}
                  </h2>
                </Link>

                {/* 2. 摘要：深灰，行高舒适 */}
                <Link href={`/forum/question/${realId}`}>
                  <div className="text-[15px] text-gray-600 leading-relaxed mb-4 cursor-pointer line-clamp-3">
                      {post.excerpt || '暂无摘要...'}
                  </div>
                </Link>

                {/* 底部数据栏：极简风格 */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-5 text-xs font-medium text-gray-400">
                         {/* 作者 */}
                        <span className="flex items-center gap-1.5 text-gray-500 bg-gray-50 px-2 py-1 rounded-md">
                            <span className="w-1.5 h-1.5 rounded-full bg-gray-400"></span>
                            {typeof post.author === 'string' ? post.author : (post.author?.username || post.author?.name || '匿名')}
                        </span>

                        {/* 数据 */}
                        <span className="flex items-center gap-1 hover:text-gray-700 transition-colors cursor-default">
                            {post.votes > 1000 ? (post.votes/1000).toFixed(1) + 'k' : post.votes || 0} 赞同
                        </span>
                        <span className="flex items-center gap-1 hover:text-gray-700 transition-colors cursor-default">
                            {post.comments || 0} 评论
                        </span>
                    </div>
                </div>
            </div>
            );
          })}

          {!loading && posts.length === 0 && (
             <div className={`${theme.card} p-12 text-center text-gray-400 rounded-xl`}>
                 暂无内容
             </div>
          )}
          
          <div className="py-6 text-center text-gray-400 text-sm cursor-pointer hover:text-gray-600 transition-colors">
            没有更多了
          </div>
        </div>

        {/* === 右侧：侧边栏 === */}
        <div className="hidden md:flex flex-col gap-6">
           
           {/* 创作中心：极简黑白风 */}
           <div className={`${theme.card} rounded-xl border ${theme.border} p-5 shadow-sm`}>
              <div className="flex items-center justify-between mb-5">
                  <span className="text-sm font-bold text-gray-900">创作中心</span>
                  <span className="text-xs text-gray-400 cursor-pointer hover:text-gray-900">草稿箱</span>
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                    <Link href="/forum/create?type=question" className="flex flex-col items-center justify-center gap-2 py-4 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors group cursor-pointer">
                        <HelpCircle className="w-5 h-5 text-gray-600 group-hover:text-gray-900" />
                        <span className="text-xs text-gray-600 font-medium">求书/提问</span>
                    </Link>

                    <Link href="/forum/create?type=article" className="flex flex-col items-center justify-center gap-2 py-4 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors group cursor-pointer">
                        <Scroll className="w-5 h-5 text-gray-600 group-hover:text-gray-900" />
                        <span className="text-xs text-gray-600 font-medium">书评/文章</span>
                    </Link>
              </div>

                <Link href="/forum/create?type=article" className="mt-4 flex items-center justify-center gap-2 w-full py-2.5 bg-gray-900 text-white text-sm rounded-lg hover:bg-black transition-all shadow-md hover:shadow-lg">
                    <Feather className="w-3.5 h-3.5" /> 开始创作
                </Link>
            </div>
            
           {/* 热榜侧栏 */}
           <div className={`${theme.card} rounded-xl border ${theme.border} p-5 shadow-sm`}>
             <div className="flex justify-between items-center mb-4">
                  <h3 className="font-bold text-gray-900 text-sm">全站热榜</h3>
             </div>
             <ul className="flex flex-col gap-3">
                 {HOT_TOPICS.map((topic, index) => (
                     <li key={index} className="flex items-start gap-3 cursor-pointer group">
                         {/* 排名数字：前三名为深黑，后面为浅灰 */}
                         <span className={`text-[15px] font-bold w-4 text-center leading-5
                            ${index < 3 ? 'text-gray-900' : 'text-gray-300'}`}>
                             {index + 1}
                         </span>
                         <span className="text-[14px] text-gray-700 leading-snug group-hover:text-blue-600 group-hover:underline line-clamp-2">
                              {topic}
                         </span>
                     </li>
                 ))}
             </ul>
           </div>
        </div>
      </div>
    </div>
  );
}