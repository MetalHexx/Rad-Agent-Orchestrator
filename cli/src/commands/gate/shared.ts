import { processEvent } from '../../lib/pipeline-engine/engine.js';
import {
  readState, writeState, readConfig, readDocument, readDocumentRaw, writeDocument, ensureDirectories,
} from '../../lib/pipeline-engine/state-io.js';
import { resolvePathContext, resolveDiscoveredConfigPath } from '../../lib/pipeline-engine/path-context.js';
import type { IOAdapter, PathContext, PipelineResult } from '../../lib/pipeline-engine/types.js';

export { processEvent, resolvePathContext, resolveDiscoveredConfigPath };
export type { PathContext, PipelineResult };

export function makeIO(): IOAdapter {
  return { readState, writeState, readConfig, readDocument, readDocumentRaw, writeDocument, ensureDirectories };
}

export function autoResolveMasterPlanDocPath(state: unknown): string | undefined {
  const s = state as { graph?: { nodes?: Record<string, { doc_path?: string } | undefined> } } | null;
  return s?.graph?.nodes?.['master_plan']?.doc_path;
}

export function autoResolveFinalReviewDocPath(state: unknown): string | undefined {
  const s = state as { graph?: { nodes?: Record<string, { doc_path?: string } | undefined> } } | null;
  return s?.graph?.nodes?.['final_review']?.doc_path;
}
