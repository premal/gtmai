import type { NextConfig } from 'next';

const apiTarget = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

const config: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/api-proxy/:path*',
        destination: `${apiTarget}/:path*`,
      },
    ];
  },
};

export default config;
