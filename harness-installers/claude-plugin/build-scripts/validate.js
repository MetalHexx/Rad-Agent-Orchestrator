import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

export const REQUIRED_ARTIFACTS = [
  '.claude-plugin/plugin.json',
  'package.json',
  'skills/rad-orchestration/scripts/radorch.mjs',
  'hooks/hooks.json',
  'hooks/bootstrap.mjs',
  'hooks/drift-check.mjs',
];
const SIZE_LIMIT = Math.round(50 * 1024 * 1024 * 1.1);

function defaultSizer(outputDir) {
  const out = execSync('npm pack --dry-run --json', {
    cwd: outputDir, shell: process.platform === 'win32', encoding: 'utf8',
  });
  const parsed = JSON.parse(out);
  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  return { unpackedSize: entry?.unpackedSize ?? entry?.size ?? 0 };
}

/** @param {{ outputDir: string, canonicalAgentsDir: string, sizer?: (d:string)=>{unpackedSize:number} }} opts */
export function validatePluginTree(opts) {
  const { outputDir, canonicalAgentsDir } = opts;
  const sizer = opts.sizer ?? defaultSizer;
  const plugin = JSON.parse(fs.readFileSync(path.join(outputDir, '.claude-plugin/plugin.json'), 'utf8'));
  const version = plugin.version;

  // Gate 1: required artifacts.
  for (const rel of REQUIRED_ARTIFACTS) {
    if (!fs.existsSync(path.join(outputDir, rel))) {
      throw new Error(`validate: missing required artifact ${rel} (gate 1)`);
    }
  }

  // Gate 2: every canonical agent appears at output/agents/<name>.md.
  const canonical = fs.readdirSync(canonicalAgentsDir)
    .filter((f) => f.endsWith('.md') && !f.includes('.copilot') && !f.includes('.claude.'))
    .map((f) => f.replace(/\.md$/, ''));
  for (const name of canonical) {
    if (!fs.existsSync(path.join(outputDir, 'agents', `${name}.md`))) {
      throw new Error(`validate: missing agents/${name}.md (gate 2)`);
    }
  }

  // Gate 4: per-version manifest present.
  const manifestRel = `manifests/v${version}.json`;
  if (!fs.existsSync(path.join(outputDir, manifestRel))) {
    throw new Error(`validate: missing ${manifestRel} (gate 4)`);
  }

  // Gate 5: tarball size budget.
  const { unpackedSize } = sizer(outputDir);
  if (unpackedSize > SIZE_LIMIT) {
    throw new Error(`validate: unpacked size ${unpackedSize} exceeds size budget of ${SIZE_LIMIT} bytes (gate 5)`);
  }
}
