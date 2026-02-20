import fs from 'fs';
import path from 'path';
import 'dotenv/config';

const VPS_URL = 'https://jiutianxiaoshuo.com';
const SECRET_KEY = process.env.SECRET_KEY;
const BATCH_SIZE = 25;

if (!SECRET_KEY) {
  console.log('当前目录:', process.cwd());
  console.log('读到的 SECRET_KEY:', process.env.SECRET_KEY);
  console.error('错误: 请在 .env 文件中配置 SECRET_KEY');
  process.exit(1);
}

async function fetchCompletedBookTitles() {
  const response = await fetch(`${VPS_URL}/api/books?limit=5000&orderBy=updatedAt&order=desc`);
  if (!response.ok) {
    throw new Error(`获取数据库书籍列表失败: ${response.status} ${response.statusText}`);
  }

  const books = await response.json();
  if (!Array.isArray(books)) {
    throw new Error('获取数据库书籍列表失败: 返回数据不是数组');
  }

  return new Set(
    books
      .filter((book) => book && book.status === '完结' && typeof book.title === 'string')
      .map((book) => book.title.trim())
      .filter(Boolean)
  );
}

async function uploadFiles() {
  const downloadDir = path.join(process.cwd(), 'downloads');
  if (!fs.existsSync(downloadDir)) {
    console.log('错误: 没有 downloads 文件夹');
    return;
  }

  const files = fs.readdirSync(downloadDir).filter((f) => f.endsWith('.json'));
  console.log(`扫描到 ${files.length} 本书，准备开始同步...`);
  console.log(`目标地址: ${VPS_URL}\n`);

  const completedTitles = await fetchCompletedBookTitles();
  console.log(`数据库中已标记“完结”的书: ${completedTitles.size} 本\n`);

  let successCount = 0;
  let syncSkipCount = 0;
  let completedSkipCount = 0;
  const failedCheckBooks = [];
  const failedUploadBooks = [];

  for (const file of files) {
    let currentBookTitle = file;
    let currentStage = 'read_and_check';

    try {
      const filePath = path.join(downloadDir, file);
      const originalData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      currentBookTitle = (originalData.title || file).trim();
      const allChapters = Array.isArray(originalData.chapters) ? originalData.chapters : [];

      console.log(`处理: 《${currentBookTitle}》 (本地共 ${allChapters.length} 章)`);

      if (completedTitles.has(currentBookTitle)) {
        console.log('   跳过: 数据库状态为“完结”，不再上传\n');
        completedSkipCount++;
        continue;
      }

      const simpleList = allChapters.map((c) => ({
        title: c.title,
        chapter_number: c.chapter_number,
      }));

      console.log('   正在与云端核对章节清单...');
      const checkResponse = await fetch(`${VPS_URL}/api/admin/check-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-secret': SECRET_KEY },
        body: JSON.stringify({
          title: currentBookTitle,
          simpleChapters: simpleList,
        }),
      });

      if (!checkResponse.ok) {
        throw new Error(`核对接口报错: ${checkResponse.status} ${checkResponse.statusText}`);
      }

      const checkResult = await checkResponse.json();
      let chaptersToUpload = [];

      if (checkResult.needsFullUpload) {
        console.log('   云端无此书，准备全量上传...');
        chaptersToUpload = allChapters;
      } else {
        const missingTitles = Array.isArray(checkResult.missingTitles) ? checkResult.missingTitles : [];
        const missingCount = missingTitles.length;

        if (missingCount === 0) {
          console.log('   云端数据已完整，无需上传\n');
          syncSkipCount++;
          continue;
        }

        console.log(`   差异对比完成: 仅需上传 ${missingCount} 章`);
        const missingSet = new Set(missingTitles);
        chaptersToUpload = allChapters.filter((c) => missingSet.has(c.title));
      }

      currentStage = 'upload';

      const totalToUpload = chaptersToUpload.length;
      const { chapters: _allChapters, ...payloadBase } = originalData;

      for (let i = 0; i < totalToUpload; i += BATCH_SIZE) {
        const chunk = chaptersToUpload.slice(i, i + BATCH_SIZE);
        const payload = {
          ...payloadBase,
          chapters: chunk,
        };

        const response = await fetch(`${VPS_URL}/api/admin/upload-book`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-admin-secret': SECRET_KEY },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error(`上传报错: ${response.status} ${response.statusText}`);
        }

        const progress = Math.min(100, Math.round(((i + chunk.length) / totalToUpload) * 100));
        process.stdout.write(
          `   同步进度: [${progress}%] 已上传 ${i + chunk.length}/${totalToUpload} 章\r`
        );
      }

      console.log(`\n   《${currentBookTitle}》同步完毕\n`);
      successCount++;
    } catch (error) {
      console.error(`\n   《${currentBookTitle}》处理失败: ${error.message}\n`);
      if (currentStage === 'read_and_check') {
        failedCheckBooks.push({ title: currentBookTitle, error: error.message });
      } else {
        failedUploadBooks.push({ title: currentBookTitle, error: error.message });
      }
    }
  }

  console.log('\n=========================================');
  console.log(' 同步任务最终报告');
  console.log('=========================================');
  console.log(` 总扫描书籍: ${files.length} 本`);
  console.log(` 跳过(数据库完结): ${completedSkipCount} 本`);
  console.log(` 跳过(云端已完整): ${syncSkipCount} 本`);
  console.log(` 成功上传/更新: ${successCount} 本`);
  console.log(` 读取/核验失败: ${failedCheckBooks.length} 本`);
  console.log(` 上传过程失败: ${failedUploadBooks.length} 本`);

  if (failedCheckBooks.length > 0) {
    console.log('\n【核验失败名单】');
    failedCheckBooks.forEach((b) => console.log(` - 《${b.title}》: ${b.error}`));
  }

  if (failedUploadBooks.length > 0) {
    console.log('\n【上传失败名单】');
    failedUploadBooks.forEach((b) => console.log(` - 《${b.title}》: ${b.error}`));
  }

  console.log('=========================================\n');
}

uploadFiles();
