'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {ArrowLeft, Plus, FileText, Download, Trash2, Check, Loader2, Upload, RotateCcw} from 'lucide-react';
import {useAuth} from '@/contexts/AuthContext';
import {safeFetch} from '@/lib/request';
import {lockBodyScroll} from '@/lib/body-scroll-lock';
import WritingTabs, {type WritingTab} from './WritingTabs';
import WritingChapterRow, {WritingBatchDialog, chapterLabel} from './WritingChapterRow';
import {cachedWorkspace, cacheWorkspace, draftScope, loadDrafts, writeDraft, pendingDrafts, needsCloudSave, draftFingerprint as fingerprint, type WritingDraft, type WorkspaceSnapshot, type WritingTrashItem} from '@/lib/writing-drafts';
import './writing-workspace.css';

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
  const [tab, setTab] = useState<WritingTab>(moderation ? 'published' : 'drafts');
  const [search, setSearch] = useState('');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const filter = useRef({search: '', order: 'desc'});
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [managing, setManaging] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [batchAction, setBatchAction] = useState<'delete' | 'publish' | 'restore' | null>(null);
  const [actionTargets, setActionTargets] = useState<string[]>([]);
  const [batchProgress, setBatchProgress] = useState('');
  const management = useRef<{token: string; afterClose?: () => void} | null>(null);
  const backgroundSync = useRef<Promise<void> | null>(null);
  const [editor, setEditor] = useState<WritingDraft | null>(null);
  const [closing, setClosing] = useState(false);
  const [saveStatus, setSaveStatus] = useState('等待同步线上');
  const [editorError, setEditorError] = useState('');
  const [publishing, setPublishing] = useState(false);
  const current = useRef<WritingDraft | null>(null);
  const savedText = useRef('');
  const saving = useRef<Promise<boolean> | null>(null);
  const publishBusy = useRef(false);
  const cloudSaving = useRef<Promise<boolean> | null>(null);
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
    setEditor(draft); setClosing(false); setEditorError(''); setSaveStatus(needsCloudSave(draft) ? '等待同步线上' : '已保存到线上');
    requestAnimationFrame(() => editorPanel.current?.focus({preventScroll: true}));
  }, []);
  useEffect(() => {callbacks.current = {onReady, onChanged};}, [onReady, onChanged]);

  useEffect(() => {
    const pop = () => {
      const state = management.current;
      if (!state || history.state?.writingManagement === state.token) return;
      if (publishBusy.current) {history.forward(); return;}
      management.current = null; setManaging(false); setSelected([]); setBatchAction(null);
      state.afterClose?.();
    };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  function startManaging(id?: string) {
    if (working || management.current) return;
    const token = crypto.randomUUID(); management.current = {token};
    history.pushState({...history.state, writingManagement: token}, '', location.href);
    setManaging(true); setSelected(id ? [id] : []); setError('');
  }
  function finishManaging(afterClose?: () => void) {
    if (publishBusy.current) return;
    const state = management.current;
    if (state && history.state?.writingManagement === state.token) {
      if (state.afterClose) return;
      state.afterClose = afterClose || (() => {}); history.back();
    } else {
      management.current = null; setManaging(false); setSelected([]); setBatchAction(null); afterClose?.();
    }
  }
  function selectChapter(id: string) {setSelected(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id]);}

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

  const checkpoint = useCallback(async (): Promise<boolean> => {
    if (saving.current) {await saving.current; return checkpoint();}
    const draft = current.current;
    if (!draft || fingerprint(draft) === savedText.current) return true;
    const operation = (async () => {
      try {
        const result = await writeDraft(scope, draft);
        savedText.current = fingerprint(draft);
        if (current.current?.id === result.id) {
          current.current = {...current.current, revision: result.revision, updatedAt: result.updatedAt};
          setEditor(current.current);
        }
        setDrafts(previous => previous.map(row => row.id === result.id ? result : row));
        setSaveStatus('已暂存，等待同步线上');
        if (form.current) form.current.dataset.dirty = String(Boolean(current.current && needsCloudSave(current.current)));
        return true;
      } catch (reason) {
        setSaveStatus('未能保存'); setEditorError((reason as Error).message); return false;
      }
    })();
    saving.current = operation;
    try {return await operation;} finally {saving.current = null;}
  }, [scope]);

  const upload = useCallback(async (draft: WritingDraft) => {
    if (!needsCloudSave(draft)) return draft;
    const result = await request<WritingDraft>(`/api/writer/workspace/${reference}/drafts/${draft.id}`, {
      method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id: draft.id,
        title: draft.title, content: draft.content, number: draft.number, revision: draft.cloudRevision || 0,
        deleted: Boolean(draft.deleted), targetChapterId: draft.targetChapterId, baseUpdatedAt: draft.baseUpdatedAt, legacyBaseHash: draft.legacyBaseHash}),
    });
    if (!Number.isSafeInteger(result.cloudRevision) || !result.cloudRevision) throw Error('线上保存未获确认，请重试；当前文字仍保留');
    return writeDraft(scope, {...draft, cloudRevision: result.cloudRevision, contentLoaded: true,
      syncedFingerprint: fingerprint(draft)});
  }, [reference, scope]);

  const save = useCallback(async (): Promise<boolean> => {
    if (cloudSaving.current) {await cloudSaving.current; return save();}
    const operation = (async () => {
      if (!await checkpoint()) return false;
      const draft = current.current;
      if (!draft || !needsCloudSave(draft)) return true;
      setSaveStatus('正在保存到线上…');
      try {
        const result = await upload(draft);
        if (current.current?.id === result.id) {
          current.current = {...current.current, revision: result.revision, cloudRevision: result.cloudRevision,
            syncedFingerprint: result.syncedFingerprint, updatedAt: result.updatedAt};
          setEditor(current.current);
        }
        setDrafts(previous => previous.map(row => row.id === result.id ? result : row));
        setSaveStatus(current.current && needsCloudSave(current.current) ? '有新改动，等待同步线上' : '已保存到线上');
        setEditorError(''); setOffline(false);
        if (form.current) form.current.dataset.dirty = String(Boolean(current.current && needsCloudSave(current.current)));
        return true;
      } catch (reason) {setSaveStatus('未能同步线上，文字已暂存'); setEditorError((reason as Error).message); return false;}
    })();
    cloudSaving.current = operation;
    try {return await operation;} finally {cloudSaving.current = null;}
  }, [checkpoint, upload]);

  const flush = useCallback(async () => {
    if (!await save()) return false;
    return current.current && needsCloudSave(current.current) ? save() : true;
  }, [save]);

  const closeEditor = useCallback(async () => {
    if (publishBusy.current || !await flush()) return;
    history.back();
  }, [flush]);

  const hydrate = useCallback(async (draft: WritingDraft) => {
    if (draft.contentLoaded !== false) return draft;
    const cloud = await request<WritingDraft>(`/api/writer/workspace/${reference}/drafts/${draft.id}`);
    return writeDraft(scope, {...cloud, revision: draft.revision, syncedFingerprint: fingerprint(cloud)});
  }, [reference, scope]);

  useEffect(() => {
    if (!scope) return;
    const restore = async () => {
      const state = history.state?.writingEditor;
      if (state?.reference !== reference || typeof state.id !== 'string' || typeof state.draftId !== 'string') return false;
      if (state.id === marker.current) {setClosing(false); return true;}
      const draft = (await loadDrafts(scope)).find(row => row.id === state.draftId);
      if (draft) showEditor(await hydrate(draft), state.id);
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
  }, [scope, reference, flush, showEditor, hydrate]);

  useEffect(() => {
    if (!scope) return;
    let syncing = false;
    const sync = async () => {
      if (syncing || publishBusy.current || cloudSaving.current) return;
      syncing = true;
      try {
        if (current.current && !await save()) return;
        // Gradually migrate existing local drafts without flooding the account's write limit.
        for (const draft of (await pendingDrafts(scope)).filter(row => row.id !== current.current?.id).slice(0, 10)) {
          if (publishBusy.current) break;
          await upload(draft);
        }
        setDrafts(await loadDrafts(scope));
      } catch (reason) {setError((reason as Error).message);}
      finally {syncing = false;}
    };
    const online = () => {if (!backgroundSync.current) {backgroundSync.current = sync().finally(() => {backgroundSync.current = null;});}};
    const interval = setInterval(online, 60000);
    window.addEventListener('online', online);
    return () => {clearInterval(interval); window.removeEventListener('online', online);};
  }, [scope, save, upload]);

  useEffect(() => {
    if (!editing) return;
    const unlockScroll = lockBodyScroll();
    const interval = setInterval(() => {if (!publishBusy.current && !cloudSaving.current) void checkpoint();}, 2000);
    const visibility = () => {if (document.visibilityState === 'hidden') void flush();};
    const unload = (event: BeforeUnloadEvent) => {
      if (publishBusy.current || (current.current && needsCloudSave(current.current))) {
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
  }, [editing, closeEditor, flush, save, checkpoint]);

  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => {
      current.current = null; marker.current = null; setEditor(null); setClosing(false);
      opener.current?.focus({preventScroll: true});
    }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 280);
    return () => clearTimeout(timer);
  }, [closing]);

  const openEditor = async (draft: WritingDraft) => {
    try {
      const latest = (await loadDrafts(scope)).find(row => row.id === draft.id);
      if (!latest) throw Error('此草稿已删除或发布，请刷新草稿箱');
      const loaded = await hydrate(latest), id = crypto.randomUUID();
      setDrafts(previous => previous.map(row => row.id === loaded.id ? loaded : row));
      history.pushState({...history.state, writingEditor: {id, reference, draftId: draft.id}}, '', location.href);
      showEditor(loaded, id);
    } catch (reason) {setError((reason as Error).message);}
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
  function confirmBatch(action: 'delete' | 'publish' | 'restore', ids = selected) {setActionTargets(ids); setBatchAction(action);}
  const runBatch = async (action: 'delete' | 'publish' | 'restore') => {
    const targetsIds = actionTargets;
    const verb = action === 'publish' ? '发布' : action === 'restore' ? '复原' : '删除';
    if (publishBusy.current || !targetsIds.length || (action === 'publish' && tab !== 'drafts')) return;
    publishBusy.current = true; setWorking(true); setBatchAction(null); setError('');
    const completed = new Set<string>();
    let failure = '';
    try {
      // Finish an in-flight minute sync before reading the latest local revisions.
      await backgroundSync.current;
      const rows = tab === 'drafts' ? await loadDrafts(scope) : tab === 'trash' ? snapshot?.trash || [] : snapshot?.published || [];
      const targets = rows.filter(row => targetsIds.includes(row.id)).sort((a, b) => a.number - b.number);
      if (targets.length !== targetsIds.length) throw Error('选中的章节已发生变化，请刷新后重新选择。');
      for (const row of targets) {
        setBatchProgress(`正在${verb} ${completed.size + 1} / ${targets.length}`);
        try {
          if (tab === 'trash') {
            const item = row as WritingTrashItem;
            if (item.kind === 'chapter') await request(`/api/chapters/${item.sourceId}/restore`, {method: 'POST'});
            else await request(`/api/writer/workspace/${reference}/trash/drafts/${item.sourceId}/restore`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({revision: item.cloudRevision})});
          } else if (tab === 'published') await request(`/api/chapters/${row.id}`, {method: 'DELETE'});
          else if (action === 'delete') {
            let draft = row as WritingDraft;
            // Cloud drafts can be recycled without fetching their bodies; unsaved local text is saved first.
            if (needsCloudSave(draft) || !draft.cloudRevision) draft = await upload(await hydrate(draft));
            const result = await request<WritingDraft>(`/api/writer/workspace/${reference}/trash/drafts/${draft.id}/delete`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({revision: draft.cloudRevision})});
            const deleted = {...draft, deleted: true, cloudRevision: result.cloudRevision, deletedAt: result.deletedAt, trashUntil: result.trashUntil};
            await writeDraft(scope, {...deleted, syncedFingerprint: fingerprint(deleted)});
          } else {
            let draft = await hydrate(row as WritingDraft);
            if (!draft.content.trim()) throw Error('正文为空，请补充正文后发布。');
            draft = await upload(draft);
            await request(`/api/writer/workspace/${reference}/publish`, {method: 'POST', headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({id: draft.id, title: draft.title, content: draft.content, number: draft.number,
                targetChapterId: draft.targetChapterId, baseUpdatedAt: draft.baseUpdatedAt, legacyBaseHash: draft.legacyBaseHash, cloudRevision: draft.cloudRevision})});
            await writeDraft(scope, {...draft, published: true});
          }
          completed.add(row.id);
        } catch (reason) {throw Error(`${chapterLabel(row)}：${(reason as Error).message}`);}
      }
    } catch (reason) {failure = (reason as Error).message;}
    try {
      const refreshed = await refresh(page);
      // A lost response can still be reconciled by the server's publication receipt/tombstone.
      if (tab === 'drafts') {
        const resolved = action === 'publish' ? new Set(refreshed.publishedDraftIds) : new Set(refreshed.cloudDrafts.filter(row => row.deleted).map(row => row.id));
        for (const id of targetsIds) if (resolved.has(id)) completed.add(id);
        if (completed.size === targetsIds.length) failure = '';
      }
      if (tab === 'published' && snapshot && snapshot.published.length === completed.size && page > 1) await refresh(page - 1);
    } catch (reason) {
      setDrafts(previous => previous.filter(row => !completed.has(row.id)));
      setSnapshot(previous => previous && tab === 'published' ? {...previous, published: previous.published.filter(row => !completed.has(row.id)), total: previous.total - completed.size} : previous);
      failure ||= `操作后刷新失败：${(reason as Error).message}`;
    }
    publishBusy.current = false; setWorking(false); setBatchProgress('');
    if (completed.size) callbacks.current.onChanged?.();
    if (failure) {setSelected(previous => previous.filter(id => !completed.has(id))); setError(`已${verb} ${completed.size} 章。${failure}${action === 'restore' ? '' : ' 未完成的章节仍保留，可重试。'}`);}
    else if (managing) finishManaging(action === 'publish' ? () => setTab('published') : undefined);
    else if (action === 'publish') setTab('published');
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
          targetChapterId: draft.targetChapterId, baseUpdatedAt: draft.baseUpdatedAt, legacyBaseHash: draft.legacyBaseHash, cloudRevision: draft.cloudRevision})});
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
      await save();
      setDrafts(await loadDrafts(scope));
    } catch (reason) {setEditorError((reason as Error).message);}
  };

  const visibleIds = (tab === 'drafts' ? drafts : tab === 'trash' ? snapshot?.trash || [] : snapshot?.published || []).map(row => row.id);
  const allSelected = visibleIds.length > 0 && visibleIds.every(id => selected.includes(id));
  const exitLibrary = () => managing ? finishManaging() : onExit();
  return <section data-managing={managing} onKeyDown={event => {if (event.key === 'Escape' && managing && !batchAction) {event.preventDefault(); event.stopPropagation(); finishManaging();}}} className={`writing-workspace${embedded ? ' writing-embedded' : ''}${compactHeader ? ' writing-compact-header' : ''}`} aria-label="章节创作">
    <div className="writing-library" inert={Boolean(editor)} aria-hidden={Boolean(editor) || undefined}>
      {!embedded && <header className="writing-header"><button type="button" aria-label={managing ? "退出批量管理" : "返回创作中心"} disabled={working} onClick={exitLibrary}><ArrowLeft size={20}/></button><h1>创作</h1></header>}
      <div className="writing-heading">{compactHeader ? <button type="button" aria-label={managing ? "退出批量管理" : "返回创作中心"} disabled={working} onClick={exitLibrary}><ArrowLeft size={21}/></button> : <p>我的作品</p>}<h2>{snapshot?.work.title || '创作'}</h2></div>
      <WritingTabs value={tab} onChange={next => {if (next !== tab) {if (managing) finishManaging(() => setTab(next)); else setTab(next);}}} draftCount={drafts.length} publishedCount={snapshot?.total || 0} trashCount={snapshot?.trash?.length || 0} disabled={loading || editing || working} swipeDisabled={managing} notice={<>
      {!loading && <div className="writing-draft-tools" data-managing={managing}>
        {managing ? <div className="writing-selection-tools"><button type="button" disabled={working} onClick={() => setSelected(allSelected ? [] : visibleIds)}>{allSelected ? '取消全选' : tab === 'published' && (snapshot?.total || 0) > 50 ? '全选本页' : '全选'}</button><span role="status">已选 {selected.length} 章</span><button type="button" disabled={working} onClick={() => finishManaging()}>完成</button></div> : <>
          {tab === 'drafts' && <button className="writing-add" type="button" aria-label="新建章节" disabled={working || !snapshot} onClick={() => void create()}><Plus size={21}/><span>新建章节</span></button>}
        </>}
      </div>}

      {offline && <p className="writing-note">当前离线，文字会暂存；联网后继续同步到线上。</p>}
      {error && <div className="writing-error" role="alert">{error}<button type="button" onClick={() => {setError(''); void refresh(page).catch(reason => setError(reason.message));}}>重试</button></div>}
      {batchProgress && <p className="writing-note" role="status">{batchProgress}</p>}
      {loading && <p className="writing-empty" role="status"><Loader2 className="writing-spinner" size={24}/>正在打开章节…</p>}
      </>}>
      <div hidden={loading}>
        {drafts.length ? <ol className="writing-chapters">{drafts.map(draft => <WritingChapterRow key={draft.id} chapter={draft} words={draft.contentLoaded === false ? draft.words || 0 : Array.from(draft.content).length} status={draft.targetChapterId ? '修改稿' : undefined} managing={managing && tab === 'drafts'} selected={selected.includes(draft.id)} disabled={working || tab !== 'drafts'} onManage={() => startManaging(draft.id)} onSelect={() => selectChapter(draft.id)} onOpen={() => void openEditor(draft)} onPublish={() => confirmBatch('publish', [draft.id])} onDelete={() => confirmBatch('delete', [draft.id])}/>)}</ol> : <div className="writing-empty"><FileText size={34}/><h3>下一章，从这里开始</h3><p>点“新建章节”，写下故事的第一句。</p></div>}
        {drafts.some(needsCloudSave) && <p className="writing-storage-note">有草稿等待同步，保持页面打开即可；进入章节后也可点“保存”。</p>}
      </div>
      <div hidden={loading}>
        {moderation && <form className="writing-filters" onSubmit={event => {event.preventDefault(); filter.current={search,order}; void refresh().catch(reason => setError(reason.message));}}><input disabled={managing || working} aria-label="搜索章节" value={search} maxLength={100} onChange={event => setSearch(event.target.value)} placeholder="搜索章节名"/><select disabled={managing || working} aria-label="章节排序" value={order} onChange={event => {const value=event.target.value as 'asc'|'desc'; setOrder(value); filter.current={search,order:value}; void refresh().catch(reason => setError(reason.message));}}><option value="desc">倒序</option><option value="asc">正序</option></select><button type="submit" disabled={managing || working}>搜索</button></form>}
        {snapshot?.published.length ? <><ol className="writing-chapters">{snapshot.published.map(chapter => <WritingChapterRow key={chapter.id} chapter={chapter} words={chapter.words} status="已发布" managing={managing && tab === 'published'} selected={selected.includes(chapter.id)} disabled={working || tab !== 'published'} onManage={() => startManaging(chapter.id)} onSelect={() => selectChapter(chapter.id)} onOpen={() => void editPublished(chapter)} published onDelete={() => confirmBatch('delete', [chapter.id])}/>)}</ol>{snapshot.total > 50 && <nav className="writing-pagination" aria-label="已发布章节分页"><button disabled={page === 1 || working || managing} onClick={() => void refresh(page - 1).catch(reason => setError(reason.message))}>上一页</button><span>{page} / {Math.ceil(snapshot.total / 50)}</span><button disabled={page * 50 >= snapshot.total || working || managing} onClick={() => void refresh(page + 1).catch(reason => setError(reason.message))}>下一页</button></nav>}</> : <div className="writing-empty"><FileText size={34}/><h3>还没有已发布章节</h3><p>草稿准备好后，就可以发布了。</p></div>}
      </div>
      <div hidden={loading}>
        {snapshot?.trash?.length ? <><p className="writing-trash-note">删除的章节保留七天，逾期自动清除。</p><ol className="writing-chapters">{snapshot.trash.map(item => <WritingChapterRow key={item.id} chapter={item} words={item.words} status={item.kind === 'draft' ? '草稿' : '已发布章节'} expiresAt={item.trashUntil} managing={managing && tab === 'trash'} selected={selected.includes(item.id)} disabled={working || tab !== 'trash'} onManage={() => startManaging(item.id)} onSelect={() => selectChapter(item.id)} onOpen={() => confirmBatch('restore', [item.id])} onRestore={() => confirmBatch('restore', [item.id])}/>)}</ol></> : <div className="writing-empty"><Trash2 size={34}/><h3>回收站是空的</h3><p>删除的章节会在这里保留七天，期间可以复原。</p></div>}
      </div>
      </WritingTabs>
      <div className="writing-batch-bar" role="region" aria-label="章节批量管理" aria-hidden={!managing} inert={!managing}>
        {tab === 'trash' ? <button type="button" className="writing-batch-publish" disabled={!selected.length || working} onClick={() => confirmBatch('restore')}><RotateCcw size={18}/>复原</button> : <>
        <button type="button" className="writing-batch-delete" disabled={!selected.length || working} onClick={() => confirmBatch('delete')}><Trash2 size={18}/>删除</button>
        <button type="button" className="writing-batch-publish" disabled={!selected.length || working || tab !== 'drafts'} onClick={() => confirmBatch('publish')}><Upload size={18}/>{tab === 'published' ? '已发布' : '发布'}</button></>}
      </div>
    </div>
    {batchAction && <WritingBatchDialog action={batchAction} count={actionTargets.length} published={tab === 'published'} publicWork={Boolean(snapshot?.work.bookId)} onClose={() => setBatchAction(null)} onConfirm={() => void runBatch(batchAction)}/> }
    {editor && <div className="writing-editor" ref={editorPanel} role="dialog" aria-modal="true" aria-label={editor.targetChapterId ? '修改章节' : '创建新章节'} tabIndex={-1} data-closing={closing || undefined}>
      <header className="writing-header"><button type="button" aria-label="返回草稿箱" disabled={publishing} onClick={() => void closeEditor()}><ArrowLeft size={20}/></button><div><p>{snapshot?.work.title}</p><h2>第 {editor.number} 章</h2></div><button type="button" className="writing-save" disabled={publishing} onClick={() => void save()}>保存</button></header>
      <form ref={form} className="writing-form writer-dirty-form" data-dirty={needsCloudSave(editor)} data-busy={publishing} onSubmit={event => {event.preventDefault(); void save();}}>
        <div className="writing-save-state" role="status" aria-live="polite">{saveStatus === '已保存到线上' && <Check size={14}/>}<span>{saveStatus}</span><span>有改动时每分钟自动保存到线上</span></div>
        {editorError && <div className="writing-error" role="alert">{editorError}{editorError.includes('序号已被使用') && <button type="button" onClick={() => void renumber()}>重新编号</button>}</div>}
        <label className="writing-title">章节名<input aria-label="章节名" value={editor.title} disabled={publishing} onChange={event => update('title', event.target.value)} maxLength={100} placeholder={`第${editor.number}章  章节名`}/></label>
        <label className="writing-body">正文<textarea aria-label="正文" value={editor.content} disabled={publishing} onChange={event => update('content', event.target.value)} maxLength={60000} placeholder="在这里，写下你的故事…"/></label>
        <footer className="writing-editor-footer"><span>{Array.from(editor.content).length.toLocaleString()} 字</span><button type="button" className="writing-backup" onClick={backup}><Download size={15}/>下载备份</button><button type="button" className="writing-publish" disabled={publishing || !editor.content.trim() || Boolean(editor.published)} onClick={() => void publish()}>{publishing ? '发布中…' : '发布'}</button></footer>
      </form>
    </div>}
  </section>;
}
