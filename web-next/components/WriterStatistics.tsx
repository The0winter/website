'use client';
import {useEffect, useRef, useState} from 'react';
import {ChevronLeft, ChevronRight, Eye, TrendingUp} from 'lucide-react';
import {safeFetch} from '@/lib/request';
import {LoadingLogo, LoadingText} from './BrandLoading';
import './writer-statistics.css';

type Statistics = {period: string; points: {date: string; views: number | null}[]; historyStart: string; totalViews: number; bestChapter: {views: number; title: string} | null; hasPrevious: boolean; hasNext: boolean; previousEnd: string; nextEnd: string};
export default function WriterStatistics({onReady}: {onReady?: () => void}) {
  const [period, setPeriod] = useState('day');
  const [end, setEnd] = useState('');
  const [retry, setRetry] = useState(0);
  const [data, setData] = useState<Statistics>();
  const [failure, setFailure] = useState({key:'', message:''});
  const [resolvedKey, setResolvedKey] = useState('');
  const requestKey = `${period}:${end}:${retry}`;
  const loading = resolvedKey !== requestKey;
  const error = failure.key === requestKey ? failure.message : '';
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    safeFetch(`/api/writer/statistics?period=${period}${end ? `&end=${end}` : ''}`, {signal: controller.signal})
      .then(async response => {if (!response.ok) throw Error('作品数据暂时加载失败'); return response.json();})
      .then(result => {if (!controller.signal.aborted) setData(result);})
      .catch(e => {if (!controller.signal.aborted) setFailure({key:requestKey, message:e.message});})
      .finally(() => {if (!controller.signal.aborted) {setResolvedKey(requestKey); onReady?.();}});
    return () => controller.abort();
  }, [period, end, retry, requestKey, onReady]);
  useEffect(() => {if (!loading && scroll.current) scroll.current.scrollLeft = scroll.current.scrollWidth;}, [data, loading]);
  const points = data?.points || [];
  const max = Math.max(2, ...points.map(p => p.views || 0));
  const width = Math.max(620, points.length * 64);
  const x = (index: number) => 36 + index * (width - 72) / Math.max(1, points.length - 1);
  const y = (value: number) => 186 - value / max * 140;
  const path = points.map((p, i) => p.views === null ? '' : `${i === 0 || points[i - 1].views === null ? 'M' : 'L'}${x(i)},${y(p.views)}`).join(' ');
  const label = (date: string) => data?.period === 'month' ? date.slice(0, 7).replace('-', '/') : date.slice(5).replace('-', '/');
  return <section className="writer-statistics" aria-label="作品数据" aria-busy={loading}>
    <div className="ws-intro"><h2>作品数据</h2></div>
    <div className="ws-cards">
      <article><Eye size={20}/><span>总浏览量</span><strong>{data ? data.totalViews.toLocaleString() : '—'}</strong><small>全部作品累计</small></article>
      <article><TrendingUp size={20}/><span>单章最高浏览量</span><strong>{data ? (data.bestChapter?.views || 0).toLocaleString() : '—'}</strong><small>{data?.bestChapter?.title || '暂无章节阅读'}</small></article>
    </div>
    <section className="ws-trend" aria-label="浏览量趋势">
      <div className="ws-trend-heading"><h3>浏览量趋势</h3><div className="ws-periods" aria-label="统计周期">{[['day','每日'],['week','每周'],['month','每月']].map(([value, title]) => <button type="button" key={value} aria-pressed={period === value} onClick={() => {setEnd(''); setPeriod(value);}}>{title}</button>)}</div></div>
      {error ? <div className="ws-status" role="alert"><p>{error}</p><button onClick={() => setRetry(n => n + 1)}>重新加载</button></div> : loading ? <div className="ws-status" role="status"><LoadingLogo/><LoadingText>正在读取浏览量</LoadingText></div> : <>
        <div className="ws-chart" ref={scroll} tabIndex={0} role="region" aria-label="浏览量时间图，可左右滑动">
          <svg width={width} height="240" role="img" aria-label={`按${period === 'day' ? '日' : period === 'week' ? '周' : '月'}统计的浏览量，最大值 ${max}`}>
            {[0, .5, 1].map(n => <g key={n}><line x1="24" x2={width - 24} y1={y(n * max)} y2={y(n * max)} stroke="#e9ddd2" strokeDasharray="4 5"/><text x="8" y={y(n * max) - 8} fill="#927b68" fontSize="11">{Math.round(n * max)}</text></g>)}
            <path d={path} stroke="#b8424c" strokeWidth="2.5" fill="none" strokeLinejoin="round"/>
            {points.map((point, index) => <g key={point.date}>{point.views !== null && <><circle cx={x(index)} cy={y(point.views)} r="4" fill="#b8424c"><title>{point.date}：{point.views} 次浏览</title></circle><text x={x(index)} y={y(point.views) - 12} textAnchor="middle" fill="#684d3a" fontSize="12">{point.views}</text></>}<text x={x(index)} y="221" textAnchor="middle" fill="#927b68" fontSize="12">{label(point.date)}</text></g>)}
          </svg>
        </div>
        <div className="ws-history"><button type="button" disabled={!data?.hasPrevious} onClick={() => setEnd(data!.previousEnd)}><ChevronLeft size={17}/>更早</button><span>左右滑动查看</span><button type="button" disabled={!data?.hasNext} onClick={() => setEnd(data!.nextEnd)}>更近<ChevronRight size={17}/></button></div>
      </>}
    </section>
  </section>;
}
