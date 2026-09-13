'use client';

// Share parsed styles across the two moving surfaces. Unlike book/reader
// transitions, section pages have no sticky catalog or nested scroll positions
// to freeze, so they need no per-element computed-style/layout walk.
const styles = new WeakMap<CSSStyleSheet, {length: number; text: string; sheet?: CSSStyleSheet}>();
const reset = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
let resetSheet: CSSStyleSheet | undefined;

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

export function captureMobileSection(source: HTMLElement, top: number, height: number, header = false) {
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
  content.querySelectorAll('.mh-bottom, script, iframe').forEach(child => child.remove());
  if (!header) content.querySelectorAll<HTMLElement>('.mh-topbar').forEach(bar => {bar.style.visibility = 'hidden';});
  Object.assign(content.style, {position: 'relative', top: `${box.top - top}px`, left: `${box.left}px`, width: `${box.width}px`, margin: '0'});
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
