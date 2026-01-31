// upload_to_railway.js
// 专门负责把本地 JSON 发送给 Railway 后端的脚本

import fs from 'fs';
import path from 'path';

// ⚠️ 配置你的 Railway 后端地址 (注意不是 mongodb 地址，是你的网站地址！)
// 格式通常是: https://web-production-xxxx.up.railway.app
// 你可以在 Railway Dashboard 看到这个 Domain
const RAILWAY_URL = 'https://website-production-6edf.up.railway.app'; 

// ⚠️ 刚才在后端设置的密码
const SECRET_KEY = 'wo_de_pa_chong_mi_ma_123';

async function uploadFiles() {
    const downloadDir = path.join(process.cwd(), 'downloads');
    
    if (!fs.existsSync(downloadDir)) {
        console.log('❌ 没有 downloads 文件夹，请先跑离线爬虫！');
        return;
    }

    const files = fs.readdirSync(downloadDir).filter(f => f.endsWith('.json'));
    console.log(`📦 发现 ${files.length} 个文件，准备上传到: ${RAILWAY_URL}`);

    for (const file of files) {
        console.log(`\n🚀 正在上传: ${file} ...`);
        
        try {
            // 1. 读取本地数据
            const filePath = path.join(downloadDir, file);
            const bookData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

            // 2. 发送 HTTP POST 请求 (就像浏览器提交表单一样)
            // Node 18+ 原生支持 fetch，不需要安装额外的库
            const response = await fetch(`${RAILWAY_URL}/api/admin/upload-book`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-admin-secret': SECRET_KEY // 带上密码
                },
                body: JSON.stringify(bookData) // 把大大的 JSON 塞进去
            });

            // 3. 处理结果
            const result = await response.json();
            
            if (response.ok) {
                console.log(`✅ 成功! ${result.message}`);
                // 可选：上传成功后把文件改名，标记为已上传
                // fs.renameSync(filePath, filePath + '.uploaded');
            } else {
                console.error(`❌ 失败 (状态码 ${response.status}):`, result);
            }

        } catch (error) {
            console.error(`💥 网络错误 (是不是地址填错了?):`, error.message);
        }
    }
}

uploadFiles();