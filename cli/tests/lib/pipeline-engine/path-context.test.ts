import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { resolvePathContext, resolveDiscoveredConfigPath } from '../../../src/lib/pipeline-engine/path-context.js';

describe('path-context resolves from the bundle location', () => {
  it('templatesDir resolves to ~/.radorc/templates/', () => {
    const ctx = resolvePathContext();
    expect(ctx.templatesDir).toBe(path.join(os.homedir(), '.radorc', 'templates'));
  });
  it('PathContext carries scriptsDir, templatesDir and scriptPath and nothing else', () => {
    const ctx = resolvePathContext();
    expect(Object.keys(ctx).sort()).toEqual(['scriptPath', 'scriptsDir', 'templatesDir']);
  });
  it('scriptPath is the running script from argv', () => {
    const ctx = resolvePathContext();
    expect(ctx.scriptPath).toBe(process.argv[1] ?? '');
  });
  it('default discovered config path is ~/.radorc/orchestration.yml', () => {
    expect(resolveDiscoveredConfigPath()).toBe(path.join(os.homedir(), '.radorc', 'orchestration.yml'));
  });
});
