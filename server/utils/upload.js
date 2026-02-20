// server/utils/upload.js
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import multer from 'multer';
import 'dotenv/config'; // 确保能读取环境变量

// 1. 配置 Cloudinary (从环境变量读)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// 2. 配置存储引擎
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'novel_covers', // 在 Cloudinary 上自动创建的文件夹名
    allowed_formats: ['jpg', 'png', 'jpeg', 'webp'], // 允许上传的格式
    transformation: [{ width: 500, height: 700, crop: 'limit' }], // (可选) 可以在这里限制最大尺寸
  },
});

// 3. 创建 Multer 实例
const upload = multer({ 
  storage: storage,
  limits: { 
    fileSize: 1.5 * 1024 * 1024 // 明确允许最大 1.5MB 的图片上传
  } 
});

export default upload;