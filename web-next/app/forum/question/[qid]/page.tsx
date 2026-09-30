'use client';
import {useParams} from 'next/navigation';
import ForumAnswerReader from '@/components/ForumAnswerReader';

export default function QuestionPage() {
  const params = useParams();
  return <ForumAnswerReader key={String(params.qid)} questionId={String(params.qid)}/>;
}
