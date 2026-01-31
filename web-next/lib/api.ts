// API client for local backend (localhost:5000)
const API_BASE_URL = 'https://website-production-6edf.up.railway.app/api';

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
  updated_at?: string; // 或者 Date，取决于后端返回的是字符串还是日期对象
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
  updated_at?: string; // 或者 Date，取决于后端返回的是字符串还是日期对象
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

// 🔥 修改后：支持传入 authorId 参数
  getMyBooks: async (authorId?: string): Promise<Book[]> => {
    // 逻辑：优先用传进来的 ID；如果没传，再尝试从 localStorage 拿
    const targetId = authorId || localStorage.getItem('novelhub_user');
    
    if (!targetId) return []; // 如果都找不到 ID，直接返回空数组

    // 发送请求，带上 author_id 参数
    return apiCall<Book[]>(`/books?author_id=${targetId}`);
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

  // ... 原有的 getByBookId, getById ...

  // 🔥 新增：更新章节内容
  update: async (id: string, chapter: Partial<Chapter>): Promise<Chapter> => {
    return apiCall<Chapter>(`/chapters/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(chapter),
    });
  },

  // 🔥 新增：删除章节
  delete: async (id: string): Promise<void> => {
    await apiCall<void>(`/chapters/${id}`, {
      method: 'DELETE',
    });
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
// Bookmarks API
export const bookmarksApi = {
  // Get all bookmarks for a user
  getByUserId: async (userId: string): Promise<Bookmark[]> => {
    return apiCall<Bookmark[]>(`/users/${userId}/bookmarks`);
  },

  // 🔥 修复重点：检查是否收藏
  check: async (userId: string, bookId: string): Promise<boolean> => {
    // 1. URL 必须加上 /check，和后端对应
    // 2. 泛型改为 { isBookmarked: boolean }，因为后端返回的是这个结构
    const response = await apiCall<{ isBookmarked: boolean }>(`/users/${userId}/bookmarks/${bookId}/check`);
    
    // 3. 直接返回后端给出的结果，不再依赖 try-catch
    return response.isBookmarked; 
  },

  // Create a bookmark
  create: async (userId: string, bookId: string): Promise<Bookmark> => {
    return apiCall<Bookmark>(`/users/${userId}/bookmarks`, {
      method: 'POST',
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

// ✅ 修改后 (加上 username)
export interface AuthUser {
  id: string;
  email: string;
  username: string; // 👈 补上这一行！告诉 TS 用户确实有名字
  role: 'reader' | 'writer';
  token?: string;
  // 如果还有其他字段比如 avatar 等，也可以加在这里
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