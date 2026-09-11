'use client';

import {useState} from 'react';
import Image from 'next/image';
import {useRouter} from 'next/navigation';
import {Search} from 'lucide-react';
import Link from './PrefetchLink';
import './home-search-header.css';

export default function HomeSearchHeader({onHomeSelect}: {onHomeSelect?: () => void}) {
  const [query, setQuery] = useState('');
  const router = useRouter();
  return <header className="mh-topbar">
    <Link href="/" className="mh-logo" aria-label="九天小说首页" onClick={onHomeSelect}><Image src="/icon.png" alt="九天小说" width={40} height={40} sizes="40px" priority/></Link>
    <form className="mh-search" role="search" onSubmit={event => {event.preventDefault(); if (query.trim()) router.push(`/search?q=${encodeURIComponent(query.trim())}`);}}>
      <Search size={19}/><input aria-label="搜索书名或作者" placeholder="搜索书名、作者" value={query} onChange={event => setQuery(event.target.value)}/>{query && <button type="submit">搜索</button>}
    </form>
  </header>;
}
