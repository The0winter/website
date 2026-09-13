import {forumMetadata} from '@/lib/forum-metadata';
export async function generateMetadata({params}: {params: Promise<{qid: string}>}) {
  const {qid} = await params;
  return forumMetadata(qid);
}
export default function QuestionLayout({children}: {children: React.ReactNode}) { return children; }
