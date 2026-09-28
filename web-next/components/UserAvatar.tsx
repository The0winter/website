'use client';

import {useState,type CSSProperties} from 'react';
import {UserRound} from 'lucide-react';
import {resolveAvatarColor} from '../../shared/avatar-colors.mjs';
import './user-avatar.css';

export default function UserAvatar({user, className = '', dark = false}: {
  user?: {id?:string;_id?:string;username?:string;avatar?:string;avatarColor?:string;isDeleted?:boolean} | null;
  className?:string;
  dark?:boolean;
}) {
  const [failedSource, setFailedSource] = useState('');
  const name = user?.username?.trim() || '书友';
  const deleted=Boolean(user?.isDeleted || user && !(user.id||user._id) && /^已注销(用户|账户|账号|书友)$/.test(name));
  const initial = Array.from(name)[0].toUpperCase();
  const source = deleted ? undefined : user?.avatar;
  const color=deleted ? {id:'deleted',background:'#ededed',foreground:'#929292',border:'#d9d9d9'} : resolveAvatarColor(user?.id||user?._id||name,user?.avatarColor);
  const style={'--avatar-background':color.background,'--avatar-foreground':color.foreground,'--avatar-border':color.border} as CSSProperties;
  return <span style={style} data-avatar-color={color.id} className={`user-avatar${dark ? ' user-avatar--dark' : ''} ${className}`} role="img" aria-label={deleted ? '已注销账户的头像' : user ? `${name}的头像` : '访客头像'}>
    {source && source !== failedSource
      ? <img src={source} alt="" onError={() => setFailedSource(source)}/>
      : user && !deleted ? initial : <UserRound size={18} aria-hidden="true"/>}
  </span>;
}
