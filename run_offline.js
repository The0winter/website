// run_offline.js
// 离线爬虫 V3.0：交互式分类版
import fs from 'fs';
import path from 'path';
import readline from 'readline';

// 动态加载 puppeteer
const loadPuppeteer = async () => (await import('puppeteer')).default;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 🔥 新增：Promise 版的提问工具，方便用 await 等待用户输入
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const askQuestion = (query) => new Promise(resolve => rl.question(query, resolve));

console.log('📂 启动【离线爬取模式 - 交互分类版】...');

// 主流程
(async () => {
    const bookName = await askQuestion('请输入你想爬取的书籍名称: ');
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
            userDataDir: './browser_data',
            args: ['--start-maximized', '--no-sandbox']
        });

        const page = await browser.newPage();
        await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // --- 1. 搜索书籍 ---
        console.log(`🔍 正在前往 69书吧首页...`);
        await page.goto('https://www.69shuba.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });

        console.log('⌨️ 正在输入书名...');
        const searchInputSelector = 'input[name="searchkey"]';
        await page.waitForSelector(searchInputSelector, { timeout: 15000 });
        await page.evaluate((sel) => { document.querySelector(sel).value = ''; }, searchInputSelector);
        await page.type(searchInputSelector, bookName, { delay: 100 });
        await page.keyboard.press('Enter');

        // 等待跳转
        try { await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }); } catch (e) {}

        // --- 2. 寻找目标链接 ---
        let targetUrl = null;
        let checks = 0;
        console.log('⏳ 正在寻找书籍链接...');
        while (!targetUrl && checks < 60) {
            checks++;
            targetUrl = await page.evaluate((name) => {
                if (window.location.href.includes('/book/') && window.location.href.endsWith('.htm')) return window.location.href;
                const links = Array.from(document.querySelectorAll('a'));
                for (let link of links) {
                    if (link.innerText.includes(name) && link.href.includes('/book/')) return link.href;
                }
                return null;
            }, bookName);
            if (targetUrl) break;
            if (checks % 5 === 0) console.log(`⚠️ 还没找到书 (第 ${checks}/60 次)，如果有验证码请手动点击...`);
            await sleep(2000);
        }

        if (!targetUrl) throw new Error("搜索超时");
        console.log(`✅ 锁定书籍主页: ${targetUrl}`);

        if (page.url() !== targetUrl) await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 0 });

        // --- 3. 提取基础信息 ---
        console.log('📊 正在分析书籍信息...');
        const basicInfo = await page.evaluate(() => {
            let title = document.querySelector('h1')?.innerText.trim() || '未知书籍';
            title = title.replace(/\?.*$/, '').replace(/最新章节.*/, '').trim();
            
            // 暴力找作者
            let author = '未知';
            const potentialElements = document.querySelectorAll('p, div, span, td, h1, h2');
            for (let el of potentialElements) {
                const text = el.innerText;
                if (text.includes('作者：') && text.length < 50) {
                    const parts = text.split(/作者[:：]/);
                    if (parts.length > 1) { author = parts[1].trim().split(/\s+/)[0]; break; }
                }
            }
            return { title, author };
        });

        // 🔥🔥🔥【关键修改：暂停并询问分类】🔥🔥🔥
        console.log('\n==========================================');
        console.log(`📖 书名: 《${basicInfo.title}》`);
        console.log(`👤 作者:  ${basicInfo.author}`);
        console.log('==========================================\n');
        
        // 这里的 await 会让程序停下来等你打字！
        const userCategory = await askQuestion(`👉 请输入这本书的分类 (例如 玄幻/都市/仙侠，直接回车默认为'搬运'): `);
        const finalCategory = userCategory.trim() || '搬运';
        
        console.log(`✅ 已分类为: [${finalCategory}]，准备开始爬取目录...`);

        // --- 4. 点击展开并获取目录 ---
        console.log('point👉 正在点击“完整目录”...');
        const isExpanded = await page.evaluate(() => {
            const btn = Array.from(document.querySelectorAll('a')).find(a => a.innerText.includes('完整目录') || a.innerText.includes('点击查看'));
            if (btn) { btn.click(); return true; }
            return false;
        });
        if (isExpanded) await sleep(3000);

        const bookData = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('li a, dd a'));
            const chapters = links.filter(a => {
                const t = a.innerText.trim();
                const h = a.href;
                return h && !h.includes('javascript') && (t.includes('章') || /^\d+/.test(t));
            }).map(a => ({ title: a.innerText.trim(), link: a.href }));
            
            const unique = [];
            const seen = new Set();
            for (const c of chapters) {
                if(!seen.has(c.link)) { seen.add(c.link); unique.push(c); }
            }
            return { chapters: unique };
        });

        // 合并信息
        const finalData = {
            title: basicInfo.title,
            author: basicInfo.author,
            category: finalCategory, // <--- 把分类存进去
            sourceUrl: targetUrl,
            chapters: []
        };

        console.log(`📚 准备爬取 ${bookData.chapters.length} 章...`);
        
        // 准备文件
        const downloadDir = path.join(process.cwd(), 'downloads');
        if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir);
        const fileName = path.join(downloadDir, `${basicInfo.title}.json`);

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
                }
            } catch (err) {
                console.error(`❌ 跳过: ${chap.title}`);
            }

            if (i % 10 === 0) fs.writeFileSync(fileName, JSON.stringify(finalData, null, 2));
            await sleep(1000 + Math.random() * 1000);
        }

        fs.writeFileSync(fileName, JSON.stringify(finalData, null, 2));
        console.log(`🎉 爬取完成！文件: ${fileName}`);

    } catch (error) {
        console.error('💥 错误:', error);
    } finally {
        if (browser) await browser.close();
        process.exit(0);
    }
})();