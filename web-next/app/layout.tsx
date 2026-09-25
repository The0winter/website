import type { Metadata, Viewport } from "next"; 
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/contexts/AuthContext";
import { ReadingSettingsProvider } from "@/contexts/ReadingSettingsContext"; 
import MobileSectionShells from "@/components/MobileSectionShells";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import BookPrefetchSession from "@/components/BookPrefetchSession";
import BookNavigation from "@/components/BookNavigation";
import LoginNavigation from "@/components/LoginNavigation";
import LibraryPrefetch from "@/components/LibraryPrefetch";
import {MobileWriterProvider} from "@/components/MobileWriterLaunch";
import { Suspense } from 'react';
import Script from 'next/script';

import { GoogleAnalytics } from '@next/third-parties/google';
import {siteDescription, siteOrigin, siteTitle} from '@/lib/seo';
import {siteThemeScript} from '@/lib/site-theme';

const inter = Inter({ subsets: ["latin"] });

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f9fafb" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin),
  robots:process.env.SITE_INDEXING==='enabled'?{index:true,follow:true}:{index:false,follow:false},
  title: siteTitle,
  description: siteDescription,
  
  // (可选) 补充关键词
  keywords: ["小说", "免费小说", "在线阅读", "热门小说", "九天小说站", "电子书"],

  icons: {
    icon: "/icon.png", 
    shortcut: "/icon.png",
    apple: "/apple-icon.png", // 针对 iPhone/iPad 添加到主屏幕的图标
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh" suppressHydrationWarning>
      <head><script id="site-theme-init" dangerouslySetInnerHTML={{__html: siteThemeScript}} /></head>
      <body className={inter.className}>
        <BookPrefetchSession />
        <BookNavigation />
        <Suspense fallback={null}><LoginNavigation /></Suspense>
        <AuthProvider>
          <MobileSectionShells />
          <LibraryPrefetch />
          {/* ✅ Provider 结构正确 */}
          <ReadingSettingsProvider>
            <MobileWriterProvider>
            
            <Navbar />
            
            {/* ✅ 修改点：增加了 dark:bg 和 transition，让搜索页等其他页面也能适配夜间模式 */}
            <main className="min-h-screen bg-gray-50 dark:bg-[#0a0a0a] transition-colors duration-300">
              {children}
            </main>
            
            <Footer />
            </MobileWriterProvider>

          </ReadingSettingsProvider>
        </AuthProvider>
        {process.env.NEXT_PUBLIC_ANALYTICS_ENABLED === 'enabled' && /^G-[A-Z0-9]+$/.test(process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID || '') && <GoogleAnalytics gaId={process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID!} />}
        {process.env.NEXT_PUBLIC_ANALYTICS_ENABLED === 'enabled' && <Script src="/traffic-observer.js" type="module" strategy="afterInteractive" />}
      </body>
    </html>
  );
}
