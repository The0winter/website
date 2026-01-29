import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

type FontSize = 'small' | 'medium' | 'large';
type Theme = 'light' | 'dark' | 'sepia';

interface ReadingSettings {
  fontSize: FontSize;
  theme: Theme;
}

interface ReadingSettingsContextType extends ReadingSettings {
  setFontSize: (size: FontSize) => void;
  setTheme: (theme: Theme) => void;
}

const ReadingSettingsContext = createContext<ReadingSettingsContextType | undefined>(undefined);

export const ReadingSettingsProvider = ({ children }: { children: ReactNode }) => {
  const [fontSize, setFontSizeState] = useState<FontSize>(() => {
    const saved = localStorage.getItem('readingFontSize');
    return (saved as FontSize) || 'medium';
  });

  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem('readingTheme');
    return (saved as Theme) || 'light';
  });

  useEffect(() => {
    localStorage.setItem('readingFontSize', fontSize);
  }, [fontSize]);

  useEffect(() => {
    localStorage.setItem('readingTheme', theme);
  }, [theme]);

  const setFontSize = (size: FontSize) => {
    setFontSizeState(size);
  };

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
  };

  return (
    <ReadingSettingsContext.Provider value={{ fontSize, theme, setFontSize, setTheme }}>
      {children}
    </ReadingSettingsContext.Provider>
  );
};

export const useReadingSettings = () => {
  const context = useContext(ReadingSettingsContext);
  if (context === undefined) {
    throw new Error('useReadingSettings must be used within a ReadingSettingsProvider');
  }
  return context;
};
