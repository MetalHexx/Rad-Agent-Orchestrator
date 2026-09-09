// docs-corpus.js — Stages the shipped documentation corpus (README.md, docs/,
// assets/) into a build's docs/ tree. The only place the corpus enumeration
// and the exclusion rule exist; every installer build calls this so the rule
// cannot drift between the installer builds that call it.

import fs from 'node:fs';
import path from 'node:path';

// Doc pages under any of these paths (relative to docs/) never ship.
// `internals/private/` is subsumed by `internals/` and is listed anyway — an
// explicit constant is what the exclusion guard reads as intent.
const EXCLUDED_DOC_PREFIXES = ['internals/', 'internals/private/', 'research/'];

// CONTRIBUTING.md is contributor-facing and never joins the staged corpus, so
// the shipped README.md can't keep a link to it — it would 404 in every
// installed copy. Strip just that link when staging; the repo-root
// README.md itself is untouched, so GitHub's rendering keeps working.
const CONTRIBUTING_LINK_PATTERN = /\[Contributing[^\]]*\]\(CONTRIBUTING\.md\)\s*(?:·|-)?\s*/;

function toPosix(rel) {
  return rel.split(path.sep).join('/');
}

function walkMarkdown(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkMarkdown(abs, acc);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      acc.push(abs);
    }
  }
  return acc;
}

/**
 * @param {{ repoRoot: string, target: string, sourcePrefix?: string }} opts
 * @returns {{ files: string[],
 *             manifestEntries: Array<{ destinationPath: string, sourcePath: string, ownership: string }> }}
 */
export function stageDocsCorpus({ repoRoot, target, sourcePrefix }) {
  const readmeSrc = path.join(repoRoot, 'README.md');
  const docsSrc = path.join(repoRoot, 'docs');
  const assetsSrc = path.join(repoRoot, 'assets');

  // Throw rather than skip: a silent skip is how a renamed/missing source
  // ships a corpus with broken links or images and no build failure anywhere.
  for (const [label, abs] of [['README.md', readmeSrc], ['docs/', docsSrc], ['assets/', assetsSrc]]) {
    if (!fs.existsSync(abs)) {
      throw new Error(`stageDocsCorpus: required source '${label}' not found at ${abs}`);
    }
  }

  const staged = [];

  fs.mkdirSync(target, { recursive: true });

  // <repoRoot>/README.md -> README.md, with the dead CONTRIBUTING.md link removed.
  const readmeText = fs.readFileSync(readmeSrc, 'utf8').replace(CONTRIBUTING_LINK_PATTERN, '');
  fs.writeFileSync(path.join(target, 'README.md'), readmeText);
  staged.push('README.md');

  // Every .md under <repoRoot>/docs/, walked recursively -> docs/<same relative path>.
  for (const abs of walkMarkdown(docsSrc)) {
    const relToDocs = toPosix(path.relative(docsSrc, abs));
    if (EXCLUDED_DOC_PREFIXES.some((prefix) => relToDocs.startsWith(prefix))) continue;
    const destRel = `docs/${relToDocs}`;
    const dest = path.join(target, ...destRel.split('/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(abs, dest);
    staged.push(destRel);
  }

  // Every .png in <repoRoot>/assets/ (non-recursive) -> assets/<name>.png.
  fs.mkdirSync(path.join(target, 'assets'), { recursive: true });
  for (const entry of fs.readdirSync(assetsSrc, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.png')) continue;
    const destRel = `assets/${entry.name}`;
    fs.copyFileSync(path.join(assetsSrc, entry.name), path.join(target, 'assets', entry.name));
    staged.push(destRel);
  }

  staged.sort();

  const manifestEntries = sourcePrefix
    ? staged.map((rel) => ({
      destinationPath: '${RAD_HOME}/docs/' + rel,
      sourcePath: `${sourcePrefix}/${rel}`,
      ownership: 'installer-owned',
    }))
    : [];

  return { files: staged, manifestEntries };
}
