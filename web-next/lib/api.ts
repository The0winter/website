import axios from 'axios';


const getBaseUrl = () => {
  // 1. 【浏览器端】 Client Side
  // 只要有 window 对象，说明是在用户的浏览器里运行
  if (typeof window !== 'undefined') {
    // 自动读取当前网址 (比如 https://jiutianxiaoshuo.com)
    return window.location.origin;
  }

  // 2. 【服务器端】 Server Side (SSR)
  // 这是解决 500 报错的关键！
  // 在服务器内部，直接走 127.0.0.1:5000 内部高速通道
  // 完全绕过 SSL 证书验证，也绕过 Nginx，速度最快且 100% 稳定
  return 'http://127.0.0.1:5000';
};

// 🔥 新增：论坛帖子类型
export interface ForumPost {
  id: string;
  title: string;
  excerpt?: string;   // 列表页用的摘要
  content?: string;   // 详情页用的内容
  // 后端返回的 author 在列表页是 string，在详情页是 object，这里做兼容
  author: string | { name: string; id: string; avatar?: string; bio?: string }; 
  authorId?: string;
  votes: number;      // 点赞数
  comments: number;   // 评论数
  tags: string[];
  isHot: boolean;
  type: 'question' | 'article';
  views?: number;
  created_at?: string;
}

// 🔥 新增：论坛回答类型
export interface ForumReply {
  id: string;
  content: string;
  votes: number;
  comments: number;
  time: string;
  author: {
    name: string;
    bio: string;
    avatar: string;
    id: string;
  };
}

// 导出最终地址 (一定要加 export！)
export const API_BASE_URL = `${getBaseUrl()}/api`;

export interface Profile {
  id: string;
  username: string;
  role: 'reader' | 'writer'| 'admin';
  created_at: string;
}

export interface Book {
  id: string;
  title: string;
  // 保持你原有的复杂类型，防止报错
  author_id?: string | { _id: string; id: string; username: string; email: string } | null;
  author?: string; // 作者名
  description: string;
  cover_image?: string;
  category?: string;
  status?: 'ongoing' | 'completed';
  
  // --- 🔥🔥🔥 新增/修改这部分开始 🔥🔥🔥 ---
  views?: number;         // 总点击
  weekly_views?: number;  // 周点击 (新增)
  monthly_views?: number; // 月点击 (新增)
  daily_views?: number;   // 日点击 (新增)
  rating?: number;        // 评分 (新增，例如 0-5.0)
  // --- 🔥🔥🔥 新增/修改这部分结束 🔥🔥🔥 ---

  updated_at?: string; 
  created_at?: string;
  profiles?: Profile;
}

export interface Chapter {
  id: string;
  // ✅ 修改 1: 对应后端的 bookId 字段
  bookId: string; 
  title: string;
  content: string;
  word_count?: number;
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


async function apiCall<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  // 1. 获取 UserID (你原有的逻辑)
  const userId = localStorage.getItem('novelhub_user');
  
  // 👇👇👇 2. 新增：获取 Token 👇👇👇
  const token = localStorage.getItem('token');

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
      // 原有的 user-id 头
      ...(userId ? { 'x-user-id': userId } : {}),
      
      // 👇👇👇 3. 新增：必须把 Token 带上，否则后端不认人！ 👇👇👇
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      
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

  // Create new chapter
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
  role: 'reader' | 'writer'| 'admin';
  token?: string;
  avatar?: string;
  // 如果还有其他字段比如 avatar 等，也可以加在这里
}

export interface AuthResponse {
  user: AuthUser;
  profile: Profile;
  token: string;  // 👈 加上这一行！告诉 TS 后端会返回 token
}

export const authApi = {
  // Sign up
  signUp: async (email: string, password: string, username: string, role: string, code: string): Promise<AuthResponse> => {
    return apiCall<AuthResponse>('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password, username, role, code }),
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

  // 修改密码
  changePassword: async (userId: string, oldPass: string, newPass: string): Promise<{ success: boolean; error?: string }> => {
    const response = await fetch(`${API_BASE_URL}/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': userId
      },
      body: JSON.stringify({ oldPassword: oldPass, newPassword: newPass }),
    });

    const data = await response.json();
    
    if (!response.ok) {
      return { success: false, error: data.error || '修改失败' };
    }
    
    return { success: true };
  }, // 👈 注意这里！changePassword 结束了，必须加逗号

  // ✅ 修正后的 updateUser：放在 changePassword 外面，并且变量名改对了
  updateUser: async (userId: string, data: { avatar?: string }) => {
    const token = localStorage.getItem('token');
    
    // 注意：这里用的是 API_BASE_URL，不是 API_URL
    const res = await fetch(`${API_BASE_URL}/users/${userId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(data),
    });
    
    return res.json();
  },

};

// 🔥 新增：论坛接口
export const forumApi = {
  // 1. 获取帖子列表 (支持 tab: 'recommend' | 'hot' | 'follow')
  getPosts: async (tab: string = 'recommend', page: number = 1): Promise<ForumPost[]> => {
    return apiCall<ForumPost[]>(`/forum/posts?tab=${tab}&page=${page}`);
  },

  // 2. 获取单个帖子详情
  getById: async (id: string): Promise<ForumPost> => {
    // 🛑 核心修复：如果是 undefined 字符串，直接报错或返回空，不发请求！
    if (!id || id === 'undefined' || id === 'null') {
        console.warn('🛑 拦截到无效 ID，阻止请求');
        return Promise.reject(new Error('无效的帖子ID'));
    }
    return apiCall<ForumPost>(`/forum/posts/${id}`);
  },

  addReply: async (postId: string, data: { content: string }) => {
    // 假设你的 axios 实例叫 api
    // 注意：这里一定要用 POST 方法，且 URL 要跟后端匹配
    const response = await axios.post(`/api/forum/posts/${postId}/replies`, data, {
    headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}` // 别忘了带 Token
    }
});
    return response.data;
},

  // 3. 发布帖子 (提问/文章)
  create: async (data: { title: string; content: string; type: 'question' | 'article'; tags?: string[] }): Promise<ForumPost> => {
    return apiCall<ForumPost>('/forum/posts', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // 4. 获取某个帖子的回复列表
  getReplies: async (postId: string): Promise<ForumReply[]> => {
    // 🛑 核心修复：同样拦截回复列表
    if (!postId || postId === 'undefined' || postId === 'null') {
        return []; // ID 不对直接返回空数组，页面就不会报错了
    }
    return apiCall<ForumReply[]>(`/forum/posts/${postId}/replies`);
  },

  // 5. 发布回复/回答
  createReply: async (postId: string, content: string): Promise<ForumReply> => {
    return apiCall<ForumReply>(`/forum/posts/${postId}/replies`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
  }
};

