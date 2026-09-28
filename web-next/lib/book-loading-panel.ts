// Clicked entries, direct URLs and refreshes share the loading.tsx shell.
export function bookLoadingPanel(href: string) {
  if (!/^\/book\/[^/]+$/.test(new URL(href, location.origin).pathname)) return;
  const shell = document.querySelector('#book-loading-template>.book-loading')?.cloneNode(true) as HTMLElement | undefined;
  if (!shell) return;
  const panel = document.createElement('div');
  panel.className = 'book-transition-snapshot book-navigation-loading book-navigation-skeleton';
  panel.tabIndex = -1;
  panel.setAttribute('aria-label', '正在打开书籍');
  panel.setAttribute('aria-busy', 'true');
  panel.append(shell);
  shell.querySelector('a')?.addEventListener('click', event => {event.preventDefault(); history.back();});
  panel.addEventListener('wheel', event => event.preventDefault(), {passive:false});
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') {event.preventDefault(); history.back();}
    if (['ArrowDown','ArrowUp','PageDown','PageUp','Home','End',' '].includes(event.key) && event.target === panel) event.preventDefault();
  });
  document.body.append(panel);
  panel.focus({preventScroll:true});
  return {panel, slow: () => {
    panel.setAttribute('aria-busy','false');shell.setAttribute('aria-busy','false');
    const brand = shell.querySelector('.book-loading-brand')!;
    const message = brand.querySelector('p')!;
    message.setAttribute('role','alert');message.textContent='书籍暂时未能加载，请重试';
    const actions = document.createElement('div');actions.className='book-loading-retry';
    for (const [label, action] of [['重试',()=>location.assign(href)],['返回',()=>history.back()]] as const) {
      const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=action;actions.append(button);
    }
    brand.append(actions);
  }};
}
