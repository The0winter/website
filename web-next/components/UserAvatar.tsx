'use client';

import {useState} from 'react';
import {UserRound} from 'lucide-react';
import './user-avatar.css';

export default function UserAvatar({user, className = '', dark = false}: {
  user?: {username?:string; avatar?:string} | null;
  className?:string;
  dark?:boolean;
}) {
  const [failedSource, setFailedSource] = useState('');
  const name = user?.username?.trim() || '书友';
  const initial = Array.from(name)[0].toUpperCase();
  const source = user?.avatar;
  return <span className={`user-avatar${dark ? ' user-avatar--dark' : ''} ${className}`} role="img" aria-label={user ? `${name}的头像` : '访客头像'}>
    {source && source !== failedSource
      ? <img src={source} alt="" onError={() => setFailedSource(source)}/>
      : user ? initial : <UserRound size={18} aria-hidden="true"/>}
  </span>;
}
