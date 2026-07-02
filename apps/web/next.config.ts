import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@tartan/types', '@tartan/db', '@tartan/agents'],
  output: 'standalone',
  // Monorepo: trace files from the workspace root, not a stray parent lockfile.
  outputFileTracingRoot: path.join(__dirname, '../../'),
};

export default nextConfig;
