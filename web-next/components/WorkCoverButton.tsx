'use client';

import {useState} from 'react';
import {ImagePlus} from 'lucide-react';
import type {Book} from '@/lib/api';
import WorkEditor from './WorkEditor';
import './work-actions.css';

export default function WorkCoverButton({book, onChanged}: {book:Book; onChanged:()=>void}) {
  const [editing,setEditing]=useState(false);
  return <>
    <button type="button" className="work-cover-shortcut" onClick={()=>setEditing(true)}><ImagePlus size={18} aria-hidden="true"/>更换封面</button>
    {editing && <WorkEditor book={book} coverOnly onClose={()=>setEditing(false)} onChanged={onChanged}/>}
  </>;
}
