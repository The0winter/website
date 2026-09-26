import {cache} from 'react';
import {notFound} from 'next/navigation';
import {safeFetch} from '@/lib/request';
import {getApiBaseUrl} from '@/utils/api';
import {privateRobots} from '@/lib/seo';
import {resolveProfileTheme} from '@/lib/profile-themes';
import PublicUserProfile from './PublicUserProfile';

export const dynamic = 'force-dynamic';
type Props = {params: Promise<{id:string}>};
const getProfile = cache(async (id:string) => {
  if (!/^[a-f0-9]{24}$/i.test(id)) notFound();
  const response = await safeFetch(`${getApiBaseUrl()}/users/${id}/profile`, {cache:'no-store'});
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error('书友主页暂时无法读取');
  const row = await response.json();
  // Only public fields cross the server/client boundary, even if an API adds fields later.
  return {id, username:String(row.username || '书友'), avatar:typeof row.avatar === 'string' ? row.avatar : '',
    isTestAccount:row.isTestAccount === true,
    role:row.role === 'admin' ? 'admin' as const : 'reader' as const,
    created_at:typeof row.created_at === 'string' ? row.created_at : '',
    profileTheme:resolveProfileTheme(id, row.profileTheme)};
});

export async function generateMetadata({params}:Props) {
  const profile = await getProfile((await params).id);
  return {title:`${profile.username}的主页 - 九天小说站`, robots:privateRobots};
}

export default async function UserPage({params}:Props) {
  return <PublicUserProfile profile={await getProfile((await params).id)}/>;
}
