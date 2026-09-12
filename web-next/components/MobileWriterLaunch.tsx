'use client';

import { useEffect, useState } from 'react';
import { PenTool } from 'lucide-react';
import WriterDialog from './MobileWriterDialog';

export default function MobileWriterLaunch() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const restore = () => { if (history.state?.mobileWriter && matchMedia('(max-width:767px)').matches) setOpen(true); };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);
  return <>
    <button type="button" className="mh-create" aria-label="创作" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
      <PenTool aria-hidden="true"/><span>创作</span>
    </button>
    {open && <WriterDialog onClose={() => setOpen(false)}/>}
  </>;
}
