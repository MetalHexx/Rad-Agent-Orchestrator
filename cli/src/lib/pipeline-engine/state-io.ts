import * as fs from 'node:fs';
import * as path from 'node:path';
import yaml from 'js-yaml';
import type { PipelineState, OrchestrationConfig } from './types.js';

// ── Private helpers ───────────────────────────────────────────────────────────

const DEFAULT_CONFIG: OrchestrationConfig = {
  default_template: 'extra-high',
  limits: {
    max_retries_per_task: 5,
    max_consecutive_review_rejections: 3,
  },
  human_gates: {
    after_planning: true,
    execution_mode: 'ask',
    after_final_review: true,
  },
  source_control: {
    auto_commit: 'ask',
    auto_pr: 'ask',
  },
};

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = result[key];
    if (
      srcVal !== null &&
      srcVal !== undefined &&
      typeof srcVal === 'object' &&
      !Array.isArray(srcVal) &&
      tgtVal !== null &&
      tgtVal !== undefined &&
      typeof tgtVal === 'object' &&
      !Array.isArray(tgtVal)
    ) {
      result[key] = deepMerge(
        tgtVal as Record<string, unknown>,
        srcVal as Record<string, unknown>,
      );
    } else if (srcVal !== undefined) {
      result[key] = srcVal;
    }
  }
  return result;
}

function isEnoent(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === 'object' &&
    (err as { code?: unknown }).code === 'ENOENT'
  );
}

// ── Exported functions ────────────────────────────────────────────────────────

export function readState(projectDir: string): PipelineState | null {
  const statePath = path.join(projectDir, 'state.json');
  try {
    const raw = fs.readFileSync(statePath, 'utf-8');
    return JSON.parse(raw) as PipelineState;
  } catch (err: unknown) {
    if (isEnoent(err)) return null;
    throw err;
  }
}

export function writeState(projectDir: string, state: PipelineState): void {
  fs.mkdirSync(projectDir, { recursive: true });
  const statePath = path.join(projectDir, 'state.json');
  const tmpPath = path.join(projectDir, 'state.json.tmp');
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
    fs.renameSync(tmpPath, statePath);
  } catch (err) {
    fs.rmSync(tmpPath, { force: true });
    throw err;
  }
}

/**
 * Strips retired keys from a merged config record (FR-11).
 *
 * `system`, `projects`, and `source_control.provider` were retired in P06.
 * Older `orchestration.yml` files may still carry them; the pipeline reads
 * those YAMLs silently and presents the post-strip ten-property shape to
 * runtime callers. The on-disk YAML is never rewritten by this code.
 */
function stripRetiredKeys(merged: Record<string, unknown>): Record<string, unknown> {
  delete merged.system;
  delete merged.projects;
  const sc = merged.source_control;
  if (sc !== null && typeof sc === 'object' && !Array.isArray(sc)) {
    delete (sc as Record<string, unknown>).provider;
  }
  return merged;
}

export function readConfig(configPath?: string): OrchestrationConfig {
  const base = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as Record<string, unknown>;

  if (!configPath) {
    return base as unknown as OrchestrationConfig;
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = yaml.load(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return base as unknown as OrchestrationConfig;
    }
    const merged = deepMerge(base, parsed as Record<string, unknown>);
    return stripRetiredKeys(merged) as unknown as OrchestrationConfig;
  } catch (err: unknown) {
    if (isEnoent(err)) return base as unknown as OrchestrationConfig;
    throw err;
  }
}

export function readDocument(
  docPath: string,
): { frontmatter: Record<string, unknown>; content: string } | null {
  let raw: string;
  try {
    raw = fs.readFileSync(docPath, 'utf-8');
  } catch (err: unknown) {
    if (isEnoent(err)) return null;
    throw err;
  }

  // Match standard YAML frontmatter: starts with ---, ends with \n---
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, content: raw };
  }

  const frontmatterText = match[1] ?? '';
  const content = match[2] ?? '';
  const parsed = yaml.load(frontmatterText);
  const frontmatter =
    parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  return {
    frontmatter,
    content,
  };
}

export function ensureDirectories(projectDir: string): void {
  fs.mkdirSync(projectDir, { recursive: true });
  for (const subdir of ['phases', 'tasks', 'reports', 'reviews']) {
    fs.mkdirSync(path.join(projectDir, subdir), { recursive: true });
  }
}
