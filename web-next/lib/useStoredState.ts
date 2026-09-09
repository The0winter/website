'use client';
import {useCallback,useSyncExternalStore,type SetStateAction} from 'react';
const subscribe=(notify:()=>void)=>{window.addEventListener('storage',notify);window.addEventListener('local-settings',notify);return()=>{window.removeEventListener('storage',notify);window.removeEventListener('local-settings',notify);};};
export function useStoredState<T>(key:string,initial:T,valid:(value:unknown)=>boolean=value=>typeof value===typeof initial):[T,(value:SetStateAction<T>)=>void] {
  const read=useCallback(()=>{try{return localStorage.getItem(key);}catch{return null;}},[key]);
  const raw=useSyncExternalStore(subscribe,read,()=>null);
  const decode=(text:string|null):T=>{if(text===null)return initial;let value:unknown;try{value=JSON.parse(text);}catch{value=text;}return valid(value)?value as T:initial;};
  const value=decode(raw);
  const set=(update:SetStateAction<T>)=>{const previous=decode(read());const next=typeof update==='function'?(update as (v:T)=>T)(previous):update;if(!valid(next))return;try{localStorage.setItem(key,JSON.stringify(next));window.dispatchEvent(new Event('local-settings'));}catch{}};
  return [value,set];
}
