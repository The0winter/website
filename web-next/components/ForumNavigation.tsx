'use client';
import {useEffect} from 'react';
import {useRouter} from 'next/navigation';
import {installForumNavigation} from '@/lib/forum-navigation';
import ForumLoadingShell from './ForumLoadingShell';
import ForumQuestionLoading from './ForumQuestionLoading';

export default function ForumNavigation() {
  const router=useRouter();
  useEffect(()=>installForumNavigation(router),[router]);
  return <><div id="forum-loading-template" hidden inert aria-hidden="true"><ForumLoadingShell/></div><div id="forum-question-loading-template" hidden inert aria-hidden="true"><ForumQuestionLoading/></div></>;
}
