'use client';

import {useState} from 'react';
import {BookOpen, Star} from 'lucide-react';
import type {Book} from '@/lib/api';
import {formatRating, ratingLabel} from '@/lib/rating';
import BookCover from './BookCover';
import BookLink from './BookLink';
import './book-shelf.css';

function ShelfCover({book}: {book: Book}) {
  const [failed, setFailed] = useState(false);
  return <div className="mh-cover">{book.cover_image && !failed
    ? <BookCover sizes="(min-width: 768px) 140px, 28vw" src={book.cover_image} alt={`${book.title}封面`} onError={() => setFailed(true)}/>
    : <><BookOpen size={26} aria-hidden="true"/><span>{book.title}</span></>}
  </div>;
}

export default function BookShelf({books, title}: {books: Book[]; title: string}) {
  return <div className="mh-shelf" role="region" aria-label={`${title}，左右滑动浏览`} tabIndex={0}>
    {books.map(book => {
      const score = formatRating(book.rating);
      return <BookLink className="mh-shelf-book" key={book.id} href={`/book/${book.id}`}>
        <div className="mh-shelf-cover">
          <ShelfCover book={book}/>
          <span className="mh-book-rating" data-nosnippet="" data-rated={score !== '暂无评分'} aria-label={`评分：${ratingLabel(book.rating)}`} title={ratingLabel(book.rating)}>
            <Star aria-hidden="true"/>{score === '暂无评分' ? '—' : score}
          </span>
        </div>
        <h3>{book.title}</h3><p>{book.category?.split('>').pop() || '综合'}</p>
      </BookLink>;
    })}
  </div>;
}
