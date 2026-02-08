// local_updater.js
// 这是一个只在本地运行的脚本
import dotenv from 'dotenv';
dotenv.config({ path: './server/.env' });
import mongoose from 'mongoose';
import Book from './server/models/Book.js'; // 注意调整路径，确保能引用到你的模型
import { scrapeAndSaveBook } from './server/utils/scraperService.js'; 

// ⚠️ 关键：这里要填你【线上】数据库的连接地址
// 格式通常是: mongodb+srv://<username>:<password>@cluster0.xxx.mongodb.net/yourdbname
//const MONGO_URL = process.env.MONGO_URI;
const MONGO_URL = process.env.MONGO_URI_LOCAL;

if (!MONGO_URL) {
    console.error("❌ 致命错误：未找到 MONGO_URI 环境变量！");
    console.error("请检查 server/.env 文件中是否有 MONGO_URI=... 这一行");
    process.exit(1);
}

async function runUpdate() {
    console.log('🔌 正在连接远程数据库...');
    try {
        await mongoose.connect(MONGO_URL, {
        serverSelectionTimeoutMS: 10000, // 10 秒连接超时
        socketTimeoutMS: 5000,
    });

    // 2. 【关键】强制等待连接状态变为 "connected" (状态码 1)
    // 很多时候 connect 返回了，但状态还是 connecting (2)
    let checks = 0;
    while (mongoose.connection.readyState !== 1) {
        checks++;
        if (checks > 20) throw new Error("连接僵死在握手阶段，请检查防火墙！");
        console.log(`💤 [${checks}/20] 等待连接变绿 (当前状态: ${mongoose.connection.readyState})...`);
        await new Promise(r => setTimeout(r, 1000)); // 每秒查一次
    }
    
    console.log('✅ 信号满格！开始查询书籍...');

        // 1. 找出所有有源网址的书
        const books = await Book.find({ sourceUrl: { $exists: true, $ne: '' }, status: '连载' }).lean();
        console.log(`📚 发现 ${books.length} 本书需要更新`);

        for (let i = 0; i < books.length; i++) {
            const book = books[i];
            console.log(`🔄 [${i+1}/${books.length}] 正在本地爬取并同步至云端: 《${book.title}》...`);
            
            try {
                // 这里的爬虫在本地跑，IP也是本地的（不容易被封），但数据会存到远程
                await scrapeAndSaveBook(book.sourceUrl, book.bookId);
                
                // 休息一下，防止被封IP
                console.log('☕ 休息 5 秒...');
                await new Promise(r => setTimeout(r, 5000));
            } catch (err) {
                console.error(`❌ 《${book.title}》更新失败:`, err.message);
            }
        }
        
        console.log('🎉 所有书籍更新完成！');

    } catch (error) {
        console.error('💥 脚本运行出错:', error);
    } finally {
        // 任务完成后关闭连接，结束进程
        await mongoose.disconnect();
        process.exit(0);
    }
}

// 执行
runUpdate();