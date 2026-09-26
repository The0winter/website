'use client';

// Share parsed styles across the two moving surfaces. Unlike book/reader
// transitions, only the banner and horizontal shelves need their scroll offsets
// frozen; the rest needs no per-element computed-style/layout walk.
const styles = new WeakMap<CSSStyleSheet, {length: number; text: string; sheet?: CSSStyleSheet}>();
const reset = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
let resetSheet: CSSStyleSheet | undefined;
let shells: ShadowRoot | undefined;

export function registerMobileSectionShells(root: ShadowRoot) {
  shells = root;
  return () => {if (shells === root) shells = undefined;};
}

export function mobileRankingShell() {
  return shells?.querySelector<HTMLElement>('[data-mobile-section-shell="/ranking"] > .ranking-page');
}

function snapshotStyles() {
  return [...document.styleSheets].flatMap(original => {
    if (original.disabled) return [];
    try {
      const rules = original.cssRules;
      let cached = styles.get(original);
      if (!cached || cached.length !== rules.length) {
        const text = [...rules].map(rule => rule.cssText).join('\n');
        const sheet = 'replaceSync' in CSSStyleSheet.prototype ? new CSSStyleSheet() : undefined;
        sheet?.replaceSync(text);
        cached = {length: rules.length, text, sheet};
        styles.set(original, cached);
      }
      return [cached];
    } catch {return [];}
  });
}

export function warmMobileSectionStyles() {
  if (!matchMedia('(max-width: 767px)').matches) return;
  const warm = () => {snapshotStyles();};
  if ('requestIdleCallback' in window) {
    const idle = window.requestIdleCallback(warm, {timeout: 1500});
    return () => window.cancelIdleCallback(idle);
  }
  const timer = setTimeout(warm, 100);
  return () => clearTimeout(timer);
}

export function captureMobileSectionShell(path: string, top: number, height: number) {
  const source = shells?.querySelector(`[data-mobile-section-shell="${path}"]`)?.cloneNode(true) as HTMLElement | undefined;
  if (!source) return;
  const measure = document.createElement('div');
  Object.assign(measure.style, {position: 'fixed', top: '0', left: '0', width: '100%', visibility: 'hidden', pointerEvents: 'none'});
  measure.inert = true;
  measure.append(source);
  document.body.append(measure);
  try {
    const spacer = source.querySelector<HTMLElement>('[data-section-shell-header]')!;
    spacer.style.height = `${Math.max(0, top - spacer.getBoundingClientRect().top)}px`;
    const tabs = source.querySelector<HTMLElement>('.shelf-tabs');
    const selected = tabs?.querySelector<HTMLElement>('[aria-selected=true]');
    if (selected) tabs!.style.setProperty('--shelf-tab-offset', `${selected.offsetLeft}px`);
    return captureMobileSection(source, top, height).element;
  } finally {measure.remove();}
}

export function captureMobileSection(source: HTMLElement, top: number, height: number, header = false, fullHome = false) {
  const element = document.createElement('div');
  element.className = header ? 'mobile-section-header' : 'mobile-section-snapshot';
  element.setAttribute('aria-hidden', 'true');
  element.inert = true;
  element.style.top = `${top}px`;
  element.style.height = `${height}px`;
  const shadow = element.attachShadow({mode: 'closed'});
  const sheets = snapshotStyles();
  if ('adoptedStyleSheets' in shadow && sheets.every(style => style.sheet)) {
    if (!resetSheet) {resetSheet = new CSSStyleSheet(); resetSheet.replaceSync(reset);}
    shadow.adoptedStyleSheets = [...sheets.map(style => style.sheet!), resetSheet];
  } else {
    const style = document.createElement('style');
    style.textContent = sheets.map(style => style.text).join('\n') + reset;
    shadow.append(style);
  }
  const box = source.getBoundingClientRect();
  const content = source.cloneNode(true) as HTMLElement;
  // cloneNode drops scrollLeft. Freeze these small, known rails into the
  // snapshot so the cover, dots and shelf books stay on the same visible page.
  const rails = source.querySelectorAll<HTMLElement>('.mh-banner-track, .mh-shelf');
  content.querySelectorAll<HTMLElement>('.mh-banner-track, .mh-shelf').forEach((rail, index) => {
    rail.style.scrollSnapType = 'none';
    rail.style.overflowX = 'clip';
    for (const child of rail.children) (child as HTMLElement).style.translate = `${-rails[index].scrollLeft}px 0`;
  });
  // Root-scoped font variables do not resolve identically inside a shadow
  // tree. Preserve the source font so the frame and real route use the same face.
  content.style.fontFamily = getComputedStyle(source).fontFamily;
  content.querySelectorAll(fullHome ? 'script, iframe' : '.mh-bottom, script, iframe').forEach(child => child.remove());
  if (!header) content.querySelectorAll<HTMLElement>('.mh-topbar').forEach(bar => {bar.style.visibility = 'hidden';});
  if (!header) content.querySelectorAll<HTMLElement>('.library-search-header, .forum-masthead').forEach(bar => {bar.style.position = 'static';});
  Object.assign(content.style, {position: 'relative', top: `${box.top - top}px`, left: `${box.left}px`, width: `${box.width}px`, margin: '0'});
  if (fullHome) {
    // A home-to-ranking transition needs only these two positioned controls,
    // not computed style and scroll reads for every book in both desktop/mobile DOMs.
    for (const selector of ['.mh-topbar', '.mh-bottom']) {
      const original = source.querySelector<HTMLElement>(selector);
      const copy = content.querySelector<HTMLElement>(selector);
      if (!original || !copy) continue;
      const rect = original.getBoundingClientRect();
      if (selector === '.mh-topbar') {
        const spacer = copy.cloneNode(false) as HTMLElement;
        spacer.dataset.snapshotSpacer = '';
        Object.assign(spacer.style, {position: 'static', visibility: 'hidden', height: `${rect.height}px`});
        copy.before(spacer);
      }
      Object.assign(copy.style, {position: 'fixed', top: `${rect.top}px`, left: `${rect.left}px`, width: `${rect.width}px`, height: `${rect.height}px`, bottom: 'auto', right: 'auto', margin: '0'});
    }
  }
  // The forum's floating publish button is the only remaining fixed control.
  const publish = source.querySelector<HTMLElement>('.forum-publish');
  const copiedPublish = content.querySelector<HTMLElement>('.forum-publish');
  if (publish && copiedPublish) {
    const button = publish.getBoundingClientRect();
    Object.assign(copiedPublish.style, {position: 'absolute', top: `${button.top - box.top}px`, left: `${button.left - box.left}px`, bottom: 'auto', right: 'auto', width: `${button.width}px`, height: `${button.height}px`});
  }
  const wrapper = document.createElement('div');
  wrapper.className = document.documentElement.className;
  wrapper.append(content);
  shadow.append(wrapper);
  return {element, content};
}
