// A throwaway custom `team:*` node type, authored entirely in tests, proving the extension surface
// (P04's `NodeTypeDefinition` contract, including the code-behind slot) is complete by construction:
// a team's own node type registers through the exact same `createNodeTypeRegistry` customs seam a
// built-in uses, and runs to completion through the exact same driver. Spawns a triage agent, then
// interprets its raw findings via this node type's own code-behind (`interpret`) — mirroring
// `parseMasterPlan`'s shape (a pure `(input) => Envelope` transform, no store/graph access).
import type {
  ActContext,
  ActResult,
  DataSchema,
  Envelope,
  EventToken,
  HandleResult,
  NodeEvent,
  NodeStatus,
  NodeTypeDefinition,
  Presentation,
  ReviewSpawnRequest,
} from '@rad-orchestration/graph-engine';

/** Names this node type's own code-behind capability, via `CapabilityName`'s open string escape hatch. */
export const SECURITY_SCAN_INTERPRETER_CAPABILITY = 'team:security-scan-interpreter';

/** Fires once the triage agent's raw findings have been read back. */
export const SECURITY_SCAN_SCANNED_TOKEN: EventToken = 'team:security_scan.scanned';

/** This node type's own two-outcome vocabulary — never the engine's `EnvelopeOutcome` spine. */
export type SecurityScanVerdict = 'clear' | 'flagged';

export interface SecurityScanFinding {
  readonly rule: string;
  readonly detail: string;
}

export interface SecurityScanOutputs {
  readonly rawFindings: readonly string[];
}

export interface SecurityScanInterpretation {
  readonly verdict: SecurityScanVerdict;
  readonly findings: readonly SecurityScanFinding[];
}

/**
 * The one code-behind slot this node type ships: a deterministic, side-effect-free transform of the
 * triage agent's raw `rule: detail` lines into a structured verdict + findings — no store, scope, or
 * graph parameter available to it, exactly like `parseMasterPlan`. `'flagged'` whenever at least one
 * finding is present, `'clear'` otherwise.
 */
export function interpret(outputs: SecurityScanOutputs): Envelope<SecurityScanInterpretation> {
  const findings: SecurityScanFinding[] = outputs.rawFindings.map((line) => {
    const [rule, ...rest] = line.split(':');
    return { rule: rule.trim(), detail: rest.join(':').trim() };
  });
  const verdict: SecurityScanVerdict = findings.length > 0 ? 'flagged' : 'clear';
  return { outcome: 'ok', data: { verdict, findings } };
}

interface SecurityScanRepoRef {
  readonly name: string;
  readonly path: string;
  readonly branch: string;
}

function readRepos(value: unknown): readonly SecurityScanRepoRef[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
    .map((entry) => ({
      name: typeof entry.name === 'string' ? entry.name : '',
      path: typeof entry.path === 'string' ? entry.path : '',
      branch: typeof entry.branch === 'string' ? entry.branch : '',
    }));
}

const DATA_SCHEMA: DataSchema = {
  repos: { kind: 'array', level: 'required', description: "The team's own repo set the triage agent scans." },
  verdict: { kind: 'string', level: 'computed', description: "This scan's resolved verdict — 'clear' | 'flagged'." },
  findings: { kind: 'array', level: 'computed', description: 'Structured findings, once interpreted.' },
};

const PRESENTATION: Presentation = {
  label: 'Team Security Scan',
  description: 'A throwaway custom node type: a triage agent plus a code-behind interpreter.',
};

const INSTRUCTIONS = `# team:security_scan

Spawns the team's own triage agent over this node's repo set, then interprets its raw findings via
this node type's own code-behind (\`interpret\`) into a structured verdict/findings pair — \`clear\`
(done) or \`flagged\` (a recoverable halt, mirroring \`rad-orc:approval\`'s final-level denial).
`;

function act(ctx: ActContext): ActResult {
  const payload: ReviewSpawnRequest = {
    kind: 'reviewer',
    handoffDoc: typeof ctx.data.briefDocPath === 'string' ? ctx.data.briefDocPath : '',
    repos: readRepos(ctx.data.repos),
  };
  return {
    instructions:
      "Spawn the team's own triage agent via the spawn-agent capability, then interpret its raw findings via " +
      'this node type\'s own code-behind capability and feed the result back as `team:security_scan.scanned`.',
    executor: 'spawn-sub-agent',
    payload,
  };
}

function handle(ev: NodeEvent): HandleResult {
  if (ev.token !== SECURITY_SCAN_SCANNED_TOKEN || ev.envelope.outcome !== 'ok') return {};
  const { verdict, findings } = ev.envelope.data as unknown as SecurityScanInterpretation;
  return { dataChange: { verdict, findings } };
}

function projectStatus(data: Readonly<Record<string, unknown>>): NodeStatus {
  if (data.verdict === 'clear') return 'done';
  if (data.verdict === 'flagged') return 'blocked';
  return 'not_started';
}

export const TEAM_SECURITY_SCAN_NODE_TYPE: NodeTypeDefinition = {
  name: 'team:security_scan',
  dataSchema: DATA_SCHEMA,
  traits: [],
  capabilities: ['spawn-agent', SECURITY_SCAN_INTERPRETER_CAPABILITY],
  presentation: PRESENTATION,
  instructions: INSTRUCTIONS,
  act,
  handle,
  projectStatus,
};
