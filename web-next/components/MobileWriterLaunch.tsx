'use client';

import { useEffect, useRef, useState } from 'react';
import { PenTool } from 'lucide-react';
import WriterDialog from './MobileWriterDialog';

export default function MobileWriterLaunch() {
  const [open, setOpen] = useState(false);
  const launcher = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const restore = () => {
      if (history.state?.mobileWriter && matchMedia('(max-width:767px)').matches) {
        launcher.current?.focus({ preventScroll: true });
        setOpen(true);
      }
    };
    // Route Back can arrive before this launcher remounts and subscribes.
    const timer = setTimeout(restore, 0);
    window.addEventListener('popstate', restore);
    return () => { clearTimeout(timer); window.removeEventListener('popstate', restore); };
  }, []);
  return <>
    <button ref={launcher} type="button" className="mh-create" aria-label="创作" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
      <PenTool aria-hidden="true"/><span>创作</span>
    </button>
    {open && <WriterDialog onClose={() => setOpen(false)}/>}
  </>;
}
