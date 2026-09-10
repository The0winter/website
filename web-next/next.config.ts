import type { NextConfig } from 'next';
const target = (process.env.INTERNAL_API_URL || 'http://127.0.0.1:5000/api').replace(/\/+$/, '');
const config: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next-candidate',
  experimental: { staleTimes: { static: 60 } },
  async rewrites() { return [{ source: '/api/:path*', destination: target + '/:path*' }]; },
};
export default config;
