'use client';
import {useParams} from 'next/navigation';
import {Suspense} from 'react';
import ForumQuestionPage from '@/components/ForumQuestionPage';
import ForumQuestionLoading from '@/components/ForumQuestionLoading';

export default function QuestionPage() {
  const params = useParams();
  return <Suspense fallback={<ForumQuestionLoading/>}><ForumQuestionPage key={String(params.qid)} questionId={String(params.qid)}/></Suspense>;
}
