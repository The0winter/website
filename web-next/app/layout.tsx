import type { Metadata, Viewport } from "next"; 
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/contexts/AuthContext";
import { ReadingSettingsProvider } from "@/contexts/ReadingSettingsContext"; 
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

import { GoogleAnalytics } from '@next/third-parties/google';

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
  // 🔥 修改 1：标题加长，包含核心关键词（小说、免费、玄幻等）
  title: "九天小说 - 热门小说 - 无弹窗 - 免费在线阅读 - 笔趣阁",
  
  // 🔥 修改 2：描述改为面向用户的自然语言，包含吸引点击的词汇
  description: "九天小说网为您提供最新最全的玄幻、都市、言情、修真、历史等热门小说在线阅读。每日更新，拒绝书荒，永久免费！精选榜单助你发现好书。",
  
  // (可选) 补充关键词
  keywords: ["小说", "免费小说", "在线阅读", "热门小说", "九天小说", "电子书"],

  icons: {
    icon: "/icon.jpg", 
    shortcut: "/icon.jpg",
    apple: "/apple-icon.png", // 针对 iPhone/iPad 添加到主屏幕的图标
  },
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