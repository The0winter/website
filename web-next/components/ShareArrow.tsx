import type {SVGProps} from 'react';

// A closed, curved arrow silhouette, matching the forum's share affordance.
export default function ShareArrow({size=24,strokeWidth=1.7,...props}:SVGProps<SVGSVGElement>&{size?:number}) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-share-arrow="curved" {...props}>
    <path d="M14.2 4.7a.6.6 0 0 1 1-.45l6 6a.7.7 0 0 1 0 1l-6 6a.6.6 0 0 1-1-.45v-3.3C9.1 13.5 5.9 15.1 3 19c.7-6.6 4.5-10.3 11.2-10.3Z"/>
  </svg>;
}
