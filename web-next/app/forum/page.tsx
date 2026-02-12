'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { HelpCircle, Scroll, Feather, Settings, Search } from 'lucide-react';
import { forumApi, ForumPost } from '@/lib/api';

const HOT_TOPICS = [
  'Official update about the Nanjing museum event',
  'Dream Chaser spacecraft latest test succeeds',
  'Japan lower-house election vote completed',
  'Seedance 2.0 filmmaking workflow discussion',
  'Black Myth Zhong Kui first gameplay reveal'
];

const theme = {
  bg: 'bg-[#f8f9fa]',
  card: 'bg-white',
  textMain: 'text-gray-900',
  textSub: 'text-gray-500',
  border: 'border-gray-100',
};

export default function ForumPage() {
  const [activeTab, setActiveTab] = useState<'recommend' | 'hot' | 'follow'>('recommend');
  const [posts, setPosts] = useState<ForumPost[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPosts = async () => {
      try {
        setLoading(true);
        const data = await forumApi.getPosts(activeTab);
        setPosts(data || []);
      } catch (error) {
        console.error('Failed to fetch forum posts:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchPosts();
  }, [activeTab]);

  return (
    <div className={`min-h-screen ${theme.bg} pb-10 font-sans`}>
      <div className={`sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b ${theme.border}`}>
        <div className="max-w-[1000px] mx-auto px-4 h-16 flex items-center justify-between">
          <div className="w-10">
            <button className="p-2 text-gray-400 hover:text-gray-900 transition-colors">
              <Search className="w-5 h-5" />
            </button>
          </div>

          <nav className="flex items-center gap-10 h-full">
            {[
              { id: 'follow', label: 'Follow' },
              { id: 'recommend', label: 'Recommend' },
              { id: 'hot', label: 'Hot' }
            ].map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as 'recommend' | 'hot' | 'follow')}
                  className={`relative h-full flex items-center px-1 font-medium text-[16px] transition-colors duration-200
                    ${isActive ? 'text-gray-900 font-bold' : 'text-gray-500 hover:text-gray-800'}`}
                >
                  {tab.label}
                  {isActive && <div className="absolute bottom-0 left-0 w-full h-[2px] bg-gray-900 rounded-full"></div>}
                </button>
              );
            })}
          </nav>

          <div className="w-10 flex justify-end">
            <button className="p-2 text-gray-400 hover:text-gray-900 transition-colors" title="Reader settings">
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-[1000px] mx-auto px-4 md:px-0 mt-6 grid grid-cols-1 md:grid-cols-[1fr_296px] gap-6">
        <div className="flex flex-col gap-4">
          {loading && (
            <div className={`${theme.card} p-12 text-center text-gray-400 border ${theme.border} rounded-xl`}>
              Loading content...
            </div>
          )}

          {!loading && posts.map((post) => {
            const realId = post.id;
            if (!realId) return null;

            const topReply = post.topReply || null;
            const answerLink = topReply?.id
              ? `/forum/${topReply.id}?fromQuestion=${realId}`
              : `/forum/question/${realId}`;
            const answerVotes = topReply?.votes ?? post.votes ?? 0;
            const answerComments = topReply?.comments ?? post.comments ?? 0;

            return (
              <div
                key={realId}
                className={`${theme.card} p-6 rounded-xl border border-transparent hover:border-gray-200 shadow-sm hover:shadow-lg transition-all duration-300 group`}
              >
                <Link href={`/forum/question/${realId}`}>
                  <h2 className="text-[19px] font-bold text-gray-900 mb-2 leading-snug cursor-pointer group-hover:text-blue-600 transition-colors">
                    {post.title}
                  </h2>
                </Link>

                <div className="flex items-center gap-2 mb-2">
                  <div className="w-7 h-7 rounded-full bg-gray-100 overflow-hidden flex items-center justify-center">
                    {topReply?.author?.avatar ? (
                      <img src={topReply.author.avatar} alt="avatar" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-[11px] font-semibold text-gray-500">
                        {(topReply?.author?.name || 'A').slice(0, 1)}
                      </span>
                    )}
                  </div>
                  <span className="text-sm text-gray-700 font-medium">
                    {topReply?.author?.name || 'No answer yet'}
                  </span>
                  <span className="text-xs text-gray-400">
                    {topReply ? 'answered' : ''}
                  </span>
                </div>

                <Link href={answerLink}>
                  <div className="text-[15px] text-gray-600 leading-relaxed mb-4 cursor-pointer line-clamp-3 hover:text-gray-800 transition-colors">
                    {topReply?.content || 'This question has no answers yet. Click to view and participate.'}
                  </div>
                </Link>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-5 text-xs font-medium text-gray-400">
                    <span className="flex items-center gap-1 hover:text-gray-700 transition-colors cursor-default">
                      {answerVotes > 1000 ? `${(answerVotes / 1000).toFixed(1)}k` : answerVotes} upvotes
                    </span>
                    <span className="flex items-center gap-1 hover:text-gray-700 transition-colors cursor-default">
                      {answerComments} comments
                    </span>
                  </div>
                </div>
              </div>
            );
          })}

          {!loading && posts.length === 0 && (
            <div className={`${theme.card} p-12 text-center text-gray-400 rounded-xl`}>
              No content yet.
            </div>
          )}
        </div>

        <div className="hidden md:flex flex-col gap-6">
          <div className={`${theme.card} rounded-xl border ${theme.border} p-5 shadow-sm`}>
            <div className="flex items-center justify-between mb-5">
              <span className="text-sm font-bold text-gray-900">Create</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Link href="/forum/create?type=question" className="flex flex-col items-center justify-center gap-2 py-4 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors group cursor-pointer">
                <HelpCircle className="w-5 h-5 text-gray-600 group-hover:text-gray-900" />
                <span className="text-xs text-gray-600 font-medium">Ask</span>
              </Link>

              <Link href="/forum/create?type=article" className="flex flex-col items-center justify-center gap-2 py-4 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors group cursor-pointer">
                <Scroll className="w-5 h-5 text-gray-600 group-hover:text-gray-900" />
                <span className="text-xs text-gray-600 font-medium">Article</span>
              </Link>
            </div>

            <Link href="/forum/create?type=article" className="mt-4 flex items-center justify-center gap-2 w-full py-2.5 bg-gray-900 text-white text-sm rounded-lg hover:bg-black transition-all shadow-md hover:shadow-lg">
              <Feather className="w-3.5 h-3.5" /> Start creating
            </Link>
          </div>

          <div className={`${theme.card} rounded-xl border ${theme.border} p-5 shadow-sm`}>
            <h3 className="font-bold text-gray-900 text-sm mb-4">Hot Topics</h3>
            <ul className="flex flex-col gap-3">
              {HOT_TOPICS.map((topic, index) => (
                <li key={index} className="flex items-start gap-3 cursor-pointer group">
                  <span className={`text-[15px] font-bold w-4 text-center leading-5 ${index < 3 ? 'text-gray-900' : 'text-gray-300'}`}>
                    {index + 1}
                  </span>
                  <span className="text-[14px] text-gray-700 leading-snug group-hover:text-blue-600 group-hover:underline line-clamp-2">
                    {topic}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
