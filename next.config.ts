import type { NextConfig } from 'next';

const standaloneOutputEnabled = !process.env.VERCEL && process.platform !== 'win32';

const nextConfig: NextConfig = {
  output: standaloneOutputEnabled ? 'standalone' : undefined,
  transpilePackages: ['mathml2omml', 'pptxgenjs'],
  serverExternalPackages: [],
  experimental: {
    proxyClientMaxBodySize: '200mb',
  },
};

export default nextConfig;
