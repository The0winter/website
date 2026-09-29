import {forumMetadata} from '@/lib/forum-metadata';
import ForumPostClient from './ForumPostClient';

export async function generateMetadata({params,searchParams}: {
  params:Promise<{postId:string}>;
  searchParams:Promise<{fromQuestion?:string|string[]}>;
}) {
  const [{postId},{fromQuestion}]=await Promise.all([params,searchParams]);
  return typeof fromQuestion==='string' && fromQuestion!=='undefined' ? forumMetadata(fromQuestion, postId) : forumMetadata(postId);
}

export default function PostPage(){return <ForumPostClient/>;}
