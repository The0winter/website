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

  const signUp = async (email: string, password: string, username: string, role: 'reader' | 'writer') => {
    try {
      const { user: newUser, profile: newProfile } = await authApi.signUp(email, password, username, role);
      setUser(newUser);
      setProfile(newProfile);
      saveUserToStorage(newUser.id);
      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  };

  const register = async (username: string, email: string, password: string) => {
    // 这里我们自动补上 'reader' 作为默认角色，因为你的注册页面没有选角色的地方
    // 注意这里调用 signUp 时，参数顺序调整为了正确的顺序 (email, password, username, role)
    return signUp(email, password, username, 'reader');
  };

const signIn = async (email: string, password: string) => {
    try {
      // 1. 【原有逻辑】先执行登录，拿到基础信息
      const { user: sessionUser, profile: sessionProfile } = await authApi.signIn(email, password);

      // 2. 【新增补丁】为了解决“名字不显示”的 Bug，我们立刻用 ID 去拉取一次完整信息
      // 只要这一步成功，我们就用新的完整数据；如果失败，也不会报错，继续用上面的 sessionUser
      try {
        const { user: fullUser, profile: fullProfile } = await authApi.getSession(sessionUser.id);
        
        // 如果成功拿到了带 username 的完整用户
        if (fullUser && fullUser.username) {
           setUser(fullUser); // ✅ 存入完整数据 (带名字)
           setProfile(fullProfile);
           saveUserToStorage(fullUser.id);
           return { error: null }; // 🎉 完美结束
        }
      } catch (e) {
        console.warn('获取完整信息失败，将使用基础登录信息');
      }

      // 3. 【保底逻辑】如果上面的补丁没跑通，依然执行你原来的逻辑，保证登录功能绝不会坏
      setUser(sessionUser); // ⚠️ 虽然这里 username 可能是空的，但至少能登录进去
      setProfile(sessionProfile);
      saveUserToStorage(sessionUser.id);
      return { error: null };

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