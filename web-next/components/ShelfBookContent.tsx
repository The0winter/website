'use client';
import {useState} from 'react';
import {BookOpen} from 'lucide-react';
import BookCover from './BookCover';
import {formatRelativeUpdate} from '@/lib/relative-update';
import type {Book} from '@/lib/api';
import type {LibraryEntry as Entry, LibraryTab as Tab} from '@/lib/library-cache';

function Cover({book}: {book: Book | null}) {
  const [failed, setFailed] = useState(false);
  return <div className="shelf-cover">{book?.cover_image && !failed ? <BookCover loading="eager" src={book.cover_image} alt={`${book.title}封面`} onError={() => setFailed(true)}/> : <><BookOpen size={24}/><span>{book?.title || '作品暂不可用'}</span></>}</div>;
}

export default function ShelfBookContent({entry, tab, readingError = ''}: {entry: Entry; tab: Tab; readingError?: string}) {
  const title = entry.book?.title || '作品暂不可用';
  return <>      <Cover book={entry.book}/>
      <div className="shelf-info"><h2>{title}</h2>
        <p>{entry.book ? `${entry.book.author || '未知作者'} · ${['完结', 'completed'].includes(entry.book.status || '') ? '完结' : '连载'}` : '原记录已保留，可稍后重试或移除'}</p>
        {entry.book && <><p className="shelf-progress">{entry.chapterTitle ? `读至 · ${entry.chapterTitle}` : tab === 'history' ? '已浏览 · 还未开始阅读' : '还未开始阅读'}</p><p className="shelf-update">{formatRelativeUpdate(entry.book.lastUpdated)}{entry.latestChapterTitle ? ` · ${entry.latestChapterTitle}` : ''}</p></>}
        {readingError && <p role="status">{readingError}</p>}
      </div></>;
}
