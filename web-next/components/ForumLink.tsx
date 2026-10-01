'use client';
import Link from 'next/link';
import type {ComponentProps} from 'react';
import {navigateForumLink} from '@/lib/forum-navigation';

export default function ForumLink({onNavigate,...props}:ComponentProps<typeof Link>) {
  return <Link {...props} onNavigate={event=>{
    let prevented=false;
    onNavigate?.({preventDefault:()=>{prevented=true;event.preventDefault();}});
    if(!prevented && typeof props.href==='string' && navigateForumLink(props.href))event.preventDefault();
  }}/>;
}
