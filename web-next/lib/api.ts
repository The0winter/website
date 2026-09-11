import { catalogPages, type CatalogOptions } from './request';
import { safeFetch as fetch } from '@/lib/request';
import { getApiBaseUrl } from '@/utils/api';
import type {ProfileTheme} from './profile-themes';
export const API_BASE_URL = getApiBaseUrl();

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
  profileTheme?: ProfileTheme;
  avatar?: string;
  id: string;
  username: string;
  role: 'reader' | 'admin';
  created_at: string;
}

export interface Book {
  writeVersion?:number;
  lastUpdated?:string;
  coverImage?:string;
  updatedAt?:string;
  createdAt?:string;
  numReviews?:number;
  id: string;
  title: string;
  author_id?: string | { _id: string; id: string; username: string; email: string } | null;
  author?: string;
  description: string;
  cover_image?: string;
  category?: string;
  status?: 'ongoing' | 'completed' | '连载' | '完结';
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
  previousId?: string | null;
  nextId?: string | null;
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
  bookId: string | (Book & {_id?:string}) | null;
  updated_at?: string;
  created_at?: string;
}

export interface AuthUser {
  profileTheme?: ProfileTheme;
  _id?:string;
  id: string;
  email: string;
  username: string;
  role: 'reader' | 'admin';

  avatar?: string;
}

export interface AuthResponse {
  user: AuthUser;
  profile: Profile;

}

async function apiCall<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const userId = typeof window !== 'undefined' ? localStorage.getItem('novelhub_user') : null;
  

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

export const booksApi = {
  getAll: async (options?: { orderBy?: string; order?: 'asc' | 'desc'; limit?: number; page?: number; q?: string; category?: string }): Promise<Book[]> => {
    const params = new URLSearchParams();
    if (options?.page) params.append('page',String(options.page));
    if (options?.q) params.append('q',options.q);
    if (options?.category) params.append('category',options.category);
    if (options?.orderBy) params.append('orderBy', options.orderBy);
    if (options?.order) params.append('order', options.order);
    if (options?.limit) params.append('limit', options.limit.toString());
    const query = params.toString();
    return apiCall<Book[]>(`/books${query ? `?${query}` : ''}`);
  },

  getById: async (id: string): Promise<Book | null> => {
    return apiCall<Book | null>(`/books/${id}`);
  },

  getMyBooks: async (authorId?: string, page = 1): Promise<Book[]> => {
    const targetId = authorId || (typeof window !== 'undefined' ? localStorage.getItem('novelhub_user') : null);
    if (!targetId) return [];
    return apiCall<Book[]>(`/books?author_id=${encodeURIComponent(targetId)}&limit=20&page=${page}&orderBy=updatedAt`);
  },

  delete: async (id: string): Promise<void> => {
    await apiCall<void>(`/books/${id}`, { method: 'DELETE' });
  },

  create: async (book: Omit<Book, 'id' | 'created_at'>, idempotencyKey=crypto.randomUUID()): Promise<Book> => {
    return apiCall<Book>('/books', {
      method: 'POST',
      headers: {'Content-Type':'application/json','Idempotency-Key':idempotencyKey},
      body: JSON.stringify({title:book.title,description:book.description,cover_image:book.cover_image,category:book.category,status:book.status}),
    });
  },

  update: async (id: string, updates: Partial<Book>): Promise<Book> => {
    return apiCall<Book>(`/books/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  },

  incrementViews: async (id: string, chapterId: string): Promise<Book> => {
    return apiCall<Book>(`/books/${id}/views`, { method: 'POST', body: JSON.stringify({chapterId}) });
  },
};

export const chaptersApi = {
  getByBookId: async (bookId: string, options?: CatalogOptions<Chapter>): Promise<Chapter[]> => {
    return catalogPages<Chapter>(`${API_BASE_URL}/books/${bookId}/chapters`, options);
  },

  getById: async (chapterId: string): Promise<Chapter | null> => {
    return apiCall<Chapter | null>(`/chapters/${chapterId}`);
  },

  update: async (id: string, chapter: Partial<Chapter>): Promise<Chapter> => {
    return apiCall<Chapter>(`/chapters/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({title:chapter.title,content:chapter.content,chapter_number:chapter.chapter_number}),
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
  logout: () => apiCall('/auth/logout', { method: 'POST' }),
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

  getSession: async (_userId?: string): Promise<{ user: AuthUser | null; profile: Profile | null }> => {
    const response=await fetch(API_BASE_URL+'/auth/session',{cache:'no-store'});
    if(response.status===401 || response.status===403)return {user:null,profile:null};
    if(!response.ok)throw new Error('账户服务暂不可用');
    return response.json();
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

  updateUser: async (userId: string, data: { avatar?: string; profileTheme?: ProfileTheme }): Promise<{success?: boolean; user?: Profile; error?: string}> => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : '';
    const res = await fetch(`${API_BASE_URL}/users/${userId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(data),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || '资料保存失败，请稍后重试');
    return result;
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

  create: async (data: { title: string; content: string; type: 'question' | 'article'; tags?: string[]; bookId?: string }): Promise<ForumPost> => {
    return apiCall<ForumPost>('/forum/posts', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  getReplies: async (postId: string, page=1): Promise<ForumReply[]> => {
    if (!postId || postId === 'undefined' || postId === 'null') return [];
    return apiCall<ForumReply[]>(`/forum/posts/${postId}/replies?page=${page}&limit=20`);
  },
  getReply: async(postId:string,replyId:string):Promise<ForumReply|null>=>{
    const rows=await apiCall<ForumReply[]>(`/forum/posts/${postId}/replies?target=${encodeURIComponent(replyId)}`);return rows[0]||null;
  },

  createReply: async (postId: string, content: string): Promise<ForumReply> => {
    return apiCall<ForumReply>(`/forum/posts/${postId}/replies`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
  },

  togglePostLike: async (postId: string, liked: boolean): Promise<{ liked: boolean; votes: number }> => {
    return apiCall<{ liked: boolean; votes: number }>(`/forum/posts/${postId}/like`, {
      method: 'POST',
      body: JSON.stringify({liked}),
    });
  },

  toggleReplyLike: async (replyId: string, liked: boolean): Promise<{ liked: boolean; votes: number; postId?: string }> => {
    return apiCall<{ liked: boolean; votes: number; postId?: string }>(`/forum/replies/${replyId}/like`, {
      method: 'POST',
      body: JSON.stringify({liked}),
    });
  },

  getReplyComments: async (replyId: string, page=1): Promise<ForumComment[]> => {
    if (!replyId || replyId === 'undefined' || replyId === 'null') return [];
    return apiCall<ForumComment[]>(`/forum/replies/${replyId}/comments?page=${page}&limit=100`);
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

  toggleCommentLike: async (commentId: string, liked: boolean): Promise<{ liked: boolean; votes: number }> => {
    return apiCall<{ liked: boolean; votes: number }>(`/forum/comments/${commentId}/like`, {
      method: 'POST',
      body: JSON.stringify({liked}),
    });
  },
};
