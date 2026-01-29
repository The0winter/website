'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

type Theme = 'light' | 'dark';

interface ReadingSettingsContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ReadingSettingsContext = createContext<ReadingSettingsContextType | undefined>(undefined);

export function ReadingSettingsProvider({ children }: { children: ReactNode }) {
  // 默认为 light，防止服务器端渲染时没有值
  const [theme, setThemeState] = useState<Theme>('light');
  
  // 这里的 mounted 仅用于确保我们在客户端才执行 localStorage 读取
  // 但我们不能因此就不渲染 Provider！
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // 读取本地存储
    const savedTheme = localStorage.getItem('novelhub_theme') as Theme;
    if (savedTheme && (savedTheme === 'light' || savedTheme === 'dark')) {
      setThemeState(savedTheme);
      // 同步 DOM
      if (savedTheme === 'dark') {
        document.documentElement.classList.add('dark');
      }
    }
  }, []);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    localStorage.setItem('novelhub_theme', t);
    
    if (t === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  // ✅ 修复点：移除了原本在这里的 if (!mounted) return children;
  // 现在无论是否 mounted，Provider 始终包裹着 children
  // 这样 Navbar 在第一帧渲染时也能找到 Context，不会报错
  return (
    <ReadingSettingsContext.Provider value={{ theme, setTheme }}>
      {/* 为了防止闪烁（服务端渲染是light，客户端变成dark），
        我们可以在未加载完成时先隐藏内容，或者为了性能接受那一瞬间的闪烁。
        这里我们选择直接渲染，保证 Provider 存在。
      */}
      {children} 
    </ReadingSettingsContext.Provider>
  );
}

export function useReadingSettings() {
  const context = useContext(ReadingSettingsContext);
  if (context === undefined) {
    throw new Error('useReadingSettings must be used within a ReadingSettingsProvider');
  }
  return context;
}