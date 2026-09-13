'use client';
import {createContext,useContext,useSyncExternalStore,type ReactNode} from 'react';
import {currentSiteTheme, serverSiteTheme, setSiteTheme, subscribeSiteTheme, type SiteTheme as Theme} from '@/lib/site-theme';
const ReadingSettingsContext=createContext<{theme:Theme;setTheme:(theme:Theme)=>void}|undefined>(undefined);
export function ReadingSettingsProvider({children}:{children:ReactNode}) {
 const theme=useSyncExternalStore(subscribeSiteTheme,currentSiteTheme,serverSiteTheme);
 return <ReadingSettingsContext.Provider value={{theme,setTheme:setSiteTheme}}>{children}</ReadingSettingsContext.Provider>;
}
export function useReadingSettings(){const context=useContext(ReadingSettingsContext);if(!context)throw new Error('ReadingSettingsProvider is required');return context;}
