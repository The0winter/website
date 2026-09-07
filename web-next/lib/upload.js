import { safeFetch as fetch } from '@/lib/request';
// web-next/lib/upload.js

export default async function uploadImageToCloudinary(file) {
  // 1. 准备表单数据
  const formData = new FormData();
  formData.append('file', file); // 必须叫 'file'，对应后端 upload.single('file')

  // 2. 获取后端地址
  const SERVER_URL = '';
  
  // 3. 获取 Token (因为你的后端接口有 authMiddleware)
  // 假设你的 token 存在 localStorage 里，名字叫 'token'
  // 如果你的 AuthContext 存的名字不一样，请在这里修改


  try {
    // 4. 发送请求
    const response = await fetch(`${SERVER_URL}/api/upload/cover`, {
      method: 'POST',
      headers: {
        // 注意：fetch 发送 FormData 时千万不要手动设置 'Content-Type'
      },
      body: formData,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || '上传失败，请稍后重试');
    }

    // 5. 返回图片 URL
    return data.url; 

  } catch (error) {
    console.error('上传出错:', error);
    throw error;
  }
}