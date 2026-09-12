'use client';

import {useCallback, useEffect, useLayoutEffect, useRef} from 'react';
import type {LibraryTab} from './library-cache';

type Position = {shelf: number; history: number};
type Motion = {animations: Animation[]; origin: Position; width: number; dragging: boolean};

export function useShelfPageTurn(tab: LibraryTab, enabled: boolean) {
  const viewport = useRef<HTMLDivElement>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const currentTab = useRef(tab);
  const active = useRef<Motion | null>(null);
  const panels = useCallback(() => [...(viewport.current?.querySelectorAll<HTMLElement>('[data-shelf-tab]') ?? [])], []);

  const align = useCallback((progress?: number) => {
    const bar = tabs.current;
    if (!bar) return;
    const shelf = bar.querySelector<HTMLElement>('#tab-shelf'), history = bar.querySelector<HTMLElement>('#tab-history');
    if (shelf && history) bar.style.setProperty('--shelf-tab-offset', `${shelf.offsetLeft + (history.offsetLeft - shelf.offsetLeft) * (progress ?? (currentTab.current === 'history' ? 1 : 0))}px`);
  }, [tabs]);

  const cancel = useCallback(() => {
    const motion = active.current;
    active.current = null;
    motion?.animations.forEach(animation => animation.cancel());
    panels().forEach(panel => {panel.style.transform = '';});
    if (viewport.current) {
      delete viewport.current.dataset.switching;
      viewport.current.style.minHeight = '';
    }
    tabs.current?.removeAttribute('data-dragging');
    align();
  }, [panels, tabs, align]);

  const capture = useCallback(() => {
    const host = viewport.current;
    if (!enabled || !host) return;
    const width = host.clientWidth;
    if (!width) return;
    const origin: Position = {shelf: currentTab.current === 'shelf' ? 0 : -width, history: currentTab.current === 'history' ? 0 : width};
    if (active.current) for (const panel of panels()) origin[panel.dataset.shelfTab as LibraryTab] = new DOMMatrix(getComputedStyle(panel).transform).m41;
    active.current?.animations.forEach(animation => animation.cancel());
    host.style.minHeight = `${host.getBoundingClientRect().height}px`;
    host.dataset.switching = 'true';
    for (const panel of panels()) panel.style.transform = `translateX(${origin[panel.dataset.shelfTab as LibraryTab]}px)`;
    const motion: Motion = {origin, width, animations: [], dragging: false};
    active.current = motion;
    return motion;
  }, [enabled, panels]);

  const change = useCallback((nextTab: LibraryTab, commit: () => void) => {
    if (!active.current && nextTab === currentTab.current) {commit(); return;}
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {cancel(); commit(); return;}
    const motion = capture();
    if (!motion) {cancel(); commit(); return;}
    tabs.current?.removeAttribute('data-dragging');
    const destination: Position = nextTab === 'shelf' ? {shelf: 0, history: motion.width} : {shelf: -motion.width, history: 0};
    const remaining = Math.abs(destination.shelf - motion.origin.shelf);
    // Continue from the finger's position; a reversal retargets the current
    // frame immediately instead of waiting in a 400ms animation queue.
    const duration = Math.max(120, Math.min(300, 300 * remaining / motion.width));
    commit();
    align(nextTab === 'history' ? 1 : 0);
    motion.animations = panels().map(panel => {
      const key = panel.dataset.shelfTab as LibraryTab;
      return panel.animate([{transform: `translateX(${motion.origin[key]}px)`}, {transform: `translateX(${destination[key]}px)`}], {duration, easing: 'cubic-bezier(.22,.7,.25,1)', fill: 'forwards'});
    });
    void Promise.allSettled(motion.animations.map(animation => animation.finished)).then(() => {if (active.current === motion) cancel();});
  }, [capture, cancel, panels, align, tabs]);

  const startDrag = useCallback(() => {
    const motion = capture();
    if (!motion) return false;
    motion.dragging = true;
    tabs.current?.setAttribute('data-dragging', 'true');
    return true;
  }, [capture, tabs]);

  const drag = useCallback((distance: number) => {
    const motion = active.current;
    if (!motion?.dragging) return;
    let x = motion.origin.shelf + distance;
    if (x > 0) x *= .18;
    if (x < -motion.width) x = -motion.width + (x + motion.width) * .18;
    for (const panel of panels()) panel.style.transform = `translateX(${x + (panel.dataset.shelfTab === 'history' ? motion.width : 0)}px)`;
    align(Math.max(0, Math.min(1, -x / motion.width)));
  }, [panels, align]);

  useLayoutEffect(() => {currentTab.current = tab; if (!enabled) cancel();}, [tab, enabled, cancel]);
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
  return {viewport, tabs, change, startDrag, drag, cancel};
}
