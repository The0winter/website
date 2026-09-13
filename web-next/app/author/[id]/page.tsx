import {notFound} from 'next/navigation';
import {safeFetch} from '@/lib/request';
import {getApiBaseUrl} from '@/utils/api';
import {publicMetadata} from '@/lib/seo';
import AuthorPageClient from './AuthorPageClient';

export const dynamic = 'force-dynamic';
type Props = {params: Promise<{id: string}>; searchParams: Promise<{page?: string}>};
export async function generateMetadata({params, searchParams}: Props) {
  const {id} = await params;
  if (!/^[a-f0-9]{24}$/i.test(id)) notFound();
  const response = await safeFetch(`${getApiBaseUrl()}/authors/${id}`, {cache: 'no-store'});
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error('作者信息暂时无法读取');
  const profile = await response.json();
  const {page: rawPage} = await searchParams;
  const number = Number(rawPage || 1);
  const page = Number.isSafeInteger(number) && number > 1 && number <= 100000 ? number : 1;
  return publicMetadata(`${profile.username}的作品${page > 1 ? ` - 第${page}页` : ''} - 九天小说站`, `查看${profile.username}的作品列表、小说介绍与最近更新，在线阅读尽在九天小说站。`, `/author/${id}${page > 1 ? `?page=${page}` : ''}`);
}
export default function AuthorPage() { return <AuthorPageClient/>; }
