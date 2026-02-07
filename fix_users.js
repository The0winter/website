// server/fix_users.js
import 'dotenv/config'; // 确保能读取 .env 里的数据库地址
import mongoose from 'mongoose';


const MONGO_URL = 'mongodb://1505993663_db_user:nQUNYNryJ0h9En0v@ac-ajkro1e-shard-00-00.xsa60lo.mongodb.net:27017,ac-ajkro1e-shard-00-01.xsa60lo.mongodb.net:27017,ac-ajkro1e-shard-00-02.xsa60lo.mongodb.net:27017/?replicaSet=atlas-13w2me-shard-0&ssl=true&authSource=admin';
const migrate = async () => {
  try {
    console.log('🚀 开始修复老用户数据...');

    // 1. 连接数据库
    if (!MONGO_URL) {
        throw new Error("❌ 没找到 MONGO_URL，请确保 .env 文件配置正确");
    }
    await mongoose.connect(MONGO_URL, {
        serverSelectionTimeoutMS: 10000, // 10 秒连接超时
        socketTimeoutMS: 5000,
    });
    console.log('✅ 数据库连接成功');

    // 2. 获取 users 集合 (直接操作底层 DB，不经过 Mongoose Schema，这样最稳)
    const usersCollection = mongoose.connection.db.collection('users');

    // 3. 核心修复逻辑
    // 查找所有“没有 loginAttempts 字段”的用户，把这个字段补上并设为 0
    const updateResult = await usersCollection.updateMany(
      { loginAttempts: { $exists: false } }, // 筛选条件
      { $set: { loginAttempts: 0 } }         // 修改动作
    );

    console.log('-----------------------------------');
    console.log(`🎉 修复完成！`);
    console.log(`📋 扫描到的老用户数: ${updateResult.matchedCount}`);
    console.log(`🛠️ 成功修复的用户数: ${updateResult.modifiedCount}`);
    console.log('-----------------------------------');

  } catch (err) {
    console.error('❌ 脚本运行出错:', err);
  } finally {
    // 4. 断开连接
    await mongoose.disconnect();
    console.log('👋 数据库连接已断开');
    process.exit();
  }
};

migrate();