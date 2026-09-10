'use client';

import type { ComponentProps } from 'react';
import PrefetchLink from './PrefetchLink';

export default function BookLink(props: Omit<ComponentProps<typeof PrefetchLink>, 'prefetchMode' | 'pendingLabel'>) {
  return <PrefetchLink {...props} pendingLabel="正在打开书籍…" />;
}
