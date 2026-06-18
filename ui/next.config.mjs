import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    outputFileTracingRoot: repoRoot,
    externalDir: true,
    serverComponentsExternalPackages: ['@rad-orchestration/repo-registry', '@rad-orchestration/telemetry'],
    outputFileTracingIncludes: {
      '/api/registry-smoke': [
        '../lib/repo-registry/dist/**',
        '../lib/repo-registry/package.json',
        '../node_modules/js-yaml/**',
      ],
      '/api/observability/usage': [
        '../lib/telemetry/dist/**',
        '../lib/telemetry/package.json',
      ],
    },
  },
};

export default nextConfig;
