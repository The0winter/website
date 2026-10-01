'use client';
import {useEffect} from 'react';
import {useRouter} from 'next/navigation';
import {installForumNavigation} from '@/lib/forum-navigation';
import ForumLoadingShell from './ForumLoadingShell';

export default function ForumNavigation() {
  const router=useRouter();
  useEffect(()=>installForumNavigation(router),[router]);
  return <div id="forum-loading-template" hidden inert aria-hidden="true"><ForumLoadingShell/></div>;
}
