require('dotenv').config({ path: '../.env' }); // 假设 .env 在上一级，根据实际情况调整

// 优先读取环境变量，读不到才用保底地址
const API_URL = process.env.API_URL 
  ? `${process.env.API_URL}/books` 
  : 'https://jiutianxiaoshuo.com/api/books'; 

console.log('🔗 当前使用的 API 地址:', API_URL);

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