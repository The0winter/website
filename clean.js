import 'dotenv/config';

const VPS_URL = 'https://jiutianxiaoshuo.com'; 
const SECRET_KEY = process.env.SECRET_KEY;

if (!SECRET_KEY) {
    console.error('❌ 错误：请在 .env 文件中设置 SECRET_KEY');
    process.exit(1);
}

// ⚠️ 核心安全开关 ⚠️
// 改为 'preview' -> 只查出名单给你看，绝对不删数据 (安全)
// 改为 'execute' -> 确认无误，真枪实弹执行删除 (危险)
const RUN_MODE = 'preview'; 

async function triggerCleanup() {
    console.log(`🔗 目标地址: ${VPS_URL}`);
    console.log(`🚀 当前运行模式: [${RUN_MODE === 'execute' ? '🔥 真实删除' : '👀 安全预览'}]\n`);

    try {
        const response = await fetch(`${VPS_URL}/api/admin/clean-dirty-chapters`, {
            method: 'POST', // 改为 POST 请求
            headers: { 
                'Content-Type': 'application/json', 
                'x-admin-secret': SECRET_KEY 
            },
            // 把指令发给后端
            body: JSON.stringify({ action: RUN_MODE })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(`请求报错: ${response.status} ${response.statusText} - ${data.error || '未知错误'}`);
        }

        console.log('✅ 后端响应完毕:');
        console.log('=========================================');
        console.log(` 📢 状态: ${data.message}`);

        if (data.summary && data.summary.length > 0) {
            console.log('\n 📊 各书籍受影响的章节数:');
            data.summary.forEach(item => {
                console.log(`   📖 《${item.title}》: 命中 ${item.count} 章重复数据`);
            });
            
            if (data.isDryRun) {
                console.log('\n💡 提示: 如果你确认以上数据都是要删除的冗余章节，');
                console.log("   请将代码中的 RUN_MODE 改为 'execute'，然后重新运行本脚本。");
            }
        } else {
            console.log('\n ✨ 你的数据库现在非常干净，没有任何冗余章节！');
        }
        console.log('=========================================\n');

    } catch (error) {
        console.error('\n💥 脚本执行出错:', error.message);
    }
}

triggerCleanup();