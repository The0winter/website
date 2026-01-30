import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BookOpen, Menu, X, LogOut, PenTool, Search } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useReadingSettings } from '../contexts/ReadingSettingsContext';

export default function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const { user, profile, logout } = useAuth();
  const { theme } = useReadingSettings();
  const navigate = useNavigate();

  const isDark = theme === 'dark';
  const navBgClass = isDark ? 'bg-[#1a1a1a]' : 'bg-white';
  const panelBgClass = navBgClass;
  const textPrimary = isDark ? 'text-gray-200' : 'text-gray-700';
  const textHeading = isDark ? 'text-gray-200' : 'text-gray-900';
  const searchBgClass = isDark ? 'bg-gray-700' : 'bg-gray-100';
  const searchTextClass = isDark ? 'text-gray-200 placeholder-gray-400' : 'text-gray-700 placeholder-gray-500';

  const handlelogout = async () => {
    if (!window.confirm('Are you sure you want to sign out?')) {
      return;
    }
    await logout();
    navigate('/');
    setMobileMenuOpen(false);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && searchTerm.trim()) {
      navigate(`/search?q=${encodeURIComponent(searchTerm.trim())}`);
    }
  };

  return (
    <nav className={`${navBgClass} shadow-sm sticky top-0 z-50`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <Link to="/" className="flex items-center space-x-2">
            <BookOpen className="h-8 w-8 text-blue-600" />
            <span className={`text-xl font-bold ${textHeading}`}>NovelHub</span>
          </Link>

          {/* Search Bar - Center */}
          <div className="hidden md:flex flex-1 max-w-md mx-8">
            <div className={`relative w-full`}>
              <Search className={`absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`} />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search books..."
                className={`w-full pl-10 pr-4 py-2 rounded-full ${searchBgClass} ${searchTextClass} focus:outline-none focus:ring-2 focus:ring-blue-500`}
              />
            </div>
          </div>

          {/* Right-side Links */}
          <div className="hidden md:flex items-center space-x-8">
            {user && (
              <Link to="/library" className={`${textPrimary} hover:text-blue-600 font-medium`}>
                Library
              </Link>
            )}
            {profile?.role === 'writer' && (
              <Link to="/write" className={`${textPrimary} hover:text-blue-600 font-medium flex items-center space-x-1`}>
                <PenTool className="h-4 w-4" />
                <span>Write</span>
              </Link>
            )}
            {user ? (
              <div className="flex items-center space-x-4">
                <span className={`${textPrimary} font-medium`}>{profile?.username}</span>
                <button
                  onClick={handlelogout}
                  className={`flex items-center space-x-1 ${textPrimary} hover:text-red-600`}
                >
                  <LogOut className="h-4 w-4" />
                  <span>Sign out</span>
                </button>
              </div>
            ) : (
              <div className="flex items-center space-x-4">
                <Link to="/login" className={`${textPrimary} hover:text-blue-600 font-medium`}>
                  Login
                </Link>
                <Link
                  to="/register"
                  className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 font-medium"
                >
                  Sign up
                </Link>
              </div>
            )}
          </div>

          <button
            className="md:hidden"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? (
              <X className={`h-6 w-6 ${textPrimary}`} />
            ) : (
              <Menu className={`h-6 w-6 ${textPrimary}`} />
            )}
          </button>
        </div>
      </div>

      {mobileMenuOpen && (
        <div className={`md:hidden border-t border-gray-200 ${panelBgClass}`}>
          <div className="px-4 py-4 space-y-3">
            {/* Mobile Search Bar */}
            <div className="relative">
              <Search className={`absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`} />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => {
                  handleSearchKeyDown(e);
                  if (e.key === 'Enter') setMobileMenuOpen(false);
                }}
                placeholder="Search books..."
                className={`w-full pl-10 pr-4 py-2 rounded-full ${searchBgClass} ${searchTextClass} focus:outline-none focus:ring-2 focus:ring-blue-500`}
              />
            </div>
            {user && (
              <Link
                to="/library"
                className={`block ${textPrimary} hover:text-blue-600 font-medium`}
                onClick={() => setMobileMenuOpen(false)}
              >
                Library
              </Link>
            )}
            {profile?.role === 'writer' && (
              <Link
                to="/write"
                className={`block ${textPrimary} hover:text-blue-600 font-medium`}
                onClick={() => setMobileMenuOpen(false)}
              >
                Write
              </Link>
            )}
            {user ? (
              <div className="pt-2 border-t border-gray-200">
                <p className={`${textPrimary} font-medium mb-2`}>{profile?.username}</p>
                <button
                  onClick={handlelogout}
                  className="text-red-600 hover:text-red-700 font-medium"
                >
                  Sign out
                </button>
              </div>
            ) : (
              <div className="pt-2 border-t border-gray-200 space-y-2">
                <Link
                  to="/login"
                  className={`block ${textPrimary} hover:text-blue-600 font-medium`}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Login
                </Link>
                <Link
                  to="/register"
                  className="block bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 font-medium text-center"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Sign up
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
