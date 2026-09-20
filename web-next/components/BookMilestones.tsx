'use client';

import {useCallback, useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {ArrowLeft, ChevronRight, Clock3, Eye, Star, TrendingUp} from 'lucide-react';
import {safeFetch} from '@/lib/request';
import {bookMilestonesOpen, closeBookMilestones, openBookMilestones, serverCatalogClosed, subscribeBookNavigation} from '@/lib/book-navigation';
import {milestoneNumber, type BookMilestone, type MilestoneKind} from '../../shared/book-milestones.mjs';
import './book-milestones.css';

type MilestoneData = {counts: Record<MilestoneKind, number>; events: BookMilestone[]; next: Record<MilestoneKind, number | null>};
const kinds = ['favorites', 'views'] as const;
const labels = {favorites: '收藏', views: '浏览'};
const compact = (value: number) => new Intl.NumberFormat('zh-CN', {notation: 'compact', maximumFractionDigits: 1}).format(value);

export function useBookMilestones(bookId: string, bookmarked: boolean) {
  const [data, setData] = useState<MilestoneData | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const open = useSyncExternalStore(subscribeBookNavigation, () => bookMilestonesOpen(bookId), serverCatalogClosed);
  const retry = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    let active = true;
    void safeFetch(`/api/books/${bookId}/milestones`, {cache: 'no-store'}).then(async response => {
      if (!response.ok) throw new Error('里程碑暂时无法加载');
      const result: MilestoneData = await response.json();
      if (active) {setData(result); setError('');}
    }).catch(() => {if (active) setError('里程碑暂时无法加载，请重试');});
    return () => {active = false;};
  }, [bookId, bookmarked, open, revision]);
  return {data, error, open, retry};
}
type State = ReturnType<typeof useBookMilestones>;

function Mark({kind}: {kind: MilestoneKind}) {
  return <span className="milestone-mark" data-kind={kind} aria-hidden="true">
    <svg viewBox="0 0 40 44"><path d="M20 1.5 37.5 11.7v20.6L20 42.5 2.5 32.3V11.7Z" fill="currentColor"/><path d="M20 5 34.5 13.5v17L20 39 5.5 30.5v-17Z" fill="none" stroke="white" strokeOpacity=".24"/></svg>
    {kind === 'favorites' ? <Star className="milestone-mark-symbol" fill="currentColor"/> : <TrendingUp className="milestone-mark-symbol"/>}
  </span>;
}

export function BookMilestoneEntry({bookId, state}: {bookId: string; state: State}) {
  const {data, error, open} = state;
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    let timer: ReturnType<typeof setInterval> | undefined;
    const schedule = () => {
      clearInterval(timer);
      if (!preference.matches && !document.hidden && !open) timer = setInterval(() => setIndex(value => value + 1), 3600);
    };
    schedule(); preference.addEventListener('change', schedule); document.addEventListener('visibilitychange', schedule);
    return () => {clearInterval(timer); preference.removeEventListener('change', schedule); document.removeEventListener('visibilitychange', schedule);};
  }, [open]);
  return <button type="button" className="book-milestone-entry" aria-label="查看作品里程碑" aria-haspopup="dialog" onClick={() => openBookMilestones(bookId)}>
    <span className="milestone-roll" data-running={index > 0} aria-hidden="true">
      {kinds.map((kind, position) => {
        const highest = data?.events.filter(event => event.kind === kind).reduce((value, event) => Math.max(value, event.threshold), 0) || 0;
        return <span className="milestone-roll-item" data-active={position === index % kinds.length} key={kind}>
          <Mark kind={kind}/><span className="milestone-entry-copy"><strong>{highest ? `${milestoneNumber(highest)}${labels[kind]}` : `${labels[kind]}里程碑`}</strong>
            <span>{data ? `${data.events.length}里程碑` : error ? '点击重试' : '里程碑'}<ChevronRight size={13}/></span>
          </span>
        </span>;
      })}
    </span>
  </button>;
}

