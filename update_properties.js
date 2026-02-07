// update_rating.js
// 用法：修改这里的配置，然后运行 node update_rating.js

// 1. 填入你要修改的书籍 ID
const BOOK_ID = '697f7cbe7bc451c7c65d4bb9'; 

// 2. 填入你想设定的数值 (这里只改阅读量)
const NEW_DATA = {
    views: 0,          // 初始化阅读量为 0
};

const API_URL = 'https://jiutianxiaoshuo.com/api/books';

(async () => {
    console.log(`📝 正在修改书籍 ID: ${BOOK_ID}...`);
    // 👇 日志改对了，显示你要改的阅读量
    console.log(`   目标数据: 阅读量设为 ${NEW_DATA.views}`); 

    try {
        const res = await fetch(`${API_URL}/${BOOK_ID}`, {
            method: 'PATCH', // 局部更新
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(NEW_DATA)
        });

        if (res.ok) {
            const updatedBook = await res.json();
            console.log('✅ 修改成功！');
            console.log('-----------------------------------');
            console.log(`书名: 《${updatedBook.title}》`);
            // 👇 关键：打印返回的 views，确认数据库真的有了！
            console.log(`当前阅读量 (views): ${updatedBook.views}`); 
            console.log(`当前评分: ${updatedBook.rating}`);
        } else {
            console.log(`❌ 修改失败: ${res.status} ${res.statusText}`);
        }
    } catch (e) {
        console.error('💥 脚本出错:', e);
    }
})();