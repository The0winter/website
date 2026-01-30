'use client';
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { authApi, usersApi, Profile, AuthUser } from '../lib/api';

interface AuthContextType {
  user: AuthUser | null;
  profile: Profile | null;
  loading: boolean;
  signUp: (email: string, password: string, username: string, role: 'reader' | 'writer') => Promise<{ error: Error | null }>;
  register: (username: string, email: string, password: string) => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  logout: () => Promise<void>; // ✅ 已修改：重命名 logout -> logout
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
      const { user: sessionUser, profile: sessionProfile } = await authApi.signIn(email, password);
      setUser(sessionUser);
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