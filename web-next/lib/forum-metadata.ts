import {notFound} from 'next/navigation';
import {safeFetch} from '@/lib/request';
import {getApiBaseUrl} from '@/utils/api';
import {plainDescription, publicMetadata} from '@/lib/seo';

export async function forumMetadata(id: string, answerId?: string) {
  if (!/^[a-f0-9]{24}$/i.test(id) || answerId && !/^[a-f0-9]{24}$/i.test(answerId)) notFound();
  const response = await safeFetch(`${getApiBaseUrl()}/forum/posts/${id}${answerId ? '/reading?answer='+answerId : ''}`, {cache: 'no-store'});
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error('讨论暂时无法读取');
  const result = await response.json();
  const post = answerId ? result.post : result;
  if(answerId) {
    if(post.type !== 'question') notFound();
    const answer = result.answer;
    if(!answer) notFound();
    const title = answer.title || `${answer.author?.name || '书友'}对「${post.title}」的回答`;
    return publicMetadata(`${title} - 书友社区 - 九天小说站`, plainDescription(answer.content || '', title), `/forum/${answerId}?fromQuestion=${id}`);
  }
  const path = post.type === 'question' ? '/forum/question/' + id : '/forum/' + id;
  return publicMetadata(`${post.title} - 书友社区 - 九天小说站`, plainDescription(post.summary || post.content || '', post.title), path);
}
