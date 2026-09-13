import {notFound} from 'next/navigation';
import {safeFetch} from '@/lib/request';
import {getApiBaseUrl} from '@/utils/api';
import {plainDescription, publicMetadata} from '@/lib/seo';

export async function forumMetadata(id: string) {
  if (!/^[a-f0-9]{24}$/i.test(id)) notFound();
  const response = await safeFetch(`${getApiBaseUrl()}/forum/posts/${id}`, {cache: 'no-store'});
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error('讨论暂时无法读取');
  const post = await response.json();
  const path = post.type === 'question' ? '/forum/question/' + id : '/forum/' + id;
  return publicMetadata(`${post.title} - 书友社区 - 九天小说站`, plainDescription(post.summary || post.content || '', post.title), path);
}
