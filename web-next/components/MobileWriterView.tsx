'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, X } from 'lucide-react';
import {LoadingLogo, LoadingText} from './BrandLoading';
import WriterStatistics from './WriterStatistics';
import WritingWorkspace from './WritingWorkspace';
import type WriterDashboard from './WriterDashboard';
import '@/app/writer/writer-mobile.css';
import './mobile-writer-view.css';

export type WriterView = { id: string; entry: string; closing?: boolean };

export function historyWriterViews(): WriterView[] {
  const views: unknown = history.state?.mobileWriterViews;
  return Array.isArray(views) ? views.filter((view): view is WriterView => Boolean(view && typeof view.id === 'string' && typeof view.entry === 'string')).map(({ id, entry }) => ({ id, entry })) : [];
}

export default function MobileWriterView({ view, covered, refreshVersion, onBack, onExited, onOpenNew, onChanged }: {
  view: WriterView; covered: boolean; refreshVersion: number; onBack: () => void; onExited: (id: string) => void; onOpenNew: () => void; onChanged: () => void;
}) {
  const statistics = new URLSearchParams(view.entry).get('action') === 'statistics';
  const title = statistics ? '作品数据' : '创作';
  const params = new URLSearchParams(view.entry);
  const chapters = params.get('action') === 'chapters';
  const create = params.get('action') === 'new' && !params.has('draft');
  const [Dashboard, setDashboard] = useState<typeof WriterDashboard>();
  const [elapsed, setElapsed] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  const exitRef = useRef(onExited);
  const markReady = useCallback(() => setReady(true), []);

  useEffect(() => { exitRef.current = onExited; }, [onExited]);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    // Start the minimum display time with the first painted loading frame.
    const frame = requestAnimationFrame(() => { timer = setTimeout(() => setElapsed(true), 400); });
    import('./WriterDashboard').then(module => { if (active) setDashboard(() => module.default); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; cancelAnimationFrame(frame); clearTimeout(timer); };
  }, [attempt]);

  useEffect(() => {
    if (!view.closing) { panel.current?.focus({ preventScroll: true }); return; }
    const element = panel.current!;
    const transform = getComputedStyle(element).transform;
    element.style.setProperty('--mw-view-close-transform', transform === 'none' ? 'translate3d(0,0,0)' : transform);
    element.dataset.closing = 'true';
    const timer = setTimeout(() => exitRef.current(view.id), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 400);
    return () => { clearTimeout(timer); delete element.dataset.closing; };
  }, [view.closing, view.id]);

  const loaded = elapsed && ready;
  const closeNew = () => {
    const form = panel.current?.querySelector<HTMLElement>('.manuscript-form');
    if (form?.dataset.busy === 'true') return;
    const warning = form?.classList.contains('work-create-form') ? '作品还未创建，确定关闭？已填写的内容不会保存。' : '还有未保存的内容，确定关闭？可以先保存草稿，之后继续整理。';
    if (form?.dataset.dirty === 'true' && !confirm(warning)) return;
    if (form) form.dataset.dirty = 'false';
    onBack();
  };
  return <div className="mw-view" data-view-id={view.id} data-kind={create ? 'new' : 'works'} data-direction={chapters ? 'left' : undefined} data-closing={view.closing || undefined} inert={covered} aria-hidden={covered || undefined}>
    <div className="mw-view-scrim" aria-hidden="true"/>
    <div ref={panel} className="mw-view-panel" role="dialog" aria-modal="true" aria-label={create ? '新建作品' : title} tabIndex={-1} data-ready={loaded}>
      <header className="mw-view-header">
        {create ? <LoadingLogo size={32}/> : <button type="button" aria-label="返回创作中心" onClick={onBack}><ArrowLeft size={20}/></button>}
        <div>{!create && <span>九天 · 创作者空间</span>}<h2>{create ? '创建新作品' : title}</h2></div>
        {create ? <button type="button" aria-label="关闭新建作品" onClick={closeNew}><X size={22}/></button> : <BookOpen size={23}/>}
      </header>
      <div className="mw-view-content">
        {!loaded && <div className="mw-view-loading" role={failed ? 'alert' : 'status'} aria-live="polite">
          {failed ? <><p>页面暂时加载失败</p><button type="button" onClick={() => { setFailed(false); setAttempt(value => value + 1); }}>重新加载</button></> : <><LoadingLogo/><p><LoadingText>{create ? '正在准备新作品' : `正在加载${title}`}</LoadingText></p><div className="mw-view-skeleton" aria-hidden="true"><i/><i/><i/></div></>}
        </div>}
        <div className="mw-view-body" inert={!loaded} aria-hidden={!loaded || undefined}>
          {statistics && elapsed && <WriterStatistics onReady={markReady}/>}
          {chapters && elapsed && <WritingWorkspace reference={params.get('work') || ''} embedded onExit={onBack} onReady={markReady} onChanged={onChanged}/>}
          {!statistics && !chapters && Dashboard && elapsed && <Dashboard entry={view.entry} embedded onExit={onBack} onOpenNew={onOpenNew} onReady={markReady} refreshVersion={refreshVersion} onWorksChanged={onChanged}/>}
        </div>
      </div>
    </div>
  </div>;
}
