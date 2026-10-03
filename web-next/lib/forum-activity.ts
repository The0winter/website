'use client';
import {useEffect,type RefObject} from 'react';
import type {ForumPost} from './api';
import {safeFetch} from './request';
import {ensureForumFeedback} from './forum-feedback';

type Activity={type:'impression'|'read';token:string;activeMs?:number;depth?:number};
let pending:Activity[]=[],timer:ReturnType<typeof setTimeout>|undefined,identity='guest';
const seen=new Set<string>();
export function setForumActivityUser(user:string|null) {
  if(identity===(user||'guest'))return;
  identity=user||'guest';pending=[];seen.clear();if(timer)clearTimeout(timer);timer=undefined;
}
function enqueue(event:Activity) {
  pending.push(event);
  if(timer)return;
  timer=setTimeout(()=>{
    timer=undefined;const events=pending.splice(0,20);
    void safeFetch('/api/forum/recommendations/events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({events}),keepalive:true})
      .catch(()=>{/* Optional telemetry must not interrupt browsing. */});
    if(pending.length){const rest=pending;pending=[];for(const row of rest)enqueue(row);}
  },1800);
}

export function useForumImpressions(root:RefObject<HTMLDivElement|null>,posts:ForumPost[],active:boolean) {
  useEffect(()=>{
    if(!active || !root.current)return;
    const visible=new Map<Element,string>(),timers=new Map<Element,ReturnType<typeof setTimeout>>();
    const tokens=new Map(posts.map(post=>[post.entryId||post.topReply?.id||post.id,post.recommendation?.token]));
    const schedule=(node:Element,token:string)=>{
      const key=identity+':'+node.getAttribute('data-entry-id');
      if(document.visibilityState!=='visible'||seen.has(key)||timers.has(node))return;
      timers.set(node,setTimeout(()=>{
        timers.delete(node);
        if(document.visibilityState!=='visible'||!node.isConnected||!visible.has(node))return;
        seen.add(key);enqueue({type:'impression',token});
      },1100));
    };
    const observer=new IntersectionObserver(entries=>{
      for(const entry of entries) {
        const token=tokens.get(entry.target.getAttribute('data-entry-id')||'');
        if(token && entry.isIntersecting && entry.intersectionRatio>=.5){visible.set(entry.target,token);schedule(entry.target,token);}
        else {visible.delete(entry.target);const timeout=timers.get(entry.target);if(timeout)clearTimeout(timeout);timers.delete(entry.target);}
      }
    },{threshold:[0,.5]});
    root.current.querySelectorAll('[data-entry-id]').forEach(node=>observer.observe(node));
    const visibility=()=>{for(const timeout of timers.values())clearTimeout(timeout);timers.clear();if(document.visibilityState==='visible')for(const [node,token] of visible)schedule(node,token);};
    document.addEventListener('visibilitychange',visibility);
    return ()=>{observer.disconnect();for(const timeout of timers.values())clearTimeout(timeout);document.removeEventListener('visibilitychange',visibility);};
  },[root,posts,active]);
}

export function useForumReadingActivity(entry:string|undefined,user:string|undefined,selector:string,enabled=true) {
  useEffect(()=>{
    if(!entry||!enabled)return;
    const controller=new AbortController();let disposed=false,receipt:{token:string;minReadMs:number}|undefined;
    let activeMs=0,depth=0,last=performance.now(),sent=false,started=false;
    const tick=()=>{
      const now=performance.now(),elapsed=Math.min(1500,now-last);last=now;
      if(sent||disposed||document.visibilityState!=='visible'||document.querySelector('[role="dialog"]'))return;
      const node=document.querySelector(selector);if(!node)return;
      const rect=node.getBoundingClientRect();
      if(Math.min(rect.bottom,innerHeight)-Math.max(rect.top,0)<Math.min(160,rect.height*.5))return;
      if(!started){started=true;void ensureForumFeedback(user||'guest').then(()=>{
        if(disposed)return;
        return safeFetch('/api/forum/recommendations/receipt?entry='+entry,{signal:controller.signal});
      }).then(async response=>{if(response?.ok && !disposed)receipt=await response.json();}).catch(()=>{});}
      if(!receipt)return;
      activeMs+=elapsed;depth=Math.max(depth,Math.min(1,Math.max(0,(innerHeight-rect.top)/Math.max(1,rect.height))));
      if(activeMs>=receipt.minReadMs && depth>=.1){sent=true;enqueue({type:'read',token:receipt.token,activeMs:Math.floor(activeMs),depth});}
    };
    const interval=setInterval(tick,1000);tick();
    return ()=>{disposed=true;controller.abort();clearInterval(interval);};
  },[entry,user,selector,enabled]);
}
