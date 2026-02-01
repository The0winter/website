// init_rankings.js - 初始化所有榜单字段
const API_URL = 'https://website-production-6edf.up.railway.app/api/books'; // 确认你的API地址

(async () => {
    console.log('🚀 开始初始化排行榜字段...');

    try {
        const res = await fetch(`${API_URL}?limit=1000`);
        const books = await res.json();
        
        let count = 0;
        
        for (const book of books) {
            // 如果缺少任意一个字段，就补全
            if (book.daily_views === undefined || book.weekly_views === undefined || book.monthly_views === undefined) {
                console.log(`🔧 正在修复: 《${book.title}》...`);
                
                await fetch(`${API_URL}/${book.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        daily_views: 0,
                        weekly_views: 0,
                        monthly_views: 0
                    })
                });
                count++;
            }
        }
        
        console.log(`\n✅ 初始化完成！共修复了 ${count} 本书。`);

    } catch (e) {
        console.error('出错:', e);
    }
})();