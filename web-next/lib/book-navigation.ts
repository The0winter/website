import {cancelBookTransition, transitionBookPage} from './book-transition';

type Route = {kind: 'home' | 'detail' | 'reader'; href: string; bookId?: string};
type Entry = Route & {version: 2; flow: string; level: number; catalog?: boolean};
type Router = {push: (href: string) => void; replace: (href: string) => void};
const listeners = new Set<() => void>();
let router: Router | undefined;
let current: Entry | undefined;
let currentPath = '';
let pending: Entry | undefined;

function routeFor(href: string): Route | undefined {
  if (href === '/') return {kind: 'home', href};
  const match = /^\/book\/([^/?#]+)(?:\/([^/?#]+))?$/.exec(href);
  if (match) return {kind: match[2] ? 'reader' : 'detail', href, bookId: match[1]};
}
function stored(state = window.history.state): Entry | undefined {
  const entry = state?.bookNavigation as Entry | undefined;
  return entry?.version === 2 ? entry : undefined;
}
function entryFor(route: Route, flow = crypto.randomUUID()): Entry {
  return {...route, version: 2, flow, level: route.kind === 'home' ? 0 : route.kind === 'detail' ? 1 : 2};
}
function notify() { listeners.forEach(listener => listener()); }
function mark(entry: Entry) {
  const state = {...window.history.state};
  delete state.readerBook; delete state.readerReturn; delete state.catalogOpen;
  // Preserve Next's route tree when only annotating the current history slot.
  window.history.replaceState({...state, bookNavigation: entry}, '', entry.href);
  current = entry;
  notify();
}

export function syncBookRoute(path: string) {
  if (path !== location.pathname) return;
  const route = routeFor(path);
  const previous = current;
  const previousPath = currentPath;
  currentPath = path;
  if (!route) { current = undefined; pending = undefined; notify(); return; }
  if (pending?.href === path) { const entry = pending; pending = undefined; mark(entry); return; }
  const saved = stored();
  if (saved?.href === path) { current = saved; notify(); return; }
  if (route.kind === 'home') { mark(entryFor(route)); return; }
  // A normal home -> details link already has the correct predecessor.
  if (route.kind === 'detail' && previous?.kind === 'home' && previousPath === '/') {
    mark(entryFor(route, previous.flow)); return;
  }
  // Direct links, old reader history and entry from search/library all receive
  // a canonical home -> details -> reader stack once. Reloads reuse these slots.
  const state = window.history.state;
  const home = entryFor({kind: 'home', href: '/'});
  const detail = entryFor({kind: 'detail', href: `/book/${route.bookId}`, bookId: route.bookId}, home.flow);
  window.history.replaceState({...state, bookNavigation: home}, '', '/');
  window.history.pushState({...state, bookNavigation: detail}, '', detail.href);
  if (route.kind === 'reader') {
    const reader = entryFor(route, home.flow);
    window.history.pushState({...state, bookNavigation: reader}, '', path);
    current = reader;
  } else current = detail;
  notify();
}

function navigate(entry: Entry, direction: 'enter' | 'exit', replace: boolean, traversing = false) {
  if (!router) return;
  pending = entry;
  // A click may still be waiting for its route request; Back must then operate
  // on the page that is actually in history. A pop has already moved the slot.
  if (traversing) current = entry;
  window.dispatchEvent(new Event('book-navigation-leave'));
  transitionBookPage(entry.href, direction, () => {
    if (replace) router!.replace(entry.href); else router!.push(entry.href);
  });
}

function onPopState(event: PopStateEvent) {
  const from = current;
  const target = stored(event.state);
  if (!from || !router) return;
  // Forward from a book page may reopen login; leave that route to Next.
  if (/^\/(login|register)$/.test(location.pathname)) {
    if (pending) { cancelBookTransition(); pending = undefined; }
    current = undefined; notify(); return;
  }
  const forward = target?.flow === from.flow && target.level > from.level;
  if (from.catalog && target?.flow === from.flow && target.kind === 'detail' && !target.catalog) {
    event.stopImmediatePropagation();
    if (pending) { cancelBookTransition(); pending = undefined; router.replace(target.href); }
    current = target; notify();
    return;
  }
  if (from.kind === 'detail' && forward && target?.catalog) {
    event.stopImmediatePropagation(); current = target; notify(); return;
  }
  if (from.kind === 'home' && !forward) {
    if (pending) { cancelBookTransition(); pending = undefined; }
    return;
  }
  event.stopImmediatePropagation();
  const destination = forward && target ? target : from.kind === 'reader'
    ? entryFor({kind: 'detail', href: `/book/${from.bookId}`, bookId: from.bookId}, from.flow)
    : entryFor({kind: 'home', href: '/'}, from.flow);
  navigate(destination, forward ? 'enter' : 'exit', true, true);
}

export function installBookNavigation(value: Router) {
  router = value;
  window.addEventListener('popstate', onPopState, true);
  window.addEventListener('pagehide', cancelBookTransition);
  return () => {
    window.removeEventListener('popstate', onPopState, true);
    window.removeEventListener('pagehide', cancelBookTransition);
    cancelBookTransition(); router = undefined;
  };
}

// Called only by Next's onNavigate, so modified clicks still open normal tabs.
export function navigateBookLink(href: string) {
  const target = routeFor(href);
  if (!target || !router || !current) return false;
  if (document.documentElement.dataset.bookTransition) return true;
  if (current.kind === 'reader' && target.kind === 'detail' && current.bookId === target.bookId || current.kind === 'detail' && target.kind === 'home') {
    window.history.back(); return true;
  }
  if (current.kind === 'home' && target.kind === 'detail') {
    navigate(entryFor(target, current.flow), 'enter', false); return true;
  }
  if (current.kind === 'detail' && target.kind === 'reader' && current.bookId === target.bookId) {
    navigate(entryFor(target, current.flow), 'enter', Boolean(current.catalog)); return true;
  }
  return false;
}

export function replaceReaderChapter(href: string) {
  const route = routeFor(href);
  if (!route) return;
  const entry = entryFor(route, current?.flow ?? stored()?.flow);
  current = entry; currentPath = href;
  // Supply only our metadata so Next's native history integration updates its URL.
  window.history.replaceState({bookNavigation: entry}, '', href);
}

export function openDetailCatalog(bookId: string) {
  if (current?.kind !== 'detail' || current.bookId !== bookId || current.catalog) return;
  const entry = {...current, catalog: true, level: 2};
  window.history.pushState({...window.history.state, bookNavigation: entry}, '', entry.href);
  current = entry; notify();
}
export function closeDetailCatalog() { if (current?.catalog) window.history.back(); }
export const detailCatalogOpen = (bookId: string) => Boolean(current?.catalog && current.bookId === bookId);
export const serverCatalogClosed = () => false;
export function subscribeBookNavigation(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
