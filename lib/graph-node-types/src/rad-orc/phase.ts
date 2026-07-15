import type {
  ActContext,
  ActResult,
  DataSchema,
  HandleResult,
  NodeEvent,
  NodeStatus,
  NodeTypeDefinition,
  Presentation,
} from '@rad-orchestration/graph-engine';

/**
 * `rad-orc:phase` — the structural container `explosion` seeds one of per parsed phase. Carries
 * zero behavior: its `docPath`/`exitCriteria` are seeded once at expansion time and never mutated,
 * and its status is the engine's own containment roll-up (`deriveContainerStatus`) over its
 * children — never this node type's own concern. The dogfood proof that a structural role is
 * declared via `traits: ['contains']`, never inferred from a node's position in the tree.
 */
export const PHASE_DATA_SCHEMA: DataSchema = {
  docPath: {
    kind: 'string',
    level: 'required',
    description: "Path to this phase's own plan doc, seeded by explosion's parse of the master plan.",
  },
  exitCriteria: {
    kind: 'array',
    level: 'required',
    description: 'Exit-criteria strings gating this phase as done, parsed from the master plan.',
  },
};

const PRESENTATION: Presentation = {
  label: 'Phase',
  description:
    "Structural container for a phase's tasks and reviews; status is the engine's own containment roll-up.",
};

const INSTRUCTIONS = `# rad-orc:phase

A structural container seeded by \`rad-orc:explosion\` for one phase of the master plan. Carries
no operator or agent action of its own — the engine never dispatches work to it directly, and its
status is always the roll-up of its own children (\`done\` once every child is \`done\`, \`failed\`
if any child is \`failed\`, \`in_progress\` otherwise).
`;

function act(_ctx: ActContext): ActResult {
  return {
    executor: 'noop',
  };
}

function handle(_ev: NodeEvent): HandleResult {
  // A `contains`-trait node's status is the engine's own roll-up over its children — no event
  // ever targets this hook in practice. Returns the universal "no reaction" result rather than
  // special-casing an unreachable path.
  return {};
}

function projectStatus(_data: Readonly<Record<string, unknown>>): NodeStatus {
  // Never consulted while this node has children: the engine's `deriveContainerStatus` reads the
  // children's own resolved statuses instead of this hook (see `graph-engine`'s `readiness.ts`).
  // Declared purely to satisfy the uniform `NodeTypeDefinition` contract.
  return 'not_started';
}

export const PHASE_NODE_TYPE: NodeTypeDefinition = {
  name: 'rad-orc:phase',
  dataSchema: PHASE_DATA_SCHEMA,
  traits: ['contains'],
  capabilities: [],
  presentation: PRESENTATION,
  instructions: INSTRUCTIONS,
  act,
  handle,
  projectStatus,
};
