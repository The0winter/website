'use client';

import { useState } from 'react';
import Link from 'next/link';
import { 
  MessageSquare, ThumbsUp, MessageCircle, Share2, 
  MoreHorizontal, PenSquare, BookOpen, Flame, ChevronRight 
} from 'lucide-react';

// --- 模拟数据 ---
const MOCK_POSTS = [
  {
    id: 1,
    title: "欧洲为什么能突破内卷？",
    excerpt: "Steven汤圆：因为欧美认真看透了财富的本质、人的意义。中国为什么这么内卷，本质上仍然是对财富没有清晰的认知...",
    author: "Steven汤圆",
    votes: 2336,
    comments: 450,
    isHot: true,
    tag: "社会学"
  },
  {
    id: 2,
    title: "为什么现在的人对银行有这么大的恶意？",
    excerpt: "如龙：中国的银行是最舒服的，简直稳赚不赔，违背经济学。在一个正常国家，比如美国，金融危机来了第一个倒的就是银行...",
    author: "如龙",
    votes: 1876,
    comments: 144,
    isHot: false,
    tag: "经济"
  },
  {
    id: 3,
    title: "波士顿圆脸为何不惊慌？",
    excerpt: "LiEdikKum：b站包保他的，现在评论区里干净到连自己玩梗的活人都没有了。21年左右关注的他，这一两年几乎没点进去看...",
    author: "LiEdikKum",
    votes: 315,
    comments: 13,
    isHot: false,
    tag: "自媒体"
  },
  {
    id: 4,
    title: "国产小说网站的发展出路在哪里？",
    excerpt: "作为一名独立开发者，我认为未来的小说站不应该只是阅读工具，更应该是读者和作者思想碰撞的社区...",
    author: "站长",
    votes: 5621,
    comments: 892,
    isHot: true,
    tag: "站务"
  }
];

const HOT_TOPICS = [
  "官方通报南京博物院事件",
  "梦舟飞船又一次试验成功",
  "日本众议院选举投票结束",
  "Seedance2.0使用影视飓风...",
  "黑神话钟馗发布6分钟实机...",
];

