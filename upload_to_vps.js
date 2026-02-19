import fs from 'fs';
import path from 'path';
import 'dotenv/config';

// ⚠️ 你的 VPS 域名
const VPS_URL = 'https://jiutianxiaoshuo.com'; 
const SECRET_KEY = process.env.SECRET_KEY;
if (!SECRET_KEY) {
    console.log('当前目录:', process.cwd());
    console.log('读到的环境变量:', process.env.SECRET_KEY);
    console.error('❌ 错误：请在 .env 文件中设置 SECRET_KEY');
    process.exit(1);
}
// 建议先调小 BATCH_SIZE 试试看能不能绕过服务器限制
const BATCH_SIZE = 25; 

async function uploadFiles() {
    const downloadDir = path.join(process.cwd(), 'downloads');
    
    if (!fs.existsSync(downloadDir)) {
        console.log('❌ 没有 downloads 文件夹');
        return;
    }

    const files = fs.readdirSync(downloadDir).filter(f => f.endsWith('.json'));
    console.log(`📦 扫描到 ${files.length} 本书，准备开始极速同步...`);
    console.log(`🔗 目标地址: ${VPS_URL}\n`);

    // --- 📊 统计数据初始化 ---
    let successCount = 0;
    let skipCount = 0;
    const failedCheckBooks = [];   // 读取或校验失败的名单
    const failedUploadBooks = [];  // 上传过程中崩溃的名单

    for (const file of files) {
        let currentBookTitle = file; // 默认用文件名，读取成功后会被替换为书名
        let currentStage = 'read_and_check'; // 初始状态为：读取与校验阶段

        try {
            const filePath = path.join(downloadDir, file);
            // 读取本地大文件
            const originalData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            currentBookTitle = originalData.title || file;
            const allChapters = originalData.chapters;
            
            console.log(`📘 正在处理: 《${currentBookTitle}》 (本地共 ${allChapters.length} 章)`);

            // --- 第一步：制作“轻量级清单” (不含正文，只有标题) ---
            const simpleList = allChapters.map(c => ({
                title: c.title,
                chapter_number: c.chapter_number
            }));

            // --- 第二步：发送清单给后端核对 ---
            console.log(`   📡 正在与云端核对章节清单...`);
            const checkResponse = await fetch(`${VPS_URL}/api/admin/check-sync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-admin-secret': SECRET_KEY },
                body: JSON.stringify({ 
                    title: currentBookTitle, 
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
                    skipCount++;
                    continue; // 直接跳过这本书
                }
                
                console.log(`   ⚡ 差异对比完成: 仅需上传 ${missingCount} 章`);
                const missingSet = new Set(checkResult.missingTitles);
                chaptersToUpload = allChapters.filter(c => missingSet.has(c.title));
            }

            // --- 第三步：只上传需要的部分 ---
            currentStage = 'upload'; // 🚀 状态切换：进入上传阶段
            
            const totalToUpload = chaptersToUpload.length;
            // 优化：彻底剥离原始超大 chapters 数组，只保留书本的基础信息
            const { chapters: _allChapters, ...payloadBase } = originalData; 
            
            for (let i = 0; i < totalToUpload; i += BATCH_SIZE) {
                const chunk = chaptersToUpload.slice(i, i + BATCH_SIZE);
                
                const payload = {
                    ...payloadBase,
                    chapters: chunk
                };

                const response = await fetch(`${VPS_URL}/api/admin/upload-book`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-admin-secret': SECRET_KEY },
                    body: JSON.stringify(payload)
                });

                if (!response.ok) throw new Error(`上传报错: ${response.status} ${response.statusText}`);

                // 进度条
                const progress = Math.min(100, Math.round(((i + chunk.length) / totalToUpload) * 100));
                process.stdout.write(`   🚀 同步进度: [${progress}%] 已传输 ${i + chunk.length}/${totalToUpload} 章 \r`);
            }

            console.log(`\n   🎉 《${currentBookTitle}》 同步完毕！\n`);
            successCount++;

        } catch (error) {
            console.error(`\n   💥 《${currentBookTitle}》 处理失败: ${error.message}\n`);
            // 根据奔溃时所处的阶段，分类记录错误
            if (currentStage === 'read_and_check') {
                failedCheckBooks.push({ title: currentBookTitle, error: error.message });
            } else {
                failedUploadBooks.push({ title: currentBookTitle, error: error.message });
            }
        }
    }

    // --- 📈 打印最终统计报告 ---
    console.log(`\n=========================================`);
    console.log(` 📊 极速同步任务·最终报告`);
    console.log(`=========================================`);
    console.log(` 📁 总计扫描书籍 : ${files.length} 本`);
    console.log(` ⏭️  完全一致跳过 : ${skipCount} 本`);
    console.log(` ✅ 成功上传/更新 : ${successCount} 本`);
    console.log(` ❌ 读取/校验失败 : ${failedCheckBooks.length} 本`);
    console.log(` 📤 上传过程失败 : ${failedUploadBooks.length} 本`);

    if (failedCheckBooks.length > 0) {
        console.log(`\n ⚠️ 【校验失败名单】(可能是本地JSON损坏或核对接口500):`);
        failedCheckBooks.forEach(b => console.log(`   - 《${b.title}》: ${b.error}`));
    }
    
    if (failedUploadBooks.length > 0) {
        console.log(`\n ⚠️ 【上传失败名单】(可能是单次体积过大或数据库写入500):`);
        failedUploadBooks.forEach(b => console.log(`   - 《${b.title}》: ${b.error}`));
    }
    console.log(`=========================================\n`);
}

uploadFiles();