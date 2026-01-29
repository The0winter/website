import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { BookOpen, Eye, Calendar, List, Bookmark, BookmarkCheck } from 'lucide-react';
import { booksApi, chaptersApi, bookmarksApi, Book, Chapter } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

export default function BookDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [book, setBook] = useState<Book | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) {
      fetchBookDetails();
      if (user) {
        checkBookmark();
      }
    }
  }, [id, user]);

  const fetchBookDetails = async () => {
    try {
      const bookData = await booksApi.getById(id!);
      const chaptersData = await chaptersApi.getByBookId(id!);

      if (bookData) {
        setBook(bookData);
        await booksApi.incrementViews(id!);
      }

      if (chaptersData) {
        setChapters(chaptersData);
      }
    } catch (error) {
      console.error('Error fetching book details:', error);
    } finally {
      setLoading(false);
    }
  };

  const checkBookmark = async () => {
    try {
      const bookmarked = await bookmarksApi.check(user!.id, id!);
      setIsBookmarked(bookmarked);
    } catch (error) {
      console.error('Error checking bookmark:', error);
    }
  };

  const toggleBookmark = async () => {
    if (!user) {
      navigate('/login');
      return;
    }

    try {
      if (isBookmarked) {
        await bookmarksApi.delete(user.id, id!);
        setIsBookmarked(false);
      } else {
        await bookmarksApi.create(user.id, id!);
        setIsBookmarked(true);
      }
    } catch (error) {
      console.error('Error toggling bookmark:', error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <BookOpen className="h-12 w-12 text-blue-600 animate-pulse" />
      </div>
    );
  }

  if (!book) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Book not found</h2>
          <Link to="/" className="text-blue-600 hover:underline">
            Return to home
          </Link>
        </div>
      </div>
    );
  }

  // 计算总字数（所有章节内容的总字符数）
  const totalWords = chapters.reduce((sum, chapter) => sum + (chapter.content?.length || 0), 0);
  const wordCount = totalWords > 0 ? totalWords.toLocaleString() : '0';

  // 提取分类的最后一个词（如果包含">"）
  const getCategoryDisplay = (category?: string) => {
    if (!category) return '';
    const parts = category.split('>');
    return parts[parts.length - 1].trim();
  };

  const categoryDisplay = getCategoryDisplay(book.category);

  // 状态显示文本
  const statusText = book.status === 'completed' ? '已完结' : '连载中';

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 上半部分：书籍信息卡片 */}
        <div className="bg-white rounded-lg shadow-sm mb-6">
          <div className="p-6 md:p-8">
            <div className="flex flex-col md:flex-row gap-6 md:gap-8">
              {/* 左侧：封面 */}
              <div className="flex-shrink-0">
                {book.cover_image ? (
                  <img
                    src={book.cover_image}
                    alt={book.title}
                    className="w-48 h-64 object-cover rounded-lg shadow-md"
                  />
                ) : (
                  <div className="w-48 h-64 bg-gradient-to-br from-blue-500 to-blue-700 rounded-lg shadow-md flex items-center justify-center">
                    <BookOpen className="h-16 w-16 text-white" />
                  </div>
                )}
              </div>

              {/* 右侧：书籍信息 */}
              <div className="flex-1 flex flex-col">
                {/* 标题 */}
                <h1 className="text-3xl font-bold text-gray-900 mb-3">
                  {book.title}
                </h1>

                {/* 作者信息（简单链接） */}
                <div className="mb-4">
                  <Link
                    to={`/author/${typeof book.author_id === 'object' ? (book.author_id?.id || book.author_id?._id) : book.author_id}`}
                    className="text-gray-600 hover:text-blue-600 transition-colors"
                  >
                    {(typeof book.author_id === 'object' ? book.author_id?.username : book.author) || '未知作者'}
                  </Link>
                </div>

                {/* 元数据行：连载状态 | 分类 | 字数 */}
                <div className="flex flex-wrap items-center gap-3 mb-5 text-sm text-gray-600">
                  <span className="text-gray-700">{statusText}</span>
                  <span className="text-gray-400">|</span>
                  {categoryDisplay && (
                    <>
                      <span className="text-gray-700">{categoryDisplay}</span>
                      <span className="text-gray-400">|</span>
                    </>
                  )}
                  <span className="text-gray-700">
                    字数：<span className="font-semibold text-blue-600">{wordCount}</span>
                  </span>
                </div>

                {/* 简介 */}
                <div className="mb-6">
                  <p 
                    className="text-gray-700 leading-relaxed"
                    style={{
                      display: '-webkit-box',
                      WebkitLineClamp: 4,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {book.description || '暂无简介'}
                  </p>
                </div>

                {/* 按钮组 */}
                <div className="flex flex-wrap gap-4 mt-auto">
                  {chapters.length > 0 ? (
                    <Link
                      to={`/read/${book.id}/${chapters[0].id}`}
                      className="bg-blue-600 text-white px-8 py-3 rounded-md hover:bg-blue-700 font-semibold transition-colors"
                    >
                      开始阅读
                    </Link>
                  ) : (
                    <button
                      disabled
                      className="bg-gray-400 text-white px-8 py-3 rounded-md cursor-not-allowed font-semibold"
                    >
                      暂无章节
                    </button>
                  )}
                  <button
                    onClick={toggleBookmark}
                    className={`flex items-center space-x-2 px-8 py-3 rounded-md font-semibold border-2 transition-colors ${
                      isBookmarked
                        ? 'bg-blue-50 border-blue-600 text-blue-600'
                        : 'bg-white border-gray-300 text-gray-700 hover:border-blue-600 hover:text-blue-600'
                    }`}
                  >
                    {isBookmarked ? (
                      <BookmarkCheck className="h-5 w-5" />
                    ) : (
                      <Bookmark className="h-5 w-5" />
                    )}
                    <span>{isBookmarked ? '已加入书架' : '加入书架'}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 下半部分：目录 */}
        <div className="bg-white rounded-lg shadow-sm">
          <div className="p-6 md:p-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-6 flex items-center space-x-2">
              <List className="h-6 w-6" />
              <span>目录</span>
            </h2>

            {chapters.length === 0 ? (
              <p className="text-gray-600">暂无章节</p>
            ) : (
              <div className="space-y-2">
                {chapters.map((chapter) => (
                  <Link
                    key={chapter.id}
                    to={`/read/${book.id}/${chapter.id}`}
                    className="block p-4 bg-gray-50 hover:bg-blue-50 rounded-md border border-gray-200 hover:border-blue-300 transition"
                  >
                    <div className="flex justify-between items-center">
                      <div>
                        <span className="font-semibold text-gray-900">
                          第{chapter.chapter_number}章：{chapter.title}
                        </span>
                      </div>
                      <span className="text-sm text-gray-500">
                        {chapter.published_at ? new Date(chapter.published_at).toLocaleDateString() : 'N/A'}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
