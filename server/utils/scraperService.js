// server/utils/scraperService.js

// 1. 引入必要的模型和库
import mongoose from 'mongoose'; // 用于生成 ObjectId 字符串
import Book from '../models/Book.js';       
import Chapter from '../models/Chapter.js';
import User from '../models/User.js'; // 新增：引入 User 模型

// 辅助函数：睡眠
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 辅助函数：确保作者用户存在
 * 逻辑：有则返回该用户，无则自动创建
 */
async function ensureAuthorExists(authorName) {
    // 过滤掉无效作者名
    if (!authorName || authorName === '未知') {
        return null;
    }

    try {
        // 1. 先查库
        let user = await User.findOne({ username: authorName });

        if (user) {
            console.log(`👤 作者账号已存在: ${user.username}`);
            return user;
        }

        // 2. 不存在则创建
        console.log(`🆕 检测到新作者，正在创建账号: ${authorName}...`);
        
        // 生成随机防撞邮箱 (例如: author_1706692341_123@auto.com)
        const timestamp = Date.now();
        const randomNum = Math.floor(Math.random() * 1000);
        const autoEmail = `author_${timestamp}_${randomNum}@auto.generated`;
        
        // 生成类似 MongoDB _id 的 hex 字符串，适配你 User 模型里的 id 字段
        const generatedId = new mongoose.Types.ObjectId().toString();

        user = await User.create({
            id: generatedId,          // 适配你的 String 类型 id
            username: authorName,
            email: autoEmail,         // 必须唯一
            password: '123456',       // 默认短密码
            role: 'writer',           // 既然是作者，给 writer 权限
            avatar: '',               // 留空
            created_at: new Date()
        });

        console.log(`✅ 作者账号创建成功: ${user.username} (ID: ${user.id})`);
        return user;

    } catch (error) {
        console.error(`⚠️ 创建作者账号失败: ${error.message}`);
        // 如果创建用户失败（比如并发导致的邮箱冲突），为了不打断爬书，返回 null
        return null;
    }
}

/**
 * 根治版搜索函数：模拟人类打字 (防空白页拦截)
 */
export const searchBookAndGetUrl = async (bookName) => {
    console.log(`🔍 [搜索服务] 正在前往 69书吧首页...`);
    
    let puppeteer;
    let browser;
    try {
        puppeteer = (await import('puppeteer')).default;
        browser = await puppeteer.launch({
            headless: false, 
            defaultViewport: null,
            userDataDir: './browser_data', // 依然保留记忆，避免频繁验证
            args: ['--start-maximized', '--no-sandbox']
        });

        const page = await browser.newPage();
        await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // 1. 先去首页 (而不是直接去搜索页，这样更像人)
        await page.goto('https://www.69shuba.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });

        // 2. 找到搜索框并“打字”
        console.log('⌨️ 正在输入书名...');
        const searchInputSelector = 'input[name="searchkey"]';
        
        // 确保搜索框出来了
        await page.waitForSelector(searchInputSelector, { timeout: 10000 });
        
        // 清空输入框并输入
        await page.evaluate((selector) => { document.querySelector(selector).value = ''; }, searchInputSelector);
        await page.type(searchInputSelector, bookName, { delay: 100 }); // 模拟打字延迟，更真实

        // 3. 点击搜索按钮 (或者回车)
        console.log('👆 点击搜索...');
        await page.keyboard.press('Enter');

        // 4. 等待结果页跳转
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => console.log("页面跳转超时或已在当前页刷新"));

        console.log('⏳ 正在解析搜索结果...');
        
        // --- 下面是之前的智能提取逻辑 (保持不变) ---
        let targetUrl = null;
        let checks = 0;

        while (!targetUrl && checks < 100) {
            checks++;
            targetUrl = await page.evaluate((searchName) => {
                // 1. 检查是否直接在书页
                if (window.location.href.includes('/book/') && window.location.href.endsWith('.htm')) {
                    return window.location.href;
                }
                // 2. 检查搜索列表
                const allLinks = Array.from(document.querySelectorAll('a'));
                for (let link of allLinks) {
                    if (link.innerText.includes(searchName) && link.href.includes('/book/')) {
                        return link.href;
                    }
                }
                return null;
            }, bookName);

            if (targetUrl) break;
            
            if (checks % 5 === 0) console.log(`⚠️ 还没找到书，可能需要人工介入...`);
            await new Promise(r => setTimeout(r, 2000));
        }

        if (!targetUrl) throw new Error("搜索超时");
        console.log(`✅ 获取到书籍主页: ${targetUrl}`);
        return targetUrl;

    } catch (error) {
        console.error(error);
        throw error;
    } finally {
        if (browser) await browser.close();
    }
};


