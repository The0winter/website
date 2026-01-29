import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ReadingSettingsProvider } from './contexts/ReadingSettingsContext';
import Navbar from './components/Navbar';
import Home from './pages/Home';
import Login from './pages/Login';
import Register from './pages/Register';
import BookDetail from './pages/BookDetail';
import Reader from './pages/Reader';
import WriterDashboard from './pages/WriterDashboard';
import Library from './pages/Library';
import SearchResults from './pages/SearchResults';
import AuthorProfile from './pages/AuthorProfile';

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ReadingSettingsProvider>
          <Navbar />
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/book/:id" element={<BookDetail />} />
            <Route path="/read/:bookId/:chapterId" element={<Reader />} />
            <Route path="/write" element={<WriterDashboard />} />
            <Route path="/library" element={<Library />} />
            <Route path="/search" element={<SearchResults />} />
            <Route path="/author/:authorId" element={<AuthorProfile />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ReadingSettingsProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
