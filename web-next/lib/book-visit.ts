import {safeFetch} from './request';

type Visit = {userId: string; bookId: string; chapterId?: string};
let entering: (Visit & {token: string; pending: Promise<boolean>}) | undefined;

async function writeVisit({userId, bookId, chapterId}: Visit) {
  const response = await safeFetch(`/api/users/${userId}/history`, {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({bookId, chapterId}),
  });
  if (!response.ok) throw new Error('阅读记录暂时未能保存');
}

// Only an actual shelf navigation calls this, after the loading paper appears.
// A matching reader mount shares the write instead of invalidating the newly
// sorted library for a second time. The entry token prevents reuse on later visits.
export function beginLibraryVisit(visit: Visit, token: string, rollback: () => void) {
  const pending = writeVisit(visit).then(() => true, () => {rollback(); return false;});
  entering = {...visit, token, pending};
}

export function recordBookVisit(visit: Visit, token?: string) {
  if (token && entering?.token === token && entering.userId === visit.userId && entering.bookId === visit.bookId && entering.chapterId === visit.chapterId) {
    const pending = entering.pending;
    entering = undefined;
    return pending.then(saved => {if (!saved) return writeVisit(visit);});
  }
  return writeVisit(visit);
}
