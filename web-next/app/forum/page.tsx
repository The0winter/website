'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  MessageCircle, HelpCircle, Flame, Compass, BookOpen, Feather, Scroll, ArrowRight, ThumbsUp
} from 'lucide-react';
// 引入 API 和类型
import { forumApi, ForumPost } from '@/lib/api';

// 热门话题 (模拟书籍榜单)
const HOT_TOPICS = [
  "官方通报南京博物院事件",
  "梦舟飞船又一次试验成功",
  "日本众议院选举投票结束",
  "Seedance2.0使用影视飓风...",
  "黑神话钟馗发布6分钟实机...",
];

// 定义主题色配置
const theme = {
    bg: 'bg-[#fdfbf7]', 
    card: 'bg-[#fffefc]',
    border: 'border-[#e8e4d9]',
    textMain: 'text-[#2c1810]',
    textSub: 'text-[#8c7b75]', // 浅棕灰
    accent: 'text-[#8b4513]', // 皮革棕
    hover: 'hover:bg-[#f0eee6]',
};

export default function ForumPage() {
  const [activeTab, setActiveTab] = useState<'recommend' | 'hot' | 'follow'>('recommend');
  const [posts, setPosts] = useState<ForumPost[]>([]);
  const [loading, setLoading] = useState(true);

  // 获取数据
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
    <div className={`min-h-screen ${theme.bg} pb-10 font-sans`}>

      {/* === 顶部导航栏 (书签式设计) === */}
      <div className={`sticky top-0 z-30 ${theme.bg}/95 backdrop-blur-md border-b ${theme.border}`}>
        <div className="max-w-[1000px] mx-auto px-4 h-16 flex items-center justify-center">
          <nav className="flex items-center gap-8 md:gap-12"> 
            {[
              { id: 'follow', label: '关注', icon: BookOpen },
              { id: 'recommend', label: '推荐', icon: Compass },
              { id: 'hot', label: '热榜', icon: Flame }
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`relative h-full px-2 flex items-center gap-2 transition-colors duration-300 group
                    ${isActive ? theme.textMain : 'text-[#a89f91] hover:text-[#5c4b45]'}`
                  }
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'fill-current opacity-20' : ''}`} />
                  <span className={`font-serif text-base tracking-wide ${isActive ? 'font-bold' : 'font-medium'}`}>
                      {tab.label}
                  </span>
                  
                  {/* 底部指示器：改成一个小圆点或短线，不那么生硬 */}
                  {isActive && (
                    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-[#8b4513]"></div>
                  )}
                </button>
              )
            })}
          </nav>
        </div>
      </div>

      {/* === 主体内容区 === */}
      <div className="max-w-[1000px] mx-auto px-4 md:px-0 mt-6 grid grid-cols-1 md:grid-cols-[1fr_296px] gap-6">
        
        {/* === 左侧：内容流 === */}
        <div className="flex flex-col gap-4">
          
          {/* 加载状态 */}
          {loading && (
             <div className={`${theme.card} p-12 text-center ${theme.textSub} border ${theme.border} rounded-lg italic font-serif`}>
                翻阅藏书中...
             </div>
          )}

          {/* 真实数据列表 */}
          {!loading && posts.map((post: any) => {
            const realId = post.id || post._id;
            if (!realId) return null;

            return (
            <div 
                key={realId} 
                className={`${theme.card} p-6 rounded-lg border border-transparent hover:border-[#e8e4d9] shadow-sm hover:shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] transition-all duration-300 group`}
            >
                {/* 1. 标题 */}
                <Link href={`/forum/question/${realId}`}>
                  <h2 className={`text-xl font-serif font-bold ${theme.textMain} mb-3 leading-snug cursor-pointer group-hover:text-[#8b4513] transition-colors`}>
                      {post.title}
                  </h2>
                </Link>

                {/* 2. 摘要 */}
                <Link href={`/forum/question/${realId}`}>
                  <div className={`${theme.textMain} text-[15px] opacity-80 leading-7 mb-4 cursor-pointer line-clamp-3 font-light`}>
                      {post.excerpt || '暂无摘要...'}
                  </div>
                </Link>

                {/* 底部操作栏 */}
                <div className="flex items-center justify-between pt-4 border-t border-[#f5f5f5]">
                    <div className="flex items-center gap-6 text-xs font-medium text-[#998a85]">
                         {/* 作者 */}
                        <span className="flex items-center gap-1.5 text-[#5c4b45]">
                            <Feather className="w-3.5 h-3.5" />
                            {typeof post.author === 'string' ? post.author : (post.author?.username || post.author?.name || '书友')}
                        </span>

                        {/* 赞同 */}
                        <button className="flex items-center gap-1.5 hover:text-[#8b4513] transition-colors">
                            <ThumbsUp className="w-3.5 h-3.5" />
                            {post.votes > 1000 ? (post.votes/1000).toFixed(1) + 'k' : post.votes || 0} 赏
                        </button>
                        
                        {/* 评论 */}
                        <button className="flex items-center gap-1.5 hover:text-[#8b4513] transition-colors">
                            <MessageCircle className="w-3.5 h-3.5" />
                            {post.comments || 0} 评
                        </button>
                    </div>

                    {/* 阅读按钮 */}
                    <Link href={`/forum/question/${realId}`} className="text-xs text-[#8b4513] flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity font-serif italic">
                        继续阅读 <ArrowRight className="w-3 h-3" />
                    </Link>
                </div>
            </div>
            );
          })}

          {!loading && posts.length === 0 && (
             <div className={`${theme.card} p-12 text-center ${theme.textSub} rounded-lg border ${theme.border}`}>
                 案头空空，何不挥毫泼墨？
             </div>
          )}
          
          {/* 加载更多 */}
          <div className={`${theme.card} py-4 text-center ${theme.textSub} text-sm rounded-lg cursor-pointer border ${theme.border} hover:bg-[#faf9f5] transition-colors font-serif italic`}>
            查看更多藏书...
          </div>
        </div>

        {/* === 右侧：侧边栏 === */}
        <div className="hidden md:flex flex-col gap-6">
           
           {/* 创作中心 (已删除回答按钮) */}
           <div className={`${theme.card} rounded-lg border ${theme.border} p-5 shadow-sm`}>
              <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-2">
                      <span className={`text-sm font-bold font-serif ${theme.textMain}`}>创作案台</span>
                  </div>
                  <span className={`text-xs ${theme.textSub} cursor-pointer hover:text-[#8b4513]`}>草稿箱 (0)</span>
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                    {/* 1. 提问 -> 改为 求惑 */}
                    <Link href="/forum/create?type=question" className="flex flex-col items-center justify-center gap-2 py-5 bg-[#faf9f5] hover:bg-[#f0eee6] border border-[#f0eee6] rounded transition-colors group cursor-pointer">
                        <HelpCircle className="w-5 h-5 text-[#8b4513] opacity-70 group-hover:opacity-100" />
                        <span className="text-xs text-[#5c4b45] font-serif">求惑 / 讨论</span>
                    </Link>

                    {/* 2. 写文章 -> 改为 著书 */}
                    <Link href="/forum/create?type=article" className="flex flex-col items-center justify-center gap-2 py-5 bg-[#faf9f5] hover:bg-[#f0eee6] border border-[#f0eee6] rounded transition-colors group cursor-pointer">
                        <Scroll className="w-5 h-5 text-[#8b4513] opacity-70 group-hover:opacity-100" />
                        <span className="text-xs text-[#5c4b45] font-serif">著书 / 书评</span>
                    </Link>
              </div>

                <Link href="/forum/create?type=article" className="mt-4 flex items-center justify-center gap-2 w-full py-2.5 bg-[#2c1810] text-[#fdfbf7] text-sm rounded hover:bg-[#4a2c20] transition-colors font-serif tracking-wide shadow-sm">
                    <Feather className="w-3.5 h-3.5" /> 提笔挥毫
                </Link>
            </div>
            
           {/* 热榜侧栏 */}
           <div className={`${theme.card} rounded-lg border ${theme.border} p-5 shadow-sm`}>
             <div className="flex justify-between items-center mb-4 pb-2 border-b border-[#f5f5f5]">
                  <h3 className={`font-serif font-bold ${theme.textMain} text-sm`}>坊间热议</h3>
             </div>
             <ul className="flex flex-col gap-3">
                 {HOT_TOPICS.map((topic, index) => (
                     <li key={index} className="flex items-start gap-3 cursor-pointer group">
                         <span className={`text-sm font-serif font-bold italic w-4 text-center mt-0.5
                            ${index < 3 ? 'text-[#8b4513]' : 'text-[#dcdcdc]'}`}>
                             {index + 1}
                         </span>
                         <span className={`text-[13px] ${theme.textMain} leading-relaxed group-hover:text-[#8b4513] group-hover:underline decoration-[#e8e4d9] underline-offset-4 line-clamp-2`}>
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