'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { 
  ArrowLeft, HelpCircle, PenTool, Loader2, 
  AlertCircle, CheckCircle2, X 
} from 'lucide-react';
import { forumApi } from '@/lib/api';

function CreatePostContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const defaultType = searchParams.get('type') === 'article' ? 'article' : 'question';

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [type, setType] = useState<'question' | 'article'>(defaultType);
  const [tags, setTags] = useState('');
  
  // 状态管理
  const [showConfirm, setShowConfirm] = useState(false); // 确认弹窗
  const [showSuccess, setShowSuccess] = useState(false); // 成功动画
  const [isSubmitting, setIsSubmitting] = useState(false); // 提交中

  // 点击“发布”按钮触发
  const handlePreSubmit = () => {
    if (!title.trim() || !content.trim()) {
      alert('标题和内容不能为空'); // 这里可以用 Toast 优化，暂用 alert
      return;
    }
    setShowConfirm(true); // 显示确认框
  };

// 修改 handleConfirmSubmit 函数
const handleConfirmSubmit = async () => {
    setShowConfirm(false);
    setIsSubmitting(true);
    try {
      const tagArray = tags.split(/[,，\s]+/).filter(Boolean);
      
      // ✅ 修复 1：接收 API 返回的结果 (后端返回了 { id: "...", ... })
      const newPost = await forumApi.create({
        title,
        content: content.replace(/\n/g, '<br/>'),
        type,
        tags: tagArray
      });

      setIsSubmitting(false);
      setShowSuccess(true);

      // ✅ 修复 2：跳转到具体的帖子详情页，而不是列表页
      setTimeout(() => {
        // 确保 newPost.id 存在。后端 index.txt 第 109 行返回了 id 字段
        if (newPost && newPost.id) {
            router.push(`/forum/question/${newPost.id}`); 
        } else {
            //以此为兜底，防止万一没拿到 ID
            router.push('/forum');
        }
      }, 1500);

    } catch (error: any) {
      setIsSubmitting(false);
      alert('发布失败: ' + error.message);
    }
};
  return (
    <div className="min-h-screen bg-gray-50 pb-20 relative">
      
      {/* === 1. 顶部导航 === */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-[800px] mx-auto px-4 h-16 flex items-center justify-between">
          <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-900 flex items-center gap-1 font-bold text-sm">
            <ArrowLeft className="w-5 h-5" /> 取消
          </button>
          <span className="font-bold text-gray-900 text-lg">
            {type === 'question' ? '发布提问' : '发布文章'}
          </span>
          <button 
            onClick={handlePreSubmit}
            disabled={isSubmitting}
            className="bg-blue-600 text-white font-bold hover:bg-blue-700 px-6 py-1.5 rounded-full text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
          >
            发布
          </button>
        </div>
      </div>

      {/* === 2. 编辑主体 === */}
      <div className="max-w-[800px] mx-auto mt-6 px-4">
        
        {/* 类型切换 */}
        <div className="flex gap-4 mb-6">
           <button 
             onClick={() => setType('question')}
             className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 font-bold transition-all ${type === 'question' ? 'border-blue-600 bg-blue-50 text-blue-600' : 'border-gray-200 bg-white text-gray-400 hover:border-gray-300'}`}
           >
              <HelpCircle className="w-5 h-5" /> 我要提问
           </button>
           <button 
             onClick={() => setType('article')}
             className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 font-bold transition-all ${type === 'article' ? 'border-orange-500 bg-orange-50 text-orange-600' : 'border-gray-200 bg-white text-gray-400 hover:border-gray-300'}`}
           >
              <PenTool className="w-5 h-5" /> 我要创作
           </button>
        </div>

        <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-200 flex flex-col gap-6">
           {/* 标题输入 - 🔥 修复：字体加深，Placeholder加深 */}
           <div>
             <input 
               type="text" 
               placeholder={type === 'question' ? "请输入问题标题，以问号结尾..." : "请输入文章标题..."}
               className="w-full text-3xl font-black text-gray-900 placeholder-gray-400 border-none outline-none ring-0 p-0 bg-transparent leading-tight"
               value={title}
               onChange={e => setTitle(e.target.value)}
               autoFocus
             />
           </div>
           
           <hr className="border-gray-100" />

           {/* 内容输入 */}
           <textarea 
             className="w-full h-[400px] resize-none text-lg text-gray-800 placeholder-gray-400 border-none outline-none ring-0 p-0 leading-relaxed"
             placeholder={type === 'question' ? "详细描述你的问题背景、条件等..." : "开始你的创作..."}
             value={content}
             onChange={e => setContent(e.target.value)}
           ></textarea>
           
           <div className="bg-gray-50 p-4 rounded-xl flex items-center gap-3">
              <span className="text-gray-500 text-sm font-bold flex-shrink-0"># 话题标签</span>
              <input 
                type="text" 
                placeholder="例如：社会学 经济 (空格分隔)"
                className="flex-1 bg-transparent border-none outline-none text-sm text-gray-900 placeholder-gray-400 focus:ring-0"
                value={tags}
                onChange={e => setTags(e.target.value)}
              />
           </div>
        </div>
      </div>

      {/* === 3. 确认弹窗 (Modal) === */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
           <div className="bg-white w-[320px] rounded-2xl p-6 shadow-2xl transform transition-all scale-100">
              <div className="flex flex-col items-center text-center">
                 <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mb-4 text-blue-600">
                    <AlertCircle className="w-7 h-7" />
                 </div>
                 <h3 className="text-lg font-bold text-gray-900 mb-2">确认发布吗？</h3>
                 <p className="text-sm text-gray-500 mb-6">发布后大家都能看到你的内容，是否继续？</p>
                 
                 <div className="flex w-full gap-3">
                    <button 
                      onClick={() => setShowConfirm(false)}
                      className="flex-1 py-2.5 rounded-lg border border-gray-200 text-gray-600 font-bold text-sm hover:bg-gray-50 transition-colors"
                    >
                      再想想
                    </button>
                    <button 
                      onClick={handleConfirmSubmit}
                      className="flex-1 py-2.5 rounded-lg bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 transition-colors shadow-md shadow-blue-200"
                    >
                      确认发布
                    </button>
                 </div>
              </div>
           </div>
        </div>
      )}

      {/* === 4. 发布中/成功 遮罩 === */}
      {(isSubmitting || showSuccess) && (
         <div className="fixed inset-0 z-[60] flex items-center justify-center bg-white/80 backdrop-blur-md">
            <div className="flex flex-col items-center">
                {showSuccess ? (
                    <>
                      <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mb-4 animate-bounce shadow-lg shadow-green-200">
                          <CheckCircle2 className="w-10 h-10 text-white" />
                      </div>
                      <h3 className="text-xl font-black text-gray-900">发布成功！</h3>
                      <p className="text-gray-500 mt-2">正在跳转到论坛首页...</p>
                    </>
                ) : (
                    <>
                      <Loader2 className="w-12 h-12 text-blue-600 animate-spin mb-4" />
                      <p className="text-gray-500 font-medium">正在提交内容...</p>
                    </>
                )}
            </div>
         </div>
      )}

    </div>
  );
}

export default function CreatePostPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">加载中...</div>}>
      <CreatePostContent />
    </Suspense>
  );
}