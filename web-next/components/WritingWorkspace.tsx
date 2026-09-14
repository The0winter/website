'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {ArrowLeft, Plus, FileText, ChevronRight, Download, Trash2, Check, Loader2} from 'lucide-react';
import {useAuth} from '@/contexts/AuthContext';
import {safeFetch} from '@/lib/request';
import {lockBodyScroll} from '@/lib/body-scroll-lock';
import {cachedWorkspace, cacheWorkspace, draftScope, loadDrafts, writeDraft, type WritingDraft, type WorkspaceSnapshot} from '@/lib/writing-drafts';
import './writing-workspace.css';

const fingerprint = (draft: WritingDraft) => JSON.stringify([draft.title, draft.content, draft.number, draft.deleted, draft.published]);
const chapterTitle = (draft: {title: string; number: number}) => draft.title.trim() || `第${draft.number}章`;
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await safeFetch(url, options);
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || '暂时无法连接，请稍后重试'), {status: response.status});
  return data;
}

type WorkspaceProps = {
  reference: string; embedded?: boolean; onExit: () => void; onReady?: () => void; onChanged?: () => void;
  moderation?: boolean; compactHeader?: boolean;
};
export default function WritingWorkspace(props: WorkspaceProps) {
  const {user} = useAuth();
  return user ? <WorkspaceContent {...props} key={user.id + props.reference} accountId={user.id}/> : <p className="writing-note">请登录后继续创作。</p>;
}
function WorkspaceContent({reference, embedded = false, moderation = false, compactHeader = false, onExit, onReady, onChanged, accountId}: WorkspaceProps & {accountId: string}) {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>();
  const [drafts, setDrafts] = useState<WritingDraft[]>([]);
  const [tab, setTab] = useState<'drafts' | 'published'>(moderation ? 'published' : 'drafts');
  const [search, setSearch] = useState('');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const filter = useRef({search: '', order: 'desc'});
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [editor, setEditor] = useState<WritingDraft | null>(null);
  const [closing, setClosing] = useState(false);
  const [saveStatus, setSaveStatus] = useState('已保存到本机');
  const [editorError, setEditorError] = useState('');
  const [publishing, setPublishing] = useState(false);
  const current = useRef<WritingDraft | null>(null);
  const savedText = useRef('');
  const saving = useRef<Promise<boolean> | null>(null);
  const publishBusy = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const marker = useRef<string | null>(null);
  const editorPanel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const callbacks = useRef({onReady, onChanged});
  const scope = snapshot ? draftScope(accountId, snapshot.work.reference) : '';
  const editing = Boolean(editor);
  const showEditor = useCallback((draft: WritingDraft, token: string) => {
    opener.current = document.activeElement as HTMLElement;
    current.current = draft; savedText.current = fingerprint(draft); marker.current = token;
    setEditor(draft); setClosing(false); setEditorError(''); setSaveStatus('已保存到本机');
    requestAnimationFrame(() => editorPanel.current?.focus({preventScroll: true}));
  }, []);
  useEffect(() => {callbacks.current = {onReady, onChanged};}, [onReady, onChanged]);

  const refresh = useCallback(async (number = 1) => {
    let next: WorkspaceSnapshot;
    try {
      next = await request<WorkspaceSnapshot>(`/api/writer/workspace/${reference}?page=${number}&search=${encodeURIComponent(filter.current.search)}&order=${filter.current.order}`);
      setOffline(false);
    } catch (reason) {
      if ((reason as {status?: number}).status && (reason as {status: number}).status < 500) throw reason;
      const cached = number === 1 && !filter.current.search && filter.current.order === 'desc' ? await cachedWorkspace(accountId, reference) : undefined;
      if (!cached) throw reason;
      next = cached; setOffline(true);
    }
    const nextScope = draftScope(accountId, next.work.reference);
    // A storage failure must never be mistaken for a successful local save.
    const local = await loadDrafts(nextScope, next);
    setSnapshot(next); setDrafts(local); setPage(number);
    if (number === 1 && !filter.current.search && filter.current.order === 'desc') await cacheWorkspace(accountId, reference, next);
    return next;
  }, [reference, accountId]);

  useEffect(() => {
    let active = true;
    refresh().catch(reason => {if (active) setError(reason.message);}).finally(() => {
      if (active) {setLoading(false); callbacks.current.onReady?.();}
    });
    return () => {active = false;};
  }, [refresh]);

  const save = useCallback(async (): Promise<boolean> => {
    if (saving.current) {await saving.current; return save();}
    const draft = current.current;
    if (!draft || fingerprint(draft) === savedText.current) return true;
    const operation = (async () => {
      setSaveStatus('正在保存…');
      try {
        const result = await writeDraft(scope, draft);
        savedText.current = fingerprint(draft);
        if (current.current?.id === result.id) {
          current.current = {...current.current, revision: result.revision, updatedAt: result.updatedAt};
          setEditor(current.current);
        }
        setDrafts(previous => previous.map(row => row.id === result.id ? result : row));
        setSaveStatus('已保存到本机'); setEditorError('');
        if (form.current) form.current.dataset.dirty = String(Boolean(current.current && fingerprint(current.current) !== savedText.current));
        return true;
      } catch (reason) {
        setSaveStatus('未能保存'); setEditorError((reason as Error).message); return false;
      }
    })();
    saving.current = operation;
    try {return await operation;} finally {saving.current = null;}
  }, [scope]);

  const flush = useCallback(async () => {
    if (!await save()) return false;
    return current.current && fingerprint(current.current) !== savedText.current ? save() : true;
  }, [save]);

  const closeEditor = useCallback(async () => {
    if (publishBusy.current || !await flush()) return;
    history.back();
  }, [flush]);

  useEffect(() => {
    if (!scope) return;
    const restore = async () => {
      const state = history.state?.writingEditor;
      if (state?.reference !== reference || typeof state.id !== 'string' || typeof state.draftId !== 'string') return false;
      if (state.id === marker.current) {setClosing(false); return true;}
      const draft = (await loadDrafts(scope)).find(row => row.id === state.draftId);
      if (draft) showEditor(draft, state.id);
      return true;
    };
    const pop = async () => {
      try {
        if (await restore()) return;
        if (!marker.current) return;
        if (publishBusy.current || !await flush()) {history.forward(); return;}
        setClosing(true);
      } catch (reason) {setEditorError((reason as Error).message);}
    };
    void restore().catch(reason => setError(reason.message));
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, [scope, reference, flush, showEditor]);

  useEffect(() => {
    if (!editing) return;
    const unlockScroll = lockBodyScroll();
    const interval = setInterval(() => {if (!publishBusy.current) void save();}, 2000);
    const visibility = () => {if (document.visibilityState === 'hidden') void flush();};
    const unload = (event: BeforeUnloadEvent) => {
      if (publishBusy.current || (current.current && fingerprint(current.current) !== savedText.current)) {
        void flush(); event.preventDefault(); event.returnValue = '';
      }
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); void closeEditor();}
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {event.preventDefault(); void save();}
      if (event.key === 'Tab') {
        const controls = editorPanel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled)');
        const first = controls?.[0], last = controls?.[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === editorPanel.current)) {event.preventDefault(); last?.focus();}
        else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first?.focus();}
      }
    };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('beforeunload', unload);
    window.addEventListener('keydown', keyboard, true);
    return () => {
      clearInterval(interval); document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('beforeunload', unload); window.removeEventListener('keydown', keyboard, true);
      unlockScroll();
    };
  }, [editing, closeEditor, flush, save]);

  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => {
      current.current = null; marker.current = null; setEditor(null); setClosing(false);
      opener.current?.focus({preventScroll: true});
    }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 280);
    return () => clearTimeout(timer);
  }, [closing]);

  const openEditor = (draft: WritingDraft) => {
    const id = crypto.randomUUID();
    history.pushState({...history.state, writingEditor: {id, reference, draftId: draft.id}}, '', location.href);
    showEditor(draft, id);
  };
  const create = async () => {
    if (working || !snapshot) return;
    setWorking(true); setError('');
    try {
      const next = await refresh() || snapshot;
      const draft = await writeDraft(scope, {id: crypto.randomUUID(), number: 0, title: '', content: '', revision: 0, updatedAt: ''}, next.maxNumber);
      setDrafts(await loadDrafts(scope)); openEditor(draft);
    } catch (reason) {setError((reason as Error).message);} finally {setWorking(false);}
  };
  const update = (field: 'title' | 'content', value: string) => {
    if (!current.current) return;
    current.current = {...current.current, [field]: value}; setEditor(current.current);
    setSaveStatus('尚未保存');
    if (form.current) form.current.dataset.dirty = String(fingerprint(current.current) !== savedText.current);
  };
  const remove = async (draft: WritingDraft) => {
    if (!confirm(`删除草稿「${chapterTitle(draft)}」？此操作不会删除已发布章节。`)) return;
    try {await writeDraft(scope, {...draft, content: '', deleted: true}); setDrafts(await loadDrafts(scope));}
    catch (reason) {setError((reason as Error).message);}
  };
  const editPublished = async (chapter: WorkspaceSnapshot['published'][number]) => {
    if (working || !snapshot) return;
    setWorking(true); setError('');
    try {
      const existing = drafts.find(draft => draft.targetChapterId === chapter.id);
      if (existing) {openEditor(existing); return;}
      const data = await request<{title: string; content: string; updatedAt: string}>(`/api/chapters/${chapter.id}`);
      const draft = await writeDraft(scope, {id: crypto.randomUUID(), number: chapter.number, title: data.title, content: data.content,
        targetChapterId: chapter.id, baseUpdatedAt: data.updatedAt, revision: 0, updatedAt: ''});
      setDrafts(await loadDrafts(scope)); openEditor(draft);
    } catch (reason) {setError((reason as Error).message);} finally {setWorking(false);}
  };
  const deletePublished = async (chapter: WorkspaceSnapshot['published'][number]) => {
    if (working || !confirm(`下架「${chapterTitle(chapter)}」？下架后读者将无法查看此章节。`)) return;
    setWorking(true); setError('');
    try {
      await request(`/api/chapters/${chapter.id}`, {method: 'DELETE'});
      await refresh(); callbacks.current.onChanged?.();
    } catch (reason) {setError((reason as Error).message);} finally {setWorking(false);}
  };
  const publish = async () => {
    if (publishBusy.current || !current.current?.content.trim()) return;
    if (!confirm(current.current.targetChapterId ? '发布修改并更新原章节？' : `发布「${chapterTitle(current.current)}」？${snapshot?.work.bookId ? '' : '作品将同时公开。'}`)) return;
    publishBusy.current = true; setPublishing(true); setEditorError('');
    try {
      if (!await flush() || !current.current) return;
      const draft = current.current;
      await request(`/api/writer/workspace/${reference}/publish`, {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({id: draft.id, title: draft.title, content: draft.content, number: draft.number,
          targetChapterId: draft.targetChapterId, baseUpdatedAt: draft.baseUpdatedAt, legacyBaseHash: draft.legacyBaseHash})});
      // The server receipt also reconciles this local state if the browser closes here.
      const result = await writeDraft(scope, {...draft, published: true});
      current.current = result; savedText.current = fingerprint(result); setEditor(result);
      if (form.current) form.current.dataset.dirty = 'false';
      await refresh(); setTab('published'); callbacks.current.onChanged?.();
      history.back();
    } catch (reason) {setEditorError((reason as Error).message);}
    finally {publishBusy.current = false; setPublishing(false);}
  };
  const backup = () => {
    if (!current.current) return;
    const url = URL.createObjectURL(new Blob([`${chapterTitle(current.current)}\n\n${current.current.content}`], {type: 'text/plain;charset=utf-8'}));
    const link = document.createElement('a'); link.href = url; link.download = `第${current.current.number}章-草稿.txt`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const renumber = async () => {
    if (!current.current || current.current.targetChapterId || !await flush()) return;
    try {
      const next = await refresh();
      const result = await writeDraft(scope, current.current!, next.maxNumber);
      current.current = result; savedText.current = fingerprint(result); setEditor(result); setEditorError('');
      setDrafts(await loadDrafts(scope));
    } catch (reason) {setEditorError((reason as Error).message);}
  };

  return <section className={`writing-workspace${embedded ? ' writing-embedded' : ''}${compactHeader ? ' writing-compact-header' : ''}`} aria-label="章节创作">
    <div className="writing-library" inert={Boolean(editor)} aria-hidden={Boolean(editor) || undefined}>
      {!embedded && <header className="writing-header"><button type="button" aria-label="返回创作中心" onClick={onExit}><ArrowLeft size={20}/></button><h1>创作</h1></header>}
      <div className="writing-heading">{compactHeader ? <button type="button" aria-label="返回创作中心" onClick={onExit}><ArrowLeft size={20}/></button> : <p>我的作品</p>}<h2>{snapshot?.work.title || '创作'}</h2></div>
      <div className="writing-tabs" role="tablist" aria-label="章节分类">
        <button type="button" role="tab" id="writing-drafts-tab" aria-controls="writing-drafts" aria-selected={tab === 'drafts'} onClick={() => setTab('drafts')}>草稿箱{drafts.length > 0 && <span>{drafts.length}</span>}</button>
        <button type="button" role="tab" id="writing-published-tab" aria-controls="writing-published" aria-selected={tab === 'published'} onClick={() => setTab('published')}>已发布{Boolean(snapshot?.total) && <span>{snapshot?.total}</span>}</button>
      </div>
      {offline && <p className="writing-note">当前离线，仍可在本机继续写作；联网后再发布。</p>}
      {error && <div className="writing-error" role="alert">{error}<button type="button" onClick={() => {setError(''); void refresh(page).catch(reason => setError(reason.message));}}>重试</button></div>}
      {loading ? <p className="writing-empty" role="status"><Loader2 className="writing-spinner" size={24}/>正在打开章节…</p> : tab === 'drafts' ? <div role="tabpanel" id="writing-drafts" aria-labelledby="writing-drafts-tab">
        <div className="writing-draft-tools"><button className="writing-add" type="button" aria-label="新建章节" disabled={working || !snapshot} onClick={() => void create()}><Plus size={22}/><span>新建章节</span></button><span>仅保存在本机</span></div>
        {drafts.length ? <ol className="writing-chapters">{drafts.map(draft => <li key={draft.id}><button type="button" className="writing-chapter" onClick={() => openEditor(draft)}><span className="writing-chapter-number">{String(draft.number).padStart(2, '0')}</span><span><strong>{chapterTitle(draft)}</strong><small>{draft.targetChapterId ? '修改稿 · ' : ''}{Array.from(draft.content).length.toLocaleString()} 字</small></span><ChevronRight size={17}/></button><button type="button" className="writing-delete" aria-label={`删除草稿「${chapterTitle(draft)}」`} onClick={() => void remove(draft)}><Trash2 size={16}/></button></li>)}</ol> : <div className="writing-empty"><FileText size={34}/><h3>下一章，从这里开始</h3><p>点上方加号，写下故事的第一句。</p></div>}
        <p className="writing-storage-note">草稿按账号保存在当前浏览器，清除网站数据会删除本地草稿。</p>
      </div> : <div role="tabpanel" id="writing-published" aria-labelledby="writing-published-tab">
        {moderation && <form className="writing-filters" onSubmit={event => {event.preventDefault(); filter.current={search,order}; void refresh().catch(reason => setError(reason.message));}}><input aria-label="搜索章节" value={search} maxLength={100} onChange={event => setSearch(event.target.value)} placeholder="搜索章节名"/><select aria-label="章节排序" value={order} onChange={event => {const value=event.target.value as 'asc'|'desc'; setOrder(value); filter.current={search,order:value}; void refresh().catch(reason => setError(reason.message));}}><option value="desc">倒序</option><option value="asc">正序</option></select><button type="submit">搜索</button></form>}
        {snapshot?.published.length ? <><ol className="writing-chapters">{snapshot.published.map(chapter => <li key={chapter.id}><button className="writing-chapter" type="button" disabled={working} onClick={() => void editPublished(chapter)}><span className="writing-chapter-number">{String(chapter.number).padStart(2, '0')}</span><span><strong>{chapterTitle(chapter)}</strong><small>{chapter.words.toLocaleString()} 字 · 已发布</small></span><ChevronRight size={17}/></button><button type="button" className="writing-delete" disabled={working} aria-label={`下架章节「${chapterTitle(chapter)}」`} onClick={() => void deletePublished(chapter)}><Trash2 size={16}/></button></li>)}</ol>{snapshot.total > 50 && <nav className="writing-pagination" aria-label="已发布章节分页"><button disabled={page === 1 || working} onClick={() => void refresh(page - 1).catch(reason => setError(reason.message))}>上一页</button><span>{page} / {Math.ceil(snapshot.total / 50)}</span><button disabled={page * 50 >= snapshot.total || working} onClick={() => void refresh(page + 1).catch(reason => setError(reason.message))}>下一页</button></nav>}</> : <div className="writing-empty"><FileText size={34}/><h3>还没有已发布章节</h3><p>草稿准备好后，就可以发布了。</p></div>}
      </div>}
    </div>
    {editor && <div className="writing-editor" ref={editorPanel} role="dialog" aria-modal="true" aria-label={editor.targetChapterId ? '修改章节' : '创建新章节'} tabIndex={-1} data-closing={closing || undefined}>
      <header className="writing-header"><button type="button" aria-label="返回草稿箱" disabled={publishing} onClick={() => void closeEditor()}><ArrowLeft size={20}/></button><div><p>{snapshot?.work.title}</p><h2>第 {editor.number} 章</h2></div><button type="button" className="writing-save" disabled={publishing} onClick={() => void save()}>保存</button></header>
      <form ref={form} className="writing-form writer-dirty-form" data-dirty={fingerprint(editor) !== savedText.current} data-busy={publishing} onSubmit={event => {event.preventDefault(); void save();}}>
        <div className="writing-save-state" role="status" aria-live="polite">{saveStatus === '已保存到本机' && <Check size={14}/>}<span>{saveStatus}</span><span>有改动时每 2 秒自动保存</span></div>
        {editorError && <div className="writing-error" role="alert">{editorError}{editorError.includes('序号已被使用') && <button type="button" onClick={() => void renumber()}>重新编号</button>}</div>}
        <label className="writing-title">章节名<input aria-label="章节名" value={editor.title} disabled={publishing} onChange={event => update('title', event.target.value)} maxLength={100} placeholder={`第${editor.number}章  章节名`}/></label>
        <label className="writing-body">正文<textarea aria-label="正文" value={editor.content} disabled={publishing} onChange={event => update('content', event.target.value)} maxLength={60000} placeholder="在这里，写下你的故事…"/></label>
        <footer className="writing-editor-footer"><span>{Array.from(editor.content).length.toLocaleString()} 字</span><button type="button" className="writing-backup" onClick={backup}><Download size={15}/>下载备份</button><button type="button" className="writing-publish" disabled={publishing || !editor.content.trim() || Boolean(editor.published)} onClick={() => void publish()}>{publishing ? '发布中…' : '发布'}</button></footer>
      </form>
    </div>}
  </section>;
}
