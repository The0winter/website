// server/migrate_passwords.js
import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from './models/User.js'; 

// 你的数据库连接字符串
const MONGO_URL = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/novel-site';

const migrate = async () => {
  try {
    await mongoose.connect(MONGO_URL);
    console.log('✅ 连接数据库成功');

    const users = await User.find({});
    console.log(`🔍 扫描到 ${users.length} 个用户，准备进行密码加密升级...`);

    let count = 0;
    for (const user of users) {
      // 🕵️ 智能检测：如果密码已经是加密格式（以 $2a$ 开头），就跳过
      if (user.password && user.password.startsWith('$2a$')) {
        continue; 
      }

      // 🔥 核心动作：把明文加密
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(user.password, salt);
      
      // 更新数据库
      // 注意：这里必须用 updateOne，绕过 mongoose 可能存在的其他校验
      await User.updateOne(
          { _id: user._id }, 
          { $set: { password: hashedPassword } }
      );
      
      count++;
      if (count % 100 === 0) process.stdout.write(`   已处理 ${count} 个...\r`);
    }

    console.log(`\n🎉 升级完成！共加密了 ${count} 个旧用户的密码。`);
    process.exit();

  } catch (error) {
    console.error('❌ 出错:', error);
    process.exit(1);
  }
};

migrate();