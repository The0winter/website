// backend/scripts/addBook.js
import 'dotenv/config';
import mongoose from 'mongoose';
import { scrapeAndSaveBook } from '../utils/scraperService.js'; // 引入刚才封装好的爬虫服务

// 🔴 配置：你的数据库地址
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/novel-website'; 

// 获取命令行传入的 URL
const targetUrl = process.argv[2]; 
const customId = process.argv[3]; // 可选

if (!targetUrl) {
    console.error('❌ 请输入书籍目录页 URL！');
    console.log('👉 用法: node scripts/addBook.js <URL> [自定义ID]');
    process.exit(1);
}

const run = async () => {
    try {
        // 1. 临时连接数据库
        console.log('🔌 正在连接数据库...');
        await mongoose.connect(MONGO_URI);
        console.log('✅ 数据库已连接');

        // 2. 调用爬虫服务
        console.log(`🚀 开始爬取: ${targetUrl}`);
        const result = await scrapeAndSaveBook(targetUrl, customId);

        console.log('------------------------------------------------');
        console.log(`🎉 成功！书籍ID: ${result.bookId}`);
        console.log(`📝 信息: ${result.message}`);
        console.log('------------------------------------------------');

    } catch (err) {
        console.error('💥 发生错误:', err);
    } finally {
        // 3. 任务结束，断开连接，脚本自动退出
        await mongoose.disconnect();
        console.log('👋 数据库连接已关闭，程序退出。');
        process.exit(0);
    }
};

run();