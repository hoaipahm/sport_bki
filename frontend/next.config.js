const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.resolve(__dirname, '..'),
  turbopack: {
    root: path.resolve(__dirname, '..'),
  },
  experimental: {
    externalDir: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'img.vietqr.io',
      },
      {
        protocol: 'http',
        hostname: 'localhost',
      },
    ],
  },
};

module.exports = nextConfig;
