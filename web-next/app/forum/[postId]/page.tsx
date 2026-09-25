import {forumMetadata} from '@/lib/forum-metadata';
import ForumPostClient from './ForumPostClient';

export async function generateMetadata({params,searchParams}: {
  params:Promise<{postId:string}>;
  searchParams:Promise<{fromQuestion?:string|string[]}>;
}) {
  const [{postId},{fromQuestion}]=await Promise.all([params,searchParams]);
  // Answer URLs carry an answer ID in the path and its parent in the query.
  // Metadata must read that parent, just like the client reader does.
  return forumMetadata(typeof fromQuestion==='string' && fromQuestion!=='undefined' ? fromQuestion : postId);
}

export default function PostPage(){return <ForumPostClient/>;}
