'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { PenTool } from 'lucide-react';

const loadWriterDialog = () => import('./MobileWriterDialog');
const WriterDialog = dynamic(() => import('./MobileWriterDialog'), { ssr: false });
const warmWriterDialog = () => { if (matchMedia('(max-width:767px)').matches) void loadWriterDialog().catch(() => {}); };

export default function MobileWriterLaunch() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const restore = () => { if (history.state?.mobileWriter && matchMedia('(max-width:767px)').matches) setOpen(true); };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);
  useEffect(() => {
    // Parse the small dialog chunk while idle, before the first tap animates it.
    if ('requestIdleCallback' in window) {
      const idle = requestIdleCallback(warmWriterDialog, { timeout: 1200 });
      return () => cancelIdleCallback(idle);
    }
    const timer = setTimeout(warmWriterDialog, 500);
    return () => clearTimeout(timer);
  }, []);
  return <>
    <button type="button" className="mh-create" aria-label="创作" aria-haspopup="dialog" aria-expanded={open} onPointerDown={warmWriterDialog} onFocus={warmWriterDialog} onClick={() => setOpen(true)}>
      <PenTool aria-hidden="true"/><span>创作</span>
    </button>
    {open && <WriterDialog onClose={() => setOpen(false)}/>}
  </>;
}
