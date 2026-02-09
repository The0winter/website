// web-next/lib/upload.js

export default async function uploadImageToCloudinary(file) {
  // 1. 准备表单数据
  const formData = new FormData();
  formData.append('file', file); // 必须叫 'file'，对应后端 upload.single('file')

  // 2. 获取后端地址
  const SERVER_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
  
  // 3. 获取 Token (因为你的后端接口有 authMiddleware)
  // 假设你的 token 存在 localStorage 里，名字叫 'token'
  // 如果你的 AuthContext 存的名字不一样，请在这里修改
  const token = localStorage.getItem('token'); 

  if (!token) {
    throw new Error('未登录，无法上传图片');
  }

  try {
    // 4. 发送请求
    const response = await fetch(`${SERVER_URL}/api/upload/cover`, {
      method: 'POST',
      headers: {
        // 注意：fetch 发送 FormData 时千万不要手动设置 'Content-Type'
        'Authorization': `Bearer ${token}` // 把 Token 带给后端
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