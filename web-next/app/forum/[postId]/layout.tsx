import {forumMetadata} from '@/lib/forum-metadata';
export async function generateMetadata({params}: {params: Promise<{postId: string}>}) {
  const {postId} = await params;
  return forumMetadata(postId);
}
export default function PostLayout({children}: {children: React.ReactNode}) { return children; }
