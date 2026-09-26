'use client';

import {useState,type CSSProperties} from 'react';
import {UserRound} from 'lucide-react';
import {resolveAvatarColor} from '../../shared/avatar-colors.mjs';
import './user-avatar.css';

export default function UserAvatar({user, className = '', dark = false}: {
  user?: {id?:string;_id?:string;username?:string;avatar?:string;avatarColor?:string} | null;
  className?:string;
  dark?:boolean;
}) {
  const [failedSource, setFailedSource] = useState('');
  const name = user?.username?.trim() || '书友';
  const initial = Array.from(name)[0].toUpperCase();
  const source = user?.avatar;
  const color=resolveAvatarColor(user?.id||user?._id||name,user?.avatarColor);
  const style={'--avatar-background':color.background,'--avatar-foreground':color.foreground,'--avatar-border':color.border} as CSSProperties;
  return <span style={style} data-avatar-color={color.id} className={`user-avatar${dark ? ' user-avatar--dark' : ''} ${className}`} role="img" aria-label={user ? `${name}的头像` : '访客头像'}>
    {source && source !== failedSource
      ? <img src={source} alt="" onError={() => setFailedSource(source)}/>
      : user ? initial : <UserRound size={18} aria-hidden="true"/>}
  </span>;
}
