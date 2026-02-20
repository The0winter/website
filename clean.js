import 'dotenv/config';

// ⚠️ 直接指向你的线上域名
const VPS_URL = 'https://jiutianxiaoshuo.com'; 
const SECRET_KEY = process.env.SECRET_KEY;

if (!SECRET_KEY) {
    console.error('❌ 错误：请在 .env 文件中设置 SECRET_KEY');
    process.exit(1);
}

async function triggerCleanup() {
    console.log(`🔗 目标地址: ${VPS_URL}`);
    console.log('🚀 正在向服务器发送清理指令...\n');

    try {
        const response = await fetch(`${VPS_URL}/api/admin/clean-dirty-chapters`, {
            method: 'DELETE', // 对应后端 app.delete
            headers: { 
                'Content-Type': 'application/json', 
                'x-admin-secret': SECRET_KEY 
            }
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(`请求报错: ${response.status} ${response.statusText} - ${data.error || '未知错误'}`);
        }

        console.log('✅ 后端清理完毕，返回结果:');
        console.log('=========================================');
        console.log(` 📢 状态: ${data.message}`);

        if (data.deletedTitles && data.deletedTitles.length > 0) {
            console.log('\n 🗑️ 本次删除了以下冗余章节:');
            data.deletedTitles.forEach(title => console.log(`   - [${title}]`));
        } else {
            console.log('\n ✨ 你的数据库现在非常干净，没有任何冗余章节！');
        }
        console.log('=========================================\n');

    } catch (error) {
        console.error('\n💥 脚本执行出错:', error.message);
    }
}

triggerCleanup();