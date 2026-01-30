//import puppeteer from 'puppeteer';
import Book from '../models/Book.js';       
import Chapter from '../models/Chapter.js';

// 辅助函数：睡眠
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 核心爬虫函数：智能单线程稳定版
 * 特点：不并发、智能等待正文加载、随机延迟防封
 */
export const scrapeAndSaveBook = async (bookIndexUrl, customBookId) => {
    // 2. 在需要用到的时候再加载，并加上 try-catch 防止生产环境误触发崩溃
    let puppeteer;
    try {
        // 动态导入
        puppeteer = (await import('puppeteer')).default; 
    } catch (error) {
        console.log("当前环境未安装 Puppeteer，跳过爬虫逻辑");
        return; // 如果在服务器上误调用了此函数，直接返回，不报错
    }

    console.log(`🚀 [爬虫服务] 启动... ${bookIndexUrl}`);

    // 1. 启动浏览器
    // headless: false 方便你调试和手动过验证码（如果出现的话）
    const browser = await puppeteer.launch({
        headless: false, 
        defaultViewport: null,
        args: ['--start-maximized'] 
    });

    try {
        const page = await browser.newPage();
        
        // 伪装 User-Agent，防止被轻易识别为脚本
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        // --- 第一阶段：获取书籍目录 ---
        console.log(`🔗 正在获取目录...`);
        // 超时时间设长一点 (60s)，防止网络波动
        await page.goto(bookIndexUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

        const bookData = await page.evaluate(() => {
            // 获取书名 (兼容多种页面结构)
            const title = document.querySelector('h1')?.innerText.trim() || 
                          document.querySelector('.booknav2 h1 a')?.innerText.trim() || 
                          '未知书籍';
            
            // 获取所有链接并筛选章节
            const allLinks = Array.from(document.querySelectorAll('a'));
            
            const chapters = allLinks.filter(a => {
                const text = a.innerText.trim();
                const href = a.href;
                
                // 排除无效链接
                if (!href || href.includes('javascript') || href === '') return false;
                // 排除导航链接
                if (text.includes('登录') || text.includes('注册') || text.includes('首页')) return false;

                // 正则匹配：必须像一个章节名 (比如包含"第x章"或数字开头)
                const isChapterName = /第.+章/.test(text) || (/^\d+/.test(text) && text.length > 2);
                const isChapterLink = /\/\d+/.test(href); // 链接里通常会有数字ID
                
                return isChapterName && isChapterLink;
            }).map(a => ({
                title: a.innerText.trim(),
                link: a.href
            }));

            // 链接去重
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

        console.log(`📖 书名: 《${bookData.title}》，共发现 ${bookData.chapters.length} 章`);

        if (bookData.chapters.length === 0) {
            throw new Error("❌ 未抓取到章节，请检查链接或手动处理验证码");
        }

        // --- 第二阶段：存储/更新书籍信息 (Book Model) ---
        let book = await Book.findOne({ title: bookData.title });
        // 使用传入的 customBookId 或者自动生成一个
        const finalBookId = customBookId || 'auto_' + Date.now();

        if (!book) {
            book = await Book.create({
                title: bookData.title,
                bookId: finalBookId, 
                author: '未知', 
                chapterCount: bookData.chapters.length
            });
            console.log(`🎉 新书创建成功: ${book.title} (ID: ${finalBookId})`);
        } else {
            // 如果书已存在，更新章节数
            book.chapterCount = bookData.chapters.length;
            await book.save();
        }

        // --- 第三阶段：逐章爬取 (核心循环) ---
        const chaptersToScrape = bookData.chapters;

        for (let i = 0; i < chaptersToScrape.length; i++) {
            const chap = chaptersToScrape[i];

            // 1. 【断点续传】查库：如果数据库里已经有这章了，直接跳过
            // 注意：这里使用 book._id (MongoDB的_id) 来关联
            const exist = await Chapter.exists({ bookId: book._id, title: chap.title });
            if (exist) {
                console.log(`✅ [${i+1}/${chaptersToScrape.length}] 跳过已存在: ${chap.title}`);
                continue;
            }

            // 2. 开始爬取单章
            let attempts = 0;
            let success = false;

            while (attempts < 3 && !success) {
                try {
                    attempts++;
                    // 如果是重试，多休息一会儿 (3秒)
                    if (attempts > 1) {
                        console.log(`⏳ 重试等待中...`);
                        await sleep(3000);
                    }

                    // 访问章节页面
                    await page.goto(chap.link, { waitUntil: 'domcontentloaded', timeout: 30000 });

                    // 🔥 【核心优化】智能等待 🔥
                    // 不要死等 sleep，而是等待正文元素出现。
                    // 这样网速快时瞬间完成，网速慢时最长等10秒，既快又稳。
                    try {
                        await page.waitForSelector('.txtnav, #content, .read_chapter_detail, .mybox', { timeout: 10000 });
                    } catch (e) {
                        throw new Error("等待正文元素超时");
                    }
                    
                    // 提取正文内容
                    const content = await page.evaluate(() => {
                        const container = document.querySelector('.txtnav') || 
                                          document.querySelector('#content') || 
                                          document.querySelector('.read_chapter_detail') ||
                                          document.querySelector('.mybox');
                        if (!container) return '';
                        
                        // 清理广告文字
                        return container.innerText
                            .replace(/69书吧/g, '')
                            .replace(/www\.69shuba\.com/g, '')
                            .replace(/作者说：.*/g, '')
                            .trim();
                    });

                    // 校验内容长度 (大于50字才算成功)
                    if (content && content.length > 50) {
                        await Chapter.create({
                            bookId: book._id, // 关联到书的 _id
                            title: chap.title,
                            content: content,
                            chapter_number: i + 1 // 章节号
                        });
                        console.log(`💾 [${i+1}/${chaptersToScrape.length}] 入库: ${chap.title}`);
                        success = true;
                    } else {
                        throw new Error("抓取内容过短或为空");
                    }

                } catch (err) {
                    console.error(`⚠️ [第${attempts}次失败] ${chap.title}: ${err.message}`);
                }
            }

            if (!success) {
                console.error(`❌ 彻底放弃: ${chap.title} (请检查链接或反爬)`);
            }

            // 🐢 【防封关键】随机等待
            // 每爬完一章，休息 1.5秒 ~ 3.5秒
            // 模拟人类正常的翻页阅读速度，这是防止被封IP最有效的手段
            const randomSleep = Math.floor(Math.random() * 2000) + 1500;
            await sleep(randomSleep);
        }

        return { success: true, message: `书籍《${bookData.title}》更新完成`, bookId: book._id };

    } catch (error) {
        console.error('❌ 爬虫服务出错:', error);
        throw error;
    } finally {
        // 任务结束后关闭浏览器
        if (browser) await browser.close();
    }
};