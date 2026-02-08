// server/fix_users.js
import 'dotenv/config'; // 确保能读取 .env 里的数据库地址
import mongoose from 'mongoose';


const MONGO_URL = 'mongodb://1505993663_db_user:nQUNYNryJ0h9En0v@ac-ajkro1e-shard-00-00.xsa60lo.mongodb.net:27017,ac-ajkro1e-shard-00-01.xsa60lo.mongodb.net:27017,ac-ajkro1e-shard-00-02.xsa60lo.mongodb.net:27017/data?replicaSet=atlas-13w2me-shard-0&ssl=true&authSource=admin';
const migrate = async () => {
  try {
    console.log('🚀 [第1步] 正在连接数据库...');
    await mongoose.connect(MONGO_URL);
    console.log(`✅ 连接成功！当前连接的数据库名: [ ${mongoose.connection.name} ]`);
    
    // ---------------------------------------------------------
    // 🔍 侦探环节：看看数据库里到底有哪些表？
    // ---------------------------------------------------------
    const collections = await mongoose.connection.db.listCollections().toArray();
    const collectionNames = collections.map(c => c.name);
    console.log('Tb [第2步] 数据库里的集合列表:', collectionNames);

    if (collectionNames.length === 0) {
        console.log('❌ 警告：当前数据库是空的！');
        console.log('💡 原因猜测：你的连接字符串里可能没写库名，默认连到了 test 或 admin 库，但你的数据在另一个库里。');
        console.log('👉 解决办法：在连接字符串的 .net/ 后面加上你的数据库名字。');
        return;
    }

    // ---------------------------------------------------------
    // 🛠 自动修正环节：自动找 'users' 还是 'Users'
    // ---------------------------------------------------------
    let targetCollectionName = collectionNames.find(name => name.toLowerCase() === 'users');
    
    if (!targetCollectionName) {
        console.log('❌ 错误：没找到 users 或 Users 集合！请检查上面的列表。');
        return;
    }

    console.log(`Cb [第3步] 锁定目标集合: [ ${targetCollectionName} ]`);
    const usersCollection = mongoose.connection.db.collection(targetCollectionName);

    // ---------------------------------------------------------
    // 💉 手术环节：强制给所有人打补丁
    // ---------------------------------------------------------
    // 不再检查 $exists，直接给所有人覆盖，防止漏网之鱼
    const result = await usersCollection.updateMany(
      {}, // 匹配所有人
      { 
        $set: { 
            loginAttempts: 0,
            lockUntil: 0 // 初始化为 0 或 null
        } 
      }
    );

    console.log('-----------------------------------');
    console.log(`🎉 修复报告:`);
    console.log(`   - 匹配到的用户数: ${result.matchedCount}`);
    console.log(`   - 实际修改的用户数: ${result.modifiedCount}`);
    console.log('-----------------------------------');
    
    if (result.matchedCount > 0) {
        console.log('✅ 数据修复完成！现在请重启你的主服务器 (node index.js)');
    } else {
        console.log('❓ 奇怪，集合里好像没有用户数据？');
    }

  } catch (err) {
    console.error('❌ 脚本出错:', err);
  } finally {
    await mongoose.disconnect();
    process.exit();
  }
};

migrate();