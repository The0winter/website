'use client';

import React from 'react';
import Link from 'next/link';
// 这里只引入组件内部写死需要的图标，动态传入的 icon 由父组件决定
import { ChevronRight, ImageOff, BookOpen, Star } from 'lucide-react';

// 定义 Props 类型，方便你在使用时有代码提示
interface RankingListProps {
  title: string;
  icon: any; // 接收传入的 Icon 组件 (如 Trophy, TrendingUp 等)
  books: any[]; // 这里为了兼容暂时用 any，你可以换成你的 Book 类型
  rankColor: string; // 例如 'text-yellow-500'
  showRating?: boolean;
  className?: string; // 允许从外部传入额外的样式
}

const RankingList = ({ 
  title, 
  icon: Icon, 
  books = [], // 给个默认值防止报错
  rankColor, 
  showRating = false,
  className = ''
}: RankingListProps) => {
  
  // 颜色映射逻辑
  const themeMap: Record<string, string> = {
    'text-yellow-500': 'from-yellow-50 via-white to-white border-yellow-100', 
    'text-red-500': 'from-red-50 via-white to-white border-red-100',       
    'text-purple-500': 'from-purple-50 via-white to-white border-purple-100', 
  };
  
  const bgTheme = themeMap[rankColor] || 'from-gray-50 to-white border-gray-100';
  
  // 数据切片：前三名单独处理，剩余的作为列表
  const [first, second, third, ...others] = books;

  return (
    <div className={`bg-white md:rounded-xl shadow-sm md:border border-gray-100 flex flex-col h-full overflow-hidden ${className}`}>
      {/* --- 头部 --- */}
      <div className="hidden md:flex py-3 px-5 border-b border-gray-50 items-center justify-between bg-gradient-to-r from-gray-50 to-white">
        <div className="flex items-center gap-2">
          {/* 渲染传入的 Icon */}
          <Icon className={`w-5 h-5 ${rankColor}`} />
          <h3 className="font-extrabold text-gray-800 text-lg">{title}</h3>
        </div>
        <span className="text-[10px] text-gray-400 uppercase tracking-wider font-bold bg-white px-1.5 py-0.5 rounded border border-gray-100">TOP 5</span>
      </div>

      <div className="flex-1 overflow-y-auto min-h-[450px] scrollbar-thin scrollbar-thumb-gray-200">
        
        {/* === 移动端视图 (列表模式) === */}
        <div className="md:hidden">
            {books.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-60 text-gray-400 text-sm">暂无数据</div>
            ) : (
                books.map((book: any, index: number) => (
                    <Link 
                        key={book.id} 
                        href={`/book/${book.id}`}
                        className="flex items-center gap-4 p-4 border-b border-gray-100 last:border-0 active:bg-gray-50"
                    >
                        <div className={`
                          w-6 h-6 flex-shrink-0 flex items-center justify-center rounded-md text-xs font-bold shadow-sm
                          ${index === 0 ? 'bg-red-500 text-white' : ''}
                          ${index === 1 ? 'bg-orange-500 text-white' : ''}
                          ${index === 2 ? 'bg-yellow-500 text-white' : ''}
                          ${index > 2 ? 'bg-gray-100 text-gray-400' : ''}
                        `}>
                          {index + 1}
                        </div>

                        <div className="relative w-12 h-16 flex-shrink-0 rounded shadow-sm overflow-hidden border border-gray-100">
                           {book.cover_image ? (
                             <img src={book.cover_image} alt={book.title} className="w-full h-full object-cover" />
                           ) : (
                             <div className="w-full h-full bg-gray-50 flex items-center justify-center">
                               <BookOpen className="w-4 h-4 text-gray-300" />
                             </div>
                           )}
                        </div>

                        <div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
                            <h4 className="font-bold text-gray-800 text-sm line-clamp-1">{book.title}</h4>
                            <div className="flex items-center text-xs text-gray-400 gap-2">
                                <span className="bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded text-[10px]">{book.category || '综合'}</span>
                            </div>
                        </div>

                        <div className="flex-shrink-0">
                            {showRating ? (
                                <span className="text-yellow-500 font-bold text-sm">{book.rating?.toFixed(1) || '0.0'}分</span>
                            ) : (
                                <ChevronRight className="w-5 h-5 text-gray-300" />
                            )}
                        </div>
                    </Link>
                ))
            )}
        </div>

        {/* === PC端视图 (品字形大图模式) === */}
        <div className="hidden md:block pb-4">
            {books.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-80 text-gray-400 text-sm gap-4">
                    <ImageOff className="w-8 h-8 text-gray-300" />
                    <span>暂无相关书籍</span>
                </div>
            ) : (
            <>
                {/* === NO.1 === */}
                {first && (
                <Link 
                    href={`/book/${first.id}`}
                    className={`relative flex gap-5 p-5 border-b border-gray-100 bg-gradient-to-b ${bgTheme} group hover:bg-gray-50 transition-colors z-10`}
                >
                    <div className="absolute top-0 right-4 text-[120px] font-black opacity-[0.04] pointer-events-none select-none">1</div>
                    
                    <div className="relative w-28 h-38 flex-shrink-0 shadow-xl rounded-md overflow-hidden transform group-hover:-translate-y-1 transition-transform duration-300 border border-black/5">
                        {first.cover_image ? (
                            <img src={first.cover_image} alt={first.title} className="w-full h-full object-cover" />
                        ) : (
                            <div className="w-full h-full bg-gray-200 flex items-center justify-center"><BookOpen className="text-gray-400"/></div>
                        )}
                        <div className="absolute top-0 left-0 bg-gradient-to-r from-red-600 to-orange-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-br-lg shadow-sm">NO.1</div>
                    </div>

                    <div className="flex-1 flex flex-col justify-center py-1 min-w-0">
                        <h4 className="text-xl font-black text-gray-900 mb-2 truncate group-hover:text-blue-600 transition-colors">
                            {first.title}
                        </h4>
                        <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs text-red-500 font-medium bg-red-50 px-1.5 py-0.5 rounded">{(first.views || 0).toLocaleString()} 热度</span>
                            <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{first.category}</span>
                        </div>
                    </div>
                </Link>
                )}

                {/* === NO.2 & NO.3 === */}
                {(second || third) && (
                    <div className="grid grid-cols-2 gap-0 border-b border-gray-100">
                        {[second, third].map((book, i) => {
                            if (!book) return null;
                            const rank = i + 2;
                            const isSecond = rank === 2;
                            return (
                                <Link 
                                    key={book.id} 
                                    href={`/book/${book.id}`} 
                                    className={`group relative flex flex-col p-4 transition-all hover:bg-gray-50 ${isSecond ? 'border-r border-gray-100' : ''}`}
                                >
                                    <div className={`absolute top-3 left-3 w-6 h-6 rounded-full border-2 border-white shadow flex items-center justify-center z-20 text-white text-[10px] font-black italic ${isSecond ? 'bg-gray-300' : 'bg-orange-300'}`}>
                                        {rank}
                                    </div>
                                    
                                    <div className="flex gap-3">
                                        <div className="w-20 h-28 flex-shrink-0 rounded bg-gray-200 overflow-hidden shadow-md group-hover:shadow-lg transition-all border border-black/5">
                                            {book.cover_image && <img src={book.cover_image} className="w-full h-full object-cover" />}
                                        </div>
                                        
                                        <div className="flex-1 min-w-0 flex flex-col justify-center">
                                            <h5 className="font-bold text-gray-800 text-base mb-1 line-clamp-1 group-hover:text-blue-600 transition-colors">
                                                {book.title}
                                            </h5>
                                            <div className="flex items-center gap-2 text-xs text-gray-400">
                                                <span>{book.category}</span>
                                                <span className="text-red-400">{(book.views/10000).toFixed(1)}w</span>
                                            </div>
                                        </div>
                                    </div>
                                </Link>
                            );
                        })}
                    </div>
                )}

                {/* === NO.4 - NO.10 === */}
                <div className="px-2 pt-2 flex flex-col gap-1">
                    {others.map((book: any, i: number) => {
                        const rank = i + 4;
                        return (
                        <Link 
                            key={book.id} 
                            href={`/book/${book.id}`}
                            className="flex items-center gap-3 p-2 rounded hover:bg-gray-50 transition-colors group"
                        >
                            <div className="w-5 h-5 flex-shrink-0 flex items-center justify-center rounded text-xs font-bold text-gray-400 bg-gray-100 mt-1">
                                {rank}
                            </div>

                            <div className="flex-1 min-w-0 flex items-center justify-between">
                                <span className="text-lg font-bold text-gray-700 truncate group-hover:text-blue-600 max-w-[65%]">
                                    {book.title}
                                </span>
                                <span className="text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded whitespace-nowrap">{book.category}</span>
                            </div>
                        </Link>
                        );
                    })}
                </div>
            </>
            )}
        </div>
      </div>
    </div>
  );
};

export default RankingList;