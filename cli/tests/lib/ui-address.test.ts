import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_UI_PORT, resolveUiPort, uiBaseUrl, projectDocUrl } from '../../src/lib/ui-address.js';

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ui-address-'));
}

function writeConfig(root: string, body: string): void {
  fs.writeFileSync(path.join(root, 'orchestration.yml'), body, 'utf8');
}

describe('resolveUiPort', () => {
  it('degrades to the default when the config file is absent', () => {
    expect(resolveUiPort(tempRoot())).toBe(DEFAULT_UI_PORT);
  });

  it('degrades to the default when the YAML is unparseable', () => {
    const root = tempRoot();
    writeConfig(root, 'ui:\n  port: [unterminated\n');
    expect(resolveUiPort(root)).toBe(DEFAULT_UI_PORT);
  });

  it('degrades to the default when ui.port is missing', () => {
    const root = tempRoot();
    writeConfig(root, 'source_control:\n  auto_commit: ask\n');
    expect(resolveUiPort(root)).toBe(DEFAULT_UI_PORT);
  });

  it('degrades to the default when ui.port is not an integer', () => {
    const root = tempRoot();
    writeConfig(root, 'ui:\n  port: "not-a-number"\n');
    expect(resolveUiPort(root)).toBe(DEFAULT_UI_PORT);
  });

  it('degrades to the default when ui.port is out of range', () => {
    const root = tempRoot();
    writeConfig(root, 'ui:\n  port: 70000\n');
    expect(resolveUiPort(root)).toBe(DEFAULT_UI_PORT);
  });

  it('honors a valid configured ui.port', () => {
    const root = tempRoot();
    writeConfig(root, 'ui:\n  port: 4000\n');
    expect(resolveUiPort(root)).toBe(4000);
  });
});

describe('uiBaseUrl', () => {
  it('builds a loopback URL from the resolved port', () => {
    const root = tempRoot();
    writeConfig(root, 'ui:\n  port: 4000\n');
    expect(uiBaseUrl(root)).toBe('http://localhost:4000');
  });

  it('falls back to the default port base URL when unconfigured', () => {
    expect(uiBaseUrl(tempRoot())).toBe(`http://localhost:${DEFAULT_UI_PORT}`);
  });
});

describe('projectDocUrl', () => {
  it('builds the URL for a flat filename', () => {
    const root = tempRoot();
    expect(projectDocUrl(root, 'DEMO', 'DEMO-AMENDMENT-01.md'))
      .toBe(`http://localhost:${DEFAULT_UI_PORT}/projects/DEMO/docs/DEMO-AMENDMENT-01.md`);
  });

  it('encodes a nested path as separate segments, not one escaped string', () => {
    const root = tempRoot();
    const url = projectDocUrl(root, 'DEMO', 'phases/P01.md');
    expect(url).toBe(`http://localhost:${DEFAULT_UI_PORT}/projects/DEMO/docs/phases/P01.md`);
    // The dashboard reconstructs the doc path from every segment after `docs/`,
    // so the slash between segments must survive unescaped.
    expect(url).not.toContain('%2F');
  });

  it('encodes a project name that needs escaping', () => {
    const root = tempRoot();
    const url = projectDocUrl(root, 'DEMO PROJECT', 'plan.md');
    expect(url).toBe(`http://localhost:${DEFAULT_UI_PORT}/projects/DEMO%20PROJECT/docs/plan.md`);
  });

  it('honors a configured ui.port in the resulting URL', () => {
    const root = tempRoot();
    writeConfig(root, 'ui:\n  port: 4000\n');
    expect(projectDocUrl(root, 'DEMO', 'plan.md')).toBe('http://localhost:4000/projects/DEMO/docs/plan.md');
  });
});
