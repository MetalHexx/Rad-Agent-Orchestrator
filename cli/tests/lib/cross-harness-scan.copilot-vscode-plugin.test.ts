import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectCopilotVscodePlugin } from '../../src/lib/cross-harness-scan.js';

function currentPlatform(): 'darwin' | 'linux' | 'win32' {
  return process.platform === 'darwin' ? 'darwin' : process.platform === 'linux' ? 'linux' : 'win32';
}

function appDataRootFor(home: string, platform: 'darwin' | 'linux' | 'win32'): string {
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Code');
  if (platform === 'linux') return path.join(home, '.config', 'Code');
  return path.join(home, 'AppData', 'Roaming', 'Code');
}

function makeFakeHome(platform: 'darwin' | 'linux' | 'win32', layout: 'present' | 'absent'): { home: string; expectedPath: string; cleanup: () => void } {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-detect-'));
  const seg = path.join('agentPlugins', 'github.com', 'MetalHexx', 'RadOrchestration');
  const appData = appDataRootFor(home, platform);
  const expectedPath = path.join(appData, seg);
  if (layout === 'present') fs.mkdirSync(expectedPath, { recursive: true });
  return { home, expectedPath, cleanup: () => fs.rmSync(home, { recursive: true, force: true }) };
}

describe('detectCopilotVscodePlugin — OS-specific agentPlugins path probe', () => {
  it('returns true when the legacy-org plugin directory exists under the platform-matched path', () => {
    const { home, cleanup } = makeFakeHome(currentPlatform(), 'present');
    try {
      expect(detectCopilotVscodePlugin({ home })).toBe(true);
    } finally { cleanup(); }
  });

  it('returns true when the new-marketplace org/repo directory exists under the platform-matched path', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-detect-new-'));
    try {
      const base = appDataRootFor(home, currentPlatform());
      fs.mkdirSync(path.join(base, 'agentPlugins', 'github.com', 'radancy-pe', 'rai-ops-plugin-marketplace'), { recursive: true });
      expect(detectCopilotVscodePlugin({ home })).toBe(true);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('returns false when no agentPlugins/github.com/.../ path exists', () => {
    const { home, cleanup } = makeFakeHome(currentPlatform(), 'absent');
    try {
      expect(detectCopilotVscodePlugin({ home })).toBe(false);
    } finally { cleanup(); }
  });

  it('honors the override parameters so tests can swap org/repo segments, ignoring defaults that exist', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-detect-ovr-'));
    try {
      const base = appDataRootFor(home, currentPlatform());
      fs.mkdirSync(path.join(base, 'agentPlugins', 'github.com', 'OtherOrg', 'OtherRepo'), { recursive: true });
      expect(detectCopilotVscodePlugin({ home, org: 'OtherOrg', repo: 'OtherRepo' })).toBe(true);
      expect(detectCopilotVscodePlugin({ home })).toBe(false);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
