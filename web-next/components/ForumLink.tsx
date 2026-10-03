'use client';
import Link from 'next/link';
import type {ComponentProps} from 'react';
import {navigateForumLink} from '@/lib/forum-navigation';
import {warmForumDestination} from '@/lib/forum-reading-cache';
import {useRouter} from 'next/navigation';

export default function ForumLink({onNavigate, onTouchStart, onMouseEnter, onFocus, ...props}:ComponentProps<typeof Link>) {
  const router = useRouter();
  const warm = () => {if (typeof props.href === 'string') {warmForumDestination(props.href); router.prefetch(props.href);}};
  return <Link prefetch={false} {...props}
    onTouchStart={event=>{warm();onTouchStart?.(event);}}
    onMouseEnter={event=>{warm();onMouseEnter?.(event);}}
    onFocus={event=>{warm();onFocus?.(event);}}
    onNavigate={event=>{
    let prevented=false;
    onNavigate?.({preventDefault:()=>{prevented=true;event.preventDefault();}});
    if(!prevented && typeof props.href==='string') {warm(); if(navigateForumLink(props.href))event.preventDefault();}
  }}/>;
}
