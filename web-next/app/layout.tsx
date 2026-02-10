import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/contexts/AuthContext";
import { ReadingSettingsProvider } from "@/contexts/ReadingSettingsContext"; 
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

import { GoogleAnalytics } from '@next/third-parties/google';

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "九天小说",
  description: "基于 MERN Stack 的小说阅读平台",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh">
      <body className={inter.className}>
        <AuthProvider>
          {/* ✅ Provider 结构正确 */}
          <ReadingSettingsProvider>
            
            <Navbar />
            
            {/* ✅ 修改点：增加了 dark:bg 和 transition，让搜索页等其他页面也能适配夜间模式 */}
            <main className="min-h-screen bg-gray-50 dark:bg-[#0a0a0a] transition-colors duration-300">
              {children}
            </main>
            
            <Footer />

          </ReadingSettingsProvider>
        </AuthProvider>
        <GoogleAnalytics gaId="G-DWMPP2NRQ1" />
      </body>
    </html>
  );
}