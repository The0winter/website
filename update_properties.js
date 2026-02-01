// update_rating.js
// 用法：修改这里的配置，然后运行 node update_rating.js

// 1. 填入你要修改的书籍 ID (从你的截图里复制 _id)
// 比如截图里的《天才游乐场》ID
const BOOK_ID = '697f7cbe7bc451c7c65d4bb9'; 

// 2. 填入你想设定的数值
const NEW_DATA = {
    rating: 0,       // 评分 (比如 9.5)
    numReviews: 0    // 评价人数 (比如 128 人)
};

const API_URL = 'https://website-production-6edf.up.railway.app/api/books';

(async () => {
    console.log(`📝 正在修改书籍 ID: ${BOOK_ID}...`);
    console.log(`   目标数据: 评分 ${NEW_DATA.rating} / 人数 ${NEW_DATA.numReviews}`);

    try {
        const res = await fetch(`${API_URL}/${BOOK_ID}`, {
            method: 'PATCH', // 使用 PATCH 方法进行局部更新
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(NEW_DATA)
        });

        if (res.ok) {
            const updatedBook = await res.json();
            console.log('✅ 修改成功！');
            console.log('-----------------------------------');
            console.log(`书名: 《${updatedBook.title}》`);
            console.log(`最新评分: ${updatedBook.rating}`);
            console.log(`最新评价数: ${updatedBook.numReviews}`);
        } else {
            console.log(`❌ 修改失败: ${res.status} ${res.statusText}`);
        }
    } catch (e) {
        console.error('💥 脚本出错:', e);
    }
})();