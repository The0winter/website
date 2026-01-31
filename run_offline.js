// run_offline.js
// 专注模式：只负责“搜索新书”并下载
import fs from 'fs';
import path from 'path';
import readline from 'readline';

// 🔥 1. 引入隐身插件
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

// 启用隐身模式
puppeteer.use(StealthPlugin());

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const askQuestion = (query) => new Promise(resolve => rl.question(query, resolve));

console.log('📂 启动【新书爬取模式 - 隐身增强版】...');

(async () => {
    // 1. 问书名
    const bookName = await askQuestion('请输入新书名称: ');
    if (!bookName.trim()) process.exit(0);

    let browser;
    try {
        // 🔥 2. 增强的启动参数
        browser = await puppeteer.launch({
            headless: false,
            defaultViewport: null,
            userDataDir: './browser_data', // 保持登录状态
            args: [
                '--start-maximized', 
                '--no-sandbox',
                '--disable-blink-features=AutomationControlled', // 关键：禁用自动化特征
                '--disable-infobars' // 隐藏“Chrome正在受到自动软件的控制”提示
            ],
            ignoreDefaultArgs: ['--enable-automation'] // 进一步隐藏
        });

        const page = await browser.newPage();
        
        // ❌ 删除：Object.defineProperty... (插件已经替你做好了，手动加反而容易暴露)

        // 设置真人 User-Agent
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        // 2. 搜索
        console.log(`🔍 正在前往 69书吧...`);
        try {
            await page.goto('https://www.69shuba.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        } catch (e) {
            console.log("⚠️ 首页加载较慢，继续尝试...");
        }

        const searchInputSelector = 'input[name="searchkey"]';
        // 增加容错：如果找不到搜索框，说明可能出了验证码
        try {
            await page.waitForSelector(searchInputSelector, { timeout: 15000 });
        } catch (e) {
            console.log("🔴 未找到搜索框！可能是出现了验证码，请手动点击验证...");
            // 这里多等一会，给你手动点的时间
            await page.waitForSelector(searchInputSelector, { timeout: 60000 }); 
        }

        await page.evaluate((sel) => { document.querySelector(sel).value = ''; }, searchInputSelector);
        
        // 模拟更真实的打字速度 (随机延迟)
        for (const char of bookName) {
            await page.type(searchInputSelector, char, { delay: 100 + Math.random() * 100 });
        }
        
        await sleep(500);
        await page.keyboard.press('Enter');

        // 等待跳转 (容错版)
        try { 
            await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }); 
        } catch (e) {
            console.log("⚠️ 跳转等待超时，可能页面已刷新或需手动介入，继续执行...");
        }

        // 3. 找链接
        let targetUrl = null;
        let checks = 0;
        console.log('⏳ 正在寻找书籍...');
        while (!targetUrl && checks < 60) { // 给你 2-3 分钟的时间处理可能出现的验证码
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
            
            if (checks % 5 === 0) console.log(`👉 还没找到书 (第 ${checks} 次检查)... 如果有验证码请点一下！`);
            await sleep(2000);
        }

        if (!targetUrl) throw new Error("未找到该书籍");
        if (page.url() !== targetUrl) await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

        // 4. 抓取基础信息
        const basicInfo = await page.evaluate(() => {
            let title = document.querySelector('h1')?.innerText.trim() || '未知';
            title = title.replace(/\?.*$/, '').replace(/最新章节.*/, '').trim();
            let author = '未知';
            const els = document.querySelectorAll('p,div,span,td');
            for (let el of els) {
                if (el.innerText.includes('作者：')) {
                    author = el.innerText.split(/作者[:：]/)[1]?.trim().split(' ')[0] || '未知';
                    break;
                }
            }
            return { title, author };
        });

        // 5. 交互：定分类
        console.log('\n==========================================');
        console.log(`📖 书名: 《${basicInfo.title}》`);
        console.log(`👤 作者:  ${basicInfo.author}`);
        console.log('==========================================\n');
        
        const userCategory = await askQuestion(`👉 给这本书定个分类 (默认'搬运'): `);
        const finalCategory = userCategory.trim() || '搬运';

        // 6. 展开目录
        console.log('point👉 正在获取目录...');
        const isExpanded = await page.evaluate(() => {
            const btn = Array.from(document.querySelectorAll('a')).find(a => a.innerText.includes('完整目录') || a.innerText.includes('点击查看'));
            if (btn) { btn.click(); return true; }
            return false;
        });
        if (isExpanded) await sleep(3000);

        const chapters = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('li a, dd a'));
            return links.filter(a => a.innerText.includes('章') || /^\d+/.test(a.innerText))
                .map(a => ({ title: a.innerText.trim(), link: a.href }));
        });

        // 7. 去重并保存结构
        const uniqueChapters = [];
        const seen = new Set();
        for (const c of chapters) {
            if(!seen.has(c.link)) { seen.add(c.link); uniqueChapters.push(c); }
        }

        const finalData = {
            title: basicInfo.title,
            author: basicInfo.author,
            category: finalCategory,
            sourceUrl: targetUrl,
            chapters: [] // 待填充
        };

        // 8. 循环下载
        console.log(`📚 准备下载 ${uniqueChapters.length} 章...`);
        const downloadDir = path.join(process.cwd(), 'downloads');
        if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir);
        const fileName = path.join(downloadDir, `${basicInfo.title}.json`);

        for (let i = 0; i < uniqueChapters.length; i++) {
            const chap = uniqueChapters[i];
            try {
                await page.goto(chap.link, { waitUntil: 'domcontentloaded', timeout: 30000 });
                // 偶尔有验证码，这里等待时间不用太长，失败就重试
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
                    console.log(`💾 [${i+1}/${uniqueChapters.length}] 下载: ${chap.title}`);
                }
            } catch (e) { console.error(`❌ 跳过: ${chap.title}`); }
            
            if (i % 20 === 0) fs.writeFileSync(fileName, JSON.stringify(finalData, null, 2));
            
            // 🔥 增加一点点随机延迟，模拟真人阅读速度，减少封IP概率
            const randomSleep = 1500 + Math.random() * 1500; 
            await sleep(randomSleep);
        }

        fs.writeFileSync(fileName, JSON.stringify(finalData, null, 2));
        console.log(`🎉 新书爬取完成！`);

    } catch (error) {
        console.error('💥', error);
    } finally {
        if (browser) await browser.close();
        process.exit(0);
    }
})();