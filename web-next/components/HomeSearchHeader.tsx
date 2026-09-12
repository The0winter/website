'use client';

import Image from 'next/image';
import type {ReactNode} from 'react';
import Link from './PrefetchLink';
import BookSearch from './BookSearch';
import './home-search-header.css';

export default function HomeSearchHeader({onHomeSelect, children}: {onHomeSelect?: () => void; children?: ReactNode}) {
  return <header className="mh-topbar">
    <Link href="/" className="mh-logo" aria-label="九天小说首页" onClick={onHomeSelect}><Image src="/icon.png" alt="九天小说" width={40} height={40} sizes="40px" priority/></Link>
    {children ?? <BookSearch/>}
  </header>;
}
