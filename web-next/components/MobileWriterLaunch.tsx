'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { PenTool } from 'lucide-react';
import dynamic from 'next/dynamic';

// The editor and its styles are only needed after opening the creation center.
// Keeping them out of the root bundle reduces every page's first download.
const WriterDialog = dynamic(() => import('./MobileWriterDialog'), {
  ssr: false,
  loading: () => <div role="status" className="fixed bottom-24 right-4 z-[100] rounded-xl bg-white px-4 py-3 text-sm text-gray-700 shadow-lg dark:bg-gray-900 dark:text-gray-200">正在打开创作中心…</div>,
});

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
