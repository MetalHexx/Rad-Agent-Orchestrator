import { readFile, readdir, stat, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

import type { AnyProjectState } from '@/types/state';
import { isV5State, isV6State } from '@/types/state';
import type { OrchestrationConfig } from '@/types/config';
import type { ProjectSummary } from '@/types/components';

import { getOrchestrationYmlPath, getProjectsRoot, resolveProjectDir } from '@/lib/path-resolver';
import { parseYaml } from '@/lib/yaml-parser';
import { derivePlanningStatus, deriveExecutionStatus } from '@/lib/status-derivation';
import { isProjectDirName } from '@/lib/project-name';

/**
 * Resolve the absolute path to orchestration.yml.
 * Always returns ~/.radorc/orchestration.yml.
 *
 * @returns Absolute path to orchestration.yml
 */
export function getConfigPath(): string {
  return getOrchestrationYmlPath();
}

/**
 * Read and parse orchestration.yml from ~/.radorc/orchestration.yml.
 *
 * @returns Parsed OrchestrationConfig
 * @throws If orchestration.yml does not exist or is invalid YAML
 */
export async function readConfig(): Promise<OrchestrationConfig> {
  const configPath = getConfigPath();
  const content = await readFile(configPath, 'utf-8');
  return parseYaml<OrchestrationConfig>(content);
}

/**
 * Read orchestration.yml and return both parsed config and raw YAML string.
 *
 * @returns Object with parsed config and raw YAML string
 * @throws If orchestration.yml does not exist or is invalid YAML
 */
export async function readConfigWithRaw(): Promise<{
  config: OrchestrationConfig;
  rawYaml: string;
}> {
  const configPath = getConfigPath();
  const rawYaml = await readFile(configPath, 'utf-8');
  const config = parseYaml<OrchestrationConfig>(rawYaml);
  return { config, rawYaml };
}

/**
 * Write content to orchestration.yml atomically (write to temp file, then rename).
 * The temp file is created in the same directory as orchestration.yml to ensure
 * same-filesystem rename semantics.
 *
 * @param content - YAML string to write
 * @throws If the write or rename operation fails (e.g., permission denied, disk full)
 */
export async function writeConfig(content: string): Promise<void> {
  const configPath = getConfigPath();
  const configDir = path.dirname(configPath);
  const suffix = randomBytes(8).toString('hex');
  const tmpPath = path.join(configDir, `.orchestration.yml.tmp.${suffix}`);

  await writeFile(tmpPath, content, 'utf-8');
  try {
    await rename(tmpPath, configPath);
  } catch (renameErr) {
    try {
      await unlink(tmpPath);
    } catch {
      // best-effort cleanup
    }
    throw renameErr;
  }
}

/**
 * Resolve the effective orchestration root folder name from a loaded config.
 *
 * Returns the orchestration root folder name. Always returns '.claude' as this is now
 * the canonical orchestration root folder.
 *
 * @param _config - A parsed OrchestrationConfig object (kept for backward compat)
 * @returns The orchestration root folder name ('.claude')
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function resolveOrchRoot(_config: OrchestrationConfig): string {
  return '.claude';
}

/**
 * Discover all projects under ~/.radorc/projects/. Returns summaries with tier info.
 * Each subdirectory whose name matches `isProjectDirName` is treated as a project.
 * If state.json exists and is parseable, extract the pipeline tier.
 * If state.json is missing, mark hasState: false.
 * If state.json is malformed, mark hasMalformedState: true with errorMessage.
 *
 * Reads run in parallel via `Promise.all` with a per-project try/catch so a
 * single malformed state.json cannot poison the entire list. Result order
 * matches `readdir`'s directory-entry order (stable per filesystem). The
 * sequential implementation became the dominant cost on large workspaces
 * once Iter 5 grew state.json from ~2 KB to ~50–200 KB per project.
 *
 * @returns Array of ProjectSummary objects (one per directory under ~/.radorc/projects/)
 */
export async function discoverProjects(): Promise<ProjectSummary[]> {
  const absBasePath = getProjectsRoot();
  const entries = await readdir(absBasePath, { withFileTypes: true });

  const summaries = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && isProjectDirName(entry.name))
      .map(async (entry): Promise<ProjectSummary> => {
        const projectName = entry.name;
        const projectDir = resolveProjectDir(projectName);
        const statePath = path.join(projectDir, 'state.json');

        const brainstormingFile = `${projectName}-BRAINSTORMING.md`;
        const brainstormingAbsPath = path.join(projectDir, brainstormingFile);
        // Initialised to false; resolved inside the try so any future exception
        // in fileExists is contained by the per-project catch below.
        let hasBrainstorming = false;

        try {
          hasBrainstorming = await fileExists(brainstormingAbsPath);
          const raw = await readFile(statePath, 'utf-8');
          const state: AnyProjectState = JSON.parse(raw);
          if (isV5State(state) || isV6State(state)) {
            return {
              name: projectName,
              tier: state.graph.status === 'completed' ? 'complete' : state.pipeline.current_tier,
              hasState: true,
              hasMalformedState: false,
              brainstormingDoc: hasBrainstorming ? brainstormingFile : null,
              planningStatus: derivePlanningStatus(state.graph.nodes, state.graph.status),
              executionStatus: deriveExecutionStatus(state.graph.status, state.graph.nodes),
              lastUpdated: state.project?.updated,
              schemaVersion: isV6State(state) ? 'v6' : 'v5',
              graphStatus: state.graph.status,
              project_type: state.project?.project_type,
            };
          }
          throw new Error(`Unrecognized state schema: ${(state as { $schema?: unknown }).$schema}`);
        } catch (err) {
          const isNotFound =
            err instanceof Error &&
            'code' in err &&
            (err as NodeJS.ErrnoException).code === 'ENOENT';

          if (isNotFound) {
            return {
              name: projectName,
              tier: 'not_initialized',
              hasState: false,
              hasMalformedState: false,
              brainstormingDoc: hasBrainstorming ? brainstormingFile : null,
              graphStatus: 'not_initialized',
            };
          }
          return {
            name: projectName,
            tier: 'not_initialized',
            hasState: true,
            hasMalformedState: true,
            errorMessage:
              err instanceof Error ? err.message : 'Unknown parse error',
            brainstormingDoc: hasBrainstorming ? brainstormingFile : null,
            graphStatus: 'not_initialized',
          };
        }
      }),
  );

  return summaries;
}

