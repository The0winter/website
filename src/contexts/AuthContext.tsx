import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { authApi, usersApi, Profile, AuthUser } from '../lib/api';

interface AuthContextType {
  user: AuthUser | null;
  profile: Profile | null;
  loading: boolean;
  signUp: (email: string, password: string, username: string, role: 'reader' | 'writer') => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
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

  const logout = async () => {
    setUser(null);
    setProfile(null);
    removeUserFromStorage();
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, signUp, signIn, logout }}>
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
