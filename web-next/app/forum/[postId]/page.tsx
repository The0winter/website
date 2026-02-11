'use client';

import { Suspense } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { 
  MessageSquare, Share2, Star, Plus, ChevronDown, MessageCircle, 
  ArrowLeft, MoreHorizontal, ThumbsUp, Heart 
} from 'lucide-react';

// === 子组件：内容展示 ===
function PostContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromQuestionId = searchParams.get('fromQuestion');
  const params = useParams();

  // 模拟数据：更丰富的内容
  const question = {
    id: "1",
    title: "欧洲为什么能突破内卷？",
    tags: ["社会学", "经济发展", "欧洲历史"],
    commentCount: 45,
  };

  const answer = {
      id: 101,
      author: { 
          name: "Steven汤圆", 
          bio: "社会学博士在读 · 观察者", 
          avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Steven" 
      },
      votes: 2336,
      time: "编辑于 昨天 14:20",
      // 🔥 模拟真实的长文 HTML 内容
      content: `
        <p class="mb-4 text-gray-800 leading-7">这是一个非常宏大的问题。简单来说，是因为欧美认真看透了财富的本质、人的意义。</p>
        
        <p class="mb-4 text-gray-800 leading-7">中国为什么这么内卷？本质上仍然是对财富没有清晰的认知，以及作为人的意义根本不关注。我们太过于这种“单一评价体系”。</p>
        
        <h3 class="text-lg font-bold text-gray-900 mt-6 mb-3">1. 职业的平权</h3>
        <p class="mb-4 text-gray-800 leading-7">在欧洲，一个修水管的工人，他的社会地位并不比一个大学教授低多少，他的收入甚至可能更高。当职业没有贵贱之分，当成功不由金钱唯一衡量时，内卷的土壤就不存在了。</p>
        
        <blockquote class="border-l-4 border-gray-300 pl-4 py-2 my-6 text-gray-500 italic bg-gray-50">
            “当每个人都想成为人上人时，地狱就诞生了。”
        </blockquote>

        <h3 class="text-lg font-bold text-gray-900 mt-6 mb-3">2. 社会保障的托底</h3>
        <p class="mb-4 text-gray-800 leading-7">我也曾在德国生活过一段时间。那里的人们并不担心失业，因为失业金足够维持体面的生活。不需要为了生存而恶性竞争，人们自然会去追求艺术、哲学和生活的乐趣。</p>
        
        <div class="bg-blue-50 p-4 rounded-lg my-6 text-sm text-blue-800">
           💡 <strong>核心观点：</strong> 内卷的本质是存量博弈。只有打破单一的价值观，建立多元的成功定义，才能真正走出内卷。
        </div>

        <p class="mb-4 text-gray-800 leading-7">所以，不是因为他们懒，而是因为他们懂得什么是生活。</p>
      `
  };

  return (
    <div className="min-h-screen bg-[#f6f6f6] pb-20">
      
      {/* 1. 顶部导航：修正宽度，与下方对齐 */}
      <div className="sticky top-0 z-30 bg-[#f6f6f6]">
        <div className="max-w-[1000px] mx-auto bg-white shadow-sm border-b border-x border-gray-200 px-4 h-14 flex items-center justify-between">
           <button onClick={() => router.back()} className="text-gray-500 hover:text-blue-600 flex items-center gap-1 text-sm font-bold">
              <ArrowLeft className="w-4 h-4" /> 返回
           </button>
           <span className="font-bold text-blue-600 text-lg hidden md:block">Novel Forum</span>
           <MoreHorizontal className="w-5 h-5 text-gray-400" />
        </div>
      </div>

      {/* 2. 问题卡片：限制在 1000px 容器内，不再全屏宽 */}
      <div className="max-w-[1000px] mx-auto mt-3">
          <div className="bg-white p-6 shadow-sm border border-gray-200 mb-3">
              
              <div className="flex gap-2 mb-3">
                  {question.tags.map(tag => (
                      <span key={tag} className="bg-blue-50 text-blue-600 px-3 py-1 rounded-full text-xs font-medium">
                          {tag}
                      </span>
                  ))}
              </div>

              {/* 点击标题跳回问题页 */}
              <Link 
                 href={`/forum/question/${fromQuestionId || '1'}`} 
                 className="block group"
              >
                  <h1 className="text-2xl font-bold text-gray-900 leading-snug group-hover:text-blue-600 transition-colors mb-4">
                      {question.title}
                  </h1>
              </Link>
              
              <div className="flex items-center gap-4">
                  <button className="bg-blue-600 text-white px-5 py-2 rounded-[4px] text-sm font-medium hover:bg-blue-700 transition-colors">
                      写回答
                  </button>
                  <Link 
                    href={`/forum/question/${fromQuestionId || '1'}`} 
                    className="bg-white border border-gray-300 text-gray-600 px-4 py-2 rounded-[4px] text-sm font-medium hover:bg-gray-50 transition-colors"
                  >
                      查看全部 {question.commentCount} 个回答
                  </Link>
              </div>
          </div>

          {/* 3. 主体布局：双栏 */}
          <div className="grid grid-cols-1 md:grid-cols-[1fr_296px] gap-3">
              
              {/* 左侧：具体的回答内容 */}
              <div className="bg-white p-6 shadow-sm border border-gray-200 min-h-[500px]">
                  {/* 作者信息栏 */}
                  <div className="flex items-center gap-3 mb-6">
                      <img src={answer.author.avatar} className="w-10 h-10 rounded-lg bg-gray-100" alt="avatar" />
                      <div>
                          <div className="font-bold text-gray-900 text-[15px]">{answer.author.name}</div>
                          <div className="text-xs text-gray-500">{answer.author.bio}</div>
                      </div>
                  </div>

                  {/* 核心文章内容 */}
                  <div className="rich-text-content" dangerouslySetInnerHTML={{ __html: answer.content }}></div>
                  
                  <div className="text-sm text-gray-400 mt-8 mb-6">{answer.time}</div>

                  {/* 底部悬浮操作栏 (Sticky Bottom) */}
                  <div className="sticky bottom-0 bg-white/95 backdrop-blur-sm pt-4 pb-2 border-t border-gray-100 flex items-center gap-4 -mx-6 px-6">
                      <button className="flex items-center gap-1 bg-blue-50 text-blue-600 px-4 py-2 rounded text-sm font-medium hover:bg-blue-100 transition-colors">
                          <ThumbsUp className="w-4 h-4 fill-current" />
                          赞同 {answer.votes}
                      </button>
                      <button className="flex items-center gap-1 bg-gray-50 text-gray-500 px-4 py-2 rounded text-sm font-medium hover:bg-gray-100 transition-colors">
                          <ChevronDown className="w-4 h-4" />
                      </button>
                      
                      <div className="flex items-center gap-6 ml-auto text-gray-500 text-sm font-medium">
                           <button className="flex items-center gap-1.5 hover:text-gray-700">
                               <MessageCircle className="w-5 h-5" /> 评论
                           </button>
                           <button className="flex items-center gap-1.5 hover:text-gray-700">
                               <Share2 className="w-5 h-5" /> 分享
                           </button>
                           <button className="flex items-center gap-1.5 hover:text-gray-700">
                               <Star className="w-5 h-5" /> 收藏
                           </button>
                      </div>
                  </div>
              </div>

              {/* 右侧：侧边栏 */}
              <div className="hidden md:flex flex-col gap-3">
                  <div className="bg-white p-4 shadow-sm border border-gray-200">
                      <div className="flex items-center justify-between mb-4">
                          <h3 className="font-bold text-gray-800 text-sm">关于作者</h3>
                      </div>
                      <div className="flex items-center gap-3 mb-3">
                           <img src={answer.author.avatar} className="w-12 h-12 rounded-lg bg-gray-100" />
                           <div>
                               <div className="font-bold text-gray-900">{answer.author.name}</div>
                               <div className="text-xs text-gray-500">获得 23,491 次赞同</div>
                           </div>
                      </div>
                      <div className="flex gap-2">
                          <button className="flex-1 bg-blue-600 text-white text-sm py-1.5 rounded hover:bg-blue-700 transition-colors">
                              + 关注
                          </button>
                          <button className="flex-1 border border-gray-300 text-gray-600 text-sm py-1.5 rounded hover:bg-gray-50 transition-colors">
                              私信
                          </button>
                      </div>
                  </div>

                  <div className="bg-white p-4 shadow-sm border border-gray-200">
                      <h3 className="font-bold text-gray-800 text-sm mb-3">相关问题</h3>
                      <ul className="space-y-3">
                          <li className="text-sm text-gray-700 hover:text-blue-600 cursor-pointer line-clamp-2">
                              如何看待现在的年轻人普遍不想结婚？
                          </li>
                          <li className="text-sm text-gray-700 hover:text-blue-600 cursor-pointer line-clamp-2">
                              为什么感觉现在的经济形势越来越复杂？
                          </li>
                          <li className="text-sm text-gray-700 hover:text-blue-600 cursor-pointer line-clamp-2">
                              躺平真的是一种不负责任的表现吗？
                          </li>
                      </ul>
                  </div>
              </div>
          </div>
      </div>
    </div>
  );
}

// 导出组件
export default function PostDetailPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#f6f6f6]"></div>}>
       <PostContent />
    </Suspense>
  );
}