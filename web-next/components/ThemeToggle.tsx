'use client';

import {Moon, Sun} from 'lucide-react';
import {useReadingSettings} from '@/contexts/ReadingSettingsContext';

export default function ThemeToggle() {
  const {theme, setTheme} = useReadingSettings();
  const label = theme === 'dark' ? '当前夜间模式，切换到日间模式' : '当前日间模式，切换到夜间模式';
  return <button type="button" className="site-theme-toggle" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
    aria-label={label} title={label} aria-pressed={theme === 'dark'}>
    <Sun className="site-theme-sun" size={21} aria-hidden="true"/>
    <Moon className="site-theme-moon" size={21} aria-hidden="true"/>
  </button>;
}
