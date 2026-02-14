import axios from 'axios';
import xml2js from 'xml2js';
import fs from 'fs';
import path from 'path';

// --- 配置区域 ---
const SITE_DOMAIN = 'https://www.jiutianxiaoshuo.com'; // 你的注册域名 (必须带www)
const SITEMAP_URL = `${SITE_DOMAIN}/sitemap.xml`;
const BAIDU_TOKEN = 'TOt2W4WdjbTaV0QO'; 
const BAIDU_API = `http://data.zz.baidu.com/urls?site=${SITE_DOMAIN}&token=${BAIDU_TOKEN}`;
const HISTORY_FILE = 'pushed_history.json'; // 用于记录推过的链接

async function pushToBaidu() {
    console.log('🚀 开始执行智能推送任务...');

    try {
        // 1. 获取 Sitemap
        console.log(`1. 获取 Sitemap: ${SITEMAP_URL}`);
        const sitemapRes = await axios.get(SITEMAP_URL);
        const parser = new xml2js.Parser();
        const result = await parser.parseStringPromise(sitemapRes.data);

        // 2. 提取并清洗链接 (强制加 www)
        let urls = [];
        if (result.urlset && result.urlset.url) {
            urls = result.urlset.url.map(item => item.loc[0]);
        } else if (result.sitemapindex) {
            // 如果是索引模式，这里简化处理，建议直接去抓子 sitemap
            console.log('⚠️ 你的 sitemap 是索引模式，这里可能只取到了子文件地址');
            urls = result.sitemapindex.sitemap.map(item => item.loc[0]);
        }

        // 🚨 关键修正：确保所有链接都带 www
        urls = urls.map(url => {
            if (url.includes('https://jiutianxiaoshuo.com') && !url.includes('www.')) {
                return url.replace('https://', 'https://www.');
            }
            return url;
        });

        // 3. 读取本地历史记录 (去重)
        let history = [];
        if (fs.existsSync(HISTORY_FILE)) {
            history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
        }

        // 4. 筛选出【未推送过】的新链接
        const newUrls = urls.filter(url => !history.includes(url));
        console.log(`🔍 扫描到 ${urls.length} 个链接，其中 ${newUrls.length} 个是新的。`);

        if (newUrls.length === 0) {
            console.log('🎉 所有链接都已推送过，今天休息！');
            return;
        }

        // 5. 截取前 10 条 (因为你的额度只有 10)
        // 建议优先推倒数 10 条（通常 sitemap 里最新的在最后？取决于你的生成逻辑）
        // 这里假设你要推最新的，我们取最后 10 个，或者前 10 个，看你 sitemap 排序
        const urlsToPush = newUrls.slice(0, 10); 
        
        console.log(`✨ 准备推送以下 ${urlsToPush.length} 条链接:`);
        console.log(urlsToPush);

        // 6. 发送给百度
        const textBody = urlsToPush.join('\n');
        const baiduRes = await axios.post(BAIDU_API, textBody, {
            headers: { 'Content-Type': 'text/plain' }
        });

        // 7. 处理结果
        console.log('------------------------------------------------');
        console.log(`📊 百度反馈: 成功 ${baiduRes.data.success} 条，剩余额度 ${baiduRes.data.remain}`);
        
        if (baiduRes.data.success > 0) {
            // 只有成功了，才把这些链接加入历史记录
            // 注意：百度并不返回具体哪条成功，我们假设这一批都处理了
            const updatedHistory = [...history, ...urlsToPush];
            fs.writeFileSync(HISTORY_FILE, JSON.stringify(updatedHistory, null, 2));
            console.log('💾 已将这些链接写入历史记录，下次不会重复推送。');
        }
        console.log('------------------------------------------------');

    } catch (error) {
        console.error('❌ 出错:', error.message);
        if (error.response) console.log(error.response.data);
    }
}

pushToBaidu();