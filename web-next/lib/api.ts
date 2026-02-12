const getBaseUrl = () => {
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  return 'http://127.0.0.1:5000';
};

export const API_BASE_URL = `${getBaseUrl()}/api`;

export interface ForumPost {
  id: string;
  title: string;
  excerpt?: string;
  content?: string;
  author: string | { name: string; id: string; avatar?: string; bio?: string };
  authorId?: string;
  topReply?: {
    id: string;
    content: string;
    votes: number;
    comments: number;
    author: {
      id: string;
      name: string;
      avatar?: string;
    };
  } | null;
  votes: number;
  comments: number;
  tags: string[];
  isHot: boolean;
  type: 'question' | 'article';
  views?: number;
  created_at?: string;
  hasLiked?: boolean;
}

export interface ForumReply {
  id: string;
  content: string;
  votes: number;
  hasLiked?: boolean;
  comments: number;
  time: string;
  author: {
    name: string;
    bio: string;
    avatar: string;
    id: string;
  };
}

export interface ForumComment {
  id: string;
  postId: string;
  replyId: string;
  parentCommentId: string | null;
  content: string;
  votes: number;
  hasLiked?: boolean;
  replyCount: number;
  time: string;
  author: {
    name: string;
    avatar: string;
    id: string;
  };
}

export interface Profile {
  id: string;
  username: string;
  role: 'reader' | 'admin';
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
  weekly_views?: number;
  monthly_views?: number;
  daily_views?: number;
  rating?: number;
  updated_at?: string;
  created_at?: string;
  profiles?: Profile;
}

export interface Chapter {
  id: string;
  bookId: string;
  title: string;
  content: string;
  word_count?: number;
  chapter_number: number;
  published_at?: string;
}

export interface Bookmark {
  id: string;
  user_id: string;
  bookId: string;
  updated_at?: string;
  created_at?: string;
}

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  role: 'reader' | 'admin';
  token?: string;
  avatar?: string;
}

export interface AuthResponse {
  user: AuthUser;
  profile: Profile;
  token: string;
}

async function apiCall<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const userId = typeof window !== 'undefined' ? localStorage.getItem('novelhub_user') : null;
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(userId ? { 'x-user-id': userId } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

export const booksApi = {
  getAll: async (options?: { orderBy?: string; order?: 'asc' | 'desc'; limit?: number }): Promise<Book[]> => {
    const params = new URLSearchParams();
    if (options?.orderBy) params.append('orderBy', options.orderBy);
    if (options?.order) params.append('order', options.order);
    if (options?.limit) params.append('limit', options.limit.toString());
    const query = params.toString();
    return apiCall<Book[]>(`/books${query ? `?${query}` : ''}`);
  },

  getById: async (id: string): Promise<Book | null> => {
    return apiCall<Book | null>(`/books/${id}`);
  },

  getMyBooks: async (authorId?: string): Promise<Book[]> => {
    const targetId = authorId || (typeof window !== 'undefined' ? localStorage.getItem('novelhub_user') : null);
    if (!targetId) return [];
    return apiCall<Book[]>(`/books?author_id=${targetId}`);
  },

  delete: async (id: string): Promise<void> => {
    await apiCall<void>(`/books/${id}`, { method: 'DELETE' });
  },

  create: async (book: Omit<Book, 'id' | 'created_at'>): Promise<Book> => {
    return apiCall<Book>('/books', {
      method: 'POST',
      body: JSON.stringify(book),
    });
  },

  update: async (id: string, updates: Partial<Book>): Promise<Book> => {
    return apiCall<Book>(`/books/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  },

  incrementViews: async (id: string): Promise<Book> => {
    return apiCall<Book>(`/books/${id}/views`, { method: 'POST' });
  },
};

export const chaptersApi = {
  getByBookId: async (bookId: string): Promise<Chapter[]> => {
    return apiCall<Chapter[]>(`/books/${bookId}/chapters`);
  },

  getById: async (chapterId: string): Promise<Chapter | null> => {
    return apiCall<Chapter | null>(`/chapters/${chapterId}`);
  },

  update: async (id: string, chapter: Partial<Chapter>): Promise<Chapter> => {
    return apiCall<Chapter>(`/chapters/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(chapter),
    });
  },

  delete: async (id: string): Promise<void> => {
    await apiCall<void>(`/chapters/${id}`, { method: 'DELETE' });
  },

  create: async (chapter: Omit<Chapter, 'id' | 'published_at'>): Promise<Chapter> => {
    return apiCall<Chapter>('/chapters', {
      method: 'POST',
      body: JSON.stringify(chapter),
    });
  },
};

