// run_search.js
import dotenv from 'dotenv';
dotenv.config({ path: './server/.env' }); // 确保能连上数据库
import mongoose from 'mongoose';
import { scrapeAndSaveBook, searchBookAndGetUrl } from './server/utils/scraperService.js';
import readline from 'readline';

// 连接数据库配置
const MONGO_URL = 'mongodb://1505993663_db_user:nQUNYNryJ0h9En0v@ac-ajkro1e-shard-00-00.xsa60lo.mongodb.net:27017,ac-ajkro1e-shard-00-01.xsa60lo.mongodb.net:27017,ac-ajkro1e-shard-00-02.xsa60lo.mongodb.net:27017/?replicaSet=atlas-13w2me-shard-0&ssl=true&authSource=admin';

// 创建命令行交互接口
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

async function main() {
    try {
        // 1. 连接数据库
        console.log('🔌 正在连接数据库...');
        
        // 👇👇👇 关键修改：增加 family: 4 选项
        await mongoose.connect(MONGO_URL, {
            serverSelectionTimeoutMS: 30000, 
            socketTimeoutMS: 45000,
            family: 4 // 🔥 强制使用 IPv4，通常能解决“莫名其妙连不上”的问题
        });
        console.log('✅ 数据库连接成功！');

        // 2. 询问书名
        rl.question('请输入你想爬取的书籍名称: ', async (bookName) => {
            if (!bookName.trim()) {
                console.log('❌ 书名不能为空！');
                process.exit(0);
            }

            try {
                // 3. 自动搜索获取链接
                const targetUrl = await searchBookAndGetUrl(bookName);
                
                if (targetUrl) {
                    // 4. 开始爬取
                    console.log(`🚀 目标锁定，开始爬取: ${targetUrl}`);
                    // 使用书名作为自定义ID的前缀，防止乱码
                    const customId = 'auto_' + Date.now(); 
                    await scrapeAndSaveBook(targetUrl, customId);
                }

            } catch (err) {
                console.error('💥 发生错误:', err.message);
            } finally {
                await mongoose.disconnect();
                process.exit(0);
            }
        });

    } catch (error) {
        console.error('❌ 初始化失败:', error);
        process.exit(1);
    }
}

main();