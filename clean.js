// 确保你的 Node.js 版本支持原生的 fetch (v18+)

async function triggerCleanup() {
    // 1. 你的后端 API 地址
    const API_URL = 'http://127.0.0.1:5000/api/admin/clean-dirty-chapters';
    
    // 2. ⚠️ 重要：将这里替换为你后端 .env 文件中真实的 ADMIN_SECRET
    // 如果你没在 .env 里配过，那你后端的默认值就是 'temp_admin_secret_123'
    const ADMIN_SECRET = 'temp_admin_secret_123'; 

    try {
        console.log('🚀 正在通过后端接口发起清理请求...');
        
        const response = await fetch(API_URL, {
            method: 'DELETE',
            headers: {
                'x-admin-secret': ADMIN_SECRET,
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('❌ 请求失败:', data.error || response.statusText);
            return;
        }

        // 打印后端返回的美化结果
        console.log('\n✅ 后端返回结果:');
        console.log('--------------------------------------------------');
        console.log(data.message);

        if (data.deletedTitles && data.deletedTitles.length > 0) {
            console.log('\n🗑️ 本次删除了以下章节:');
            data.deletedTitles.forEach(title => console.log(`  - [${title}]`));
        }
        console.log('--------------------------------------------------');

    } catch (error) {
        console.error('❌ 脚本执行出错:', error.message);
    }
}

triggerCleanup();