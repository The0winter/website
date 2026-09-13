'use client';

import {useEffect, useRef, useState} from 'react';
import {safeFetch} from './request';

export type ReviewReaction = 'like' | 'dislike' | null;
type Feedback = {id:string; likes:number; dislikes:number; reaction:ReviewReaction};

export function useReviewReactions(bookId:string, ids:string, userId:string) {
  const key = `${bookId}/${userId}/${ids}`;
  const currentKey = useRef(key);
  const [refresh, setRefresh] = useState(0);
  const [state, setState] = useState<{key:string; rows:Record<string,Feedback>}>({key:'', rows:{}});
  const [error, setError] = useState<{key:string; message:string} | null>(null);
  const [pending, setPending] = useState<Record<string,boolean>>({});
  const inFlight = useRef(new Set<string>());

  useEffect(() => {
    currentKey.current = key;
    if (!ids) return;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await safeFetch(`/api/books/${bookId}/review-reactions?ids=${encodeURIComponent(ids)}`, {signal:controller.signal, cache:'no-store'});
        if (!response.ok) throw Error('评论反馈暂不可用');
        const rows:Feedback[] = await response.json();
        if (controller.signal.aborted) return;
        setState({key, rows:Object.fromEntries(rows.map(row => [row.id, row]))});
        setError(null);
      } catch {
        if (!controller.signal.aborted) setError({key, message:'评论反馈加载失败，请重试'});
      }
    }
    void load();
    return () => {controller.abort(); currentKey.current = '';};
  }, [bookId, ids, key, refresh]);

  async function react(id:string, reaction:ReviewReaction) {
    const requestKey = `${key}/${id}`;
    if (inFlight.current.has(requestKey)) return;
    inFlight.current.add(requestKey);
    setPending(previous => ({...previous, [requestKey]:true}));
    try {
      const response = await safeFetch(`/api/books/${bookId}/reviews/${id}/reaction`, {
        method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({reaction}),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || '反馈保存失败，请重试');
      if (currentKey.current !== key) return;
      setState(previous => ({key, rows:{...(previous.key === key ? previous.rows : {}), [id]:data}}));
      setError(null);
    } catch (error) {
      if (currentKey.current === key) setError({key, message:error instanceof Error ? error.message : '反馈保存失败，请重试'});
    } finally {
      inFlight.current.delete(requestKey);
      setPending(previous => {const next = {...previous}; delete next[requestKey]; return next;});
    }
  }

  return {
    rows:state.key === key ? state.rows : {},
    error:error?.key === key ? error.message : '',
    busy:(id:string) => !!pending[`${key}/${id}`],
    react,
    retry:() => setRefresh(value => value + 1),
  };
}
