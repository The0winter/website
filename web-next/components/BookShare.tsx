'use client';

import {useEffect, useId, useRef, useState, useSyncExternalStore} from 'react';
import {Check, ChevronRight, Copy, Share2, X} from 'lucide-react';
import {bookShareOpen, closeBookShare, openBookShare, serverCatalogClosed, subscribeBookNavigation} from '@/lib/book-navigation';
import {hasQQShare, isAndroidQQBrowser, prepareQQShare, shareWithQQ, supportsWebShare} from '@/lib/book-sharing';

export default function BookShare({bookId, title}: {bookId: string; title: string}) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const active = useRef(false);
  const copying = useRef(false);
  const sharing = useRef(false);
  const open = useSyncExternalStore(subscribeBookNavigation, () => bookShareOpen(bookId), serverCatalogClosed);
  const [content, setContent] = useState('');
  const [shareMode, setShareMode] = useState<'native' | 'qq' | 'loading' | 'copy'>('loading');
  const [message, setMessage] = useState('');
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const shareTitle = `《${title.trim()}》 - 九天小说站`;

  useEffect(() => {
    if (!open) return;
    active.current = true;
    let disposed = false;
    const panelElement = panel.current, toggleElement = toggle.current;
    const desktop = window.matchMedia('(min-width: 768px)');
    const resize = () => {if (desktop.matches) closeBookShare();};
    const dismiss = (event: MouseEvent) => {
      if (panel.current?.contains(event.target as Node) || toggle.current?.contains(event.target as Node)) return;
      event.preventDefault(); event.stopPropagation(); closeBookShare();
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {event.preventDefault(); closeBookShare(); return;}
      if (event.key !== 'Tab') return;
      const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input') || []);
      if (!controls.length) return;
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || !panel.current?.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !panel.current?.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    // Initialize on every opening, including Forward and restored browser history.
    const frame = requestAnimationFrame(() => {
      const url = new URL(`/book/${encodeURIComponent(bookId)}`, location.origin).href;
      setContent(`${shareTitle} ${url}`);
      const data = {title: shareTitle, text: shareTitle, url};
      if (supportsWebShare(data)) setShareMode('native');
      else if (hasQQShare()) setShareMode('qq');
      else if (isAndroidQQBrowser()) {
        setShareMode('loading');
        void prepareQQShare().then(ready => {if (!disposed) setShareMode(ready ? 'qq' : 'copy');});
      } else setShareMode('copy');
      setCopied(false); setManual(false); setMessage('');
      panel.current?.querySelector<HTMLButtonElement>('button')?.focus({preventScroll:true});
    });
    resize();
    document.addEventListener('click', dismiss, true);
    document.addEventListener('keydown', keyboard);
    desktop.addEventListener('change', resize);
    return () => {
      active.current = false;
      disposed = true;
      cancelAnimationFrame(frame);
      document.removeEventListener('click', dismiss, true);
      document.removeEventListener('keydown', keyboard);
      desktop.removeEventListener('change', resize);
      if (panelElement?.contains(document.activeElement)) toggleElement?.focus({preventScroll:true});
    };
  }, [open, bookId, shareTitle]);

  async function copy(forSharing = false) {
    if (!content || copying.current) return;
    copying.current = true;
    let success = false;
    try {await navigator.clipboard.writeText(content); success = true;} catch {
      // Keep copying available in embedded browsers that reject Clipboard API.
      input.current?.focus(); input.current?.select();
      try {success = document.execCommand('copy');} catch { /* Offer manual selection below. */ }
    } finally {copying.current = false;}
    if (!active.current) return;
    setCopied(success); setManual(!success);
    setMessage(success ? (forSharing ? '书名和链接已复制，请到微信、QQ 等应用中粘贴发送' : '书名和链接已复制') : '请长按上方文字，全选后复制');
    if (!success) {input.current?.focus(); input.current?.select();}
  }

  async function share() {
    if (shareMode === 'copy') {await copy(true); return;}
    if (shareMode === 'loading') {setMessage('正在准备分享，请稍后再点一次，也可复制上方链接'); return;}
    if (sharing.current) return;
    sharing.current = true; setBusy(true); setMessage('');
    try {
      const data = {title:shareTitle, text:shareTitle, url:new URL(`/book/${encodeURIComponent(bookId)}`, location.origin).href};
      if (shareMode === 'qq') {
        shareWithQQ(data);
        setMessage('若未弹出分享面板，请用浏览器菜单中的“分享”，或复制上方链接');
      } else await navigator.share(data);
    } catch (error) {
      const cancelled = typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError';
      if (active.current && !cancelled) {
        if (shareMode === 'native' && isAndroidQQBrowser()) {
          setShareMode('loading');
          const ready = await prepareQQShare();
          if (!active.current) return;
          setShareMode(ready ? 'qq' : 'copy');
          setMessage(ready ? '已切换到 QQ 浏览器分享，请再点一次' : '暂时无法打开分享，请复制后分享，或使用浏览器菜单中的“分享”');
        } else {
          setShareMode('copy');
          setMessage('暂时无法打开分享，请复制后分享，或使用浏览器菜单中的“分享”');
        }
      }
    } finally {sharing.current = false; setBusy(false);}
  }

  return <div className="book-share">
    <button ref={toggle} type="button" className="book-share-toggle" aria-label="分享书籍" aria-expanded={open} aria-controls={id}
      onClick={() => open ? closeBookShare() : openBookShare(bookId)}>
      <Share2 size={25} strokeWidth={1.5} aria-hidden="true"/>
    </button>
    <div ref={panel} id={id} className="book-share-panel" role="dialog" aria-labelledby={`${id}-title`} data-open={open} inert={!open}>
      <header><h2 id={`${id}-title`}>分享这本书</h2><button type="button" aria-label="关闭分享" onClick={closeBookShare}><X size={21} aria-hidden="true"/></button></header>
      <div className="book-share-copy">
        <input ref={input} readOnly value={content} aria-label="书名和分享链接" title={content} onFocus={event => {if (manual) event.target.select();}}/>
        <button type="button" onClick={() => void copy()}>{copied ? <Check size={16} aria-hidden="true"/> : <Copy size={16} aria-hidden="true"/>}{copied ? '已复制' : '复制'}</button>
      </div>
      <button type="button" className="book-share-apps" disabled={busy} onClick={() => void share()}>
        <span className="book-share-app-icon"><Share2 size={21} aria-hidden="true"/></span>
        <span><strong>{shareMode === 'copy' ? '复制后分享' : '分享到其他应用'}</strong><small>{shareMode === 'native' ? '打开手机分享面板，选择应用' : shareMode === 'qq' ? '打开 QQ 浏览器分享面板，选择应用' : shareMode === 'loading' ? '正在准备分享，也可复制链接' : '复制书名和链接，粘贴到微信、QQ 等应用'}</small></span>
        <ChevronRight size={18} aria-hidden="true"/>
      </button>
      <p className="book-share-message" role="status">{message}</p>
    </div>
  </div>;
}
