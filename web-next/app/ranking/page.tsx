'use client';

import {useEffect, useLayoutEffect, useRef, useSyncExternalStore} from 'react';
import {usePathname} from 'next/navigation';
import Link from '@/components/PrefetchLink';
import {ArrowLeft, BookOpen, Star} from 'lucide-react';
import BookCover from '@/components/BookCover';
import BookLink from '@/components/BookLink';
import {formatRating, ratingLabel} from '@/lib/rating';
import {currentRankingVisit, selectRankingView, subscribeBookNavigation} from '@/lib/book-navigation';
import {getRankingSnapshot, loadRanking, loadMoreRanking, rankingScroll, rememberRankingScroll, serverRankingSnapshot, subscribeRanking} from '@/lib/ranking-cache';
import RankingFrame, {RANKS, RankingSkeleton, type RankId} from '@/components/RankingFrame';

const defaultView = {activeRank: 'day', category: '全部'};
const serverVisit = () => undefined;

function formatViews(value = 0) {
  if (value >= 100000000) return `${(value / 100000000).toFixed(1).replace(/\.0$/, '')}亿`;
  if (value >= 10000) return `${(value / 10000).toFixed(1).replace(/\.0$/, '')}万`;
  return Math.max(0, Math.round(value)).toLocaleString('zh-CN');
}

