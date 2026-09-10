'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {safeFetch} from '@/lib/request';

type Article={_id:string;title:string;summary?:string;author?:{username?:string};createdAt:string};
export default function BookArticles({bookId,title}:{bookId:string;title:string}){
  const [items,setItems]=useState<Article[]>([]);
  const [page,setPage]=useState(1);
  const [total,setTotal]=useState(0);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [retry,setRetry]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    setLoading(true);setError('');
    safeFetch(`/api/books/${bookId}/articles?page=${page}`,{signal:controller.signal})
      .then(async response=>{if(!response.ok)throw Error('文章加载失败，请重试');return response.json();})
      .then(data=>{setItems(data.items);setTotal(data.total);})
      .catch(error=>{if(!controller.signal.aborted)setError(error.message);})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[bookId,page,retry]);
  return <div className="book-articles">
    <div className="flex items-center justify-between gap-3 text-sm mb-5"><span className="text-gray-500">书友创作，分享阅读见解</span><Link className="text-red-600 shrink-0" href={`/forum/create?type=article&bookId=${bookId}&bookTitle=${encodeURIComponent(title)}`}>写文章</Link></div>
    {loading?<p className="py-8 text-center text-gray-500">正在加载文章…</p>:error?<p role="alert">{error} <button onClick={()=>setRetry(v=>v+1)}>重试</button></p>:items.length?items.map(item=><Link key={item._id} href={`/forum/question/${item._id}`} className="block py-4 border-t border-gray-100"><h3 className="font-semibold text-gray-900">{item.title}</h3><p className="text-sm text-gray-500 line-clamp-2 mt-2">{item.summary}</p><p className="text-xs text-gray-400 mt-3">{item.author?.username||'书友'} · {item.createdAt.slice(0,10)}</p></Link>):<p className="py-10 text-center text-sm text-gray-400">还没有文章，来分享你的第一篇读后感吧</p>}
    {total>20&&<nav aria-label="文章分页" className="flex justify-center gap-5 py-4"><button disabled={page===1} onClick={()=>setPage(p=>p-1)}>上一页</button><span>{page}</span><button disabled={page*20>=total} onClick={()=>setPage(p=>p+1)}>下一页</button></nav>}
  </div>;
}

