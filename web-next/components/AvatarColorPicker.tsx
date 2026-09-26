'use client';

import {useRef,useState} from 'react';
import {Check,Palette} from 'lucide-react';
import {AVATAR_COLORS,resolveAvatarColor} from '../../shared/avatar-colors.mjs';
import {useAuth} from '@/contexts/AuthContext';
import {authApi} from '@/lib/api';
import UserAvatar from './UserAvatar';
import './avatar-color-picker.css';

export default function AvatarColorPicker({disabled,onSaving}:{disabled:boolean;onSaving:(value:boolean)=>void}) {
  const {user,setUser}=useAuth();
  const [draft,setDraft]=useState<{userId:string;color:string}|null>(null);
  const [saving,setSaving]=useState(false),[error,setError]=useState('');
  const trigger=useRef<HTMLButtonElement>(null);
  if(!user)return null;
  const saved=resolveAvatarColor(user.id,user.avatarColor),open=draft?.userId===user.id;
  const selected=open?draft.color:saved.id;
  const close=()=>{if(saving)return;setDraft(null);setError('');trigger.current?.focus();};
  const save=async()=>{
    if(saving||disabled)return;
    setSaving(true);onSaving(true);setError('');
    try{
      const result=await authApi.updateUser(user.id,{avatarColor:selected});
      if(!result.success||result.user?.avatarColor!==selected)throw Error(result.error||'颜色保存失败，请重试');
      setUser({...user,avatarColor:selected});setDraft(null);trigger.current?.focus();
    }catch(error){setError(error instanceof Error?error.message:'颜色保存失败，请重试');}
    finally{setSaving(false);onSaving(false);}
  };
  return <section className="avatar-color-settings" onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();close();}}}>
    <button ref={trigger} className="avatar-color-trigger" aria-expanded={open} aria-controls="avatar-color-options" disabled={disabled||saving}
      onClick={()=>{if(open)close();else {setDraft({userId:user.id,color:saved.id});setError('');}}}><Palette size={16}/>头像颜色<span style={{background:saved.background,borderColor:saved.border}}/></button>
    {open&&<div id="avatar-color-options" className="avatar-color-panel">
      <header><UserAvatar user={{...user,avatar:'',avatarColor:selected}}/><div><h2>选择头像颜色</h2><p>{user.avatar?'用于默认文字头像，已上传的图片会保留。':'评论、导航和个人主页会使用同一颜色。'}</p></div></header>
      <fieldset disabled={saving||disabled}><legend className="sr-only">头像颜色</legend>
        {AVATAR_COLORS.map(color=><label key={color.id} title={color.name}>
          <input type="radio" name="avatar-color" value={color.id} aria-label={color.name} checked={selected===color.id} onChange={()=>{setDraft({userId:user.id,color:color.id});setError('');}}/>
          <span style={{background:color.background,color:color.foreground,borderColor:color.border}}>{selected===color.id?<Check size={19}/>:null}</span>
        </label>)}
      </fieldset>
      {error&&<p role="alert" className="avatar-color-error">{error}</p>}
      <footer><span aria-live="polite">{saving?'正在保存…':'保存后生效'}</span><button disabled={saving} onClick={close}>取消</button><button className="avatar-color-save" disabled={saving||disabled} onClick={()=>void save()}>保存颜色</button></footer>
    </div>}
  </section>;
}
