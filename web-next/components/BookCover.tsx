'use client';

import {useState,type ImgHTMLAttributes} from 'react';
import {BookOpen} from 'lucide-react';

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>,'src'> & {src?:string;priority?:boolean};
function CoverImage({src,alt='小说封面',priority=false,className,style,onError,sizes='120px',...rest}:Props) {
  const [failed,setFailed]=useState(false);
  if (!src || failed) return <span role="img" aria-label={alt} className={className} style={{display:'grid',placeItems:'center',background:'var(--surface-soft, #e9e4dc)',color:'var(--text-muted, #817b70)',...style}}><BookOpen size={24} aria-hidden="true"/></span>;
  const managed=/^https:\/\/[^/]+\/covers\/[a-f0-9]{24}\/480\.webp$/.test(src);
  return <img {...rest} src={src} srcSet={managed?`${src.replace('/480.webp','/240.webp')} 240w, ${src} 480w`:undefined} sizes={managed?sizes:undefined} alt={alt} className={className} style={style} width={240} height={320} loading={priority?'eager':(rest.loading||'lazy')} fetchPriority={priority?'high':'auto'} decoding="async" onError={event=>{setFailed(true);onError?.(event);}}/>;
}
export default function BookCover(props:Props) { return <CoverImage key={props.src||'empty'} {...props}/>; }
