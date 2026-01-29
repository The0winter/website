import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BookOpen, Sparkles, Sword, Building2, History, Rocket } from 'lucide-react';
import { booksApi, Book } from '../lib/api';

// Categories data - Added 'All Books' at the start
const categories = [
  { name: 'All Books', icon: BookOpen, slug: 'all' },
  { name: 'Fantasy', icon: Sparkles, slug: 'fantasy' },
  { name: 'Wuxia', icon: Sword, slug: 'wuxia' },
  { name: 'Urban', icon: Building2, slug: 'urban' },
  { name: 'History', icon: History, slug: 'history' },
  { name: 'Sci-Fi', icon: Rocket, slug: 'sci-fi' },
];

export default function Home() {
  const [searchParams] = useSearchParams();
  const searchQuery = searchParams.get('q') || '';

  const [featuredBooks, setFeaturedBooks] = useState<Book[]>([]);
  const [allBooks, setAllBooks] = useState<Book[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [activeBookIndex, setActiveBookIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBooks();
  }, []);

  const fetchBooks = async () => {
    try {
      // Fetch featured books (top 5 by views)
      const featured = await booksApi.getAll({ orderBy: 'views', order: 'desc', limit: 5 });
      setFeaturedBooks(featured);

      // Fetch all books for the grid
      const books = await booksApi.getAll();
      setAllBooks(books);
    } catch (error) {
      console.error('Error fetching books:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isPaused || featuredBooks.length <= 1) return;

    const intervalId = window.setInterval(() => {
      setActiveBookIndex((prevIndex) => (prevIndex + 1) % featuredBooks.length);
    }, 3000);

    return () => window.clearInterval(intervalId);
  }, [featuredBooks, isPaused, activeBookIndex]);

  // Filter books based on selected category AND search query
  const filteredBooks = allBooks.filter((book) => {
    // Category filter
    const matchesCategory =
      selectedCategory === 'all' ||
      book.category?.toLowerCase() === selectedCategory.toLowerCase();

    // Search filter (by title)
    const matchesSearch =
      !searchQuery ||
      book.title.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesCategory && matchesSearch;
  });

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <BookOpen className="h-12 w-12 text-blue-600 animate-pulse mx-auto" />
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  const activeBook = featuredBooks[activeBookIndex] || featuredBooks[0];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Dark Navigation Bar */}
      <div className="w-full bg-[#3e3d43] h-[40px]">
        <div className="max-w-4xl mx-auto h-full flex justify-between items-center text-white text-[14px] px-2">
          {['全部作品', '排行', '完本', '免费', 'VIP', '作家专区'].map((item) => (
            <Link
              key={item}
              to="#"
              className="hover:text-red-500 transition-colors whitespace-nowrap"
            >
              {item}
            </Link>
          ))}
        </div>
      </div>

      {/* Main Content Area - vertical stack */}
      <div className="max-w-[1200px] mx-auto px-4 py-6 flex flex-col gap-8">
        {/* Hero Carousel */}
        <section className="w-full" onMouseLeave={() => setIsPaused(false)}>
          {featuredBooks.length > 0 && activeBook ? (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden w-full">
              {/* Hero Banner Area */}
              <Link
                to={`/book/${activeBook.id}`}
                className="block w-full h-full"
              >
                <div
                  className="relative h-80 bg-gradient-to-br from-blue-600 to-purple-700"
                  onMouseEnter={() => setIsPaused(true)}
                >
                  {activeBook.cover_image ? (
                    <img
                      src={activeBook.cover_image}
                      alt={activeBook.title}
                      className="w-full h-full object-cover cursor-pointer hover:opacity-90 transition-opacity"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <BookOpen className="h-24 w-24 text-white/50" />
                    </div>
                  )}
                  {/* Overlay with book info */}
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-6">
                    <h3 className="text-2xl font-bold text-white mb-2">{activeBook.title}</h3>
                    <p className="text-white/90 text-sm mb-1">
                      by {(activeBook.author_id as any)?.username || 'Unknown'}
                    </p>
                    <p className="text-white/80 text-sm line-clamp-2">
                      {activeBook.description || 'No description available'}
                    </p>
                  </div>
                </div>
              </Link>

              {/* Embedded Tabs Navigation - Qidian Style */}
              <div className="bg-gray-900/60">
                <div className="grid grid-cols-5">
                  {featuredBooks.map((book, index) => (
                    <button
                      key={book.id}
                      onClick={() => setActiveBookIndex(index)}
                      className={`px-4 py-3 text-sm font-medium transition-all ${
                        index === activeBookIndex
                          ? 'bg-red-600 text-white'
                          : 'bg-black/60 text-gray-300 hover:bg-black/80'
                      }`}
                    >
                      <span className="line-clamp-1">{book.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
              <BookOpen className="h-16 w-16 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-600 text-lg">No featured books available</p>
            </div>
          )}
        </section>

        {/* Unified Category + Book Grid Card */}
        <div className="flex flex-col">
          {/* Categories as horizontal bar - Card Header */}
          <section className="w-full">
            <div className="bg-white rounded-t-xl rounded-b-none shadow-sm border border-gray-200 border-b-0 p-6">
              <nav className="flex flex-row flex-wrap items-center">
                {categories.map((category, index) => {
                  const Icon = category.icon;
                  const isLast = index === categories.length - 1;
                  const isSelected = selectedCategory === category.slug;
                  return (
                    <span key={category.slug} className="flex items-center">
                      <button
                        onClick={() => setSelectedCategory(category.slug)}
                        className={`flex items-center space-x-2 text-lg transition-colors cursor-pointer ${
                          isSelected
                            ? 'text-red-600 font-bold'
                            : 'text-gray-500 hover:text-red-600'
                        }`}
                      >
                        <Icon className="h-5 w-5" />
                        <span>{category.name}</span>
                      </button>
                      {!isLast && <span className="h-5 w-px bg-gray-300 mx-5" />}
                    </span>
                  );
                })}
              </nav>
            </div>
          </section>

          {/* Book Grid Section - Card Body */}
          <section className="w-full">
            <div className="bg-white rounded-t-none rounded-b-xl shadow-sm border border-gray-200 p-6">
              {/* Search Results Feedback */}
              {searchQuery && (
                <div className="mb-4 pb-4 border-b border-gray-200">
                  <p className="text-gray-700">
                    Search results for: <span className="font-semibold text-red-600">"{searchQuery}"</span>
                  </p>
                </div>
              )}

              {filteredBooks.length > 0 ? (
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-6">
                  {filteredBooks.map((book) => (
                    <Link
                      key={book.id}
                      to={`/book/${book.id}`}
                      className="group"
                    >
                      <div className="bg-gray-100 rounded-lg overflow-hidden aspect-[3/4] mb-3">
                        {book.cover_image ? (
                          <img
                            src={book.cover_image}
                            alt={book.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-blue-500 to-purple-600">
                            <BookOpen className="h-12 w-12 text-white/50" />
                          </div>
                        )}
                      </div>
                      <h3 className="text-sm font-medium text-gray-800 line-clamp-2 group-hover:text-red-600 transition-colors">
                        {book.title}
                      </h3>
                      <p className="text-xs text-gray-500 mt-1">
                        {(book.author_id as any)?.username || 'Unknown Author'}
                      </p>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <BookOpen className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-500">
                    {searchQuery
                      ? `No books found matching "${searchQuery}"`
                      : 'No books found in this category'}
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}