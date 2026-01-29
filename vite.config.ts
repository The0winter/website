import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // 保持你原有的配置，防止图标报错
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  // ✅ 这里是关键！新增代理配置
  server: {
    proxy: {
      '/api': {
        target: 'https://website-production-565f.up.railway.app', // 告诉前端：凡是 /api 开头的请求，都转发给后端 5000 端口
        changeOrigin: true,
        secure: false,
      },
    },
  },
});