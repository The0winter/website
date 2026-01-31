// upload_to_railway.js
// 旗舰版：支持“差异化极速同步”的上传脚本
import fs from 'fs';
import path from 'path';

// ⚠️ 你的 Railway 域名
const RAILWAY_URL = 'https://website-production-6edf.up.railway.app'; 
const SECRET_KEY = 'wo_de_pa_chong_mi_ma_123';
const BATCH_SIZE = 50; // 每批传50章

async function uploadFiles() {
    const downloadDir = path.join(process.cwd(), 'downloads');
    
    if (!fs.existsSync(downloadDir)) {
        console.log('❌ 没有 downloads 文件夹');
        return;
    }

    const files = fs.readdirSync(downloadDir).filter(f => f.endsWith('.json'));
    console.log(`📦 扫描到 ${files.length} 本书，准备开始极速同步...`);
    console.log(`🔗 目标地址: ${RAILWAY_URL}\n`);

    for (const file of files) {
        try {
            const filePath = path.join(downloadDir, file);
            // 读取本地大文件
            const originalData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            const allChapters = originalData.chapters;
            
            console.log(`📘 正在处理: 《${originalData.title}》 (本地共 ${allChapters.length} 章)`);

            // --- 第一步：制作“轻量级清单” (不含正文，只有标题) ---
            const simpleList = allChapters.map(c => ({
                title: c.title,
                chapter_number: c.chapter_number
            }));

            // --- 第二步：发送清单给后端核对 ---
            console.log(`   📡 正在与云端核对章节清单...`);
            const checkResponse = await fetch(`${RAILWAY_URL}/api/admin/check-sync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-admin-secret': SECRET_KEY },
                body: JSON.stringify({ 
                    title: originalData.title, 
                    simpleChapters: simpleList 
                })
            });

            if (!checkResponse.ok) throw new Error(`核对接口报错: ${checkResponse.statusText}`);
            
            const checkResult = await checkResponse.json();
            
            let chaptersToUpload = [];

            if (checkResult.needsFullUpload) {
                console.log(`   🆕 云端无此书，准备【全量上传】...`);
                chaptersToUpload = allChapters;
            } else {
                const missingCount = checkResult.missingTitles.length;
                if (missingCount === 0) {
                    console.log(`   ✅ 云端数据已完整，无需上传！\n`);
                    continue; // 直接跳过这本书，去处理下一本
                }
                
                console.log(`   ⚡ 差异对比完成: 仅需上传 ${missingCount} 章`);
                
                // 过滤出真正需要上传的章节 (带正文)
                // 使用 Set 来加速查找
                const missingSet = new Set(checkResult.missingTitles);
                chaptersToUpload = allChapters.filter(c => missingSet.has(c.title));
            }

            // --- 第三步：只上传需要的部分 ---
            const totalToUpload = chaptersToUpload.length;
            
            // 构造上传用的 payload (基础信息 + 过滤后的章节)
            const payloadBase = { ...originalData }; 
            
            for (let i = 0; i < totalToUpload; i += BATCH_SIZE) {
                const chunk = chaptersToUpload.slice(i, i + BATCH_SIZE);
                
                // 组装最终发送的数据
                const payload = {
                    ...payloadBase,
                    chapters: chunk
                };

                const response = await fetch(`${RAILWAY_URL}/api/admin/upload-book`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-admin-secret': SECRET_KEY },
                    body: JSON.stringify(payload)
                });

                if (!response.ok) throw new Error(`上传失败: ${response.status} ${response.statusText}`);

                // 进度条
                const progress = Math.min(100, Math.round(((i + chunk.length) / totalToUpload) * 100));
                process.stdout.write(`   🚀 同步进度: [${progress}%] 已传输 ${i + chunk.length}/${totalToUpload} 章 \r`);
            }

            console.log(`\n   🎉 《${originalData.title}》 同步完毕！\n`);

        } catch (error) {
            console.error(`\n   💥 处理失败: ${error.message}\n`);
        }
    }
}

uploadFiles();