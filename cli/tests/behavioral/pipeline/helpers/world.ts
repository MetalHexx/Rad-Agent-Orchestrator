// cli/tests/behavioral/pipeline/helpers/world.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import type { PathContext, PipelineState, OrchestrationConfig } from '../../../../src/lib/pipeline-engine/types.js';

// Widen every string-literal union in PipelineState to plain `string` so test
// scaffolds (whose object literals widen on the way in) are assignable, while
// preserving structural shape so field-name typos still get caught. Ajv at
// runtime enforces the actual literal values via the v5 schema.
type LoosenLiterals<T> =
  T extends string ? string :
  T extends number | boolean | null | undefined ? T :
  T extends Array<infer U> ? LoosenLiterals<U>[] :
  T extends object ? { [K in keyof T]: LoosenLiterals<T[K]> } :
  T;
type BehavioralStateScaffold = LoosenLiterals<PipelineState>;

export interface WorldSpec {
  template: { id: string; body: string };
  state: Partial<BehavioralStateScaffold> | null;
  config: Partial<OrchestrationConfig> & Record<string, unknown>;
  sideFiles: Array<{ path: string; contents: string }>;
}
export interface World {
  projectDir: string;
  configPath: string;
  pathContext: PathContext;
  cleanup: () => void;
}

const DEFAULT_CONFIG: OrchestrationConfig = {
  limits: { max_retries_per_task: 3 },
  human_gates: { after_planning: true, execution_mode: 'task', after_final_review: true },
  source_control: { auto_commit: 'never', auto_pr: 'never' },
  default_template: 'medium',
};

export function buildWorld(spec: WorldSpec): World {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-behavioral-'));
  fs.writeFileSync(path.join(projectDir, 'template.yml'), spec.template.body, 'utf8');
  if (spec.state !== null) {
    fs.writeFileSync(path.join(projectDir, 'state.json'), JSON.stringify(spec.state, null, 2), 'utf8');
  }
  // One-level deep merge over OrchestrationConfig's nested objects so callers
  // can override a single nested key (e.g. { limits: { max_retries_per_task: 2 } }) without
  // having to restate the other required siblings.
  const mergedConfig = {
    ...DEFAULT_CONFIG,
    ...spec.config,
    limits: { ...DEFAULT_CONFIG.limits, ...(spec.config.limits ?? {}) },
    human_gates: { ...DEFAULT_CONFIG.human_gates, ...(spec.config.human_gates ?? {}) },
    source_control: { ...DEFAULT_CONFIG.source_control, ...(spec.config.source_control ?? {}) },
  };
  const configPath = path.join(projectDir, 'orchestration.yml');
  fs.writeFileSync(configPath, yaml.dump(mergedConfig), 'utf8');
  for (const f of spec.sideFiles) {
    const full = path.join(projectDir, f.path);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, f.contents, 'utf8');
  }
  const prevTemplatesEnv = process.env['RADORCH_TEMPLATES_DIR'];
  process.env['RADORCH_TEMPLATES_DIR'] = projectDir;
  const pathContext: PathContext = {
    scriptsDir: projectDir,
    templatesDir: projectDir,
    scriptPath: path.join(projectDir, 'radorch.mjs'),
  };
  return {
    projectDir,
    configPath,
    pathContext,
    cleanup: () => {
      if (prevTemplatesEnv === undefined) delete process.env['RADORCH_TEMPLATES_DIR'];
      else process.env['RADORCH_TEMPLATES_DIR'] = prevTemplatesEnv;
      fs.rmSync(projectDir, { recursive: true, force: true });
    },
  };
}
