import type { NextConfig } from 'next';
const target = (process.env.INTERNAL_API_URL || 'http://127.0.0.1:5000/api').replace(/\/+$/, '');
const config: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next-candidate',
  experimental: { staleTimes: { static: 60 } },
  async headers() {
    return [{source: '/textures/reader-paper-v2.webp', headers: [{key: 'Cache-Control', value: 'public, max-age=31536000, immutable'}]}];
  },
  async rewrites() { return [{ source: '/api/:path*', destination: target + '/:path*' }]; },
};
export default config;
