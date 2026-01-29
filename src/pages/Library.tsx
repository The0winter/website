import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bookmark, BookOpen, Eye } from 'lucide-react';
import { bookmarksApi, booksApi, Book } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

export default function Library() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [bookmarkedBooks, setBookmarkedBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    fetchBookmarkedBooks();
  }, [user]);

  const fetchBookmarkedBooks = async () => {
    try {
      const bookmarks = await bookmarksApi.getByUserId(user!.id);
      
      if (bookmarks && bookmarks.length > 0) {
        const bookPromises = bookmarks.map((bookmark) => {
          // ✅ 修改 1：这里要从 bookmark.bookId 读取
          if (!bookmark || !bookmark.bookId) {
             return Promise.resolve(null);
          }

          let bookId: string;
          
          // ✅ 修改 2：检查类型时也用 bookId
          // 后端做了 populate('bookId')，所以这里通常是一个对象（Book信息）
          if (typeof bookmark.bookId === 'object') {
                const bookObj = bookmark.bookId as any; 
                bookId = bookObj._id || bookObj.id || String(bookObj);
          } else {
                // 如果后端没 populate，这里就是一个 ID 字符串
                bookId = String(bookmark.bookId);
          }

          // 3. 再次检查提取出来的 ID 是否是脏数据
          if (!bookId || bookId === 'null' || bookId === 'undefined') {
             return Promise.resolve(null);
          }

          return booksApi.getById(bookId);
        });

        const books = (await Promise.all(bookPromises)).filter((book): book is Book => book !== null);
        setBookmarkedBooks(books);
      }
    } catch (error) {
      console.error('Error fetching bookmarked books:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <BookOpen className="h-12 w-12 text-blue-600 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center space-x-3 mb-8">
          <Bookmark className="h-8 w-8 text-blue-600" />
          <h1 className="text-3xl font-bold text-gray-900">My Library</h1>
        </div>

        {bookmarkedBooks.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg shadow-md">
            <Bookmark className="h-16 w-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-gray-900 mb-2">No bookmarks yet</h3>
            <p className="text-gray-600 mb-4">
              Start exploring and bookmark novels you want to read later!
            </p>
            <Link
              to="/"
              className="inline-block bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 font-medium"
            >
              Browse Novels
            </Link>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {bookmarkedBooks.map((book) => (
              <Link
                key={book.id}
                to={`/book/${book.id}`}
                className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-xl transition group"
              >
                {book.cover_image ? (
                  <img
                    src={book.cover_image}
                    alt={book.title}
                    className="w-full h-64 object-cover group-hover:scale-105 transition"
                  />
                ) : (
                  <div className="w-full h-64 bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center">
                    <BookOpen className="h-16 w-16 text-white" />
                  </div>
                )}
                <div className="p-4">
                  <h3 className="font-bold text-lg text-gray-900 mb-1 line-clamp-1">
                    {book.title}
                  </h3>
                  <p className="text-sm text-gray-600 mb-2">by {book.author || book.profiles?.username || 'Unknown'}</p>
                  <p className="text-sm text-gray-700 line-clamp-2 mb-3">{book.description}</p>
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span className="flex items-center space-x-1">
                      <Eye className="h-3 w-3" />
                      <span>{(book.views || 0).toLocaleString()}</span>
                    </span>
                    <span className="px-2 py-1 bg-gray-100 rounded text-xs">
                      {book.category || 'Uncategorized'}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}