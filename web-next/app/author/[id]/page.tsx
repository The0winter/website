"use client";

export const dynamic = 'force-dynamic';

import React, { useEffect, useState } from 'react';
//import { useParams } from 'react-router-dom';
import { useParams } from 'next/navigation';
import { BookOpen, Award, Flame, Plus, Clock } from 'lucide-react';
// ✅ 确保引用路径正确
import { booksApi, Book } from '@/lib/api';

export default function AuthorProfile() {
    const params = useParams();
    const authorId = params.id;
    const [books, setBooks] = useState<Book[]>([]);
    const [loading, setLoading] = useState(true);

// 1. 先定义一个安全的 helper 变量算出名字
    const safeAuthorName = (() => {
        const book = books[0];
        // 检查：书存在 && author_id 存在 && author_id 是个对象（说明 populate 成功）
        if (book && book.author_id && typeof book.author_id === 'object') {
            return (book.author_id as any).username;
        }
        // 兜底：如果书里存了 author 字符串（如 "Ao"），就用它
        if (book && book.author) {
            return book.author;
        }
        // 最后默认值
        return "签约作家";
    })();

    const author = {
        id: authorId,
        username: safeAuthorName, // 👈 赋值算好的字符串
        role: "Platinum Writer",
        bio: "This author creates amazing worlds on NovelHub. (Bio is a placeholder until backend API is ready).",
        // 使用 DiceBear 根据 ID 生成固定头像
        avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${authorId}` 
    };

    // 模拟数据统计
    const stats = {
        totalBooks: books.length,
        totalWords: 1500000, // 假数据
        daysActive: 365      // 假数据
    };

useEffect(() => {
    const fetchAuthorBooks = async () => {
        try {
            setLoading(true);
            const allBooks = await booksApi.getAll();
            
            // 🔍 调试大法：先看看拿到了什么
            console.log("All books fetched:", allBooks); 

            const filteredBooks = allBooks.filter(b => {
                // 🛑 第一步：先检查 author_id 是否存在
                // 如果是 null 或 undefined，直接扔掉，防止报错
                if (!b.author_id) return false;

                // 🛡️ 第二步：安全地提取 ID
                // 不管它是对象还是字符串，都统一转成 String 来对比
                const bookAuthorId = typeof b.author_id === 'object' 
                    ? (b.author_id as any)._id 
                    : b.author_id;

                // 🔍 可以在这里打印一下，看看每一本书的 ID 对不对
                // console.log(`Comparing book author ${bookAuthorId} with page author ${authorId}`);

                return String(bookAuthorId) === String(authorId);
            });
            
            console.log("Filtered books:", filteredBooks); // 看看筛选剩下了什么
            setBooks(filteredBooks);

        } catch (error) {
            console.error('Error fetching author books:', error);
        } finally {
            setLoading(false);
        }
    };

    if (authorId) {
        fetchAuthorBooks();
    }
}, [authorId]);

    if (loading) return <div className="text-center py-12">Loading...</div>;

    // 这里的逻辑保持你想要的效果
    const latestBook = books[0];
    const otherBooks = books.slice(1);

    return (
        <div className="bg-gray-50 min-h-screen">
            {/* Header Banner */}
            <div className="bg-gradient-to-r from-purple-900 to-black h-48 relative">
                <div className="max-w-7xl mx-auto px-6 h-full flex items-end pb-6">
                    <div className="flex gap-6 w-full">
                        {/* Avatar */}
                        <div className="w-32 h-32 rounded-full border-4 border-white bg-white overflow-hidden shadow-lg">
                            <img
                                src={author.avatar}
                                alt={author.username}
                                className="w-full h-full object-cover"
                                onError={(e) => {
            (e.target as HTMLImageElement).src = "/default-avatar.png"; // 你的本地默认图路径
        }}
                            />
                        </div>
                        
                        {/* Author Info */}
                        <div className="flex-1 text-white flex justify-between items-end pb-2">
                            <div>
                                <h1 className="text-4xl font-bold">{author.username}</h1>
                                <p className="text-gray-300 max-w-xl line-clamp-1">{author.bio}</p>
                                <span className="inline-block mt-2 bg-purple-600 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider">
                                    {author.role}
                                </span>
                            </div>
                            
                            {/* Stats */}
                            <div className="flex gap-8 text-center">
                                <div>
                                    <p className="text-2xl font-bold">{stats.totalBooks}</p>
                                    <p className="text-xs text-purple-200 uppercase">Works</p>
                                </div>
                                <div>
                                    <p className="text-2xl font-bold">{(stats.totalWords / 1000000).toFixed(1)}M</p>
                                    <p className="text-xs text-purple-200 uppercase">Words</p>
                                </div>
                                <div>
                                    <p className="text-2xl font-bold">{stats.daysActive}</p>
                                    <p className="text-xs text-purple-200 uppercase">Days</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div className="max-w-7xl mx-auto px-6 py-8 flex flex-col lg:flex-row gap-6">
                {/* Left Column */}
                <div className="lg:w-3/4 space-y-8">
                    {/* Hot Serial */}
                    {latestBook ? (
                        <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-shadow">
                            <div className="flex p-6 gap-6">
                                <div className="w-32 h-48 shrink-0 bg-gray-200 rounded overflow-hidden">
                                     {latestBook.cover_image ? (
                                        <img src={latestBook.cover_image} className="w-full h-full object-cover" />
                                     ) : <div className="w-full h-full flex items-center justify-center bg-gray-300"><BookOpen/></div>}
                                </div>
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-3">
                                        <Flame className="w-4 h-4 text-red-500" />
                                        <span className="text-xs font-bold text-red-500 uppercase tracking-wide">Latest Release</span>
                                    </div>
                                    <h2 className="text-2xl font-bold mb-2 text-gray-900">{latestBook.title}</h2>
                                    <p className="text-gray-600 mb-6 line-clamp-2">{latestBook.description}</p>
                                    <div className="flex gap-3">
                                        <button className="bg-red-600 hover:bg-red-700 text-white px-6 py-2 rounded-full font-medium transition-colors">
                                            Read Now
                                        </button>
                                        <button className="border border-gray-300 hover:border-gray-400 text-gray-700 px-6 py-2 rounded-full font-medium flex items-center gap-2 transition-colors">
                                            <Plus className="w-4 h-4" />
                                            Library
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="p-8 bg-white rounded-lg text-center text-gray-500">No books found for this author.</div>
                    )}

                    {/* All Works */}
                    <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
                        <h3 className="text-lg font-bold mb-6 text-gray-900 flex items-center gap-2">
                            <BookOpen className="w-5 h-5" />
                            All Works ({books.length})
                        </h3>
                        <div className="space-y-6">
                            {otherBooks.length > 0 ? otherBooks.map((book) => (
                                <div key={book.id} className="flex gap-4 pb-6 border-b border-gray-100 last:border-0 last:pb-0">
                                    <div className="text-sm font-medium text-gray-400 min-w-[60px] pt-1">
                                        {/* ✅ 修复 year 报错：使用 created_at */}
                                        {new Date(book.created_at || Date.now()).getFullYear()}
                                    </div>
                                    <div className="w-16 h-24 shrink-0 bg-gray-200 rounded overflow-hidden">
                                        {book.cover_image ? (
                                            <img src={book.cover_image} className="w-full h-full object-cover" />
                                        ) : <div className="w-full h-full bg-gray-100"></div>}
                                    </div>
                                    <div className="flex-1">
                                        <div className="flex justify-between items-start">
                                            <h4 className="font-bold text-gray-900 hover:text-blue-600 cursor-pointer">{book.title}</h4>
                                            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">
                                                {book.status || 'Ongoing'}
                                            </span>
                                        </div>
                                        <p className="text-sm text-gray-500 mt-1 line-clamp-2">{book.description}</p>
                                        <div className="mt-2 text-xs text-gray-400 flex items-center gap-4">
                                            <span>{book.category}</span>
                                            <span className="flex items-center gap-1"><Clock className="w-3 h-3"/> {new Date(book.created_at || Date.now()).toLocaleDateString()}</span>
                                        </div>
                                    </div>
                                </div>
                            )) : (
                                <p className="text-gray-500 italic">No other works.</p>
                            )}
                        </div>
                    </div>
                </div>

                {/* Right Column - Sidebar */}
                <div className="lg:w-1/4">
                    <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 sticky top-24">
                        <h3 className="text-sm font-bold mb-4 flex items-center gap-2 text-gray-900 uppercase tracking-wide">
                            <Award className="w-4 h-4 text-yellow-500" />
                            Achievements
                        </h3>
                        <div className="space-y-4">
                            <div className="flex items-center gap-3 p-3 bg-yellow-50 rounded-lg border border-yellow-100">
                                <span className="text-2xl">🏆</span>
                                <div>
                                    <div className="text-sm font-bold text-gray-900">Author Glory</div>
                                    <div className="text-xs text-gray-500">86 collected</div>
                                </div>
                            </div>
                            <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg border border-blue-100">
                                <span className="text-2xl">⭐</span>
                                <div>
                                    <div className="text-sm font-bold text-gray-900">Rising Star</div>
                                    <div className="text-xs text-gray-500">Top 100 rank</div>
                                </div>
                            </div>
                            <div className="flex items-center gap-3 p-3 bg-purple-50 rounded-lg border border-purple-100">
                                <span className="text-2xl">📚</span>
                                <div>
                                    <div className="text-sm font-bold text-gray-900">Prolific</div>
                                    <div className="text-xs text-gray-500">1M+ words</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}