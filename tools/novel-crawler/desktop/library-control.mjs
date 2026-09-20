import {randomUUID} from 'node:crypto';

// A fresh id per book prevents a delayed click from skipping the next book.
export function createLibraryControl({signal, shouldStop = () => false} = {}) {
  const active = new Map();
  const stopped = () => signal?.aborted || shouldStop();
  const interrupt = () => { for (const book of active.values()) book.resolve?.('stop'); };
  const abort = () => { for (const book of active.values()) book.controller.abort(); interrupt(); };
  signal?.addEventListener('abort', abort, {once: true});
  return {
    begin() {
      const current = {id: randomUUID(), controller: new AbortController(), skipped: false};
      active.set(current.id, current);
      if (stopped()) current.controller.abort();
      return current;
    },
    act(id, action) {
      const current = active.get(id);
      if (!current || current.id !== id || stopped() || current.skipped) return false;
      if (action === 'skip') {
        current.skipped = true; current.controller.abort(); current.resolve?.('skip');
        return true;
      }
      if (action === 'retry' && current.resolve) { current.resolve('retry'); return true; }
      return false;
    },
    wait(book) {
      if (stopped()) return Promise.resolve('stop');
      if (book.skipped) return Promise.resolve('skip');
      return new Promise(resolve => {
        book.resolve = value => { book.resolve = null; resolve(value); };
      });
    },
    interrupt,
    end(book) { if (active.get(book.id) === book) { book.resolve?.('stop'); active.delete(book.id); } },
    close() { abort(); signal?.removeEventListener('abort', abort); active.clear(); },
  };
}
