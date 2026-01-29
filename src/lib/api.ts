// API client for local backend (localhost:5000)
const API_BASE_URL = 'https://website-production-565f.up.railway.app/api';

export interface Profile {
  id: string;
  username: string;
  role: 'reader' | 'writer';
  created_at: string;
}

export interface Book {
  id: string;
  title: string;
  author_id?: string | { _id: string; id: string; username: string; email: string } | null;
  author?: string;
  description: string;
  cover_image?: string;
  category?: string;
  status?: 'ongoing' | 'completed';
  views?: number;
  created_at?: string;
  profiles?: Profile;
}

export interface Chapter {
  id: string;
  // ✅ 修改 1: 对应后端的 bookId 字段
  bookId: string; 
  title: string;
  content: string;
  // 保持 chapter_number 不变，因为后端 schema 我们决定暂时不动它
  chapter_number: number;
  published_at?: string;
}

export interface Bookmark {
  id: string;
  user_id: string;
  // ✅ 修改 2: 对应后端的 bookId 字段
  bookId: string; 
  created_at?: string;
}

// Helper function for API calls
async function apiCall<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  // Extract user ID from localStorage (set during login)
  const userId = localStorage.getItem('novelhub_user');
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(userId ? { 'x-user-id': userId } : {}),
      ...options?.headers,
    },
    ...options,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || `HTTP error! status: ${response.status}`);
  }

  return response.json();
}

// Books API
export const booksApi = {
  // Get all books with optional sorting and limit
  getAll: async (options?: { orderBy?: string; order?: 'asc' | 'desc'; limit?: number }): Promise<Book[]> => {
    const params = new URLSearchParams();
    if (options?.orderBy) params.append('orderBy', options.orderBy);
    if (options?.order) params.append('order', options.order);
    if (options?.limit) params.append('limit', options.limit.toString());
    
    const query = params.toString();
    return apiCall<Book[]>(`/books${query ? `?${query}` : ''}`);
  },

  // Get a single book by ID
  getById: async (id: string): Promise<Book | null> => {
    return apiCall<Book | null>(`/books/${id}`);
  },

  // ... 原有的 getAll, getById ...

  // 🔥 新增：只获取当前登录用户的书
  getMyBooks: async (): Promise<Book[]> => {
    const userId = localStorage.getItem('novelhub_user');
    if (!userId) return []; // 没登录就返回空
    // 假设后端支持通过 ?author_id=xxx 筛选
    return apiCall<Book[]>(`/books?author_id=${userId}`);
  },

  // 🔥 新增：删除书籍
  delete: async (id: string): Promise<void> => {
    await apiCall<void>(`/books/${id}`, {
      method: 'DELETE',
    });
  },

  // Create a new book
  create: async (book: Omit<Book, 'id' | 'created_at'>): Promise<Book> => {
    return apiCall<Book>('/books', {
      method: 'POST',
      body: JSON.stringify(book),
    });
  },

  // Update a book
  update: async (id: string, updates: Partial<Book>): Promise<Book> => {
    return apiCall<Book>(`/books/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  },

  // Increment views
  incrementViews: async (id: string): Promise<Book> => {
    return apiCall<Book>(`/books/${id}/views`, {
      method: 'POST',
    });
  },
};

// Chapters API
export const chaptersApi = {
  // Get all chapters for a book
  getByBookId: async (bookId: string): Promise<Chapter[]> => {
    return apiCall<Chapter[]>(`/books/${bookId}/chapters`);
  },

  // Get a single chapter by ID
  getById: async (chapterId: string): Promise<Chapter | null> => {
    return apiCall<Chapter | null>(`/chapters/${chapterId}`);
  },

  // Create a new chapter
  create: async (chapter: Omit<Chapter, 'id' | 'published_at'>): Promise<Chapter> => {
    return apiCall<Chapter>('/chapters', {
      method: 'POST',
      body: JSON.stringify(chapter),
    });
  },
};

// Bookmarks API
export const bookmarksApi = {
  // Get all bookmarks for a user
  getByUserId: async (userId: string): Promise<Bookmark[]> => {
    return apiCall<Bookmark[]>(`/users/${userId}/bookmarks`);
  },

  // Check if a book is bookmarked
  check: async (userId: string, bookId: string): Promise<boolean> => {
    try {
      await apiCall<Bookmark>(`/users/${userId}/bookmarks/${bookId}`);
      return true;
    } catch {
      return false;
    }
  },

  // Create a bookmark
  create: async (userId: string, bookId: string): Promise<Bookmark> => {
    return apiCall<Bookmark>(`/users/${userId}/bookmarks`, {
      method: 'POST',
      // ✅ 修改 3: 发送的 JSON 键名改成 bookId 
      body: JSON.stringify({ bookId }), 
    });
  },

  // Delete a bookmark
  delete: async (userId: string, bookId: string): Promise<void> => {
    await apiCall<void>(`/users/${userId}/bookmarks/${bookId}`, {
      method: 'DELETE',
    });
  },
};

// Users/Profiles API
export const usersApi = {
  // Get user profile
  getProfile: async (userId: string): Promise<Profile | null> => {
    return apiCall<Profile | null>(`/users/${userId}/profile`);
  },
};

// Auth API
export interface AuthUser {
  id: string;
  email: string;
}

export interface AuthResponse {
  user: AuthUser;
  profile: Profile;
}

export const authApi = {
  // Sign up
  signUp: async (email: string, password: string, username: string, role: 'reader' | 'writer'): Promise<AuthResponse> => {
    return apiCall<AuthResponse>('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password, username, role }),
    });
  },

  // Sign in
  signIn: async (email: string, password: string): Promise<AuthResponse> => {
    return apiCall<AuthResponse>('/auth/signin', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },

  // Get session
  getSession: async (userId: string): Promise<{ user: AuthUser | null; profile: Profile | null }> => {
    return apiCall<{ user: AuthUser | null; profile: Profile | null }>(`/auth/session?userId=${userId}`);
  },
};