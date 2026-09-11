import {cancelBookTransition, transitionBookPage} from './book-transition';
import {cancelChapterEntry, currentChapterEntry} from './chapter-entry';

type Route = {kind: 'home' | 'author' | 'library' | 'detail' | 'reader'; href: string; bookId?: string};
type Entry = Route & {version: 2; flow: string; level: number; catalog?: boolean; settings?: boolean; restoreSession?: string; homeBrowse?: boolean; libraryReturn?: string};
type Router = {push: (href: string) => void; replace: (href: string) => void};
const listeners = new Set<() => void>();
let router: Router | undefined;
let current: Entry | undefined;
let currentPath = '';
let pending: Entry | undefined;
let overlayClosing = false;
let catalogSelection: (() => void) | undefined;
let documentSession: string | undefined;
const session = () => documentSession ??= crypto.randomUUID();

const overlay = (entry?: Entry) => entry?.catalog ? 'catalog' : entry?.settings ? 'settings' : undefined;
const isList = (route?: Route): route is Route & {kind: 'home' | 'author' | 'library'} => route?.kind === 'home' || route?.kind === 'author' || route?.kind === 'library';

function routeFor(href: string): Route | undefined {
  if (href === '/' || href.startsWith('/?')) return {kind: 'home', href};
  if (href === '/library' || href.startsWith('/library?')) return {kind: 'library', href};
  if (/^\/author\/[^/?#]+(?:\?[^#]*)?$/.test(href)) return {kind: 'author', href};
  const match = /^\/book\/([^/?#]+)(?:\/([^/?#]+))?$/.exec(href);
  if (match) return {kind: match[2] ? 'reader' : 'detail', href, bookId: match[1]};
}
function stored(state = window.history.state): Entry | undefined {
  const entry = state?.bookNavigation as Entry | undefined;
  return entry?.version === 2 ? entry : undefined;
}
function entryFor(route: Route, flow = crypto.randomUUID()): Entry {
  return {...route, version: 2, flow, level: route.kind === 'detail' ? 1 : route.kind === 'reader' ? 2 : 0};
}
function notify() { listeners.forEach(listener => listener()); }
function mark(entry: Entry) {
  // Only real, rendered home/detail slots have a matching Next route tree.
  // Synthetic predecessors and client-replaced reader chapters must still load
  // their route normally. A reload also starts a fresh in-memory router cache.
  entry = {...entry, restoreSession: entry.kind === 'reader' ? undefined : session()};
  const state = {...window.history.state};
  delete state.readerBook; delete state.readerReturn; delete state.catalogOpen;
  state.homeBrowse = entry.kind === 'home' && Boolean(entry.homeBrowse);
  // Preserve Next's route tree when only annotating the current history slot.
  window.history.replaceState({...state, bookNavigation: entry}, '', entry.href);
  current = entry;
  notify();
}

export function syncBookRoute(path: string) {
  const search = new URLSearchParams(location.search).toString();
  if (path !== location.pathname + (search ? `?${search}` : '')) return;
  const route = routeFor(path);
  const previous = current;
  const previousPath = currentPath;
  currentPath = path;
  if (!route) { cancelChapterEntry(); current = undefined; pending = undefined; notify(); return; }
  if (pending?.href === path) { const entry = pending; pending = undefined; mark(entry); return; }
  const saved = stored();
  if (saved?.href === path) { mark(saved); return; }
  if (isList(route)) {
    mark({...entryFor(route), homeBrowse: route.kind === 'home' && Boolean(window.history.state?.homeBrowse)}); return;
  }
  // Browse views, authors and the library keep their list as the predecessor.
  if (route.kind === 'detail' && isList(previous) && previousPath === previous.href) {
    mark(entryFor(route, previous.flow)); return;
  }
  // Shelf links enter the reader directly and keep the actual shelf visit below it.
  if (route.kind === 'reader' && previous?.kind === 'library' && previousPath === previous.href) {
    mark({...entryFor(route, previous.flow), level: 1, libraryReturn: previous.href}); return;
  }
  // Other list shortcuts continue to return through details.
  if (route.kind === 'reader' && isList(previous) && previousPath === previous.href) {
    const state = window.history.state;
    const detail = entryFor({kind: 'detail', href: `/book/${route.bookId}`, bookId: route.bookId}, previous.flow);
    const reader = entryFor(route, previous.flow);
    window.history.replaceState({...state, bookNavigation: detail}, '', detail.href);
    window.history.pushState({...state, bookNavigation: reader}, '', path);
    mark(reader); return;
  }
  // Direct links, old reader history and entry from search all receive
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
  mark(current);
}

function navigate(entry: Entry, direction: 'enter' | 'exit', replace: boolean, traversing = false, restore = false) {
  if (!router) return;
  if (currentChapterEntry()?.href !== entry.href) cancelChapterEntry();
  pending = entry;
  // A click may still be waiting for its route request; Back must then operate
  // on the page that is actually in history. A pop has already moved the slot.
  if (traversing) current = entry;
  window.dispatchEvent(new Event('book-navigation-leave'));
  if (currentChapterEntry()?.href === entry.href) {
    cancelBookTransition();
    if (replace) router.replace(entry.href); else router.push(entry.href);
    return;
  }
  transitionBookPage(entry.href, direction, () => {
    // Let Next's popstate listener restore the visited route and scroll position.
    // Replacing the URL here would refetch the page.
    if (!restore) { if (replace) router!.replace(entry.href); else router!.push(entry.href); }
  });
}

function onPopState(event: PopStateEvent) {
  const from = current;
  const target = stored(event.state);
  if (!from || !router) return;
  // Forward may reopen a separate list visit or login; leave that to Next.
  if (/^\/(login|register)$/.test(location.pathname) || isList(target) && target.kind !== 'home' && target.flow !== from.flow) {
    if (pending) { cancelBookTransition(); pending = undefined; }
    cancelChapterEntry(); current = undefined; notify(); return;
  }
  const forward = target?.flow === from.flow && target.level > from.level;
  if (overlay(from) && target?.flow === from.flow && target.href === from.href && !overlay(target)) {
    event.stopImmediatePropagation();
    if (pending) { cancelBookTransition(); cancelChapterEntry(); pending = undefined; router.replace(target.href); }
    const select = catalogSelection;
    overlayClosing = false; catalogSelection = undefined;
    current = target; notify();
    select?.();
    return;
  }
  overlayClosing = false; catalogSelection = undefined;
  if (forward && overlay(target) && target?.kind === from.kind && target.bookId === from.bookId) {
    event.stopImmediatePropagation();
    // A reader chapter can replace the slot underneath a closed catalog.
    // Forward should reopen that catalog on the current chapter as well.
    current = {...from, catalog: target.catalog, settings: target.settings, level: from.level + 1};
    window.history.replaceState({bookNavigation: current}, '', current.href);
    notify(); return;
  }
  if (isList(from) && !forward) {
    if (pending) { cancelBookTransition(); cancelChapterEntry(); pending = undefined; }
    return;
  }
  const predecessor = target?.flow === from.flow && (from.kind === 'reader' && (from.libraryReturn ? target.kind === 'library' && target.href === from.libraryReturn : target.kind === 'detail' && target.bookId === from.bookId) || from.kind === 'detail' && isList(target));
  const destination = (forward || predecessor) && target ? target : from.kind === 'reader'
    ? entryFor(from.libraryReturn ? {kind: 'library', href: from.libraryReturn} : {kind: 'detail', href: `/book/${from.bookId}`, bookId: from.bookId}, from.flow)
    : entryFor({kind: 'home', href: '/'}, from.flow);
  const restore = target?.href === destination.href && target.restoreSession === session() && Boolean(event.state?.__NA);
  if (!restore) event.stopImmediatePropagation();
  navigate(restore ? target! : destination, forward ? 'enter' : 'exit', true, true, restore);
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
  if (current.kind === 'reader' && (current.libraryReturn ? href === current.libraryReturn : target.kind === 'detail' && current.bookId === target.bookId) || current.kind === 'detail' && target.kind === 'home') {
    window.history.back(); return true;
  }
  if (current.kind === 'library' && target.kind === 'reader') {
    navigate({...entryFor(target, current.flow), level: 1, libraryReturn: current.href}, 'enter', false); return true;
  }
  if (isList(current) && target.kind === 'detail') {
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
  const previous = current ?? stored();
  const entry = {...entryFor(route, previous?.flow), ...(previous?.libraryReturn ? {libraryReturn: previous.libraryReturn, level: 1} : {})};
  current = entry; currentPath = href;
  // Supply only our metadata so Next's native history integration updates its URL.
  window.history.replaceState({bookNavigation: entry}, '', href);
}

export function openBookCatalog(bookId: string) {
  if (!current || current.kind === 'home' || current.bookId !== bookId || overlay(current) || pending || currentChapterEntry()) return;
  const entry = {...current, catalog: true, level: current.level + 1};
  window.history.pushState({...window.history.state, bookNavigation: entry}, '', entry.href);
  current = entry; notify();
}
export function closeBookCatalog() {
  if (current?.catalog && !overlayClosing) { overlayClosing = true; window.history.back(); }
}
// Consume the overlay slot before replacing the reader's chapter slot. Otherwise
// Back would revisit the old chapter, or cancel an in-flight chapter request.
export function selectReaderCatalogChapter(select: () => void) {
  if (!current?.catalog) { select(); return; }
  if (overlayClosing) return;
  catalogSelection = select; closeBookCatalog();
}
export function openReaderSettings(bookId: string) {
  if (current?.kind !== 'reader' || current.bookId !== bookId || overlay(current) || pending || currentChapterEntry()) return;
  const entry = {...current, settings: true, level: current.level + 1};
  window.history.pushState({...window.history.state, bookNavigation: entry}, '', entry.href);
  current = entry; notify();
}
export function closeReaderSettings() {
  if (current?.settings && !overlayClosing) { overlayClosing = true; window.history.back(); }
}
export const readerSettingsOpen = (bookId: string) => Boolean(current?.settings && current.bookId === bookId);
export const bookCatalogOpen = (bookId: string) => Boolean(current?.catalog && current.bookId === bookId);
export const serverCatalogClosed = () => false;
export const readerReturnHref = (bookId: string) => current?.kind === 'reader' && current.bookId === bookId && current.libraryReturn || `/book/${bookId}`;
export function subscribeBookNavigation(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
