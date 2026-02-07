// clean_book.js
// 注意：Node.js v18 以上版本自带 fetch，无需 import

const BOOK_TITLE_TO_DELETE = "玄鉴仙族";  // 👈 记得改这里！！
const VPS_URL = 'https://jiutianxiaoshuo.com';
const SECRET_KEY = process.env.SECRET_KEY;
if (!SECRET_KEY) {
    console.error('❌ 错误：请在 .env 文件中设置 SECRET_KEY');
    process.exit(1);
}
(async () => {
    console.log(`🗑️ 正在寻找并删除: 《${BOOK_TITLE_TO_DELETE}》...`);

    try {
        // 1. 先通过书名找到 ID
        const searchRes = await fetch(`${VPS_URL}/api/books?limit=1000`);
        const books = await searchRes.json();
        const targetBook = books.find(b => b.title === BOOK_TITLE_TO_DELETE);

        if (!targetBook) {
            console.log("❌ 没找到这本书，可能已经被删除了，或者书名填错了。");
            return;
        }

        // 2. 发送删除指令
        const delRes = await fetch(`${VPS_URL}/api/books/${targetBook.id}`, {
            method: 'DELETE',
            headers: { 'x-admin-secret': SECRET_KEY }
        });

        if (delRes.ok) {
            console.log(`✅ 成功删除 《${BOOK_TITLE_TO_DELETE}》 (ID: ${targetBook.id})`);
            console.log("👉 现在你可以运行 node upload_to_railway.js 重新上传了！");
        } else {
            console.log(`❌ 删除失败: ${delRes.status} ${delRes.statusText}`);
        }
    } catch (error) {
        console.error("💥 脚本出错:", error.message);
    }
})();