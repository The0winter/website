'use client';

import {useEffect, useId, useRef, useState} from 'react';
import {useRouter} from 'next/navigation';
import {BookOpen, Search, X} from 'lucide-react';
import BookLink from './BookLink';
import {safeFetch} from '@/lib/request';
import type {Book} from '@/lib/api';
import './book-search.css';

function MatchedText({text, query}: {text: string; query: string}) {
  const start = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (start < 0) return <>{text}</>;
  return <>{text.slice(0, start)}<mark>{text.slice(start, start + query.length)}</mark>{text.slice(start + query.length)}</>;
}

export default function BookSearch({appearance = 'home', dark = false, autoFocus = false, onNavigate}: {
  appearance?: 'home' | 'navbar'; dark?: boolean; autoFocus?: boolean; onNavigate?: () => void;
}) {
  const router = useRouter();
  const listId = useId();
  const form = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const [isComposing, setIsComposing] = useState(false);
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(-1);
  const [result, setResult] = useState<{query: string; books: Book[]; error: boolean}>({query: '', books: [], error: false});
  const query = draft.trim();
  const visible = open && Boolean(query) && !isComposing;
  const loading = result.query !== query;
  const books = loading ? [] : result.books;

  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    let active = true;
    let timeout: number | undefined;
    // Search the entire library through the existing title/author substring filter.
    // Keep its popularity ordering and return at most six suggestions.
    const debounce = window.setTimeout(async () => {
      timeout = window.setTimeout(() => controller.abort(), 8000);
      try {
        const response = await safeFetch(`/api/books?${new URLSearchParams({q: query, limit: '6', page: '1'})}`, {signal: controller.signal});
        if (!response.ok) throw new Error('Search unavailable');
        const rows: Book[] = await response.json();
        if (!Array.isArray(rows)) throw new Error('Invalid search results');
        if (active) setResult({query, books: rows.slice(0, 6), error: false});
      } catch {
        if (active) setResult({query, books: [], error: true});
      } finally {
        window.clearTimeout(timeout);
      }
    }, 250);
    return () => {active = false; window.clearTimeout(debounce); window.clearTimeout(timeout); controller.abort();};
  }, [query, visible]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!form.current?.contains(event.target as Node)) {setOpen(false); setSelected(-1);}
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  function close() {setOpen(false); setSelected(-1); onNavigate?.();}
  function search() {
    if (!query || composing.current) return;
    close();
    input.current?.blur();
    router.push(`/search?${new URLSearchParams({q: query})}`);
  }
  function select(index: number) {
    setSelected(index);
    form.current?.querySelectorAll<HTMLElement>('[role="option"]')[index]?.scrollIntoView({block: 'nearest'});
  }

  return <form ref={form} role="search" autoComplete="off" className={`book-search book-search--${appearance}${dark ? ' book-search--dark' : ''}`}
    onSubmit={event => {event.preventDefault(); search();}}
    onBlur={event => {if (!event.currentTarget.contains(event.relatedTarget)) {setOpen(false); setSelected(-1);}}}>
    <div className="book-search-field">
      <Search size={19} aria-hidden="true"/>
      <input ref={input} type="search" name="q" role="combobox" aria-label="搜索书名或作者" aria-autocomplete="list" aria-haspopup="listbox"
        aria-expanded={visible} aria-controls={visible ? listId : undefined}
        aria-activedescendant={visible && books[selected] ? `${listId}-${selected}` : undefined}
        placeholder="搜索书名、作者" autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} enterKeyHint="search" maxLength={100} autoFocus={autoFocus}
        value={draft} onChange={event => {setDraft(event.target.value); setSelected(-1); setOpen(true);}}
        onFocus={() => {setOpen(true); setSelected(-1);}}
        onCompositionStart={() => {composing.current = true; setIsComposing(true); setSelected(-1);}}
        onCompositionEnd={() => {composing.current = false; setIsComposing(false);}}
        onKeyDown={event => {
          if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) {
            if (event.key === 'Enter') event.preventDefault();
            return;
          }
          if (event.key === 'Escape') {event.preventDefault(); setOpen(false); setSelected(-1);}
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); setOpen(true);
            if (books.length) select(event.key === 'ArrowDown' ? (selected + 1) % books.length : (selected < 0 ? books.length - 1 : (selected - 1 + books.length) % books.length));
          }
          if (event.key === 'Enter' && visible && books[selected]) {
            event.preventDefault();
            form.current?.querySelectorAll<HTMLAnchorElement>('[role="option"]')[selected]?.click();
          }
        }}/>
      {draft && <button type="button" className="book-search-clear" aria-label="清空搜索词" onClick={() => {setDraft(''); setSelected(-1); input.current?.focus();}}><X size={16}/></button>}
      {query && <button type="submit" className="book-search-submit">搜索</button>}
    </div>
    {visible && <div className="book-search-panel">
      <ul id={listId} role="listbox" aria-label="书籍推荐" aria-busy={loading}>
        {books.map((book, index) => {
          const author = typeof book.author_id === 'object' && book.author_id?.username || book.author || '佚名';
          return <li key={book.id} role="presentation"><BookLink href={`/book/${book.id}`} id={`${listId}-${index}`} role="option" aria-selected={selected === index}
            className="book-search-option" onNavigate={close} onMouseEnter={() => setSelected(index)}>
            <BookOpen size={18} aria-hidden="true"/><span><strong><MatchedText text={book.title} query={query}/></strong><small><MatchedText text={author} query={query}/></small></span>
          </BookLink></li>;
        })}
      </ul>
      {loading ? <p role="status">正在查找…</p> : result.error ? <p role="status">推荐暂不可用，可继续搜索</p> : !books.length && <p role="status">暂无匹配书籍</p>}
      <button className="book-search-all" type="submit">查看全部搜索结果</button>
    </div>}
  </form>;
}
