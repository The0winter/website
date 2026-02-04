// run_offline.js
// 专注模式：直接输入URL并下载
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

console.log('📂 启动【新书爬取模式 - 直连版】...');

(async () => {
    // 1. 改为直接问 URL
    const inputUrl = await askQuestion('请输入书籍主页链接 (如 https://www.69shuba.com/book/xxxx.htm): ');
    const targetUrl = inputUrl.trim();

    if (!targetUrl || !targetUrl.startsWith('http')) {
        console.error('❌ 链接格式不正确，程序退出');
        process.exit(0);
    }

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
                '--disable-blink-features=AutomationControlled',
                '--disable-infobars'
            ],
            ignoreDefaultArgs: ['--enable-automation']
        });

        const page = await browser.newPage();
        
        // 设置真人 User-Agent
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        // 2. 直接访问目标页面
        console.log(`🚀 正在直连书籍页面: ${targetUrl}`);
        
        try {
            await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        } catch (e) {
            console.log("⚠️ 页面加载较慢或超时，尝试继续解析...");
        }

        // 增加容错：如果刚进去遇到了 Cloudflare 验证，这里等待一下
        // 检测是否有标题元素，如果没有，说明可能被拦截了
        try {
            await page.waitForSelector('h1', { timeout: 15000 });
        } catch (e) {
            console.log("🔴 未检测到书名，可能是遇到了验证码！请手动在浏览器中完成验证...");
            await page.waitForSelector('h1', { timeout: 120000 }); // 给2分钟时间手动处理
        }

        // 3. 抓取基础信息 (强力净化版)
        console.log('📖 正在解析书籍信息...');
        const basicInfo = await page.evaluate(() => {
            let title = document.querySelector('h1')?.innerText.trim() || '未知';
            title = title.replace(/\?.*$/, '').replace(/最新章节.*/, '').trim();
            
            let author = '未知';
            const els = document.querySelectorAll('p,div,span,td');
            for (let el of els) {
                const text = el.innerText;
                if (text.includes('作者：') && text.length < 100) { 
                    let temp = text.split(/作者[:：]/)[1];
                    if (temp) {
                        temp = temp.split(/分类[:：]/)[0]; 
                        temp = temp.split(/\d+万字/)[0];   
                        temp = temp.split(/连载/)[0];      
                        temp = temp.split(/完结/)[0];
                        author = temp.trim().split(/\s+/)[0]; 
                        author = author.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, ''); 
                        if (author) break; 
                    }
                }
            }
            return { title, author };
        });

        // 4. 交互：定分类
        console.log('\n==========================================');
        console.log(`📖 书名: 《${basicInfo.title}》`);
        console.log(`👤 作者:  ${basicInfo.author}`);
        console.log('==========================================\n');
        
        const userCategory = await askQuestion(`👉 给这本书定个分类 (默认'搬运'): `);
        const finalCategory = userCategory.trim() || '搬运';

        // 5. 展开目录
        console.log('📂 正在获取目录...');
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

        // 6. 去重并保存结构
        const uniqueChapters = [];
        const seen = new Set();
        for (const c of chapters) {
            if(!seen.has(c.link)) { seen.add(c.link); uniqueChapters.push(c); }
        }

        // 🔥🔥🔥【增强版】排序修复 🔥🔥🔥
        uniqueChapters.sort((a, b) => {
            const getNum = (str) => {
                const cleanStr = str.replace(/\s+/g, '');
                const matchChapter = cleanStr.match(/第(\d+)章/);
                if (matchChapter) return parseInt(matchChapter[1]);
                const matchStartNum = cleanStr.match(/^(\d+)/);
                if (matchStartNum) return parseInt(matchStartNum[1]);
                const matchAnyNum = cleanStr.match(/(\d+)/);
                return matchAnyNum ? parseInt(matchAnyNum[1]) : 999999; 
            };
            return getNum(a.title) - getNum(b.title);
        });

        const finalData = {
            title: basicInfo.title,
            author: basicInfo.author,
            category: finalCategory,
            sourceUrl: targetUrl,
            views: 0, 
            rating: 0,
            chapters: [] 
        };

        // 7. 循环下载
        console.log(`📚 准备下载 ${uniqueChapters.length} 章...`);
        const downloadDir = path.join(process.cwd(), 'downloads');
        if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir);
        const fileName = path.join(downloadDir, `${basicInfo.title}.json`);

        for (let i = 0; i < uniqueChapters.length; i++) {
            const chap = uniqueChapters[i];
            try {
                await page.goto(chap.link, { waitUntil: 'domcontentloaded', timeout: 30000 });
                try { await page.waitForSelector('.txtnav', { timeout: 5000 }); } catch(e) {}
                
                const content = await page.evaluate((chapterTitle) => {
                    const el = document.querySelector('.txtnav') || document.querySelector('#content');
                    if (!el) return '';
                    let text = el.innerText;
                    text = text.replace(/69书吧/g, '').replace(/www\.69shuba\.com/g, '');

                    // 智能去重逻辑
                    const lines = text.split('\n');
                    const normTitle = chapterTitle.replace(/\s+/g, '');
                    while (lines.length > 0) {
                        const firstLine = lines[0].trim();
                        const normLine = firstLine.replace(/\s+/g, '');
                        if (!firstLine) { lines.shift(); continue; }
                        if (normLine.includes(normTitle) || normTitle.includes(normLine)) {
                            lines.shift();
                            continue;
                        }
                        if (/^第\d+章/.test(firstLine) && firstLine.length < 20) {
                            lines.shift();
                            continue;
                        }
                        break;
                    }
                    return lines.join('\n').trim();
                }, chap.title);

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
            
            const randomSleep = 1500 + Math.random() * 1500; 
            await sleep(randomSleep);
        }

        fs.writeFileSync(fileName, JSON.stringify(finalData, null, 2));
        console.log(`🎉 新书爬取完成！文件已保存至 downloads/${basicInfo.title}.json`);

    } catch (error) {
        console.error('💥', error);
    } finally {
        if (browser) await browser.close();
        process.exit(0);
    }
})();