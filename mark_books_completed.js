import 'dotenv/config';

const VPS_URL = 'https://jiutianxiaoshuo.com';

// Configure target books by title (recommended).
const TARGET_BOOK_TITLES = [
   '诡秘之主',
   '绍宋',
];

// Configure target books by database ID (optional).
const TARGET_BOOK_IDS = [
  // '67f7cbe7bc451c7c65d4bb9a',
];

function normalizeTitle(title) {
  return String(title || '').trim();
}

function buildPatchHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.SECRET_KEY) {
    headers['x-admin-secret'] = process.env.SECRET_KEY;
  }
  return headers;
}

async function fetchAllBooks() {
  const response = await fetch(`${VPS_URL}/api/books?limit=5000&orderBy=updatedAt&order=desc`);
  if (!response.ok) {
    throw new Error(`获取书籍列表失败: ${response.status} ${response.statusText}`);
  }

  const books = await response.json();
  if (!Array.isArray(books)) {
    throw new Error('获取书籍列表失败: 返回数据不是数组');
  }
  return books;
}

async function markBookCompleted(book) {
  const response = await fetch(`${VPS_URL}/api/books/${book.id}`, {
    method: 'PATCH',
    headers: buildPatchHeaders(),
    body: JSON.stringify({ status: '完结' }),
  });

  if (!response.ok) {
    throw new Error(`PATCH失败: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function main() {
  const normalizedTitles = TARGET_BOOK_TITLES.map(normalizeTitle).filter(Boolean);
  const normalizedIds = TARGET_BOOK_IDS.map((id) => String(id).trim()).filter(Boolean);

  if (normalizedTitles.length === 0 && normalizedIds.length === 0) {
    console.error('请先在 mark_books_completed.js 里填写 TARGET_BOOK_TITLES 或 TARGET_BOOK_IDS');
    process.exit(1);
  }

  console.log('正在读取线上书籍列表...');
  const books = await fetchAllBooks();

  const titleMap = new Map();
  const idMap = new Map();
  for (const book of books) {
    if (!book || !book.id) continue;
    idMap.set(String(book.id), book);
    const title = normalizeTitle(book.title);
    if (title) titleMap.set(title, book);
  }

  const targets = new Map();
  const notFoundTitles = [];
  const notFoundIds = [];

  for (const title of normalizedTitles) {
    const found = titleMap.get(title);
    if (found) targets.set(String(found.id), found);
    else notFoundTitles.push(title);
  }

  for (const id of normalizedIds) {
    const found = idMap.get(id);
    if (found) targets.set(String(found.id), found);
    else notFoundIds.push(id);
  }

  if (notFoundTitles.length > 0) {
    console.log('\n以下书名未找到:');
    notFoundTitles.forEach((title) => console.log(` - ${title}`));
  }

  if (notFoundIds.length > 0) {
    console.log('\n以下书籍ID未找到:');
    notFoundIds.forEach((id) => console.log(` - ${id}`));
  }

  if (targets.size === 0) {
    console.log('\n没有可更新的目标书籍，任务结束。');
    return;
  }

  let updatedCount = 0;
  let alreadyCompletedCount = 0;
  const failed = [];

  console.log(`\n准备更新 ${targets.size} 本书为“完结”...`);

  for (const book of targets.values()) {
    try {
      const title = normalizeTitle(book.title) || book.id;
      if (book.status === '完结') {
        console.log(` - 已是完结，跳过: 《${title}》`);
        alreadyCompletedCount++;
        continue;
      }

      const updated = await markBookCompleted(book);
      console.log(` - 更新成功: 《${title}》 -> ${updated.status}`);
      updatedCount++;
    } catch (error) {
      failed.push({ book, error: error.message });
      console.log(` - 更新失败: 《${normalizeTitle(book.title) || book.id}》: ${error.message}`);
    }
  }

  console.log('\n=========================================');
  console.log(' 批量标记完结报告');
  console.log('=========================================');
  console.log(` 目标总数: ${targets.size}`);
  console.log(` 成功更新: ${updatedCount}`);
  console.log(` 已是完结: ${alreadyCompletedCount}`);
  console.log(` 更新失败: ${failed.length}`);
  if (failed.length > 0) {
    console.log('\n失败明细:');
    failed.forEach((item) => {
      console.log(` - 《${normalizeTitle(item.book.title) || item.book.id}》: ${item.error}`);
    });
  }
  console.log('=========================================');
}

main().catch((error) => {
  console.error('\n脚本执行失败:', error.message);
  process.exit(1);
});
