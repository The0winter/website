{/* ... 上面的代码保持不变 ... */}

<div className="flex flex-col gap-3">
    {answers.map(answer => (
        // 🔥 修改点：把 div 改回 Link，并加上 href
        <Link 
          href={`/forum/${answer.id}?fromQuestion=${question.id}`} // 你的原版链接逻辑
          key={answer.id}
          className="bg-white p-5 rounded-sm shadow-sm hover:shadow-md transition-shadow block" // 加上 block 让它占满一行
        >
            <div className="flex items-center gap-2 mb-2">
                <div className="w-6 h-6 bg-gray-200 rounded-full flex items-center justify-center overflow-hidden">
                   {answer.author?.avatar ? (
                     <img src={answer.author.avatar} alt="avatar" className="w-full h-full object-cover"/>
                   ) : (
                     <User className="w-4 h-4 text-gray-400" />
                   )}
                </div>
                <span className="text-sm font-bold text-gray-900">{answer.author?.name || '匿名用户'}</span>
            </div>

            <div 
                // 这里的 line-clamp-3 会让过长的文字显示省略号
                // 点击 Link 后应该跳转到详情页看全文
                className="text-[15px] text-gray-800 leading-relaxed mb-3 line-clamp-3"
                dangerouslySetInnerHTML={{ __html: answer.content }} 
            >
            </div>
            
            <div className="flex items-center gap-4 text-gray-400 text-sm">
                <span className="text-blue-600 font-medium bg-blue-50 px-2 py-0.5 rounded text-xs">{answer.votes || 0} 赞同</span>
                <span className="flex items-center gap-1 hover:text-gray-600 transition-colors">
                    <MessageCircle className="w-4 h-4" /> {answer.comments || 0} 条评论
                </span>
                <span className="text-xs">{answer.time}</span>
            </div>
        </Link> // 🔥 别忘了闭合标签也要改成 Link
    ))}
    
    {answers.length === 0 && (
        <div className="bg-white p-10 text-center text-gray-400">暂无回答，快来抢沙发！</div>
    )}
</div>