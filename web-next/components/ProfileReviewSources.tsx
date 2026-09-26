'use client';

import {useEffect,useState} from 'react';
import {safeFetch} from '@/lib/request';

type Source={bookTitle:string;platform:string;author:string;url:string;kind:'excerpt'|'paraphrase'};
export default function ProfileReviewSources({userId}:{userId:string}) {
  const [rows,setRows]=useState<Source[]>([]),[error,setError]=useState(false),[retry,setRetry]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    safeFetch(`/api/users/${userId}/review-sources`,{cache:'no-store',signal:controller.signal})
      .then(async response=>{if(!response.ok)throw Error();const rows:Source[]=await response.json();if(!controller.signal.aborted){setRows(rows.filter(row=>row.url.startsWith('https://')));setError(false);}})
      .catch(()=>{if(!controller.signal.aborted)setError(true);});
    return()=>controller.abort();
  },[userId,retry]);
  if(!rows.length&&!error)return null;
  return <section className="public-profile-info public-review-sources"><h2>评论来源</h2>
    <p className="text-sm text-gray-500 my-3">星级用于功能测试，非原作者评分；参考改写的内容也不代表原作者原话。</p>
    {error?<button onClick={()=>setRetry(value=>value+1)}>来源暂时无法读取，点击重试</button>:<ul className="space-y-3">{rows.map((row,index)=><li key={index} className="text-sm"><span>{row.bookTitle} · {row.kind==='paraphrase'?'参考改写':'原文短摘录'}</span><br/><a className="underline" href={row.url} target="_blank" rel="noopener noreferrer">{row.platform} · {row.author} ↗</a></li>)}</ul>}
  </section>;
}
