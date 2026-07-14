// graph-service/src/capabilities/real.ts
//
// The real `docRead`/`docWrite` ports — filesystem-backed, confined to a resolved filesystem root
// passed in via `projectRoot` (defaults to `resolveRadorcRoot()` if not supplied by the caller).
// `gitFacts`/`spawnAgent`/`runCommand`/`requestHuman` stay the fakes: those four ports name work
// that is the orchestrator's job, never service-executed, so this bundle never needs a real
// implementation for them.
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  DocReadPort,
  DocReadRequest,
  DocWritePort,
  DocWriteRequest,
  DocWriteResult,
  Envelope,
} from '@rad-orchestration/graph-engine';
import { createFakedCapabilityPorts } from './fakes.js';
import type { CapabilityPorts } from './ports.js';

/**
 * Resolves `requestedPath` against `root` and rejects anything that escapes it — a `..`
 * traversal or an absolute path outside the root — returning `null` rather than throwing so
 * callers can turn it into an error `Envelope`.
 */
function resolveWithinRoot(root: string, requestedPath: string): string | null {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, requestedPath);
  const relative = path.relative(resolvedRoot, resolved);
  if (relative !== '' && (relative.startsWith('..') || path.isAbsolute(relative))) return null;
  return resolved;
}

export class RealDocReadPort implements DocReadPort {
  constructor(private readonly projectRoot: string) {}

  async read(request: DocReadRequest): Promise<Envelope<{ readonly content: string }>> {
    const resolved = resolveWithinRoot(this.projectRoot, request.path);
    if (resolved === null) return { outcome: 'error', data: { content: '' } };
    try {
      const content = await fs.readFile(resolved, 'utf8');
      return { outcome: 'ok', data: { content } };
    } catch {
      return { outcome: 'error', data: { content: '' } };
    }
  }
}

export class RealDocWritePort implements DocWritePort {
  constructor(private readonly projectRoot: string) {}

  async write(request: DocWriteRequest): Promise<Envelope<DocWriteResult>> {
    const echo = { idempotencyKey: request.idempotencyKey, path: request.path };
    const resolved = resolveWithinRoot(this.projectRoot, request.path);
    if (resolved === null) return { outcome: 'error', data: echo };
    try {
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.writeFile(resolved, request.content, 'utf8');
      return { outcome: 'ok', data: echo };
    } catch {
      return { outcome: 'error', data: echo };
    }
  }
}

/**
 * Builds the `CapabilityPorts` bundle `compose()` wires in: real filesystem-backed
 * `docRead`/`docWrite`, confined to `projectRoot`; the remaining four ports resolve via the fakes,
 * since `gitFacts`/`spawnAgent`/`runCommand`/`requestHuman` are the orchestrator's job, never
 * service-executed.
 */
export function createRealCapabilityPorts(projectRoot: string): CapabilityPorts {
  const fakes = createFakedCapabilityPorts();
  return {
    docRead: new RealDocReadPort(projectRoot),
    docWrite: new RealDocWritePort(projectRoot),
    gitFacts: fakes.gitFacts,
    spawnAgent: fakes.spawnAgent,
    runCommand: fakes.runCommand,
    requestHuman: fakes.requestHuman,
  };
}
