import type { NodeTypeName } from '../model/vocab.js';
import type { NodeTypeDefinition } from './definition.js';

/** The namespace no custom node type may claim — reserved for the engine's own built-ins. */
export const RESERVED_NODE_TYPE_PREFIX = 'rad-orc:';

/**
 * Resolves a `type` name to its `NodeTypeDefinition` — the one seam the mutation primitives
 * (`add_node`, `expand`) call through to turn a bare `NodeTypeName` into behavior, and the only
 * place a `type` name is ever looked up. The engine never scans a filesystem or falls back to a
 * global default; every host constructs and injects its own registry via
 * {@link createNodeTypeRegistry}.
 */
export interface NodeTypeRegistry {
  /** `undefined` when `name` isn't registered — callers turn that into a structured `unknown_node_type` failure. */
  resolve(name: NodeTypeName): NodeTypeDefinition | undefined;
  /** Every registered definition, built-in and custom alike. */
  list(): readonly NodeTypeDefinition[];
}

/**
 * Builds the map-backed {@link NodeTypeRegistry} from `builtins` and `customs`, enforcing both
 * rules at construction time — never at resolution time, so a misconfigured registry fails fast
 * instead of surfacing as a runtime `unknown_node_type` surprise:
 *
 * - **Reserved prefix.** A `customs` entry named under {@link RESERVED_NODE_TYPE_PREFIX} throws —
 *   that namespace is reserved for `builtins`, which register unchecked against it (claiming
 *   `rad-orc:*` is exactly what makes a definition built-in rather than custom).
 * - **Global uniqueness.** Any two entries sharing a `name` throw, whether both are built-in, both
 *   custom, or one of each.
 *
 * `builtins` and `customs` fold into the exact same underlying map through the exact same
 * insertion step — built-ins carry no privileged registration path beyond the one prefix rule
 * they alone are exempt from.
 */
export function createNodeTypeRegistry(
  builtins: readonly NodeTypeDefinition[],
  customs: readonly NodeTypeDefinition[] = [],
): NodeTypeRegistry {
  const definitions = new Map<NodeTypeName, NodeTypeDefinition>();

  function register(definition: NodeTypeDefinition, reservedPrefixAllowed: boolean): void {
    if (!reservedPrefixAllowed && definition.name.startsWith(RESERVED_NODE_TYPE_PREFIX)) {
      throw new Error(`node type '${definition.name}' claims the reserved '${RESERVED_NODE_TYPE_PREFIX}' prefix`);
    }
    if (definitions.has(definition.name)) {
      throw new Error(`node type '${definition.name}' is already registered`);
    }
    definitions.set(definition.name, definition);
  }

  for (const definition of builtins) register(definition, true);
  for (const definition of customs) register(definition, false);

  return {
    resolve: (name) => definitions.get(name),
    list: () => [...definitions.values()],
  };
}
