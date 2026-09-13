import {randomUUID} from 'node:crypto';

// A fresh id per book prevents a delayed click from skipping the next book.
export function createLibraryControl({signal, shouldStop = () => false} = {}) {
  let current;
  const stopped = () => signal?.aborted || shouldStop();
  const interrupt = () => current?.resolve?.('stop');
  const abort = () => { current?.controller.abort(); interrupt(); };
  signal?.addEventListener('abort', abort, {once: true});
  return {
    begin() {
      current = {id: randomUUID(), controller: new AbortController(), skipped: false};
      if (stopped()) current.controller.abort();
      return current;
    },
    act(id, action) {
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
    end(book) { if (current === book) { interrupt(); current = null; } },
    close() { abort(); signal?.removeEventListener('abort', abort); current = null; },
  };
}
