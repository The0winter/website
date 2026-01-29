import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();
// 1. 引入你的 Book 模型 (请确保路径正确！)
// 假设你的模型文件在 models/Book.js
// 如果你还没有模型，请先看下面的“附录：创建模型”
import Book from './models/Book.js'; 

dotenv.config(); // 读取 .env 里的数据库连接字符串

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 🛠️ 配置：你的 JSON 文件名
const JSON_FILE_NAME = '没钱修什么仙？_book_page.json'; 

const importData = async () => {
  try {
    // 2. 连接数据库
    // 确保你的 .env 文件里有 MONGO_URI
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/novel-site');
    console.log('✅ 数据库已连接');

    // 3. 读取 JSON 文件
    const filePath = path.join(__dirname, 'data', JSON_FILE_NAME);
    const rawData = fs.readFileSync(filePath, 'utf-8');
    const bookData = JSON.parse(rawData);

    console.log(`📖 准备导入书籍：《${bookData.title}》，共 ${bookData.chapters.length} 章`);

    // 4. 构建要存入数据库的对象
    // 注意：这里需要根据你的 Mongoose Schema 进行调整
    const newBook = {
      title: bookData.title,
      author: bookData.author || '未知',
      description: '暂无简介', // 爬虫没爬简介，可以手动填或者留空
      category: '修真', // 可以手动指定分类
      coverImage: '', // 封面图 URL，后续可以手动上传
      chapters: bookData.chapters.map((chap, index) => ({
        title: chap.title,
        content: chap.content,
        order: index + 1 // 给章节排个序
      }))
    };

    // 5. 存入数据库
    // 检查是否已经存在同名书，避免重复
    const exist = await Book.findOne({ title: newBook.title });
    if (exist) {
      console.log('⚠️ 这本书已经存在了，正在删除旧数据并重新导入...');
      await Book.deleteOne({ _id: exist._id });
    }

    await Book.create(newBook);

    console.log('🎉 导入成功！');
    process.exit();
  } catch (error) {
    console.error('❌ 导入失败:', error);
    process.exit(1);
  }
};

importData();