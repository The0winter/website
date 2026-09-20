'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { PenTool } from 'lucide-react';
import WriterDialog from './MobileWriterDialog';

const WriterContext = createContext({open: false, launch: () => {}});

// Retain the center across route restoration until its exit animation finishes.
export function MobileWriterProvider({children}: {children: ReactNode}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const restore = () => {
      if (history.state?.mobileWriter && matchMedia('(max-width:767px)').matches) {
        setOpen(true);
      }
    };
    // Route Back can arrive before this launcher remounts and subscribes.
    const timer = setTimeout(restore, 0);
    window.addEventListener('popstate', restore);
    return () => { clearTimeout(timer); window.removeEventListener('popstate', restore); };
  }, []);
  return <WriterContext.Provider value={{open, launch: () => setOpen(true)}}>
    {children}
    {open && <WriterDialog onClose={() => setOpen(false)}/>}
  </WriterContext.Provider>;
}

export default function MobileWriterLaunch() {
  const {open, launch} = useContext(WriterContext);
  return <button type="button" className="mh-create" aria-label="创作" aria-haspopup="dialog" aria-expanded={open} onClick={launch}>
    <PenTool aria-hidden="true"/><span>创作</span>
  </button>;
}
