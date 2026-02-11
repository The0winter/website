'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  MessageSquare, MessageCircle, PenSquare, HelpCircle,
} from 'lucide-react';
// 引入 API 和类型
import { forumApi, ForumPost } from '@/lib/api';

// 热门话题
const HOT_TOPICS = [
  "官方通报南京博物院事件",
  "梦舟飞船又一次试验成功",
  "日本众议院选举投票结束",
  "Seedance2.0使用影视飓风...",
  "黑神话钟馗发布6分钟实机...",
];

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
        console.log('📋 帖子列表数据:', data); // 调试：看看控制台打印的是 id 还是 _id
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
    <div className="min-h-screen bg-[#f6f6f6] pb-10">

      {/* 顶部导航栏 */}
      <div className="sticky top-0 z-30 bg-[#f6f6f6]">
        <div className="max-w-[1000px] mx-auto bg-white shadow-sm border-b border-x border-gray-200 px-0 h-14 flex items-center justify-center">
          <nav className="flex items-center justify-center gap-12 w-full h-full"> 
            {[
              { id: 'follow', label: '关注' },
              { id: 'recommend', label: '推荐' },
              { id: 'hot', label: '热榜' }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`relative h-full px-4 text-[16px] transition-colors flex items-center ${
                  activeTab === tab.id 
                    ? 'text-blue-600 font-bold' 
                    : 'text-gray-600 font-medium hover:text-blue-600'
                }`}
              >
                {tab.label}
                {activeTab === tab.id && (
                  <div className="absolute bottom-0 left-0 w-full h-[3px] bg-blue-600"></div>
                )}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* 主体内容区 */}
      <div className="max-w-[1000px] mx-auto px-4 md:px-0 mt-3 grid grid-cols-1 md:grid-cols-[1fr_296px] gap-3">
        
        {/* === 左侧：内容流 === */}
        <div className="flex flex-col gap-2">
          
          {/* 加载状态 */}
          {loading && (
             <div className="bg-white p-10 text-center text-gray-400">加载中...</div>
          )}

          {/* 真实数据列表 */}
          {!loading && posts.map((post: any) => {
            // 🔥 核心修复：兼容 id 和 _id
            // 如果 post.id 存在就用 id，否则用 _id

            const realId = post.id || post._id;

    // 🔥【建议新增】如果 ID 也是空的，直接不渲染这条数据，防止生成坏链接
    if (!realId) return null; 

            return (
            <div 
                key={realId} 
                className="bg-white p-5 rounded-sm shadow-sm hover:shadow-md transition-shadow mb-2"
            >
                {/* 1. 标题 -> 链接到【问题页】 */}
                {/* 🛡️ 使用 realId 替换 post.id */}
                <Link href={`/forum/question/${realId}`}>
                  <h2 className="text-[18px] font-bold text-gray-900 mb-2 hover:text-blue-600 leading-snug cursor-pointer">
                      {post.title}
                  </h2>
                </Link>

                {/* 2. 摘要 */}
                <Link href={`/forum/question/${realId}`}>
                  <div className="text-[15px] text-gray-800 leading-relaxed mb-3 cursor-pointer hover:text-gray-600 line-clamp-3">
                      {post.excerpt || '暂无摘要...'}
                      <span className="text-blue-500 text-sm ml-1">阅读全文 &rarr;</span>
                  </div>
                </Link>

                {/* 底部操作栏 */}
                <div className="flex items-center gap-4 text-sm">
                  <button className="flex items-center gap-1 bg-blue-50 text-blue-600 px-3 py-1.5 rounded-[4px] font-medium hover:bg-blue-100 transition-colors">
                      <div className="w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-b-[6px] border-b-blue-600 mb-0.5"></div>
                      赞同 {post.votes > 1000 ? (post.votes/1000).toFixed(1) + '万' : post.votes || 0}
                  </button>
                  
                  <button className="flex items-center gap-1.5 text-gray-500 hover:text-gray-600 font-medium">
                      <MessageCircle className="w-5 h-5 text-gray-400" />
                      {post.comments || 0} 条评论
                  </button>
                  
                  {/* 作者展示 */}
                  <span className="text-gray-400 flex items-center gap-1">
                      <PenSquare className="w-4 h-4" />
                      {/* 兼容作者可能是对象也可能是字符串的情况 */}
                      {typeof post.author === 'string' ? post.author : (post.author?.username || post.author?.name || '匿名')}
                  </span>
                </div>
            </div>
            );
          })}

          {!loading && posts.length === 0 && (
             <div className="bg-white p-10 text-center text-gray-400">暂无内容，快来发布第一个帖子吧！</div>
          )}
          
          {/* 加载更多 */}
          <div className="bg-white p-4 text-center text-gray-500 text-sm rounded-sm cursor-pointer hover:bg-gray-50">
            加载更多内容...
          </div>
        </div>

        {/* === 右侧：侧边栏 === */}
        <div className="hidden md:flex flex-col gap-3">
           <div className="bg-white rounded-sm shadow-sm p-4">
              <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                      <div className="bg-yellow-100 p-1 rounded">
                        <PenSquare className="w-4 h-4 text-yellow-600" />
                      </div>
                      <span className="text-sm font-medium text-gray-700">创作中心</span>
                  </div>
                  <span className="text-xs text-blue-500 cursor-pointer">草稿箱 (0)</span>
              </div>
              
              <div className="grid grid-cols-3 gap-2">
                    {/* 1. 提问 */}
                    <Link href="/forum/create?type=question" className="flex flex-col items-center justify-center gap-2 py-4 hover:bg-gray-50 rounded transition-colors group cursor-pointer">
                        <div className="bg-green-50 p-2 rounded-full group-hover:bg-green-100">
                            <HelpCircle className="w-6 h-6 text-green-600" />
                        </div>
                        <span className="text-xs text-gray-600">提问</span>
                    </Link>

                    {/* 2. 回答 */}
                    <Link href="/forum?tab=hot" onClick={() => setActiveTab('hot')} className="flex flex-col items-center justify-center gap-2 py-4 hover:bg-gray-50 rounded transition-colors group cursor-pointer">
                        <div className="bg-blue-50 p-2 rounded-full group-hover:bg-blue-100">
                            <MessageSquare className="w-6 h-6 text-blue-500" />
                        </div>
                        <span className="text-xs text-gray-600">回答</span>
                    </Link>

                    {/* 3. 写文章 */}
                    <Link href="/forum/create?type=article" className="flex flex-col items-center justify-center gap-2 py-4 hover:bg-gray-50 rounded transition-colors group cursor-pointer">
                        <div className="bg-orange-50 p-2 rounded-full group-hover:bg-orange-100">
                            <PenSquare className="w-6 h-6 text-orange-500" />
                        </div>
                        <span className="text-xs text-gray-600">写文章</span>
                    </Link>
                </div>

                <Link href="/forum/create?type=article" className="block w-full text-center mt-3 py-2 border border-blue-600 text-blue-600 text-sm rounded hover:bg-blue-50 transition-colors">
                    开始创作
                </Link>
            </div>
            
           {/* 热榜侧栏 */}
           <div className="bg-white rounded-sm shadow-sm p-4">
             <div className="flex justify-between items-center mb-3">
                 <h3 className="font-semibold text-gray-700 text-sm">全站热榜</h3>
             </div>
             <ul className="flex flex-col gap-1">
                 {HOT_TOPICS.map((topic, index) => (
                     <li key={index} className="flex items-start gap-2 py-2 cursor-pointer group">
                         <span className={`text-sm font-bold w-5 text-center ${index < 3 ? 'text-orange-500' : 'text-gray-400'}`}>
                             {index + 1}
                         </span>
                         <span className="text-sm text-gray-700 group-hover:text-blue-600 group-hover:underline line-clamp-1">
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