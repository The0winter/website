import { submitToIndexNow } from './utils/indexNow.js';

// 填入你网站上已经存在的一个真实书籍链接
const testUrls = [
  'https://jiutianxiaoshuo.com/book/6983b18ede08a115b078f06b' 
];

console.log('🚀 开始尝试手动推送测试...');
submitToIndexNow(testUrls)
  .then(() => console.log('🏁 测试脚本运行结束，请检查上方日志。'))
  .catch(err => console.error('❌ 测试失败:', err));