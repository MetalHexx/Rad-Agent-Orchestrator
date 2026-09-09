import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const homeDirTracingIgnore = `${os.homedir().split(path.sep).join('/')}/**`;

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    outputFileTracingRoot: repoRoot,
    externalDir: true,
    serverComponentsExternalPackages: ['@rad-orchestration/repo-registry', '@rad-orchestration/telemetry', '@rad-orchestration/work-graph', '@rad-orchestration/terminal-launch'],
    outputFileTracingIgnores: [homeDirTracingIgnore],
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
      '/api/work-graph': [
        '../lib/work-graph/dist/**',
        '../lib/work-graph/package.json',
        '../lib/repo-registry/dist/**',
        '../lib/repo-registry/package.json',
        '../node_modules/js-yaml/**',
      ],
      '/api/projects/[name]/sessions/[sessionId]/launch': [
        '../lib/terminal-launch/dist/**',
        '../lib/terminal-launch/package.json',
      ],
      '/api/projects/[name]/sessions': [
        '../lib/telemetry/dist/**',
        '../lib/telemetry/package.json',
      ],
      '/api/projects/[name]/start-action': [
        '../lib/terminal-launch/dist/**',
        '../lib/terminal-launch/package.json',
      ],
    },
  },
};

export default nextConfig;