/**
 * Read and parse a project's state.json. Returns null if file does not exist.
 *
 * @param projectDir - Absolute path to the project directory
 * @returns Parsed ProjectState, or null if state.json does not exist
 * @throws If state.json exists but is malformed JSON
 */
export async function readProjectState(
  projectDir: string
): Promise<AnyProjectState | null> {
  const statePath = path.join(projectDir, 'state.json');
  try {
    const content = await readFile(statePath, 'utf-8');
    return JSON.parse(content) as AnyProjectState;
  } catch (err) {
    const isNotFound =
      err instanceof Error &&
      'code' in err &&
      (err as NodeJS.ErrnoException).code === 'ENOENT';
    if (isNotFound) return null;
    throw err;
  }
}

/**
 * Read a document file and return its raw content.
 *
 * @param absolutePath - Absolute filesystem path to the document
 * @returns Raw file content as a string
 * @throws If file does not exist
 */
export async function readDocument(absolutePath: string): Promise<string> {
  return readFile(absolutePath, 'utf-8');
}

/**
 * Check if a file exists at the given absolute path.
 *
 * @param absolutePath - Absolute filesystem path to check
 * @returns true if file exists, false otherwise
 */
export async function fileExists(absolutePath: string): Promise<boolean> {
  try {
    await stat(absolutePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Directory names skipped by `listProjectFiles`. A project that contains its
 * own build scaffold (e.g. a Next.js app with installed npm deps) would
 * otherwise pull hundreds of `.md` files out of `node_modules` into the UI's
 * "Other Docs" list, and walking those trees on every selection is slow.
 */
const LIST_IGNORED_DIR_NAMES: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  '.next',
  '.cache',
]);

/**
 * Recursively list all .md and .html files in a project directory, collecting
 * each file's `mtimeMs` from `stat`. Returns paths relative to the project
 * directory using forward slashes. Does not follow symlinks. Skips entries
 * containing "..".
 *
 * @param projectDir - Absolute path to the project directory
 * @returns Object with `files` (relative paths) and `mtimes` (map from relative path to mtimeMs)
 */
export async function listProjectFilesWithMtimes(
  projectDir: string,
): Promise<{ files: string[]; mtimes: Record<string, number> }> {
  const files: string[] = [];
  const mtimes: Record<string, number> = {};

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.includes('..')) continue;
      if (entry.isDirectory() && LIST_IGNORED_DIR_NAMES.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.name.endsWith('.md') || entry.name.endsWith('.html')) {
        const relPath = path.relative(projectDir, fullPath).replace(/\\/g, '/');
        const fileStat = await stat(fullPath);
        files.push(relPath);
        mtimes[relPath] = fileStat.mtimeMs;
      }
    }
  }

  await walk(projectDir);
  return { files, mtimes };
}

/**
 * Recursively list all .md and .html files in a project directory.
 * Returns paths relative to the project directory using forward slashes.
 * Does not follow symlinks. Skips entries containing "..".
 *
 * @param projectDir - Absolute path to the project directory
 * @returns Array of relative file paths (e.g., ["PRD.md", "tasks/TASK-P01-T01.md"])
 */
export async function listProjectFiles(projectDir: string): Promise<string[]> {
  const { files } = await listProjectFilesWithMtimes(projectDir);
  return files;
}
