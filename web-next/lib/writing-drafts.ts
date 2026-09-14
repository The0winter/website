export type WritingDraft = {
  id: string; title: string; content: string; number: number; revision: number; updatedAt: string;
  targetChapterId?: string; baseUpdatedAt?: string; legacyBaseHash?: string;
  deleted?: boolean; published?: boolean;
};
export type WorkspaceSnapshot = {
  work: {reference: string; title: string; bookId: string | null; visibility: string};
  cloudDrafts: WritingDraft[];
  published: {id: string; title: string; number: number; words: number; updatedAt: string}[];
  total: number; maxNumber: number; publishedDraftIds: string[];
};
type Row = WritingDraft & {key: string; scope: string};
const database = 'jiutian-writing';
let connection: Promise<IDBDatabase> | undefined;
const unavailable = () => new Error('本地保存失败，请保留此页面并下载备份，检查浏览器存储空间后重试。');
function open() {
  connection ||= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(database, 1);
    request.onupgradeneeded = () => {
      const drafts = request.result.createObjectStore('drafts', {keyPath: 'key'});
      drafts.createIndex('scope', 'scope');
      request.result.createObjectStore('workspaces');
    };
    request.onsuccess = () => {request.result.onversionchange = () => {request.result.close(); connection = undefined;}; resolve(request.result);};
    request.onerror = () => reject(unavailable());
    request.onblocked = () => reject(unavailable());
  }).catch(error => {connection = undefined; throw error;});
  return connection;
}
export const draftScope = (account: string, reference: string) => `${account}:${reference}`;
export async function cacheWorkspace(account: string, reference: string, snapshot: WorkspaceSnapshot) {
  const db = await open();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('workspaces', 'readwrite');
    const store = tx.objectStore('workspaces');
    store.put(snapshot, draftScope(account, reference));
    store.put(snapshot, draftScope(account, snapshot.work.reference));
    if (snapshot.work.bookId) store.put(snapshot, draftScope(account, `b_${snapshot.work.bookId}`));
    tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(unavailable());
  });
}
export async function cachedWorkspace(account: string, reference: string) {
  const db = await open();
  return new Promise<WorkspaceSnapshot | undefined>((resolve, reject) => {
    const request = db.transaction('workspaces').objectStore('workspaces').get(draftScope(account, reference));
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(unavailable());
  });
}
export async function loadDrafts(scope: string, snapshot?: WorkspaceSnapshot): Promise<WritingDraft[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('drafts', snapshot ? 'readwrite' : 'readonly');
    const store = tx.objectStore('drafts');
    const request = store.index('scope').getAll(scope);
    let rows: Row[] = [];
    request.onsuccess = () => {
      rows = request.result;
      if (!snapshot) return;
      try {
      const existing = new Set(rows.map(row => row.id));
      for (const draft of snapshot.cloudDrafts) if (!existing.has(draft.id)) {
        const row = {...draft, revision: 1, scope, key: `${scope}:${draft.id}`};
        store.put(row); rows.push(row);
      }
      const published = new Set(snapshot.publishedDraftIds);
      for (const row of rows) if (published.has(row.id) && !row.published) {
        row.published = true; row.revision++; store.put(row);
      }
      } catch {tx.abort();}
    };
    tx.oncomplete = () => resolve(rows.filter(row => !row.deleted && !row.published).sort((a, b) => b.number - a.number));
    tx.onabort = tx.onerror = () => reject(unavailable());
  });
}
// The transaction serializes allocation and revision checks across tabs.
export async function writeDraft(scope: string, draft: WritingDraft, allocateAfter?: number): Promise<WritingDraft> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('drafts', 'readwrite');
    const store = tx.objectStore('drafts');
    let saved: Row, conflict = false;
    const request = allocateAfter === undefined ? store.get(`${scope}:${draft.id}`) : store.index('scope').getAll(scope);
    request.onsuccess = () => {
      try {
      const rows: Row[] = allocateAfter === undefined ? request.result ? [request.result] : [] : request.result;
      const previous = rows.find(row => row.id === draft.id);
      if ((previous?.revision || 0) !== draft.revision) {conflict = true; tx.abort(); return;}
      const number = allocateAfter === undefined ? draft.number : Math.max(allocateAfter, ...rows.filter(row => !row.deleted).map(row => row.number)) + 1;
      saved = {...draft, number, revision: draft.revision + 1, updatedAt: new Date().toISOString(), scope, key: `${scope}:${draft.id}`};
      store.put(saved);
      } catch {tx.abort();}
    };
    tx.oncomplete = () => resolve(saved);
    tx.onabort = tx.onerror = () => reject(conflict ? new Error('此草稿已在另一页面更新。你的文字仍在此处，请下载备份后重新打开，避免覆盖。') : unavailable());
  });
}