export default function RankingPage() {
  const visit = useSyncExternalStore(subscribeBookNavigation, currentRankingVisit, serverVisit);
  const {activeRank, category} = visit?.rankingView ?? defaultView;
  const pathname = usePathname();
  const categories = useRef<HTMLElement>(null);
  const more = useRef<HTMLDivElement>(null);
  const motion = useRef({top: 0, time: 0, speed: 0});
  const rank = RANKS.find(item => item.id === activeRank) ?? RANKS[0];
  const visitId = visit?.flow ?? '';
  const query = {visit: visitId, orderBy: rank.sort, category};
  const result = useSyncExternalStore(subscribeRanking, () => getRankingSnapshot(query), serverRankingSnapshot);
  const loading = !result.books && !result.error;
  const hasBooks = Boolean(result.books);

  useEffect(() => {
    if (pathname === '/ranking') void loadRanking({visit: visitId, orderBy: rank.sort, category});
  }, [visitId, rank.sort, category, pathname]);

  useLayoutEffect(() => {
    if (pathname !== '/ranking' || !visitId || !hasBooks) return;
    const current = {visit: visitId, orderBy: rank.sort, category};
    const position = rankingScroll(current);
    if (position) {
      window.scrollTo({top: position.top, behavior: 'instant'});
      if (categories.current) categories.current.scrollLeft = position.categories;
    }
    const remember = () => {
      if (location.pathname === '/ranking') rememberRankingScroll(current, window.scrollY, categories.current?.scrollLeft ?? 0);
    };
    window.addEventListener('scroll', remember, {passive: true});
    window.addEventListener('book-navigation-leave', remember);
    const categoryBar = categories.current;
    categoryBar?.addEventListener('scroll', remember, {passive: true});
    return () => {
      window.removeEventListener('scroll', remember);
      window.removeEventListener('book-navigation-leave', remember);
      categoryBar?.removeEventListener('scroll', remember);
    };
  }, [visitId, rank.sort, category, pathname, hasBooks]);

  useEffect(() => {
    if (pathname !== '/ranking' || !hasBooks || !result.hasMore || result.moreError) return;
    let frame = 0;
    motion.current = {top: scrollY, time: performance.now(), speed: 0};
    const check = () => {
      frame = 0;
      if (document.visibilityState !== 'visible' || !more.current || more.current.getClientRects().length === 0) return;
      const now = performance.now(), elapsed = now - motion.current.time, delta = scrollY - motion.current.top;
      const speed = elapsed > 0 && elapsed < 300 ? Math.max(0, delta / elapsed) : 0;
      motion.current = {top: scrollY, time: now, speed: speed * .7 + motion.current.speed * .3};
      // Predict the distance covered during one request, bounded to three screens.
      const lead = Math.min(innerHeight * 3, Math.max(innerHeight * .7, motion.current.speed * (result.fetchMs + 350)));
      if (delta >= 0 && more.current.getBoundingClientRect().top - innerHeight <= lead) {
        void loadMoreRanking({visit: visitId, orderBy: rank.sort, category});
      }
    };
    const schedule = () => {if (!frame) frame = requestAnimationFrame(check);};
    window.addEventListener('scroll', schedule, {passive: true});
    window.addEventListener('resize', schedule);
    schedule();
    return () => {cancelAnimationFrame(frame); window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule);};
  }, [visitId, rank.sort, category, pathname, hasBooks, result.books?.length, result.hasMore, result.moreError, result.fetchMs]);

  function selectRank(id: RankId) {
    selectRankingView({activeRank: id, category});
    window.scrollTo({top: 0, behavior: 'instant'});
  }

  return (
    <RankingFrame activeRank={activeRank} category={category} categoriesRef={categories} busy={loading}
      back={<Link href="/" className="ranking-back" aria-label="返回首页"><ArrowLeft size={21}/></Link>}
      onRank={selectRank} onCategory={(name, event) => {
        selectRankingView({activeRank, category: name});
        event.currentTarget.scrollIntoView({block: 'nearest', inline: 'nearest'});
        window.scrollTo({top: 0, behavior: 'instant'});
      }}>
            {loading ? <RankingSkeleton/> : result.error ? <div className="ranking-empty" role="alert">
              <BookOpen size={30} aria-hidden="true"/><h2>榜单暂时没能加载</h2><p>请稍后再试一次</p><button type="button" onClick={() => void loadRanking(query, true)}>重新加载</button>
            </div> : result.books?.length === 0 ? <div className="ranking-empty">
              <BookOpen size={30} aria-hidden="true"/><h2>这个分类还没有作品</h2><p>换个分类，发现更多好故事</p>
            </div> : <ol className="ranking-list" aria-label={`${category}${rank.name}`}>
              {result.books?.map((book, index) => <li key={book.id} className="ranking-row" data-position={index + 1}>
                <BookLink href={`/book/${book.id}`} className="ranking-card" aria-label={`阅读${book.title}`}>
                  <span className="ranking-number" aria-label={`第${index + 1}名`}>{String(index + 1).padStart(2, '0')}</span>
                  <div className="ranking-cover">
                    <BookCover src={book.cover_image} alt={book.title} priority={index < 5}/>
                  </div>
                  <div className="ranking-book-info">
                    <div className="ranking-book-heading">
                      <h2>{book.title}</h2>
                      <span className="ranking-rating" data-unrated={!book.rating} aria-label={`评分：${ratingLabel(book.rating)}`}>
                        {book.rating ? <><Star size={13} aria-hidden="true"/><strong>{formatRating(book.rating)}</strong></> : '暂无评分'}
                      </span>
                    </div>
                    <p className="ranking-book-meta"><span>{book.author || book.profiles?.username || '佚名'}</span></p>
                    <p className="ranking-description">{book.description || '这个故事，等你翻开。'}</p>
                    <div className="ranking-book-stats">
                      {activeRank !== 'views' && <span className="ranking-metric">热度指数 {(book.rankingScore ?? 0).toFixed(1)}</span>}
                      <span className="ranking-views"><strong>{formatViews(activeRank === 'views' ? book.views : book.rankingViews)}</strong><span className="ranking-views-label">{rank.period}浏览</span></span>
                    </div>
                  </div>
                </BookLink>
              </li>)}
            </ol>}

            {hasBooks && result.hasMore && <div ref={more} className="ranking-more" aria-live="polite">
              {result.loadingMore ? <span role="status">正在加载更多作品…</span> : <button type="button" onClick={() => void loadMoreRanking(query)}>{result.moreError ? '加载未完成，点击重试' : '继续向下浏览'}</button>}
            </div>}
            {!loading && !result.error && <p className="ranking-note">{activeRank === 'views' ? '按累计浏览量排序' : '浏览热度占 80% · 综合评分占 20%'}<span>展示前 100 部作品 · 含基础热度与实际阅读</span></p>}
    </RankingFrame>
  );
}
