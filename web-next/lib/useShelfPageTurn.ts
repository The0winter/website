'use client';

import {useCallback, useEffect, useLayoutEffect, useRef} from 'react';
import {freezeBookPage} from './book-transition';
import type {LibraryTab} from './library-cache';

type Request = {tab: LibraryTab; commit: () => void};
type Turn = {to: LibraryTab; snapshot: HTMLElement; animations: Animation[]; queued?: Request; started: boolean};

export function useShelfPageTurn(tab: LibraryTab, enabled: boolean) {
  const content = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const currentTab = useRef(tab);
  const active = useRef<Turn | null>(null);
  const cancel = useCallback(() => {
    const turn = active.current;
    active.current = null;
    turn?.animations.forEach(animation => animation.cancel());
    turn?.snapshot.remove();
    if (viewport.current) {
      delete viewport.current.dataset.switching;
      viewport.current.style.minHeight = '';
      viewport.current.inert = false;
    }
  }, [viewport]);

  const change = useCallback(function request(nextTab: LibraryTab, commit: () => void) {
    // Complete the current page movement before honoring the latest tab click.
    // This avoids snapping or accumulating stale outgoing pages on rapid taps.
    if (active.current) {active.current.queued = {tab: nextTab, commit}; return;}
    const panel = content.current, host = viewport.current;
    if (!enabled || !panel || !host || nextTab === currentTab.current || matchMedia('(prefers-reduced-motion: reduce)').matches) {commit(); return;}
    const snapshot = freezeBookPage('shelf-page-outgoing', panel);
    host.style.minHeight = `${host.getBoundingClientRect().height}px`;
    host.dataset.switching = nextTab;
    host.inert = true;
    host.append(snapshot);
    active.current = {to: nextTab, snapshot, animations: [], started: false};
    commit();
  }, [content, viewport, enabled]);

  useLayoutEffect(() => {
    currentTab.current = tab;
    const turn = active.current, panel = content.current, host = viewport.current;
    if (!turn) return;
    if (!enabled || turn.to !== tab || !panel || !host) {cancel(); return;}
    if (turn.started) return;
    turn.started = true;
    const distance = host.clientWidth * (tab === 'history' ? 1 : -1);
    const options = {duration: 400, easing: 'cubic-bezier(.22,.7,.25,1)', fill: 'forwards' as const};
    // Both opaque pages travel the same full width; no fade or blank interval.
    turn.animations = [
      turn.snapshot.animate([{transform: 'translateX(0)'}, {transform: `translateX(${-distance}px)`}], options),
      panel.animate([{transform: `translateX(${distance}px)`}, {transform: 'translateX(0)'}], options),
    ];
    void Promise.allSettled(turn.animations.map(animation => animation.finished)).then(() => {
      if (active.current !== turn) return;
      const queued = turn.queued;
      cancel();
      if (queued) change(queued.tab, queued.commit);
    });
  }, [tab, enabled, content, viewport, cancel, change]);

  useEffect(() => {
    window.addEventListener('book-navigation-leave', cancel);
    window.addEventListener('pagehide', cancel);
    window.addEventListener('resize', cancel);
    return () => {
      window.removeEventListener('book-navigation-leave', cancel);
      window.removeEventListener('pagehide', cancel);
      window.removeEventListener('resize', cancel);
      cancel();
    };
  }, [cancel]);
  return {content, viewport, change, cancel};
}
