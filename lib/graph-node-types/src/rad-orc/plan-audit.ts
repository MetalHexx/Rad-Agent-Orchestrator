import type {
  ActContext,
  ActResult,
  DataSchema,
  EventToken,
  HandleResult,
  NodeEvent,
  NodeStatus,
  NodeTypeDefinition,
  Presentation,
} from '@rad-orchestration/graph-engine';

/** Fires once the orchestrator's inline audit-and-correct cycle has completed. */
export const PLAN_AUDIT_AUDITED_TOKEN: EventToken = 'rad-orc:plan_audit.audited';

/** The envelope data `handle` expects on {@link PLAN_AUDIT_AUDITED_TOKEN}. D12: no verdict crosses the wire, so this carries nothing. */
export type PlanAuditAuditedData = Record<string, never>;

export const PLAN_AUDIT_DATA_SCHEMA: DataSchema = {
  requirementsDocPath: {
    kind: 'string',
    level: 'optional',
    description: "Override pointer to the requirements doc; falls back to the project's standard location.",
  },
  masterPlanDocPath: {
    kind: 'string',
    level: 'optional',
    description: 'Override pointer to the master-plan doc to audit; falls back to the standard location.',
  },
  audited: {
    kind: 'boolean',
    level: 'computed',
    description: 'Set once the inline audit-and-correct cycle completes.',
  },
};

const PRESENTATION: Presentation = {
  label: 'Plan Audit',
  description: 'Independent-eyes audit of the master plan against requirements; applies findings as inline corrections.',
};

const INSTRUCTIONS = `# rad-orc:plan_audit

Audit of the master plan against requirements, executed inline by the orchestrator. Read the
requirements doc and the master-plan doc end to end and judge the plan through four lenses,
then apply findings as inline corrections:

- **Accurate** — the plan matches the codebase: load-bearing paths, signatures, and types the plan
  pins are real, not guessed; a "mirror the existing X" pattern the plan tells a coder to follow
  actually exists; discovery reads grounded, not invented.
- **Consistent** — Requirements and plan agree, and the plan agrees with itself: each requirement
  is carried in the shape the requirements describe; a contract pinned at a cross-repo seam reads
  identically in both tasks that meet there; every task's target repo sits inside the sealed
  \`repos:\` set.
- **Coherent** — sensible scope, order, complexity, and calibration: phases run in dependency
  order; complexity reads honest rather than uniformly inflated; each brief is calibrated to its
  stamped complexity — flag both a too-thin brief that leaves load-bearing gaps unfilled and a
  too-much brief that pastes finished code, bending toward the contract-rich middle.
- **Complete** — the plan covers the requirements: each requirement has a task carrying its
  substance, judged by reading the capability it asks to build rather than by label-matching; a
  requirement with no home in any task is a gap; a deliberate, named non-goal is not a gap.
`;

function act(_ctx: ActContext): ActResult {
  return {
    executor: 'orchestrator-inline',
  };
}

function handle(ev: NodeEvent): HandleResult {
  if (ev.token !== PLAN_AUDIT_AUDITED_TOKEN || ev.envelope.outcome !== 'ok') return {};
  return { dataChange: { audited: true } };
}

function projectStatus(data: Readonly<Record<string, unknown>>): NodeStatus {
  return data.audited === true ? 'done' : 'not_started';
}

export const PLAN_AUDIT_NODE_TYPE: NodeTypeDefinition = {
  name: 'rad-orc:plan_audit',
  dataSchema: PLAN_AUDIT_DATA_SCHEMA,
  traits: [],
  capabilities: ['doc-read', 'doc-write'],
  presentation: PRESENTATION,
  instructions: INSTRUCTIONS,
  act,
  handle,
  projectStatus,
};
