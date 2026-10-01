import Link from 'next/link';
import {ChevronLeft} from 'lucide-react';
import './forum-navigation.css';
export default function ForumQuestionLoading(){
  return <div className="forum-loading forum-question-loading" aria-busy="true"><nav className="forum-loading-nav"><Link href="/forum" aria-label="返回论坛"><ChevronLeft size={28}/></Link></nav><div className="forum-loading-body">
    <div className="forum-loading-question" aria-hidden="true"><div className="forum-loading-line forum-loading-title"/><div className="forum-loading-line forum-loading-title short"/></div><p className="forum-loading-status" role="status">正在加载问题…</p>
    {[0,1,2].map(i=><div className="forum-loading-preview" key={i} aria-hidden="true"><div className="forum-loading-author"><span/><div className="forum-loading-line"/></div><div className="forum-loading-line"/><div className="forum-loading-line short"/><div className="forum-loading-line forum-loading-count"/></div>)}
  </div></div>;
}
