import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PenTool, Plus, BookOpen, FileText, Trash2, List, X } from 'lucide-react';
import { booksApi, chaptersApi, Book, Chapter } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

export default function WriterDashboard() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [myBooks, setMyBooks] = useState<Book[]>([]);
  const [showCreateBook, setShowCreateBook] = useState(false);
  const [showAddChapter, setShowAddChapter] = useState(false);
  const [showChapterManager, setShowChapterManager] = useState(false);
  const [selectedBookId, setSelectedBookId] = useState('');
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [loading, setLoading] = useState(true);

  const [bookForm, setBookForm] = useState({
    title: '',
    description: '',
    cover_image: '',
    category: 'Fantasy',
  });

  const [chapterForm, setChapterForm] = useState({
    title: '',
    content: '',
    chapter_number: 1,
  });

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }

    if (profile && profile.role !== 'writer') {
      navigate('/');
      return;
    }

    if (user) {
      fetchMyBooks();
    }
  }, [user, profile]);

  const fetchMyBooks = async () => {
    try {
      const allBooks = await booksApi.getAll();
      const filteredBooks = allBooks.filter(book => {
        if (!book.author_id) return false;
        
        if (typeof book.author_id === 'object') {
          return (book.author_id._id === user!.id) || (book.author_id.id === user!.id);
        }
        
        return book.author_id === user!.id;
      });
      setMyBooks(filteredBooks);
    } catch (error) {
      console.error('Error fetching my books:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateBook = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await booksApi.create({
        ...bookForm,
        author_id: user!.id,
        status: 'ongoing',
        views: 0,
      });
      setShowCreateBook(false);
      setBookForm({ title: '', description: '', cover_image: '', category: 'Fantasy' });
      fetchMyBooks();
    } catch (error) {
      console.error('Error creating book:', error);
    }
  };

  const handleDelete = async (bookId: string) => {
    if (!window.confirm('Are you sure you want to delete this book?')) {
      return;
    }

    try {
      const response = await fetch(`/api/books/${bookId}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error('Failed to delete book');
      }

      setMyBooks(prevBooks => prevBooks.filter(book => book.id !== bookId));
    } catch (error) {
      console.error('Error deleting book:', error);
      alert('Failed to delete book. Please try again.');
    }
  };

  const handleAddChapter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBookId || selectedBookId.trim() === '') {
      console.error('Error: bookId is required to add a chapter');
      alert('Error: Please select a book first');
      return;
    }
    
    try {
      await chaptersApi.create({
        ...chapterForm,
        // ✅ 修改: 这里的字段名改为bookId
        bookId: selectedBookId,
      });
      setShowAddChapter(false);
      setChapterForm({ title: '', content: '', chapter_number: 1 });
      setSelectedBookId('');
    } catch (error) {
      console.error('Error adding chapter:', error);
    }
  };

  const openAddChapter = async (bookId: string) => {
    if (!bookId || bookId.trim() === '') {
      console.error('Error: bookId is required to open add chapter dialog');
      alert('Error: Invalid book ID');
      return;
    }
    
    setSelectedBookId(bookId);
    try {
      const chapters = await chaptersApi.getByBookId(bookId);
      const sortedChapters = chapters.sort((a, b) => b.chapter_number - a.chapter_number);
      const nextChapterNumber = sortedChapters.length > 0 ?
        sortedChapters[0].chapter_number + 1 : 1;
      setChapterForm({ ...chapterForm, chapter_number: nextChapterNumber });
      setShowAddChapter(true);
    } catch (error) {
      console.error('Error fetching chapters:', error);
      setChapterForm({ ...chapterForm, chapter_number: 1 });
      setShowAddChapter(true);
    }
  };

  const openChapterManager = async (bookId: string) => {
    if (!bookId || bookId.trim() === '') {
      console.error('Error: bookId is required to open chapter manager');
      alert('Error: Invalid book ID');
      return;
    }

    setSelectedBookId(bookId);
    try {
      const fetchedChapters = await chaptersApi.getByBookId(bookId);
      const sortedChapters = fetchedChapters.sort((a, b) => a.chapter_number - b.chapter_number);
      setChapters(sortedChapters);
      setShowChapterManager(true);
    } catch (error) {
      console.error('Error fetching chapters:', error);
      setChapters([]);
      setShowChapterManager(true);
    }
  };

  const handleDeleteChapter = async (chapterId: string) => {
    if (!window.confirm('Are you sure you want to delete this chapter?')) {
      return;
    }

    try {
      const response = await fetch(`/api/chapters/${chapterId}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error('Failed to delete chapter');
      }

      setChapters(prevChapters => prevChapters.filter(chapter => chapter.id !== chapterId));
    } catch (error) {
      console.error('Error deleting chapter:', error);
      alert('Failed to delete chapter. Please try again.');
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
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center space-x-3">
            <PenTool className="h-8 w-8 text-blue-600" />
            <h1 className="text-3xl font-bold text-gray-900">Writer Dashboard</h1>
          </div>
          <button
            onClick={() => setShowCreateBook(true)}
            className="flex items-center space-x-2 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 font-medium"
          >
            <Plus className="h-5 w-5" />
            <span>Create New Book</span>
          </button>
        </div>

        {showCreateBook && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <h2 className="text-2xl font-bold mb-4">Create New Book</h2>
              <form onSubmit={handleCreateBook} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                  <input
                    type="text"
                    required
                    value={bookForm.title}
                    onChange={(e) => setBookForm({ ...bookForm, title: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                  <select
                    value={bookForm.category}
                    onChange={(e) => setBookForm({ ...bookForm, category: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="Fantasy">Fantasy</option>
                    <option value="Romance">Romance</option>
                    <option value="Sci-Fi">Sci-Fi</option>
                    <option value="Mystery">Mystery</option>
                    <option value="Action">Action</option>
                    <option value="Horror">Horror</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Cover Image URL
                  </label>
                  <input
                    type="url"
                    value={bookForm.cover_image}
                    onChange={(e) => setBookForm({ ...bookForm, cover_image: e.target.value })}
                    placeholder="https://example.com/image.jpg"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Description
                  </label>
                  <textarea
                    required
                    rows={4}
                    value={bookForm.description}
                    onChange={(e) => setBookForm({ ...bookForm, description: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div className="flex space-x-4">
                  <button
                    type="submit"
                    className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 font-medium"
                  >
                    Create Book
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCreateBook(false)}
                    className="flex-1 bg-gray-200 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-300 font-medium"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {showAddChapter && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto">
              <h2 className="text-2xl font-bold mb-4">Add New Chapter</h2>
              <form onSubmit={handleAddChapter} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Chapter Number
                  </label>
                  <input
                    type="number"
                    required
                    min="1"
                    value={chapterForm.chapter_number}
                    onChange={(e) =>
                      setChapterForm({ ...chapterForm, chapter_number: parseInt(e.target.value) })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Chapter Title
                  </label>
                  <input
                    type="text"
                    required
                    value={chapterForm.title}
                    onChange={(e) => setChapterForm({ ...chapterForm, title: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Content</label>
                  <textarea
                    required
                    rows={20}
                    value={chapterForm.content}
                    onChange={(e) => setChapterForm({ ...chapterForm, content: e.target.value })}
                    placeholder="Write your chapter content here..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 font-serif"
                  />
                </div>

                <div className="flex space-x-4">
                  <button
                    type="submit"
                    className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 font-medium"
                  >
                    Add Chapter
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAddChapter(false)}
                    className="flex-1 bg-gray-200 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-300 font-medium"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Chapter Manager Modal */}
        {showChapterManager && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-gray-900">Chapter Manager</h2>
                <button
                  onClick={() => {
                    setShowChapterManager(false);
                    setChapters([]);
                    setSelectedBookId('');
                  }}
                  className="text-gray-500 hover:text-gray-700 p-1 rounded-md hover:bg-gray-100"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              {chapters.length === 0 ? (
                <div className="text-center py-8">
                  <FileText className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-500">No chapters yet. Add your first chapter!</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {chapters.map((chapter) => (
                    <div
                      key={chapter.id}
                      className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200 hover:bg-gray-100 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-gray-900">
                          Chapter {chapter.chapter_number}:
                        </span>{' '}
                        <span className="text-gray-700 truncate">{chapter.title}</span>
                      </div>
                      <button
                        onClick={() => {
                          if (chapter.id) {
                            handleDeleteChapter(chapter.id);
                          } else {
                            console.error('Error: chapter.id is undefined');
                            alert('Error: Invalid chapter ID');
                          }
                        }}
                        className="flex items-center space-x-1 text-red-600 hover:text-red-700 hover:bg-red-50 px-3 py-1.5 rounded-md text-sm font-medium ml-4 flex-shrink-0"
                      >
                        <Trash2 className="h-4 w-4" />
                        <span>Delete</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-6 pt-4 border-t border-gray-200">
                <button
                  onClick={() => {
                    setShowChapterManager(false);
                    setChapters([]);
                    setSelectedBookId('');
                  }}
                  className="w-full bg-gray-200 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-300 font-medium"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-6">
          {myBooks.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-lg shadow-md">
              <BookOpen className="h-16 w-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-xl font-bold text-gray-900 mb-2">No books yet</h3>
              <p className="text-gray-600 mb-4">Create your first book to get started!</p>
            </div>
          ) : (
            myBooks.map((book) => (
              <div key={book.id} className="bg-white rounded-lg shadow-md p-6">
                <div className="flex flex-col md:flex-row gap-6">
                  {/* Left: Cover Image */}
                  <div className="md:w-32 h-48 flex-shrink-0">
                    {book.cover_image ? (
                      <img
                        src={book.cover_image}
                        alt={book.title}
                        className="w-full h-full object-cover rounded"
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-blue-500 to-blue-700 rounded flex items-center justify-center">
                        <BookOpen className="h-12 w-12 text-white" />
                      </div>
                    )}
                  </div>

                  {/* Center: Text Content */}
                  <div className="flex-1">
                    <div className="mb-2">
                      <h3 className="text-2xl font-bold text-gray-900">{book.title}</h3>
                      <span className="text-sm text-gray-600">{book.category}</span>
                    </div>

                    <p className="text-gray-700 mb-4 line-clamp-2">{book.description}</p>

                    <div className="flex items-center space-x-6 text-sm text-gray-600">
                      <div className="flex items-center space-x-1">
                        <FileText className="h-4 w-4" />
                        <span>{book.views || 0} views</span>
                      </div>
                      <span className="px-3 py-1 bg-gray-100 rounded text-xs">
                        {book.status || 'ongoing'}
                      </span>
                    </div>
                  </div>

                  {/* Right: Action Buttons Column */}
                  <div className="flex flex-col gap-2 ml-4 min-w-[140px]">
                    <button
                      onClick={() => {
                        if (book.id) {
                          openAddChapter(book.id);
                        } else {
                          console.error('Error: book.id is undefined');
                          alert('Error: Invalid book ID');
                        }
                      }}
                      className="flex items-center justify-center space-x-1 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 text-sm font-medium w-full"
                    >
                      <Plus className="h-4 w-4" />
                      <span>Add Chapter</span>
                    </button>
                    <button
                      onClick={() => {
                        if (book.id) {
                          openChapterManager(book.id);
                        } else {
                          console.error('Error: book.id is undefined');
                          alert('Error: Invalid book ID');
                        }
                      }}
                      className="flex items-center justify-center space-x-1 text-gray-600 hover:text-gray-700 hover:bg-gray-100 px-3 py-2 rounded-md text-sm font-medium border border-gray-300 w-full"
                    >
                      <List className="h-4 w-4" />
                      <span>Manage</span>
                    </button>
                    <button
                      onClick={() => {
                        if (book.id) {
                          handleDelete(book.id);
                        } else {
                          console.error('Error: book.id is undefined');
                          alert('Error: Invalid book ID');
                        }
                      }}
                      className="flex items-center justify-center space-x-1 text-red-600 hover:text-red-700 hover:bg-red-50 px-3 py-2 rounded-md text-sm font-medium mt-auto w-full"
                    >
                      <Trash2 className="h-4 w-4" />
                      <span>Delete</span>
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}