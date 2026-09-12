'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import WriterDashboard from '@/components/WriterDashboard';

function WriterEntry() {
  const search = useSearchParams();
  return <WriterDashboard entry={search.toString()} key={search.toString()}/>;
}

export default function WriterPage() {
  return <Suspense fallback={<div className="writer-page min-h-screen"/>}><WriterEntry/></Suspense>;
}
