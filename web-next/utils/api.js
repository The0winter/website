// web-next/utils/api.js

export const getApiBaseUrl = () => {
  // typeof window === 'undefined' 是判断当前代码是否运行在 Node.js 服务器环境（即 SSR 时）的绝对标准
  if (typeof window === 'undefined') {
    // 服务端渲染时：返回内网地址。如果没有配置，默认退回到本地 5000 端口
    return process.env.INTERNAL_API_URL || 'http://127.0.0.1:5000/api';
  }
  
  // 客户端运行时（浏览器环境）：返回带 NEXT_PUBLIC_ 前缀的公网地址
  return process.env.NEXT_PUBLIC_API_URL || 'https://jiutianxiaoshuo.com/api';
};