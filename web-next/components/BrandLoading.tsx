import Image from 'next/image';
import {LOADING_LOGO_SIZE, LOADING_TEXT_SIZE} from '@/lib/loading-brand';

export function LoadingLogo({size = LOADING_LOGO_SIZE, className = ''}: {size?: number; className?: string}) {
  return <Image src="/icon.png" alt="" width={size} height={size} priority className={`loading-logo ${className}`} style={{width:size,height:size}}/>;
}

export function LoadingText({children, branded = false}: {children: string; branded?: boolean}) {
  return <span className="loading-text" style={branded ? {fontSize: LOADING_TEXT_SIZE} : undefined}><span>{children}</span><span className="loading-dots" aria-hidden="true"/></span>;
}
