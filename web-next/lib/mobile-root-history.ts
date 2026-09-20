import {beginMobileSectionReturn, beginMobileSectionTransition} from './mobile-section-navigation';

type Position = {version: 1; visit: string; index: number};
type State = Record<string, unknown> & {mobileRoot?: Position};
type Router = {replace: (href: string) => void};
const mobile = () => matchMedia('(max-width: 767px)').matches;
const href = () => location.pathname + location.search;
const featured = (path: string) => path.split('?')[0] === '/' && !new URL(path, location.origin).searchParams.has('view');
const section = (path: string) => featured(path) || ['/library', '/forum'].includes(path.split('?')[0]);
let selectSection: ((href: string) => boolean) | undefined;
let installation: symbol | undefined;

export function navigateMobileRoot(href: string) {
  const target = new URL(href, location.origin);
  return mobile() && target.origin === location.origin && section(target.pathname + target.search) &&
    (selectSection?.(target.pathname + target.search) ?? false);
}

function root(state: State, path: string) {
  if (!section(path)) return false;
  // The writer is an overlay: dismiss it to its retained source section before
  // applying the main-section return rule on the next Back.
  return !state.mobileWriter && !state.libraryManagement && !state.workEditor && !state.writingManagement && !state.writingEditor &&
    !(Array.isArray(state.mobileWriterViews) && state.mobileWriterViews.length);
}

// Keep a position on every slot, including Next navigations and same-URL
// overlays. Replacements must retain it even when a page supplies fresh state.
// Main-screen Back can then skip the complete browsing trail in one action.
export function installMobileRootHistory(router: Router) {
  const token = Symbol();
  installation = token;
  const originalPush = history.pushState;
  const originalReplace = history.replaceState;
  const saved = history.state?.mobileRoot as Position | undefined;
  let position: Position = saved?.version === 1 ? saved : {version: 1, visit: crypto.randomUUID(), index: 0};
  let current: State = {...history.state, mobileRoot: position};
  let path = href();
  let returning: {source: string} | undefined;

  const remember = () => {current = history.state; path = href();};
  const push: History['pushState'] = function (data, unused, url) {
    if (installation !== token) return originalPush.call(history, data, unused, url);
    position = {...position, index: position.index + 1};
    originalPush.call(history, {...data, mobileRoot: position}, unused, url);
    remember();
  };
  const replace: History['replaceState'] = function (data, unused, url) {
    // Next can retain a wrapped native method across Strict Mode remounts.
    // An inactive wrapper must pass through instead of stamping stale indices.
    if (installation !== token) return originalReplace.call(history, data, unused, url);
    originalReplace.call(history, {...data, mobileRoot: position}, unused, url);
    remember();
  };
  history.pushState = push;
  history.replaceState = replace;
  replace(current, '', location.href);

  // A direct/reloaded main section also needs a home predecessor. Reuse saved
  // positions on reload; do not insert another predecessor on every mount.
  if (!saved && mobile() && section(path) && !featured(path)) {
    const destination = path, state = current;
    replace({}, '', '/');
    push(state, '', destination);
  }

  const finishReturn = () => {
    const destination = returning!;
    returning = undefined;
    beginMobileSectionReturn(destination.source);
    const state = {...history.state};
    for (const key of ['mobileWriter', 'mobileWriterViews', 'libraryManagement', 'workEditor', 'writingManagement', 'writingEditor']) delete state[key];
    replace(state, '', '/');
    router.replace('/');
  };
  const pop = (event: PopStateEvent) => {
    const from = current, source = path, before = position;
    const target = event.state?.mobileRoot as Position | undefined;
    if (!target || target.visit !== before.visit) {returning = undefined; return;}
    position = target;
    remember();
    if (returning) {
      event.stopImmediatePropagation();
      if (position.index > 0) history.go(-position.index);
      else finishReturn();
      return;
    }
    if (!mobile() || target.index >= before.index || !root(from, source)) return;
    // Featured is the exit boundary, even if reached by a bottom-nav tap after
    // a long browsing session. The browser owns what happens beyond that slot.
    if (featured(source)) {
      if (before.index > 0) {event.stopImmediatePropagation(); history.go(-(target.index + 1));}
      return;
    }
    event.stopImmediatePropagation();
    returning = {source};
    if (position.index > 0) history.go(-position.index);
    else finishReturn();
  };
  const select = (destination: string) => {
    if (!root(current, path)) return false;
    if (returning) return true;
    if (!featured(destination)) {
      if (destination === path) return true;
      beginMobileSectionTransition(destination);
      // Reserve the visit before requesting the route. System Back from a
      // slow section loader must reach Featured instead of leaving the site.
      push({...history.state}, '', destination);
      router.replace(destination);
      return true;
    }
    if (position.index === 0) return featured(path);
    returning = {source: path};
    history.go(-position.index);
    return true;
  };
  selectSection = select;
  window.addEventListener('popstate', pop, true);
  return () => {
    if (installation === token) installation = undefined;
    window.removeEventListener('popstate', pop, true);
    if (selectSection === select) selectSection = undefined;
    if (history.pushState === push) history.pushState = originalPush;
    if (history.replaceState === replace) history.replaceState = originalReplace;
  };
}
