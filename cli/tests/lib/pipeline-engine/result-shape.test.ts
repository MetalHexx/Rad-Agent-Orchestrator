import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { processEvent } from '../../../src/lib/pipeline-engine/engine.js';
import {
  readState, writeState, readConfig, readDocument, readDocumentRaw, writeDocument, ensureDirectories,
} from '../../../src/lib/pipeline-engine/state-io.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEMPLATES_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'runtime-config', 'templates');

describe('PipelineResult shape after legacy-field retirement', () => {
  it('start event returns an object with action and context but no success/orchRoot/mutations_applied', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-shape-'));
    fs.copyFileSync(path.join(TEMPLATES_DIR, 'medium.yml'), path.join(dir, 'template.yml'));
    const io = { readState, writeState, readConfig, readDocument, readDocumentRaw, writeDocument, ensureDirectories };
    const pathContext = {
      scriptsDir: path.resolve(__dirname, '..', '..', '..', 'src', 'lib', 'pipeline'),
      templatesDir: TEMPLATES_DIR,
      scriptPath: path.resolve(__dirname, '..', '..', '..', 'radorch.mjs'),
    };
    const result = processEvent('start', dir, { template: 'medium' }, io, pathContext);
    expect('action' in result).toBe(true);
    expect('context' in result).toBe(true);
    expect('success' in result).toBe(false);
    expect('orchRoot' in result).toBe(false);
    expect('mutations_applied' in result).toBe(false);
  });
});
