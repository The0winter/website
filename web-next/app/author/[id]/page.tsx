"use client";

export const dynamic = 'force-dynamic';

import React, { useEffect, useState } from 'react';
//import { useParams } from 'react-router-dom';
import { useParams } from 'next/navigation';
import { BookOpen, Award, Flame, Plus, Clock } from 'lucide-react';
// ✅ 确保引用路径正确
import { Book, Profile } from '@/lib/api';
import {safeFetch} from '@/lib/request';
import Link from 'next/link';

export default function AuthorProfile() {
    const params = useParams();
    const authorId = params.id;
    const [books, setBooks] = useState<Book[]>([]);
    const [loading, setLoading] = useState(true);

    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const [profile, setProfile] = useState<Profile | null>(null);
    const [error, setError] = useState('');
    const [asOf, setAsOf] = useState(0);
    const author = {username:profile?.username || '作者',avatar:profile?.avatar || '/default-avatar.png',role:'作者',bio:'作者公开作品'};
    const stats = {totalBooks:total,daysActive:profile?.created_at ? Math.max(0,Math.floor((asOf-Date.parse(profile.created_at))/86400000)) : '—'};
    useEffect(() => {
        let active=true;
        Promise.all([
            safeFetch(`/api/books?author_id=${encodeURIComponent(String(authorId))}&page=${page}&limit=20&orderBy=updatedAt`),
            safeFetch(`/api/authors/${encodeURIComponent(String(authorId))}`).then(async r=>{if(!r.ok)throw new Error('作者加载失败');return r.json();}),
        ]).then(async ([response, user])=>{
            if(!response.ok)throw new Error('作品加载失败，请重试');
            const data: Book[]=await response.json();
            if(active){setBooks(data);setTotal(Number(response.headers.get('X-Total-Count')));setProfile(user);setAsOf(Date.now());setLoading(false);setError('');}
        }).catch(e=>{if(active){setError(e instanceof Error ? e.message : '加载失败');setLoading(false);}});
        return ()=>{active=false;};
    },[authorId,page]);
    if (error) return <div role="alert">{error}<button onClick={()=>location.reload()}>重试</button></div>;
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
                                    <p className="text-2xl font-bold">—</p>
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
                                        <Link href={`/book/${latestBook.id}`} className="bg-red-600 hover:bg-red-700 text-white px-6 py-2 rounded-full font-medium transition-colors">
                                            Read Now
                                        </Link>
                                        <Link href={`/book/${latestBook.id}`} className="border border-gray-300 hover:border-gray-400 text-gray-700 px-6 py-2 rounded-full font-medium flex items-center gap-2 transition-colors">
                                            <Plus className="w-4 h-4" />
                                            Library
                                        </Link>
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
                            All Works ({total})
                        </h3>
                        <div className="flex gap-4"><button disabled={page===1} onClick={()=>setPage(page-1)}>上一页</button><span>第 {page} 页</span><button disabled={page*20>=total} onClick={()=>setPage(page+1)}>下一页</button></div><div className="space-y-6">
                            {otherBooks.length > 0 ? otherBooks.map((book) => (
                                <div key={book.id} className="flex gap-4 pb-6 border-b border-gray-100 last:border-0 last:pb-0">
                                    <div className="text-sm font-medium text-gray-400 min-w-[60px] pt-1">
                                        {/* ✅ 修复 year 报错：使用 created_at */}
                                        {book.created_at || book.createdAt ? new Date(book.created_at || book.createdAt!).getFullYear() : '—'}
                                    </div>
                                    <div className="w-16 h-24 shrink-0 bg-gray-200 rounded overflow-hidden">
                                        {book.cover_image ? (
                                            <img src={book.cover_image} className="w-full h-full object-cover" />
                                        ) : <div className="w-full h-full bg-gray-100"></div>}
                                    </div>
                                    <div className="flex-1">
                                        <div className="flex justify-between items-start">
                                            <h4 className="font-bold text-gray-900 hover:text-blue-600 cursor-pointer"><Link href={`/book/${book.id}`}>{book.title}</Link></h4>
                                            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">
                                                {book.status || 'Ongoing'}
                                            </span>
                                        </div>
                                        <p className="text-sm text-gray-500 mt-1 line-clamp-2">{book.description}</p>
                                        <div className="mt-2 text-xs text-gray-400 flex items-center gap-4">
                                            <span>{book.category}</span>
                                            <span className="flex items-center gap-1"><Clock className="w-3 h-3"/> {book.created_at || book.createdAt ? new Date(book.created_at || book.createdAt!).toLocaleDateString() : '—'}</span>
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
                                    <div className="text-xs text-gray-500">暂无已核实记录</div>
                                </div>
                            </div>
                            <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg border border-blue-100">
                                <span className="text-2xl">⭐</span>
                                <div>
                                    <div className="text-sm font-bold text-gray-900">Rising Star</div>
                                    <div className="text-xs text-gray-500">暂无已核实记录</div>
                                </div>
                            </div>
                            <div className="flex items-center gap-3 p-3 bg-purple-50 rounded-lg border border-purple-100">
                                <span className="text-2xl">📚</span>
                                <div>
                                    <div className="text-sm font-bold text-gray-900">Prolific</div>
                                    <div className="text-xs text-gray-500">暂无已核实记录</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}