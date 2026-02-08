'use client';
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { authApi, usersApi, Profile, AuthUser } from '../lib/api';

interface AuthContextType {
  user: AuthUser | null;
  profile: Profile | null;
  loading: boolean;
  
  // 注册相关的不用动（除非你注册后也想直接拿到token）
  signUp: (email: string, password: string, username: string, role: 'reader' | 'writer') => Promise<{ error: Error | null }>;
  register: (username: string, email: string, password: string) => Promise<{ error: Error | null }>;
  
  // 👇👇👇 重点修改这一行 👇👇👇
  signIn: (email: string, password: string) => Promise<{ 
      error: Error | null; 
      token?: string;      // ✅ 新增：告诉TS这里可能有token
      user?: AuthUser;     // ✅ 新增：告诉TS这里可能有user数据
  }>;
  
  logout: () => Promise<void>; 
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Helper functions for localStorage
const STORAGE_KEY = 'novelhub_user';

const saveUserToStorage = (userId: string) => {
  localStorage.setItem(STORAGE_KEY, userId);
};

const getUserFromStorage = (): string | null => {
  return localStorage.getItem(STORAGE_KEY);
};

const removeUserFromStorage = () => {
  localStorage.removeItem(STORAGE_KEY);
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const initAuth = async () => {
      const userId = getUserFromStorage();
      if (userId) {
        try {
          const { user: sessionUser, profile: sessionProfile } = await authApi.getSession(userId);
          if (sessionUser && sessionProfile) {
            setUser(sessionUser);
            setProfile(sessionProfile);
          } else {
            removeUserFromStorage();
          }
        } catch (error) {
          console.error('Error fetching session:', error);
          removeUserFromStorage();
        }
      }
      setLoading(false);
    };

    initAuth();
  }, []);

  // ... 上面是 useEffect 的结尾 (第67行) ...
  // initAuth();
  // }, []);

  // 👇👇👇 请把这段代码补在第 68 行的位置 👇👇👇

  const signUp = async (email: string, password: string, username: string, role: 'reader' | 'writer') => {
    try {
      const { user: newUser, profile: newProfile } = await authApi.signUp(email, password, username, role);
      setUser(newUser);
      setProfile(newProfile);
      // 这里的 saveUserToStorage 记得确保文件头部定义了或者导入了
      localStorage.setItem('novelhub_user', newUser.id); 
      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  };

  const register = async (username: string, email: string, password: string) => {
    // 复用上面的 signUp，默认角色是 reader
    return signUp(email, password, username, 'reader');
  };

  // 👆👆👆 补完结束 👆👆👆

  // const signIn = async ... (这里是你原本的第69行)

const signIn = async (email: string, password: string) => {
    try {
      // 👇 修改点 1：这里不仅要解构 user 和 profile，还要把 token 解构出来
      // 假设你的 authApi.signIn 返回的是后端整个 json：{ token, user, profile }
      const { user: sessionUser, profile: sessionProfile, token } = await authApi.signIn(email, password);

      // ... (中间获取完整用户信息的逻辑保持不变) ...
      
      try {
        const { user: fullUser, profile: fullProfile } = await authApi.getSession(sessionUser.id);
        if (fullUser && fullUser.username) {
           setUser(fullUser);
           setProfile(fullProfile);
           saveUserToStorage(fullUser.id);
           // 👇 修改点 2：这里成功返回时，必须带上 token
           return { error: null, token: token, user: fullUser }; 
        }
      } catch (e) {
        console.warn('获取完整信息失败，将使用基础登录信息');
      }

      // 3. 【保底逻辑】
      setUser(sessionUser);
      setProfile(sessionProfile);
      saveUserToStorage(sessionUser.id);
      
      // 👇 修改点 3：这里也必须带上 token
      return { error: null, token: token, user: sessionUser }; 

    } catch (error) {
      return { error: error as Error };
    }
};

  // ✅ 已修改：函数名改为 logout，为了匹配 Navbar 调用
  const logout = async () => {
    setUser(null);
    setProfile(null);
    removeUserFromStorage();
  };
  

  return (
    // ✅ 已修改：Value 中传入 logout
    <AuthContext.Provider value={{ user, profile, loading, signUp, signIn, logout, register}}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};