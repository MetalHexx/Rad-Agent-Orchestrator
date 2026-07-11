import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  discoveryFilePath,
  readDiscoveryFile,
  removeDiscoveryFile,
  writeDiscoveryFile,
  type ServiceDiscovery,
} from '../../src/lifecycle/discovery.js';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'graph-service-discovery-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const sampleEntry: ServiceDiscovery = {
  pid: 4242,
  port: 1336,
  url: 'http://127.0.0.1:1336',
  startedAt: '2026-01-01T00:00:00.000Z',
};

describe('discovery file', () => {
  it('round-trips a write through a read', async () => {
    await writeDiscoveryFile(sampleEntry, root);
    await expect(readDiscoveryFile(root)).resolves.toEqual(sampleEntry);
  });

  it('writes atomically: no leftover temp file, and the target holds the full body', async () => {
    await writeDiscoveryFile(sampleEntry, root);
    const dirEntries = await fs.readdir(root);
    expect(dirEntries).toEqual(['service.json']);
    const raw = await fs.readFile(discoveryFilePath(root), 'utf8');
    expect(JSON.parse(raw)).toEqual(sampleEntry);
  });

  it('returns null when the file is absent', async () => {
    await expect(readDiscoveryFile(root)).resolves.toBeNull();
  });

  it('returns null for a corrupt or shape-mismatched file instead of throwing', async () => {
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(discoveryFilePath(root), 'not json', 'utf8');
    await expect(readDiscoveryFile(root)).resolves.toBeNull();

    await fs.writeFile(discoveryFilePath(root), JSON.stringify({ pid: 1 }), 'utf8');
    await expect(readDiscoveryFile(root)).resolves.toBeNull();
  });

  it('removes the file, and is a no-op when it is already gone', async () => {
    await writeDiscoveryFile(sampleEntry, root);
    await removeDiscoveryFile(root);
    await expect(readDiscoveryFile(root)).resolves.toBeNull();

    await expect(removeDiscoveryFile(root)).resolves.toBeUndefined();
  });
});
