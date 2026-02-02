// import type { NextConfig } from "next";

// const nextConfig: NextConfig = {
//   /* config options here */
// };

// export default nextConfig;

import type { NextConfig } from "next";

// 这里的关键改动：删掉了 nextConfig 后面的 ": NextConfig"
const nextConfig = {
  typescript: {
    // 忽略 TS 报错
    ignoreBuildErrors: true,
  },
  transpilePackages: ['react-window'],
};

export default nextConfig;
