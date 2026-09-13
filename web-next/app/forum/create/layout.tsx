import {privateRobots} from '@/lib/seo';
export const metadata = {title: '发表讨论 - 九天小说站', robots: privateRobots, alternates: {canonical: null}};
export default function PrivatePageLayout({children}: {children: React.ReactNode}) { return children; }