export const bookmarksApi = {
  getByUserId: async (userId: string): Promise<Bookmark[]> => {
    return apiCall<Bookmark[]>(`/users/${userId}/bookmarks`);
  },

  check: async (userId: string, bookId: string): Promise<boolean> => {
    const response = await apiCall<{ isBookmarked: boolean }>(`/users/${userId}/bookmarks/${bookId}/check`);
    return response.isBookmarked;
  },

  create: async (userId: string, bookId: string): Promise<Bookmark> => {
    return apiCall<Bookmark>(`/users/${userId}/bookmarks`, {
      method: 'POST',
      body: JSON.stringify({ bookId }),
    });
  },

  delete: async (userId: string, bookId: string): Promise<void> => {
    await apiCall<void>(`/users/${userId}/bookmarks/${bookId}`, {
      method: 'DELETE',
    });
  },
};

export const usersApi = {
  getProfile: async (userId: string): Promise<Profile | null> => {
    return apiCall<Profile | null>(`/users/${userId}/profile`);
  },
};

export const authApi = {
  signUp: async (email: string, password: string, username: string, role: 'reader', code: string): Promise<AuthResponse> => {
    return apiCall<AuthResponse>('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password, username, role, code }),
    });
  },

  signIn: async (email: string, password: string): Promise<AuthResponse> => {
    return apiCall<AuthResponse>('/auth/signin', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },

  getSession: async (userId: string): Promise<{ user: AuthUser | null; profile: Profile | null }> => {
    return apiCall<{ user: AuthUser | null; profile: Profile | null }>(`/auth/session?userId=${userId}`);
  },

  changePassword: async (userId: string, oldPass: string, newPass: string): Promise<{ success: boolean; error?: string }> => {
    const response = await fetch(`${API_BASE_URL}/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': userId,
      },
      body: JSON.stringify({ oldPassword: oldPass, newPassword: newPass }),
    });

    const data = await response.json();
    if (!response.ok) {
      return { success: false, error: data.error || 'Change password failed' };
    }
    return { success: true };
  },

  updateUser: async (userId: string, data: { avatar?: string }) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : '';
    const res = await fetch(`${API_BASE_URL}/users/${userId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(data),
    });
    return res.json();
  },
};

export const forumApi = {
  getPosts: async (tab: string = 'recommend', page: number = 1): Promise<ForumPost[]> => {
    return apiCall<ForumPost[]>(`/forum/posts?tab=${tab}&page=${page}`);
  },

  getById: async (id: string): Promise<ForumPost> => {
    if (!id || id === 'undefined' || id === 'null') {
      return Promise.reject(new Error('Invalid post id'));
    }
    return apiCall<ForumPost>(`/forum/posts/${id}`);
  },

  addReply: async (postId: string, data: { content: string }) => {
    return apiCall<ForumReply>(`/forum/posts/${postId}/replies`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  create: async (data: { title: string; content: string; type: 'question' | 'article'; tags?: string[] }): Promise<ForumPost> => {
    return apiCall<ForumPost>('/forum/posts', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  getReplies: async (postId: string): Promise<ForumReply[]> => {
    if (!postId || postId === 'undefined' || postId === 'null') return [];
    return apiCall<ForumReply[]>(`/forum/posts/${postId}/replies`);
  },

  createReply: async (postId: string, content: string): Promise<ForumReply> => {
    return apiCall<ForumReply>(`/forum/posts/${postId}/replies`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
  },

  togglePostLike: async (postId: string): Promise<{ liked: boolean; votes: number }> => {
    return apiCall<{ liked: boolean; votes: number }>(`/forum/posts/${postId}/like`, {
      method: 'POST',
    });
  },

  toggleReplyLike: async (replyId: string): Promise<{ liked: boolean; votes: number; postId?: string }> => {
    return apiCall<{ liked: boolean; votes: number; postId?: string }>(`/forum/replies/${replyId}/like`, {
      method: 'POST',
    });
  },

  getReplyComments: async (replyId: string): Promise<ForumComment[]> => {
    if (!replyId || replyId === 'undefined' || replyId === 'null') return [];
    return apiCall<ForumComment[]>(`/forum/replies/${replyId}/comments`);
  },

  createReplyComment: async (
    replyId: string,
    data: { content: string; parentCommentId?: string | null }
  ): Promise<ForumComment> => {
    return apiCall<ForumComment>(`/forum/replies/${replyId}/comments`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  toggleCommentLike: async (commentId: string): Promise<{ liked: boolean; votes: number }> => {
    return apiCall<{ liked: boolean; votes: number }>(`/forum/comments/${commentId}/like`, {
      method: 'POST',
    });
  },
};
