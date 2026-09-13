import Image from 'next/image';

export function LoadingLogo({size = 48, className = ''}: {size?: number; className?: string}) {
  return <Image src="/icon.png" alt="" width={size} height={size} priority className={`loading-logo ${className}`} style={{width:size,height:size}}/>;
}

export function LoadingText({children}: {children: string}) {
  return <span>{children}<span className="loading-dots" aria-hidden="true"/></span>;
}
