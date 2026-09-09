'use client';
import {useEffect} from 'react';
import {safeFetch} from './request';
export function useForumView(postId?:string){
  useEffect(()=>{
    if(!postId)return;
    let timer:ReturnType<typeof setTimeout>|undefined,sent=false;
    function schedule(){
      if(timer)clearTimeout(timer);
      if(!sent&&document.visibilityState==='visible')timer=setTimeout(()=>{
        sent=true;
        void safeFetch(`/api/forum/posts/${postId}/views`,{method:'POST'}).catch(()=>{/* Viewing remains usable during telemetry failure. */});
      },10000);
    }
    schedule();document.addEventListener('visibilitychange',schedule);
    return()=>{if(timer)clearTimeout(timer);document.removeEventListener('visibilitychange',schedule);};
  },[postId]);
}
