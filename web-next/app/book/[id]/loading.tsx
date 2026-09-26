import Link from 'next/link';
import {ChevronLeft} from 'lucide-react';
import './loading.css';

export default function LoadingBook() {
  return <div className="book-loading" aria-busy="true">
    <span role="status" className="sr-only">正在打开书籍…</span>
    <div className="book-loading-inner">
      <section className="book-loading-hero">
        <nav className="book-loading-nav" aria-label="书籍导航">
          <Link href="/" aria-label="返回首页"><ChevronLeft size={24}/></Link>
          <span aria-hidden="true" className="book-loading-line"/>
        </nav>
        <div className="book-loading-summary" aria-hidden="true">
          <div className="book-loading-cover"/>
          <div className="book-loading-info"><div className="book-loading-line book-loading-title"/><div className="book-loading-line"/><div className="book-loading-line book-loading-short"/></div>
        </div>
      </section>
      <div aria-hidden="true" className="book-loading-intro">
        <div className="book-loading-stats">{[0,1,2].map(key=><div key={key}><div className="book-loading-line"/><div className="book-loading-line book-loading-short"/></div>)}</div>
        <div className="book-loading-paragraph"><div className="book-loading-line"/><div className="book-loading-line"/><div className="book-loading-line book-loading-short"/></div>
      </div>
      <div aria-hidden="true" className="book-loading-catalog"><div className="book-loading-line"/><div className="book-loading-line"/></div>
      <div aria-hidden="true" className="book-loading-reviews">
        <div className="book-loading-line book-loading-title"/>
        {[0,1].map(key=><div className="book-loading-review" key={key}><div className="book-loading-avatar"/><div className="book-loading-paragraph"><div className="book-loading-line book-loading-short"/><div className="book-loading-line"/><div className="book-loading-line"/></div></div>)}
      </div>
    </div>
    <div aria-hidden="true" className="book-loading-actions"><div className="book-loading-line"/><div className="book-loading-line"/></div>
  </div>;
}