export default function ForumPage() {
  const [activeTab, setActiveTab] = useState<'recommend' | 'hot' | 'follow'>('recommend');

  return (
    <div className="min-h-screen bg-[#f6f6f6] pb-10">

{/* 顶部导航栏 */}
    <div className="sticky top-0 z-30 bg-[#f6f6f6]"> {/* 给外层加背景色遮挡滚动内容 */}
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

      {/* 主体内容区：双栏布局 */}
      <div className="max-w-[1000px] mx-auto px-4 md:px-0 mt-3 grid grid-cols-1 md:grid-cols-[1fr_296px] gap-3">
        
        {/* === 左侧：内容流 === */}
        <div className="flex flex-col gap-2">
        {MOCK_POSTS.map((post) => (
        // 🔥 修改 1：这里原来是 <Link>，现在直接删掉，只留 div 作为容器
        <div 
            key={post.id} 
            className="bg-white p-5 rounded-sm shadow-sm hover:shadow-md transition-shadow mb-2"
        >
            {/* 1. 标题 -> 链接到【问题页】 */}
            <Link href={`/forum/question/${post.id}`}>
            <h2 className="text-[18px] font-bold text-gray-900 mb-2 hover:text-blue-600 leading-snug cursor-pointer">
                {post.title}
            </h2>
            </Link>

            {/* 2. 摘要/内容 -> 链接到【回答详情页】 */}
            <Link href={`/forum/${post.id}`}>
            <div className="text-[15px] text-gray-800 leading-relaxed mb-3 cursor-pointer hover:text-gray-600">
                {post.excerpt}
                <span className="text-blue-500 text-sm ml-1">阅读全文 &rarr;</span>
            </div>
            </Link>

            {/* 底部操作栏 (保持不变) */}
            <div className="flex items-center gap-4">
            <button className="flex items-center gap-1 bg-blue-50 text-blue-600 px-3 py-1.5 rounded-[4px] text-sm font-medium hover:bg-blue-100 transition-colors">
                <div className="w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-b-[6px] border-b-blue-600 mb-0.5"></div>
                赞同 {post.votes > 1000 ? (post.votes/1000).toFixed(1) + '万' : post.votes}
            </button>
            
            <button className="flex items-center gap-1.5 text-gray-500 hover:text-gray-600 text-sm font-medium">
                <MessageCircle className="w-5 h-5 text-gray-400" />
                {post.comments} 条评论
            </button>
            
            <button className="flex items-center gap-1.5 text-gray-400 hover:text-gray-500 text-sm font-medium">
                <Share2 className="w-4 h-4" />
                分享
            </button>

            <button className="flex items-center gap-1.5 text-gray-400 hover:text-gray-500 text-sm font-medium ml-auto">
                <MoreHorizontal className="w-5 h-5" />
            </button>
            </div>

        </div> // 🔥 修改 2：这里原来是 </Link>，现在改成 </div> 来闭合最上面的 div
        ))}
          
          {/* 加载更多 */}
          <div className="bg-white p-4 text-center text-gray-500 text-sm rounded-sm cursor-pointer hover:bg-gray-50">
            加载更多内容...
          </div>
        </div>

        {/* === 右侧：侧边栏 === */}
        <div className="hidden md:flex flex-col gap-3">
          
          {/* 创作中心卡片 */}
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
            
            <div className="grid grid-cols-2 gap-2">
                <button className="flex flex-col items-center justify-center gap-2 py-4 hover:bg-gray-50 rounded transition-colors group">
                    <div className="bg-blue-50 p-2 rounded-full group-hover:bg-blue-100">
                        <MessageSquare className="w-6 h-6 text-blue-500" />
                    </div>
                    <span className="text-xs text-gray-600">回答问题</span>
                </button>
                <button className="flex flex-col items-center justify-center gap-2 py-4 hover:bg-gray-50 rounded transition-colors group">
                    <div className="bg-orange-50 p-2 rounded-full group-hover:bg-orange-100">
                        <PenSquare className="w-6 h-6 text-orange-500" />
                    </div>
                    <span className="text-xs text-gray-600">写文章</span>
                </button>
            </div>
            
            <button className="w-full mt-3 py-2 border border-blue-600 text-blue-600 text-sm rounded hover:bg-blue-50 transition-colors">
                开始创作
            </button>
          </div>

          {/* 推荐关注 */}
          <div className="bg-white rounded-sm shadow-sm p-4">
             <div className="flex justify-between items-center mb-4">
                 <h3 className="font-semibold text-gray-700 text-sm">推荐关注</h3>
                 <span className="text-xs text-gray-400">换一换</span>
             </div>
             <ul className="flex flex-col gap-4">
                 {[1, 2, 3].map(i => (
                     <li key={i} className="flex items-center gap-3">
                         <div className="w-10 h-10 bg-gray-200 rounded-md overflow-hidden">
                             {/* 这里可以放头像 */}
                             <div className="w-full h-full bg-gradient-to-br from-gray-300 to-gray-400"></div>
                         </div>
                         <div className="flex-1 min-w-0">
                             <div className="text-sm font-medium text-gray-800">书荒拯救者</div>
                             <div className="text-xs text-gray-400 truncate">资深网文鉴赏家，推书达人</div>
                         </div>
                         <button className="text-blue-600 text-sm flex items-center gap-1 font-medium hover:bg-blue-50 px-2 py-1 rounded">
                             + 关注
                         </button>
                     </li>
                 ))}
             </ul>
          </div>

          {/* 热榜侧栏版 */}
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
                         {index < 2 && <span className="bg-red-500 text-white text-[10px] px-1 rounded-sm scale-75 origin-left">热</span>}
                     </li>
                 ))}
             </ul>
          </div>

          {/* 底部链接 */}
          <div className="px-2">
            <div className="flex flex-wrap gap-2 text-xs text-gray-400">
                <span>用户协议</span> · 
                <span>隐私政策</span> · 
                <span>联系我们</span>
            </div>
            <div className="mt-1 text-xs text-gray-400">© 2026 Novel Forum</div>
          </div>

        </div>
      </div>
    </div>
  );
}