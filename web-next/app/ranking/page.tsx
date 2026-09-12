'use client';

import {useEffect, useState} from 'react';
import Link from 'next/link';
import {ArrowLeft, BookOpen, ChevronRight, Star} from 'lucide-react';
import BookCover from '@/components/BookCover';
import BookLink from '@/components/BookLink';
import {booksApi, type Book} from '@/lib/api';
import './ranking.css';

const RANKS = [
  {id: 'day', name: '日榜', sort: 'rank_day', period: '今日'},
  {id: 'week', name: '周榜', sort: 'rank_week', period: '本周'},
  {id: 'month', name: '月榜', sort: 'rank_month', period: '本月'},
  {id: 'total', name: '总榜', sort: 'rank_total', period: '累计'},
  {id: 'views', name: '浏览榜', sort: 'views', period: '累计'},
] as const;
const CATEGORIES = ['全部', '玄幻', '仙侠', '都市', '历史', '科幻', '奇幻', '悬疑'];
type RankId = typeof RANKS[number]['id'];

function formatViews(value = 0) {
  if (value >= 100000000) return `${(value / 100000000).toFixed(1).replace(/\.0$/, '')}亿`;
  if (value >= 10000) return `${(value / 10000).toFixed(1).replace(/\.0$/, '')}万`;
  return Math.max(0, Math.round(value)).toLocaleString('zh-CN');
}

export default function RankingPage() {
  const [activeRank, setActiveRank] = useState<RankId>('day');
  const [category, setCategory] = useState('全部');
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{key: string; books: Book[]; error: boolean}>({key: '', books: [], error: false});
  const rank = RANKS.find(item => item.id === activeRank)!;
  const key = `${rank.sort}:${category}:${retry}`;
  const loading = result.key !== key;

  useEffect(() => {
    let active = true;
    booksApi.getAll({orderBy: rank.sort, limit: 100, category: category === '全部' ? undefined : category})
      .then(books => {if (active) setResult({key, books, error: false});})
      .catch(() => {if (active) setResult({key, books: [], error: true});});
    return () => {active = false;};
  }, [key, rank.sort, category]);

  function selectRank(id: RankId) {
    setActiveRank(id);
    window.scrollTo({top: 0, behavior: 'instant'});
  }

  return (
    <div className="ranking-page">
      <div className="ranking-shell">
        <header className="ranking-header">
          <div className="ranking-titlebar">
            <Link href="/" className="ranking-back" aria-label="返回首页"><ArrowLeft size={21}/></Link>
            <h1 className="ranking-title">排行榜<span>发现值得读的故事</span></h1>
          </div>
          <nav className="ranking-categories" aria-label="小说分类">
            {CATEGORIES.map(name => <button key={name} type="button" aria-pressed={category === name} onClick={event => {
              setCategory(name);
              event.currentTarget.scrollIntoView({block: 'nearest', inline: 'nearest'});
              window.scrollTo({top: 0, behavior: 'instant'});
            }}>{name}</button>)}
          </nav>
        </header>

        <div className="ranking-layout">
          <aside className="ranking-sidebar">
            <nav className="ranking-nav" aria-label="榜单切换">
              {RANKS.map(item => <button key={item.id} type="button" aria-pressed={activeRank === item.id} onClick={() => selectRank(item.id)}>
                <span>{item.name}</span><ChevronRight size={15} aria-hidden="true"/>
              </button>)}
            </nav>
          </aside>

          <section className="ranking-content" aria-label={`${category}${rank.name}`} aria-busy={loading}>
            {loading ? <div className="ranking-loading" role="status" aria-label="正在加载排行榜">
              {Array.from({length: 7}, (_, i) => <div className="ranking-skeleton" key={i} aria-hidden="true"><i/><div><i/><i/><i/></div></div>)}
            </div> : result.error ? <div className="ranking-empty" role="alert">
              <BookOpen size={30} aria-hidden="true"/><h2>榜单暂时没能加载</h2><p>请稍后再试一次</p><button type="button" onClick={() => setRetry(value => value + 1)}>重新加载</button>
            </div> : result.books.length === 0 ? <div className="ranking-empty">
              <BookOpen size={30} aria-hidden="true"/><h2>这个分类还没有作品</h2><p>换个分类，发现更多好故事</p>
            </div> : <ol className="ranking-list" aria-label={`${category}${rank.name}`}>
              {result.books.map((book, index) => <li key={book.id} className="ranking-row" data-position={index + 1}>
                <span className="ranking-number" aria-label={`第${index + 1}名`}>{String(index + 1).padStart(2, '0')}</span>
                <BookLink href={`/book/${book.id}`} className="ranking-cover" aria-label={`阅读${book.title}`}>
                  <BookCover src={book.cover_image} alt={book.title} priority={index < 5}/>
                </BookLink>
                <div className="ranking-book-info">
                  <div className="ranking-book-heading">
                    <h2><BookLink href={`/book/${book.id}`}>{book.title}</BookLink></h2>
                    <span className="ranking-rating" data-unrated={!book.rating} aria-label={book.rating ? `评分 ${book.rating.toFixed(1)}` : '暂无评分'}>
                      {book.rating ? <><Star size={13} aria-hidden="true"/><strong>{book.rating.toFixed(1)}</strong></> : '暂无评分'}
                    </span>
                  </div>
                  <p className="ranking-book-meta"><span>{book.author || book.profiles?.username || '佚名'}</span><span>{book.category || '未分类'}</span></p>
                  <p className="ranking-description">{book.description || '这个故事，等你翻开。'}</p>
                  <div className="ranking-book-stats">
                    {activeRank !== 'views' && <span className="ranking-metric">热度指数 {(book.rankingScore ?? 0).toFixed(1)}</span>}
                    <span className="ranking-views"><strong>{formatViews(activeRank === 'views' ? book.views : book.rankingViews)}</strong><span className="ranking-views-label">{rank.period}浏览</span></span>
                  </div>
                </div>
              </li>)}
            </ol>}

            {!loading && !result.error && <p className="ranking-note">{activeRank === 'views' ? '按累计浏览量排序' : '浏览热度占 80% · 读者评分占 20%'}<span>展示前 100 部作品</span></p>}
          </section>
        </div>
      </div>
    </div>
  );
}
