// fix_db_order_v2.js
// 修正版：既然数据库没有 link 字段，我们强制使用 title 进行匹配
import fs from 'fs';
import path from 'path';
import { MongoClient } from 'mongodb'; 

// ⚠️ 请确保这里是你的真实连接地址
const MONGO_URI = process.env.MONGO_URI_LOCAL; 
// ⚠️ 数据库名 (看截图你的数据库好像叫 "test" 下的 "chapters" 集合，但也可能是 "data" 库)
// 请务必确认你的 Cluster0 下面那个库的名字，截图看左边是 "Cluster0 -> data -> chapters"
// 所以这里很可能应该是 'data'
const DB_NAME = 'data'; 

console.log('🔧 启动【数据库顺序强制修复 - 标题匹配版】...');

(async () => {
    const downloadDir = path.join(process.cwd(), 'downloads');
    // 读取所有 json 文件
    const files = fs.readdirSync(downloadDir).filter(f => f.endsWith('.json'));

    if (files.length === 0) {
        console.log('❌ 没找到本地 JSON 文件。');
        process.exit(0);
    }

    const client = new MongoClient(MONGO_URI);
    
    try {
        await client.connect();
        console.log('✅ 已连接数据库');
        const db = client.db(DB_NAME);
        
        // 注意：看截图你的集合名是 "chapters"，不是 "books" 的子字段
        // 但通常 books 集合存书名，chapters 集合存章节
        const booksCollection = db.collection('books');
        const chaptersCollection = db.collection('chapters');

        for (const file of files) {
            const filePath = path.join(downloadDir, file);
            const bookData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            
            console.log(`\n📘 正在处理: 《${bookData.title}》`);

            // 1. 先找到书的 ID (Book ID)
            const book = await booksCollection.findOne({ title: bookData.title });
            if (!book) {
                console.log(`   ⚠️ 数据库里没找到书名: 《${bookData.title}》，无法同步章节。`);
                // 尝试模糊匹配或者打印数据库里的书名帮助调试
                continue;
            }

            console.log(`   ID: ${book._id}`);
            console.log(`   本地共有 ${bookData.chapters.length} 章，开始同步顺序...`);
            
            // 2. 批量构建写入操作
            const bulkOps = bookData.chapters.map((chap, index) => {
                // 🚨 核心修改：只用 title 和 bookId 匹配
                // 我们使用 trim() 去掉两端空格，防止 "第1章 " 和 "第1章" 不匹配
                return {
                    updateOne: {
                        filter: { 
                            bookId: book._id,
                            title: chap.title.trim() // 强力依赖标题匹配
                        },
                        update: { 
                            $set: { 
                                chapter_number: index + 1, // 强制改为本地的顺序
                                // 顺便把 link 补进去，以后就好修了（可选）
                                // link: chap.link 
                            } 
                        }
                    }
                };
            });

            if (bulkOps.length > 0) {
                // 执行批量更新
                const result = await chaptersCollection.bulkWrite(bulkOps);
                
                // 🔥 打印结果
                console.log(`   ----------------------------------------`);
                console.log(`   ✅ 匹配并更新了: ${result.modifiedCount} 章`);
                console.log(`   ⚠️ 未能匹配的章节: ${bookData.chapters.length - result.matchedCount} 章`);
                
                if (result.matchedCount === 0) {
                    console.log(`   ❌ 警告：所有章节都没匹配上！可能是书名匹配了但章节名有空格差异。`);
                }
            }
        }

        console.log('\n🎉 修复脚本运行结束！请刷新网页查看。');

    } catch (error) {
        console.error('💥 发生错误:', error);
    } finally {
        await client.close();
    }
})();