/**
 * 核心爬虫函数：智能单线程稳定版
 */
export const scrapeAndSaveBook = async (bookIndexUrl, customBookId) => {
    let puppeteer;
    try {
        puppeteer = (await import('puppeteer')).default; 
    } catch (error) {
        console.log("当前环境未安装 Puppeteer，跳过爬虫逻辑");
        return; 
    }

    console.log(`🚀 [爬虫服务] 启动... ${bookIndexUrl}`);

    const browser = await puppeteer.launch({
        headless: false, 
        defaultViewport: null,
        args: ['--start-maximized'] 
    });

    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        // --- 第一阶段：获取书籍详情（书名、作者、目录） ---
        console.log(`🔗 正在获取目录及书籍信息...`);
        await page.goto(bookIndexUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

        // 🔥🔥🔥【这里是新增的“点击”逻辑】🔥🔥🔥
        console.log('point👉 正在寻找并点击“完整目录”按钮...');
        
        const isExpanded = await page.evaluate(async () => {
            // 1. 找到所有包含“完整目录”字样的按钮
            const links = Array.from(document.querySelectorAll('a'));
            const expandBtn = links.find(a => a.innerText.includes('完整目录') || a.innerText.includes('点击查看'));
            
            // 2. 如果找到了，就点它！
            if (expandBtn) {
                expandBtn.click(); // <--- 这一脚踢开了隐藏的大门
                return true;
            }
            return false;
        });

        if (isExpanded) {
            console.log('✅ 已点击展开按钮，等待列表刷新 (3秒)...');
            await sleep(3000); // 给网页一点时间把章节吐出来
        } else {
            console.log('⚠️ 未找到展开按钮，可能已经是全本显示，或需要手动点击');
        }
        // 🔥🔥🔥【新增逻辑结束】🔥🔥🔥

        const bookData = await page.evaluate(() => {
            // 1. 获取书名
            const title = document.querySelector('h1')?.innerText.trim() || 
                          document.querySelector('.booknav2 h1 a')?.innerText.trim() || 
                          '未知书籍';
            
            // 2. 获取作者 (新增逻辑)
            // 策略：遍历页面常见元素，寻找包含中文 "作者：" 的文本
            let author = '未知';
            // 常见的可能包含作者信息的容器
            const potentialElements = document.querySelectorAll('p, div, span, td, h1, h2');
            
            for (let el of potentialElements) {
                const text = el.innerText;
                // 必须包含 "作者：" 且长度不能太长（防止抓到大段简介）
                if (text.includes('作者：') && text.length < 50) {
                    // 提取冒号后面的内容
                    // 例如 "作者：唐家三少" -> split -> ["", "唐家三少"]
                    const parts = text.split(/作者[:：]/); 
                    if (parts.length > 1) {
                        author = parts[1].trim().split(/\s+/)[0]; // 去除空格，只取第一段
                        break; // 找到就退出
                    }
                }
            }

            // 3. 获取目录
            const allLinks = Array.from(document.querySelectorAll('a'));
            const chapters = allLinks.filter(a => {
                const text = a.innerText.trim();
                const href = a.href;
                if (!href || href.includes('javascript') || href === '') return false;
                if (text.includes('登录') || text.includes('注册') || text.includes('首页')) return false;
                const isChapterName = /第.+章/.test(text) || (/^\d+/.test(text) && text.length > 2);
                const isChapterLink = /\/\d+/.test(href); 
                return isChapterName && isChapterLink;
            }).map(a => ({
                title: a.innerText.trim(),
                link: a.href
            }));

            // 去重
            const uniqueChapters = [];
            const seenLinks = new Set();
            for (const chap of chapters) {
              if (!seenLinks.has(chap.link)) {
                seenLinks.add(chap.link);
                uniqueChapters.push(chap);
              }
            }
            return { title, author, chapters: uniqueChapters };
        });

        console.log(`📖 书名: 《${bookData.title}》 | 作者: ${bookData.author} | 章节: ${bookData.chapters.length} 章`);

        if (bookData.chapters.length === 0) {
            throw new Error("❌ 未抓取到章节，请检查链接或手动处理验证码");
        }

        // --- 中间阶段：处理作者账号 ---
        let authorUserId = null;
        if (bookData.author !== '未知') {
            const authorUser = await ensureAuthorExists(bookData.author);
            if (authorUser) {
                authorUserId = authorUser._id; // 获取 MongoDB 的 ObjectId
            }
        }

        // --- 第二阶段：存储/更新书籍信息 (Book Model) ---
        let book = await Book.findOne({ title: bookData.title });
        const finalBookId = customBookId || 'auto_' + Date.now();

        if (!book) {
            // 新书入库
            book = await Book.create({
                title: bookData.title,
                bookId: finalBookId, 
                author: bookData.author,     // 冗余存储名字
                author_id: authorUserId,     // 关联 User 表 ID (核心修改)
                chapterCount: bookData.chapters.length,
                sourceUrl: bookIndexUrl,
                status: '连载'
            });
            console.log(`🎉 新书创建成功: ${book.title} (ID: ${finalBookId})`);
        } else {
            // 旧书更新：更新章节数，并尝试补全作者关联
            book.chapterCount = bookData.chapters.length;
            book.author = bookData.author; // 更新作者名
            if (authorUserId) {
                book.author_id = authorUserId; // 补全关联
            }
            await book.save();
            console.log(`🔄 书籍信息已更新: ${book.title}`);
        }

        // --- 第三阶段：逐章爬取 (保持原逻辑不变) ---
        const chaptersToScrape = bookData.chapters;

        for (let i = 0; i < chaptersToScrape.length; i++) {
            const chap = chaptersToScrape[i];
            const exist = await Chapter.exists({ bookId: book._id, title: chap.title });
            
            if (exist) {
                console.log(`✅ [${i+1}/${chaptersToScrape.length}] 跳过已存在: ${chap.title}`);
                continue;
            }

            let attempts = 0;
            let success = false;

            while (attempts < 3 && !success) {
                try {
                    attempts++;
                    if (attempts > 1) {
                        console.log(`⏳ 重试等待中...`);
                        await sleep(3000);
                    }

                    await page.goto(chap.link, { waitUntil: 'domcontentloaded', timeout: 30000 });

                    try {
                        await page.waitForSelector('.txtnav, #content, .read_chapter_detail, .mybox', { timeout: 10000 });
                    } catch (e) {
                        throw new Error("等待正文元素超时");
                    }
                    
                    const content = await page.evaluate(() => {
                        const container = document.querySelector('.txtnav') || 
                                          document.querySelector('#content') || 
                                          document.querySelector('.read_chapter_detail') ||
                                          document.querySelector('.mybox');
                        if (!container) return '';
                        return container.innerText
                            .replace(/69书吧/g, '')
                            .replace(/www\.69shuba\.com/g, '')
                            .replace(/作者说：.*/g, '')
                            .trim();
                    });

                    if (content && content.length > 50) {
                        await Chapter.create({
                            bookId: book._id,
                            title: chap.title,
                            content: content,
                            chapter_number: i + 1
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

            if (!success) console.error(`❌ 放弃章节: ${chap.title}`);
            
            const randomSleep = Math.floor(Math.random() * 2000) + 1500;
            await sleep(randomSleep);
        }

        return { success: true, message: `书籍《${bookData.title}》更新完成`, bookId: book._id };

    } catch (error) {
        console.error('❌ 爬虫服务出错:', error);
        throw error;
    } finally {
        if (browser) await browser.close();
    }
};