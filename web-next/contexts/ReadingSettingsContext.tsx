'use client';
import {createContext,useContext,useEffect,type ReactNode} from 'react';
import {useStoredState} from '@/lib/useStoredState';
type Theme='light'|'dark';
const ReadingSettingsContext=createContext<{theme:Theme;setTheme:(theme:Theme)=>void}|undefined>(undefined);
export function ReadingSettingsProvider({children}:{children:ReactNode}) {
 const [theme,setTheme]=useStoredState<Theme>('novelhub_theme','light',v=>v==='light'||v==='dark');
 useEffect(()=>{document.documentElement.classList.toggle('dark',theme==='dark');},[theme]);
 return <ReadingSettingsContext.Provider value={{theme,setTheme}}>{children}</ReadingSettingsContext.Provider>;
}
export function useReadingSettings(){const context=useContext(ReadingSettingsContext);if(!context)throw new Error('ReadingSettingsProvider is required');return context;}
