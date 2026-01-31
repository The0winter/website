// upload_to_railway.js
// 进阶版：支持分批上传和进度显示的搬运脚本

import fs from 'fs';
import path from 'path';

// ⚠️ 你的 Railway 域名 (保持不变)
const RAILWAY_URL = 'https://website-production-6edf.up.railway.app'; 
const SECRET_KEY = 'wo_de_pa_chong_mi_ma_123';

// ⭐ 设置每次上传多少章 (建议 50-100)
const BATCH_SIZE = 50;

async function uploadFiles() {
    const downloadDir = path.join(process.cwd(), 'downloads');
    
    if (!fs.existsSync(downloadDir)) {
        console.log('❌ 没有 downloads 文件夹');
        return;
    }

    const files = fs.readdirSync(downloadDir).filter(f => f.endsWith('.json'));
    console.log(`📦 扫描到 ${files.length} 本书，准备开始分批搬运...`);
    console.log(`🔗 目标地址: ${RAILWAY_URL}\n`);

    for (const file of files) {
        console.log(`📖 正在处理文件: ${file}`);
        
        try {
            const filePath = path.join(downloadDir, file);
            // 读取原始大文件
            const originalData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            const allChapters = originalData.chapters;
            const totalChapters = allChapters.length;

            console.log(`   - 书名: 《${originalData.title}》`);
            console.log(`   - 总章节数: ${totalChapters} 章`);
            console.log(`   - 模式: 每批上传 ${BATCH_SIZE} 章`);

            // --- 开始分批循环 ---
            for (let i = 0; i < totalChapters; i += BATCH_SIZE) {
                // 切割出一小块章节 (例如 0-50, 50-100)
                const chunk = allChapters.slice(i, i + BATCH_SIZE);
                
                // 构造这一批的请求数据 (保留书籍元数据，但章节只放这一小块)
                const payload = {
                    ...originalData,
                    chapters: chunk
                };

                // 发送请求
                // console.log(`   ⏳ 正在上传第 ${i + 1} - ${i + chunk.length} 章...`);
                
                const response = await fetch(`${RAILWAY_URL}/api/admin/upload-book`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-admin-secret': SECRET_KEY
                    },
                    body: JSON.stringify(payload)
                });

                if (!response.ok) {
                    throw new Error(`服务器返回错误: ${response.status} ${response.statusText}`);
                }

                // 计算进度百分比
                const progress = Math.min(100, Math.round(((i + chunk.length) / totalChapters) * 100));
                
                // ✨ 打印漂亮的进度条
                // \r 可以让光标回到行首，实现“原地刷新”效果，而不是刷屏
                process.stdout.write(`   🚀 进度: [${progress}%] 已上传 ${i + chunk.length}/${totalChapters} 章 \r`);
            }

            console.log(`\n   ✅ 《${originalData.title}》 全部上传完毕！\n`);

        } catch (error) {
            console.error(`\n   💥 上传失败: ${error.message}`);
        }
    }
}

uploadFiles();