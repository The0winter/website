import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { booksApi, Book } from '../lib/api';
import { BookOpen } from 'lucide-react';

export default function SearchResults() {
  const [searchParams] = useSearchParams();
  const query = searchParams.get('q') || '';
  const [books, setBooks] = useState<Book[]>([]);
  const [filteredBooks, setFilteredBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchBooks = async () => {
      try {
        const allBooks = await booksApi.getAll();
        setBooks(allBooks);
      } catch (error) {
        console.error('Failed to fetch books:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchBooks();
  }, []);

  useEffect(() => {
    if (query) {
      const results = books.filter((book) =>
        book.title.toLowerCase().includes(query.toLowerCase())
      );
      setFilteredBooks(results);
    } else {
      setFilteredBooks([]);
    }
  }, [query, books]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8">
        Search Results for: <span className="text-blue-600">"{query}"</span>
      </h1>

      {filteredBooks.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {filteredBooks.map((book) => (
            <Link
              key={book.id}
              to={`/book/${book.id}`}
              className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow"
            >
              <img
                src={book.cover_image}
                alt={book.title}
                className="w-full h-48 object-cover"
              />
              <div className="p-4">
                <h2 className="text-lg font-semibold mb-2 line-clamp-2">
                  {book.title}
                </h2>
                <p className="text-gray-600 text-sm">{book.author}</p>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16">
          <BookOpen className="w-16 h-16 text-gray-400 mb-4" />
          <h2 className="text-xl font-semibold text-gray-600 mb-2">
            No results found
          </h2>
          <p className="text-gray-500">
            We couldn't find any books matching "{query}"
          </p>
          <Link
            to="/"
            className="mt-4 text-blue-600 hover:text-blue-800 underline"
          >
            Back to Home
          </Link>
        </div>
      )}
    </div>
  );
}