import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ✅ 1. 已修正为你指定的 /book/ 页面
const BOOK_INDEX_URL = 'https://www.69shuba.com/book/85122/'; 

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function startScrape() {
  console.log('🚀 启动浏览器...');
  
  const browser = await puppeteer.launch({
    headless: false, // 设为 false，方便你盯着看
    defaultViewport: null,
    args: ['--start-maximized'] 
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  console.log(`🔗 正在打开：${BOOK_INDEX_URL}`);
  
  try {
    await page.goto(BOOK_INDEX_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (e) {
    console.error('❌ 页面加载超时，请检查网络或是否需要手动过验证码。');
  }

  // --- 🕵️‍♂️ 暴力搜寻章节 ---
  const bookData = await page.evaluate(() => {
    // 1. 获取书名
    const title = document.querySelector('h1')?.innerText.trim() || 
                  document.querySelector('.booknav2 h1 a')?.innerText.trim() || 
                  '没钱修什么仙？';
    
    // 2. 获取页面上所有的链接
    const allLinks = Array.from(document.querySelectorAll('a'));
    
    // 3. 过滤出章节链接 (不依赖 div 结构，只看文字长得像不像章节)
    const chapters = allLinks
      .filter(a => {
        const text = a.innerText.trim();
        const href = a.href;
        
        // 排除空链接和无效链接
        if (!href || href.includes('javascript') || href === '') return false;

        // 排除导航栏链接 (首页、分类、登录等)
        if (text.includes('登录') || text.includes('注册') || text.includes('首页')) return false;

        // ✅ 核心判断：文字里必须包含“第”和“章”，或者包含数字且看起来像标题
        // 比如 "第1章 面试" 或者 "123. 章节名"
        const isChapterName = /第.+章/.test(text) || (/^\d+/.test(text) && text.length > 2);
        
        // 双重保险：链接里通常包含数字ID
        const isChapterLink = /\/\d+/.test(href);

        return isChapterName && isChapterLink;
      })
      .map(a => ({
        title: a.innerText.trim(),
        link: a.href
      }));

    // 4. 去重 (因为有些网页会有“最新章节”和“目录”两个区域，导致重复)
    const uniqueChapters = [];
    const seenLinks = new Set();
    for (const chap of chapters) {
      if (!seenLinks.has(chap.link)) {
        seenLinks.add(chap.link);
        uniqueChapters.push(chap);
      }
    }

    return { title, chapters: uniqueChapters };
  });

  console.log(`📖 书名：《${bookData.title}》`);
  console.log(`📚 共发现 ${bookData.chapters.length} 个章节。`);

  // 🔴 调试信息：如果还是0，这一步会告诉你网页里到底看到了什么
  if (bookData.chapters.length === 0) {
      console.error("❌ 依然为 0！正在保存当前页面截图，请检查...");
      await page.screenshot({ path: path.join(__dirname, 'error_debug.png') });
      console.log("📸 已保存截图至 server/error_debug.png，请查看截图是否是验证码页面。");
      // 不退出，防止浏览器直接关闭
  } else {
      console.log(`✅ 准备开始下载前 5 章测试...`);
  }

  // --- 📥 下载逻辑 ---
  const finalBookData = { title: bookData.title, author: '未知', chapters: [] };
  // ⚠️ 这里先只爬 10 章，确认成功了再改成全本！
  //const chaptersToScrape = bookData.chapters.slice(0, 10); 
  const chaptersToScrape = bookData.chapters;
  // 如果要爬全本，把上面那行换成： const chaptersToScrape = bookData.chapters;

  for (let i = 0; i < chaptersToScrape.length; i++) {
    const chapter = chaptersToScrape[i];
    console.log(`⏳ [${i+1}/${chaptersToScrape.length}] 正在下载：${chapter.title}`);

    try {
      await page.goto(chapter.link, { waitUntil: 'domcontentloaded', timeout: 30000 });
      
      const content = await page.evaluate(() => {
        // 尝试获取正文，如果之前的 .txtnav 不对，这里加了更多备选
        const container = document.querySelector('.txtnav') || 
                          document.querySelector('#content') || 
                          document.querySelector('.read_chapter_detail') ||
                          document.querySelector('.mybox'); // 有时候会在 mybox 里
        
        if (!container) return '';
        
        return container.innerText
          .replace(/69书吧/g, '')
          .replace(/www\.69shuba\.com/g, '')
          .replace(/作者说：.*/g, '')
          .trim();
      });

      if (content.length > 20) {
        finalBookData.chapters.push({ title: chapter.title, content });
      }
      
      await sleep(500); 

    } catch (err) {
      console.error(`❌ 跳过: ${chapter.title}`);
    }
  }

  // 保存
  const outputDir = path.join(__dirname, 'data');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);
  const filePath = path.join(outputDir, `${bookData.title}_book_page.json`);
  fs.writeFileSync(filePath, JSON.stringify(finalBookData, null, 2));
  
  console.log(`✅ 完成！文件已保存至: ${filePath}`);
  // await browser.close(); // 暂时不自动关闭，方便你检查
}

startScrape();