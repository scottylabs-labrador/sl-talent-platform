import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@tartan/types', '@tartan/db', '@tartan/agents'],
  output: 'standalone',
};

export default nextConfig;
