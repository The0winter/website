import 'dotenv/config';
import mongoose from 'mongoose';
import puppeteer from 'puppeteer';
import readline from 'readline';
import dotenv from 'dotenv';
import Book from './models/Book.js';
import Chapter from './models/Chapter.js';

dotenv.config();

// ⚠️ 请确认你的数据库连接
const DB_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/novel-site'; 
const BASE_URL = 'https://www.69shuba.com';

mongoose.connect(DB_URI)
  .then(() => console.log('✅ 数据库连接成功'))
  .catch(err => console.error('数据库连接失败:', err));

// --- 浏览器配置 (已改为静默模式) ---
async function startBrowser() {
  return await puppeteer.launch({
    // 🔥 改动1：'new' 表示后台运行，不弹窗！
    headless: "new", 
    args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled' // 稍微隐藏一下爬虫特征
    ]
  });
}

// 1. 智能搜索 (支持 ID 直达)
async function getBookUrl(browser, input) {
  // 🔥 改动2：如果输入的是纯数字 (例如 85122)，直接拼接网址，跳过搜索！
  if (/^\d+$/.test(input)) {
      const directUrl = `${BASE_URL}/txt/${input}/`;
      console.log(`🎯 检测到书籍ID，直接跳转：${directUrl}`);
      return directUrl;
  }

  // 如果输入的是中文，才去尝试搜索 (搜索功能不稳定，不推荐)
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  
  console.log(`🔍 正在站内搜索：${input}...`);
  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    const searchInput = await page.$('input[name="searchkey"]') || await page.$('.search_text');
    if (!searchInput) throw new Error("搜索框加载失败");
    
    await searchInput.type(input);
    await page.keyboard.press('Enter');
    await page.waitForNavigation({ waitUntil: 'domcontentloaded' });

    // 尝试获取结果
    const firstResult = await page.$('.newbox h3 a, .bookname a'); 
    if (firstResult) {
        const href = await page.evaluate(el => el.href, firstResult);
        return href.replace('/book/', '/txt/'); // 强制转目录页
    } 
    // 有时会直接跳转
    if (page.url().includes('/txt/')) return page.url();
    
    console.log("❌ 站内搜索未找到，建议直接输入书籍ID");
    return null;
  } catch (e) {
    console.error("❌ 搜索出错 (可能是反爬虫)，请尝试输入ID:", e.message);
    return null;
  } finally {
    await page.close();
  }
}

// 2. 爬取并入库 (核心逻辑)
async function processBook(browser, sourceUrl) {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    console.log(`🔗 正在连接：${sourceUrl}`);
    await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // A. 抓取元数据
    const bookMeta = await page.evaluate(() => {
        return {
            title: document.querySelector('h1')?.innerText.trim() || '未知书籍',
            author: document.querySelector('.booknav2 p')?.innerText.split('：')[1]?.trim() || '未知',
            category: document.querySelector('.booknav2 p:nth-child(2)')?.innerText.split('：')[1]?.trim() || '修真', 
            cover_image: document.querySelector('.bookimg2 img')?.src || '',
            chapters: Array.from(document.querySelectorAll('#catalog ul li a')).map(a => ({
                title: a.innerText.trim(),
                link: a.href
            }))
        };
    });

    console.log(`📖 识别到：《${bookMeta.title}》，全书共 ${bookMeta.chapters.length} 章`);

    // B. 存/取 Book 表
    let book = await Book.findOne({ title: bookMeta.title });
    if (!book) {
        book = await Book.create({
            title: bookMeta.title,
            description: `作者：${bookMeta.author}`,
            cover_image: bookMeta.cover_image,
            category: bookMeta.category,
            status: 'ongoing',
            sourceUrl: sourceUrl
        });
        console.log(`✨ 新书入库成功！ID: ${book._id}`);
    } else {
        // 更新 URL，方便以后追更
        book.sourceUrl = sourceUrl;
        await book.save();
        console.log(`🔄 旧书记录已更新`);
    }

    // C. 检查进度
    const existingCount = await Chapter.countDocuments({ book_id: book._id });
    console.log(`📊 本地已有 ${existingCount} 章`);

    if (existingCount >= bookMeta.chapters.length) {
        console.log("✅ 已经是最新章节，无需更新。");
        await page.close();
        return;
    }

    const newChaptersList = bookMeta.chapters.slice(existingCount);
    console.log(`🚀 发现 ${newChaptersList.length} 个新章节，后台静默下载中...`);

    // D. 循环下载
    for (let i = 0; i < newChaptersList.length; i++) {
        const chapInfo = newChaptersList[i];
        const currentChapterNum = existingCount + i + 1;

        try {
            await page.goto(chapInfo.link, { waitUntil: 'domcontentloaded' });
            
            const content = await page.evaluate(() => {
                const el = document.querySelector('.txtnav') || document.querySelector('#content');
                if (!el) return '';
                return el.innerText
                    .replace(/69书吧/g, '')
                    .replace(/www\.69shuba\.com/g, '')
                    .trim();
            });

            if (content.length > 50) {
                await Chapter.create({
                    book_id: book._id,
                    title: chapInfo.title,
                    content: content,
                    chapter_number: currentChapterNum
                });
                // 简洁进度条
                process.stdout.write(`✅ [${i+1}/${newChaptersList.length}] 已存入: ${chapInfo.title.substring(0, 15)}... \r`);
            }
            
            // 稍作等待，防止后台跑太快被封
            await new Promise(r => setTimeout(r, 200));

        } catch (err) {
            console.error(`\n❌ 章节获取失败: ${chapInfo.title}`);
        }
    }

    // 更新最后更新时间
    book.lastUpdated = new Date();
    await book.save();

    console.log(`\n🎉 全部完成！`);
    await page.close();
}

// --- 简易主程序 ---

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (query) => new Promise(resolve => rl.question(query, resolve));

async function main() {
  const browser = await startBrowser();

  console.log('\n=============================');
  console.log('📚 无头爬虫管理器 (Headless Mode)');
  console.log('1. 📥 下载书籍 (支持 输入ID 或 书名)');
  console.log('2. 🔄 一键更新库内所有书');
  console.log('=============================');

  const answer = await ask('请输入数字 (1 或 2): ');

  if (answer.trim() === '1') {
      console.log('\n💡 提示：输入数字ID最准确 (例如: 85122)，输入书名可能会失败。');
      const input = await ask('请输入 书名 或 ID: ');
      
      const url = await getBookUrl(browser, input.trim());
      if (url) {
          await processBook(browser, url);
      }
  } else if (answer.trim() === '2') {
      console.log('🔄 开始后台巡检所有书籍...');
      const books = await Book.find({});
      for (const book of books) {
          if (book.sourceUrl) {
              await processBook(browser, book.sourceUrl);
          }
      }
  } else {
      console.log('❌ 无效输入');
  }

  rl.close();
  await browser.close();
  process.exit(0);
}

main();