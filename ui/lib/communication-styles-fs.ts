// In-process catalog helper for the Communication Style dashboard surface.
//
// This module is a deliberate transplant of the listing/parsing logic from
// `cli/src/lib/communication-style.ts`. The CLI remains the canonical
// implementation; the UI keeps a local, list-only copy so the dashboard's
// catalog route can stay in-process (no subprocess spawn per file read).
// The dashboard only ever *lists* styles — it never reads or writes a style
// body, so the CLI's parse/save/read-selected-style surface is not mirrored
// here.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

export interface StyleFrontmatter { name: string; title: string; description: string }
export interface ParsedStyle { name: string; frontmatter: StyleFrontmatter; body: string }
export interface StyleCatalogEntry { path: string; name: string; title: string; description: string; isCustom: boolean }

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const FILENAME_RE = /^[a-z0-9][a-z0-9-]*\.md$/;

/** Throws on any violation — mirrors cli/src/lib/communication-style.ts#parseStyleFile. */
function parseStyleFile(text: string, filename: string): ParsedStyle {
  const base = path.basename(filename);
  if (!FILENAME_RE.test(base)) {
    throw new Error(`Invalid style filename '${filename}': expected '<name>.md' (lowercase letters, digits, hyphens).`);
  }
  const stem = base.slice(0, -3);

  const fmMatch = FRONTMATTER_RE.exec(text);
  if (!fmMatch) {
    throw new Error(`File '${filename}' missing YAML frontmatter block.`);
  }
  const raw = parseYaml(fmMatch[1]) as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== 'object') {
    throw new Error(`File '${filename}' has empty or non-object frontmatter.`);
  }
  if (raw['name'] !== stem) {
    throw new Error(`File '${filename}' frontmatter.name '${String(raw['name'])}' disagrees with filename stem '${stem}'.`);
  }
  for (const field of ['title', 'description']) {
    if (typeof raw[field] !== 'string' || !(raw[field] as string).length) {
      throw new Error(`File '${filename}' frontmatter.${field} is required and must be a non-empty string.`);
    }
  }

  return {
    name: stem,
    frontmatter: { name: stem, title: raw['title'] as string, description: raw['description'] as string },
    body: fmMatch[2] ?? '',
  };
}

function toEntry(catalogRoot: string, abs: string, isCustom: boolean): StyleCatalogEntry | null {
  try {
    const text = fs.readFileSync(abs, 'utf8');
    const parsed = parseStyleFile(text, path.basename(abs));
    const rel = path.relative(catalogRoot, abs).split(path.sep).join('/');
    return { path: rel, name: parsed.name, title: parsed.frontmatter.title, description: parsed.frontmatter.description, isCustom };
  } catch (err) {
    console.warn(`[communication-style] skipping unparseable style '${abs}': ${(err as Error).message}`);
    return null;
  }
}

function listDir(catalogRoot: string, dir: string, isCustom: boolean): StyleCatalogEntry[] {
  if (!fs.existsSync(dir)) return [];
  const entries: StyleCatalogEntry[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.md')) continue;
    const abs = path.join(dir, name);
    if (!fs.statSync(abs).isFile()) continue;
    const entry = toEntry(catalogRoot, abs, isCustom);
    if (entry) entries.push(entry);
  }
  return entries;
}

// Mirrors cli/src/lib/paths.ts#userDataPaths().communicationStyles. Tests
// stub os.homedir() via ui/lib/test-helpers.ts#withHomedir to redirect this.
export function resolveStyleCatalogRoot(): string {
  return path.join(os.homedir(), '.radorc', 'communication-styles');
}

/** Catalog root + `custom/`, one level deep. Skips unparseable files with a console.warn;
 *  never throws. A missing catalogRoot or a missing custom/ both yield [] / no custom
 *  entries. `path` is catalog-relative and POSIX-separated ('custom/foo.md'). */
export function listStyleCatalog(catalogRoot: string): StyleCatalogEntry[] {
  return [
    ...listDir(catalogRoot, catalogRoot, false),
    ...listDir(catalogRoot, path.join(catalogRoot, 'custom'), true),
  ];
}