function dayLabel(date: string | null) {
  if (!date) return '历史达成';
  return new Intl.DateTimeFormat('zh-CN', {timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date(date)).replaceAll('/', '年').replace(/年(\d+)年/, '年$1月') + '日';
}

export function BookMilestoneSheet({title, state}: {title: string; state: State}) {
  const {data, error, open, retry} = state;
  const panel = useRef<HTMLDialogElement>(null);
  const [explanation, setExplanation] = useState(false);
  useEffect(() => {
    const element = panel.current;
    if (!element || !open) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element.showModal();
    return () => {element.close(); document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus({preventScroll: true});};
  }, [open]);
  const groups = new Map<string, BookMilestone[]>();
  for (const event of data?.events || []) {
    const day = dayLabel(event.achievedAt);
    groups.set(day, [...(groups.get(day) || []), event]);
  }
  return <dialog ref={panel} className="book-milestone-sheet" aria-labelledby="milestone-title" onCancel={event => {event.preventDefault(); closeBookMilestones();}} onClick={event => {if (event.target === event.currentTarget) closeBookMilestones();}}>
    {open && <div className="milestone-page">
      <header className="milestone-header">
        <button aria-label="返回书籍详情" onClick={closeBookMilestones}><ArrowLeft size={23}/></button>
        <h2 id="milestone-title">作品里程碑</h2>
        <button className="milestone-help" aria-expanded={explanation} aria-controls="milestone-explanation" onClick={() => setExplanation(value => !value)}>说明</button>
      </header>
      <div className="milestone-body">
        <p className="milestone-book-title">{title}</p>
        {explanation && <div className="milestone-explanation" id="milestone-explanation">
          <p>记录作品达到的收藏与浏览里程碑。收藏按当前书架人数统计，浏览沿用本站去重后的阅读统计；已达成的里程碑永久保留。</p>
          <p>收藏从三百、五百、一千、三千、五千、一万起；浏览从一万、五万、十万、二十万、五十万起，后续逐级递增。</p>
          <p>日期按北京时间显示。历史数据无法确认具体达标日期的，统一标为“历史达成”。</p>
        </div>}
        {error && <p role="alert" className="milestone-message">{error} <button onClick={retry}>重试</button></p>}
        {!data && !error && <p role="status" className="milestone-message">正在加载里程碑…</p>}
        {data && <>
          <div className="milestone-progress" aria-label="下一里程碑">
            {kinds.map(kind => <div key={kind}>
              <span className="milestone-progress-label">{kind === 'favorites' ? <Star size={14}/> : <Eye size={15}/>} {labels[kind]}</span>
              <p><strong>{compact(data.counts[kind])}</strong><span>{data.next[kind] ? ` / ${compact(data.next[kind]!)}` : ' · 全部达成'}</span></p>
              <div role="progressbar" aria-label={`${labels[kind]}里程碑进度`} aria-valuenow={data.counts[kind]} aria-valuemin={0} aria-valuemax={Math.max(data.next[kind] || 0, data.counts[kind])} className="milestone-progress-track"><span style={{width: `${Math.min(100, data.counts[kind] / (data.next[kind] || 1) * 100)}%`}}/></div>
            </div>)}
          </div>
          <div className="milestone-section-title"><h3>里程碑</h3><span>已达成 {data.events.length} 项</span></div>
          {data.events.length ? <ol className="milestone-timeline">
            {[...groups].map(([date, events]) => <li className="milestone-day" key={date}>
              <div className="milestone-date"><Clock3 size={15}/><span>{date}</span></div>
              <ul>{events.map(event => <li className="milestone-event" key={`${event.kind}:${event.threshold}`}><span aria-hidden="true">·</span>累计获得{milestoneNumber(event.threshold)}{event.kind === 'favorites' ? '个收藏' : '次浏览'}</li>)}</ul>
            </li>)}
          </ol> : <div className="milestone-empty"><Mark kind="favorites"/><h4>每一份喜欢，都是新的起点</h4><p>达到三百收藏或一万浏览，<br/>点亮作品的第一个里程碑。</p></div>}
        </>}
      </div>
    </div>}
  </dialog>;
}
