import Link from 'next/link';
import {ArrowLeft} from 'lucide-react';
import './forum-navigation.css';

// The route fallback and the incoming navigation cover use the same small shell.
export default function ForumLoadingShell() {
  return <div className="forum-loading" aria-busy="true">
    <nav className="forum-loading-nav"><Link href="/forum" aria-label="返回论坛"><ArrowLeft size={24}/></Link></nav>
    <div className="forum-loading-body">
      <div className="forum-loading-question" aria-hidden="true"><div className="forum-loading-line forum-loading-title"/><div className="forum-loading-line forum-loading-title short"/><div className="forum-loading-line forum-loading-count"/></div>
      <div className="forum-loading-author" aria-hidden="true"><span/><div className="forum-loading-line"/></div>
      <p className="forum-loading-status" role="status">正在加载正文…</p>
      <div className="forum-loading-paragraph" aria-hidden="true">{Array.from({length:12},(_,i)=><div key={i} className={`forum-loading-line ${i%4===3?'short':''}`}/>)}</div>
    </div>
    <div className="forum-loading-footer" aria-hidden="true"><span/>{[0,1,2,3].map(i=><div className="forum-loading-line" key={i}/>)}</div>
  </div>;
}
