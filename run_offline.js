// run_offline.js
// 离线爬虫修正版：采用“模拟打字”搜索，彻底解决空白页问题
import fs from 'fs';
import path from 'path';
import readline from 'readline';

// 动态加载 puppeteer
const loadPuppeteer = async () => (await import('puppeteer')).default;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

console.log('📂 启动【离线爬取模式 - 模拟打字版】...');

rl.question('请输入你想爬取的书籍名称: ', async (bookName) => {
    if (!bookName.trim()) {
        console.log('❌ 书名不能为空');
        process.exit(0);
    }

    let browser;
    try {
        const puppeteer = await loadPuppeteer();
        browser = await puppeteer.launch({
            headless: false,
            defaultViewport: null,
            userDataDir: './browser_data', // 保持记忆
            args: ['--start-maximized', '--no-sandbox']
        });

        const page = await browser.newPage();
        // 伪装
        await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // --- 1. 进入首页并打字搜索 (核心修改) ---
        console.log(`🔍 正在前往 69书吧首页...`);
        await page.goto('https://www.69shuba.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });

        console.log('⌨️ 正在输入书名...');
        const searchInputSelector = 'input[name="searchkey"]';
        
        // 等待搜索框出现
        await page.waitForSelector(searchInputSelector, { timeout: 15000 });
        
        // 清空并输入 (模拟打字延迟)
        await page.evaluate((sel) => { document.querySelector(sel).value = ''; }, searchInputSelector);
        await page.type(searchInputSelector, bookName, { delay: 200 }); // 每个字停顿200毫秒
        await sleep(500);

        console.log('👆 点击搜索...');
        await page.keyboard.press('Enter');

        // 等待页面跳转
        try {
            await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 });
        } catch (e) {
            console.log("⚠️ 页面跳转超时或已在当前页刷新，继续解析...");
        }

        // --- 2. 寻找书籍链接 ---
        let targetUrl = null;
        let checks = 0;
        console.log('⏳ 正在寻找书籍链接...');

        while (!targetUrl && checks < 60) {
            checks++;
            targetUrl = await page.evaluate((name) => {
                // 情况A: 直接跳进书页
                if (window.location.href.includes('/book/') && window.location.href.endsWith('.htm')) return window.location.href;
                
                // 情况B: 在搜索列表里
                const links = Array.from(document.querySelectorAll('a'));
                for (let link of links) {
                    // 只要链接文字包含书名，且是书籍链接
                    if (link.innerText.includes(name) && link.href.includes('/book/')) return link.href;
                }
                return null;
            }, bookName);

            if (targetUrl) break;
            
            // 每5次提示一次
            if (checks % 5 === 0) console.log(`⚠️ 还没找到书 (第 ${checks}/60 次)，如果出现验证码请手动点击...`);
            await sleep(3000);
        }

        if (!targetUrl) throw new Error("搜索超时，未找到书籍。");
        console.log(`✅ 锁定书籍主页: ${targetUrl}`);

        // --- 3. 进入目录页并展开 ---
        if (page.url() !== targetUrl) await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 0 });
        
        console.log('point👉 正在点击“完整目录”...');
        const isExpanded = await page.evaluate(() => {
            const btn = Array.from(document.querySelectorAll('a')).find(a => a.innerText.includes('完整目录') || a.innerText.includes('点击查看'));
            if (btn) { btn.click(); return true; }
            return false;
        });
        
        if (isExpanded) {
            console.log('✅ 已点击展开，等待列表加载...');
            await sleep(3000);
        }

        // --- 4. 提取书籍信息 ---
        const bookData = await page.evaluate(() => {
            const title = document.querySelector('h1')?.innerText.trim() || '未知书籍';
            // 尝试多种方式获取作者
            let author = '未知';
            const pTags = Array.from(document.querySelectorAll('p'));
            const authorTag = pTags.find(p => p.innerText.includes('作者：'));
            if (authorTag) author = authorTag.innerText.split('作者：')[1]?.split(' ')[0] || '未知';

            const links = Array.from(document.querySelectorAll('li a, dd a'));
            const chapters = links.filter(a => {
                const t = a.innerText.trim();
                const h = a.href;
                return h && !h.includes('javascript') && (t.includes('章') || /^\d+/.test(t));
            }).map(a => ({ title: a.innerText.trim(), link: a.href }));
            
            // 去重
            const unique = [];
            const seen = new Set();
            for (const c of chapters) {
                if(!seen.has(c.link)) { seen.add(c.link); unique.push(c); }
            }
            return { title, author, chapters: unique };
        });

        console.log(`📖 书名: ${bookData.title} | 作者: ${bookData.author} | 章节数: ${bookData.chapters.length}`);

        // 准备文件
        const downloadDir = path.join(process.cwd(), 'downloads');
        if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir);
        const fileName = path.join(downloadDir, `${bookData.title}.json`);
        
        let finalData = {
            title: bookData.title,
            author: bookData.author,
            sourceUrl: targetUrl,
            chapters: []
        };

        // --- 5. 循环爬取 ---
        for (let i = 0; i < bookData.chapters.length; i++) {
            const chap = bookData.chapters[i];
            try {
                await page.goto(chap.link, { waitUntil: 'domcontentloaded', timeout: 30000 });
                try { await page.waitForSelector('.txtnav', { timeout: 5000 }); } catch(e) {}

                const content = await page.evaluate(() => {
                    const el = document.querySelector('.txtnav') || document.querySelector('#content');
                    return el ? el.innerText.replace(/69书吧/g, '').replace(/www\.69shuba\.com/g, '').trim() : '';
                });

                if (content.length > 50) {
                    finalData.chapters.push({
                        title: chap.title,
                        chapter_number: i + 1,
                        content: content
                    });
                    console.log(`💾 [${i+1}/${bookData.chapters.length}] 已缓存: ${chap.title}`);
                } else {
                    console.log(`⚠️ 内容过短: ${chap.title}`);
                }
            } catch (err) {
                console.error(`❌ 跳过: ${chap.title}`);
            }

            if (i % 10 === 0) fs.writeFileSync(fileName, JSON.stringify(finalData, null, 2));
            await sleep(1000 + Math.random() * 1000);
        }

        fs.writeFileSync(fileName, JSON.stringify(finalData, null, 2));
        console.log(`🎉 爬取完成！文件已保存: ${fileName}`);

    } catch (error) {
        console.error('💥 错误:', error);
    } finally {
        if (browser) await browser.close();
        process.exit(0);
    }
});