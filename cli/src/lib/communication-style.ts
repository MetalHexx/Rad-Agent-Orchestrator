import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { UserError } from '../framework/errors.js';

export interface StyleFrontmatter { name: string; title: string; description: string }
export interface ParsedStyle { name: string; frontmatter: StyleFrontmatter; body: string }
export interface StyleCatalogEntry { path: string; name: string; title: string; description: string; isCustom: boolean }

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const FILENAME_RE = /^[a-z0-9][a-z0-9-]*\.md$/;
const NAME_SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

/** Resolve-and-compare containment check — never string sanitization. */
function isInside(root: string, abs: string): boolean {
  const rel = path.relative(root, abs);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Throws on any violation — used by save/load where a bad file is a real error. */
export function parseStyleFile(text: string, filename: string): ParsedStyle {
  const base = path.basename(filename);
  if (!FILENAME_RE.test(base)) {
    throw new Error(`Invalid style filename '${filename}': expected '<name>.md' (lowercase letters, digits, hyphens).`);
  }
  const stem = base.slice(0, -3);

  const fmMatch = FRONTMATTER_RE.exec(text);
  if (!fmMatch) {
    throw new Error(`File '${filename}' missing YAML frontmatter block.`);
  }
  const raw = yaml.load(fmMatch[1]) as Record<string, unknown> | undefined;
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

/** Catalog root + `custom/`, one level deep. Skips unparseable files with a console.warn; never throws.
 *  A missing catalogRoot or a missing custom/ both yield [] / no custom entries. `path` is
 *  catalog-relative and POSIX-separated ('custom/foo.md'), never a platform path. */
export function listStyles(catalogRoot: string): StyleCatalogEntry[] {
  return [
    ...listDir(catalogRoot, catalogRoot, false),
    ...listDir(catalogRoot, path.join(catalogRoot, 'custom'), true),
  ];
}

/** Containment check only — no read. Returns the absolute path, or null when `selected`
 *  escapes the catalog root, is absolute, is empty, or is not a `.md` file. */
export function resolveStylePath(catalogRoot: string, selected: string): string | null {
  if (!selected || path.isAbsolute(selected)) return null;
  if (!selected.endsWith('.md')) return null;
  const abs = path.resolve(catalogRoot, selected);
  return isInside(catalogRoot, abs) ? abs : null;
}

/** Exception-safe existence probe — a throwing probe (EACCES, ELOOP, hostile path) is
 *  treated as "this candidate does not exist" rather than propagating. */
function probeExists(abs: string): boolean {
  try {
    return fs.existsSync(abs) && fs.statSync(abs).isFile();
  } catch {
    return false;
  }
}

/** Accepts either form: a catalog-relative '.md' path, or a bare slug looked up
 *  under custom/ first, then the catalog root. Null when nothing resolves. */
export function resolveStyleRef(catalogRoot: string, ref: string): { rel: string; abs: string } | null {
  if (ref.endsWith('.md')) {
    const abs = resolveStylePath(catalogRoot, ref);
    if (!abs) return null;
    return { rel: path.relative(catalogRoot, abs).split(path.sep).join('/'), abs };
  }

  if (!NAME_SLUG_RE.test(ref)) return null;

  for (const rel of [`custom/${ref}.md`, `${ref}.md`]) {
    const abs = path.resolve(catalogRoot, rel);
    if (!isInside(catalogRoot, abs)) continue;
    if (probeExists(abs)) return { rel, abs };
  }
  return null;
}

/** The read path used by session-start. Returns null for EVERY failure mode:
 *  containment rejection, missing file, empty file, unreadable, unparseable. Never throws. */
export function readSelectedStyle(catalogRoot: string, selected: string): ParsedStyle | null {
  const abs = resolveStyleRef(catalogRoot, selected)?.abs ?? null;
  if (!abs) return null;
  let text: string;
  try {
    text = fs.readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
  let parsed: ParsedStyle;
  try {
    parsed = parseStyleFile(text, path.basename(abs));
  } catch {
    return null;
  }
  if (!parsed.body.trim().length) return null;
  return parsed;
}

/** Writes `custom/<name>.md`. Throws UserError when `name` is not a bare slug, when the
 *  resolved destination escapes `<catalogRoot>/custom/`, or when the source fails parsing. */
export function saveCustomStyle(opts: { catalogRoot: string; name: string; sourceText: string }): { path: string; overwritten: boolean } {
  const { catalogRoot, name, sourceText } = opts;
  if (!NAME_SLUG_RE.test(name)) {
    throw new UserError(`Invalid style name '${name}': expected a bare lowercase slug (letters, digits, hyphens, no path separators or leading dot).`);
  }
  const customRoot = path.join(catalogRoot, 'custom');
  const dest = path.resolve(customRoot, `${name}.md`);
  if (!isInside(customRoot, dest)) {
    throw new UserError(`Style name '${name}' resolves outside the custom styles folder.`);
  }

  try {
    parseStyleFile(sourceText, `${name}.md`);
  } catch (err) {
    throw new UserError((err as Error).message);
  }

  fs.mkdirSync(customRoot, { recursive: true });
  const overwritten = fs.existsSync(dest);
  const tmp = `${dest}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    fs.writeFileSync(tmp, sourceText, 'utf8');
    fs.renameSync(tmp, dest);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best-effort cleanup */ }
    throw err;
  }

  return { path: `custom/${name}.md`, overwritten };
}
