// run_update.js
// 补货模式：批量扫描本地书籍，去网站检查更新 (隐身增强版)
import fs from 'fs';
import path from 'path';

// 🔥 1. 引入隐身插件
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

// 启用隐身模式
puppeteer.use(StealthPlugin());

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

console.log('📂 启动【书籍批量更新模式 - 隐身增强版】...');

(async () => {
    const downloadDir = path.join(process.cwd(), 'downloads');
    if (!fs.existsSync(downloadDir)) {
        console.log('❌ 没找到 downloads 文件夹，请先用 run_offline.js 下几本书。');
        process.exit(0);
    }

    const files = fs.readdirSync(downloadDir).filter(f => f.endsWith('.json'));
    if (files.length === 0) {
        console.log('❌ 文件夹里没书。');
        process.exit(0);
    }

    console.log(`📦 扫描到 ${files.length} 本书，准备开始检查更新...`);

    let browser;
    try {
        // 🔥 2. 增强启动参数 (和 run_offline.js 保持一致)
        browser = await puppeteer.launch({
            headless: false,
            defaultViewport: null,
            userDataDir: './browser_data',
            args: [
                '--start-maximized', 
                '--no-sandbox',
                '--disable-blink-features=AutomationControlled', // 关键：禁用自动化特征
                '--disable-infobars'
            ],
            ignoreDefaultArgs: ['--enable-automation']
        });

        const page = await browser.newPage();
        
        // ❌ 删除手动的 navigator.webdriver 修改 (插件已接管)
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // 遍历每一本书
        for (const file of files) {
            const filePath = path.join(downloadDir, file);
            // 增加 try-catch 防止某本书 JSON 损坏导致整个脚本崩溃
            let bookData;
            try {
                bookData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            } catch (e) {
                console.log(`⚠️ 文件损坏跳过: ${file}`);
                continue;
            }

            console.log(`\n📘 正在检查: 《${bookData.title}》...`);
            if (!bookData.sourceUrl) {
                console.log(`⚠️ 跳过: 没记录来源网址`);
                continue;
            }

            // 模拟更加真实的浏览器环境
            await page.setExtraHTTPHeaders({ 
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                'Referer': 'https://www.69shuba.com/' // 伪装来源
            });
            // 1. 去书的首页 (增加容错)
            try {
                await page.goto(bookData.sourceUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
            } catch (e) {
                console.log(`⚠️ 页面加载超时，可能需要手动验证，尝试继续...`);
            }

            // 🔥 增加验证码检测逻辑
            try {
                // 如果找不到“完整目录”按钮，可能就是被验证码挡住了
                // 这里我们稍微等一下，给人肉验证留点时间
                await page.waitForSelector('a', { timeout: 5000 });
            } catch (e) {
                console.log("🔴 页面元素未加载，可能是验证码！请手动点击...");
                await sleep(10000); // 给你 10 秒时间点验证码
            }

            // 2. 获取网站最新目录 (首次尝试展开)
            const expandCatalog = async () => {
                const isExpanded = await page.evaluate(() => {
                    const btn = Array.from(document.querySelectorAll('a')).find(a => a.innerText.includes('完整目录') || a.innerText.includes('点击查看'));
                    if (btn) { btn.click(); return true; }
                    return false;
                });
                if (isExpanded) await sleep(3000); // 展开目录需要时间
            };
            await expandCatalog();

            // 获取本地已有的章节数，方便后续对比
            const localChapterCount = bookData.chapters ? bookData.chapters.length : 0;

            // 🔥🔥🔥【修改】重试机制：加入章节数对比，最多试3次 🔥🔥🔥
            let webChapters = [];
            let retryCount = 0;
            const MAX_RETRIES = 3;

            while (retryCount < MAX_RETRIES) {
                // 1. 尝试获取目录
                webChapters = await page.evaluate(() => {
                    const links = Array.from(document.querySelectorAll('li a, dd a'));
                    const list = links.filter(a => a.innerText.includes('章') || /^\d+/.test(a.innerText))
                        .map(a => ({ title: a.innerText.trim(), link: a.href }));
                    
                    // 内部去重
                    const unique = [];
                    const seen = new Set();
                    for (const c of list) { if(!seen.has(c.link)) { seen.add(c.link); unique.push(c); } }
                    return unique;
                });

                // 🔥 新增判定条件：抓到的章节必须大于5章，且不能少于本地已下载的章节数
                if (webChapters.length > 5 && webChapters.length >= localChapterCount) {
                    // 成功抓到了完整目录，跳出循环
                    break;
                }

                // 没抓到完整的，触发重试机制
                retryCount++;
                console.log(`⚠️  读取异常: 网页仅抓到 ${webChapters.length} 章 (本地已有 ${localChapterCount} 章)。第 ${retryCount}/${MAX_RETRIES} 次重试...`);
                
                if (retryCount < MAX_RETRIES) {
                    // 刷新页面
                    try {
                        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
                        await sleep(3000); 
                        // 🔥 关键修复：刷新页面后，需要重新点击“完整目录”展开，否则重试也没用
                        await expandCatalog();
                    } catch(e) {
                        console.log('   刷新超时...');
                    }
                }
            }

            // 【统一强力排序修复】(从 run_offline.js 复制过来的)
            webChapters.sort((a, b) => {
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

        // 🔥🔥🔥【关键修改】防覆盖/防清空机制 🔥🔥🔥
        // 逻辑：如果在3次重试后，抓到的章节数依然 <= 5，或者比本地存的章节还要少，绝对不能更新。
        if (webChapters.length <= 5 || webChapters.length < localChapterCount) {
            console.error(`\n❌ 严重警告：《${bookData.title}》 抓取异常！`);
            console.error(`   最终只抓取到 ${webChapters.length} 章，但本地已有 ${localChapterCount} 章。`);
            console.error('🛡️  触发熔断：跳过本书更新，保护本地数据不被缩水或覆盖。');
            console.error('   (可能是网站反爬虫或目录未展开，建议稍后再试)');
            
            // 只是跳过这一本书，不退出整个程序，继续检查下一本
            continue; 
        }
        // 🔥🔥🔥【结束】🔥🔥🔥
            // 3. 对比逻辑 (保持不变)
            const newChapters = [];
            const mergedChapters = [];

            for (let i = 0; i < webChapters.length; i++) {
                const webChap = webChapters[i];
                // 在本地找对应的内容
                const localChap = bookData.chapters.find(c => c.link === webChap.link || c.title === webChap.title);

                if (localChap && localChap.content && localChap.content.length > 50) {
                    mergedChapters.push({
                        ...localChap,
                        chapter_number: i + 1,
                        link: webChap.link
                    });
                } else {
                    const pendingChap = {
                        title: webChap.title,
                        link: webChap.link,
                        chapter_number: i + 1,
                        content: '' 
                    };
                    mergedChapters.push(pendingChap);
                    newChapters.push(pendingChap);
                }
            }

            bookData.chapters = mergedChapters;
            
            if (newChapters.length === 0) {
                console.log(`✅ 已是最新 (共 ${bookData.chapters.length} 章)，无需更新。`);
                fs.writeFileSync(filePath, JSON.stringify(bookData, null, 2));
                continue;
            }

            console.log(`🚀 发现 ${newChapters.length} 章新内容，开始抓取...`);

            // 4. 抓取新章节 (增加随机延迟)
            for (let i = 0; i < newChapters.length; i++) {
                const chap = newChapters[i];
                // 模拟更加真实的浏览器环境
            await page.setExtraHTTPHeaders({ 
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                'Referer': 'https://www.69shuba.com/' // 伪装来源
            });
                try {
                    await page.goto(chap.link, { waitUntil: 'domcontentloaded', timeout: 45000 });
                    try { await page.waitForSelector('.txtnav', { timeout: 5000 }); } catch(e) {}

                    const content = await page.evaluate(() => {
                        const el = document.querySelector('.txtnav') || document.querySelector('#content');
                        return el ? el.innerText.replace(/69书吧/g, '').replace(/www\.69shuba\.com/g, '').trim() : '';
                    });

                    if (content.length > 50) {
                        chap.content = content;
                        console.log(`💾 下载: ${chap.title}`);
                    }
                } catch (e) {
                    console.error(`❌ 失败: ${chap.title}`);
                }
                
                // 🔥 关键修改：更长的随机等待，模拟真人阅读翻页
                // 2秒 到 4秒 之间随机
                const randomSleep = 2000 + Math.random() * 2000;
                await sleep(randomSleep);
            }

            fs.writeFileSync(filePath, JSON.stringify(bookData, null, 2));
            console.log(`🎉 《${bookData.title}》 更新完毕！`);
            
            // 每本书之间也休息一下
            await sleep(8000);
        }

        console.log('\n✅ 所有书籍检查完成！');

    } catch (error) {
        console.error('💥 错误:', error);
    } finally {
        if (browser) await browser.close();
        process.exit(0);
    }
})();