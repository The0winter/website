import { MetadataRoute } from 'next'
 
export default function robots(): MetadataRoute.Robots {
  const baseUrl = 'https://jiutianxiaoshuo.com'; // 替换成你的真实域名

  return {
    rules: {
      userAgent: '*', // 针对所有爬虫（Google, 百度, Bing）
      allow: '/',     // 允许访问所有页面
      disallow: '/admin/', // 不允许访问后台管理页（如果有的话）
    },
    // 🔥 最关键的一行：告诉爬虫地图在哪里
    sitemap: `${baseUrl}/sitemap.xml`, 
  }
}