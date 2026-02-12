'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { 
  ArrowLeft, HelpCircle, PenTool, Loader2, 
  AlertCircle, CheckCircle2, X, Hash
} from 'lucide-react';
import { forumApi } from '@/lib/api';

// 🎨 主题配置：极简黑白
const theme = {
  bg: 'bg-[#f8f9fa]',
  card: 'bg-white',
  inputBg: 'bg-transparent',
  textMain: 'text-gray-900',
  textSub: 'text-gray-500',
  border: 'border-gray-200',
  focusRing: 'focus:ring-gray-900',
  primaryBtn: 'bg-gray-900 text-white hover:bg-black',
  secondaryBtn: 'bg-white text-gray-900 border border-gray-200 hover:bg-gray-50',
};

function CreatePostContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const defaultType = searchParams.get('type') === 'article' ? 'article' : 'question';

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [type, setType] = useState<'question' | 'article'>(defaultType);
  const [tags, setTags] = useState('');
  
  const [showConfirm, setShowConfirm] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handlePreSubmit = () => {
    if (!title.trim() || !content.trim()) {
      alert('标题和内容不能为空');
      return;
    }
    setShowConfirm(true);
  };

  const handleConfirmSubmit = async () => {
    setShowConfirm(false);
    setIsSubmitting(true);
    try {
      const tagArray = tags.split(/[,，\s]+/).filter(Boolean);
      
      // 🔥 核心修复：回车问题
      // 方案 A：在存入数据库前，把换行符 \n 替换成HTML的 <br/>
      // 这样在 dangerouslySetInnerHTML 里就能正确换行了
      const formattedContent = content.replace(/\n/g, '<br/>');

      await forumApi.create({
        title,
        content: formattedContent, 
        type,
        tags: tagArray
      });

      setIsSubmitting(false);
      setShowSuccess(true);
      setTimeout(() => {
        router.push('/forum'); 
      }, 1500);
    } catch (error: any) {
      setIsSubmitting(false);
      alert('发布失败: ' + error.message);
    }
  };

  return (
    <div className={`min-h-screen ${theme.bg} pb-20 relative font-sans`}>
      
      {/* === 1. 顶部导航 === */}
      <div className="bg-white/80 backdrop-blur-md border-b border-gray-100 sticky top-0 z-30">
        <div className="max-w-[800px] mx-auto px-4 h-16 flex items-center justify-between">
          <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-900 flex items-center gap-2 font-medium text-sm transition-colors">
            <ArrowLeft className="w-5 h-5" /> 取消
          </button>
 
          <span className="font-bold text-gray-900 text-base">
            {type === 'question' ? '提问' : '创作'}
          </span>

          <button 
            onClick={handlePreSubmit}
            disabled={isSubmitting}
            className={`${theme.primaryBtn} px-6 py-2 rounded-lg text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm`}
          >
            发布
          </button>
        </div>
      </div>

      {/* === 2. 编辑主体 === */}
      <div className="max-w-[800px] mx-auto mt-8 px-4">
        
        {/* 类型切换 (极简 Tab) */}
        <div className="flex bg-gray-100 p-1 rounded-xl mb-8 w-fit mx-auto">
           <button 
             onClick={() => setType('question')}
             className={`px-6 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2
               ${type === 'question' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
           >
              <HelpCircle className="w-4 h-4" /> 提问
           </button>
           <button 
             onClick={() => setType('article')}
             className={`px-6 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2
               ${type === 'article' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
           >
              <PenTool className="w-4 h-4" /> 文章
           </button>
        </div>

        <div className={`${theme.card} p-8 md:p-12 rounded-2xl shadow-sm border border-transparent hover:border-gray-200 transition-colors`}>
           {/* 标题输入 */}
           <div className="mb-6">
             <input 
               type="text" 
               placeholder={type === 'question' ? "请输入问题，以问号结尾" : "请输入文章标题"}
               className="w-full text-3xl md:text-4xl font-bold text-gray-900 placeholder-gray-300 border-none outline-none bg-transparent leading-tight"
               value={title}
               onChange={e => setTitle(e.target.value)}
               autoFocus
             />
           </div>
           
           {/* 内容输入 */}
           <textarea 
             className="w-full h-[400px] resize-none text-lg text-gray-800 placeholder-gray-300 border-none outline-none bg-transparent leading-relaxed"
             placeholder={type === 'question' ? "描述你的问题背景、条件等..." : "开始你的创作..."}
             value={content}
             onChange={e => setContent(e.target.value)}
           ></textarea>
           
           {/* 标签栏 */}
           <div className="mt-8 pt-6 border-t border-gray-50 flex items-center gap-3">
              <Hash className="w-4 h-4 text-gray-400" />
              <input 
                type="text" 
                placeholder="添加话题标签 (例如: 历史 科技)"
                className="flex-1 bg-transparent border-none outline-none text-sm text-gray-900 placeholder-gray-400"
                value={tags}
                onChange={e => setTags(e.target.value)}
              />
           </div>
        </div>
      </div>

      {/* === 3. 确认弹窗 === */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/20 backdrop-blur-sm animate-in fade-in duration-200">
           <div className="bg-white w-[320px] rounded-2xl p-6 shadow-xl transform transition-all scale-100 border border-gray-100">
              <div className="flex flex-col items-center text-center">
                 <h3 className="text-lg font-bold text-gray-900 mb-2">确认发布？</h3>
                 <p className="text-sm text-gray-500 mb-6">发布后将对所有用户可见。</p>
                 
                 <div className="flex w-full gap-3">
                    <button 
                      onClick={() => setShowConfirm(false)}
                      className="flex-1 py-2.5 rounded-lg border border-gray-200 text-gray-600 font-medium text-sm hover:bg-gray-50 transition-colors"
                    >
                      取消
                    </button>
                    <button 
                      onClick={handleConfirmSubmit}
                      className="flex-1 py-2.5 rounded-lg bg-gray-900 text-white font-bold text-sm hover:bg-black transition-colors"
                    >
                      确认
                    </button>
                 </div>
              </div>
           </div>
        </div>
      )}

      {/* === 4. 加载/成功状态 === */}
      {(isSubmitting || showSuccess) && (
         <div className="fixed inset-0 z-[60] flex items-center justify-center bg-white/90 backdrop-blur-sm">
            <div className="flex flex-col items-center">
                {showSuccess ? (
                    <>
                      <div className="w-16 h-16 bg-gray-900 rounded-full flex items-center justify-center mb-4 animate-bounce">
                          <CheckCircle2 className="w-8 h-8 text-white" />
                      </div>
                      <h3 className="text-xl font-bold text-gray-900">已发布</h3>
                    </>
                ) : (
                    <>
                      <Loader2 className="w-10 h-10 text-gray-900 animate-spin mb-4" />
                      <p className="text-gray-500 font-medium text-sm">正在提交...</p>
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
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-gray-400">Loading...</div>}>
      <CreatePostContent />
    </Suspense>
  );
}