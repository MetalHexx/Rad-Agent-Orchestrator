import type { EdgeType } from './types.js';

/** Edge types that assert an ordering and therefore shape a layout. */
export const RANKING_EDGE_TYPES: ReadonlySet<EdgeType> = new Set(['follows', 'depends-on']);

/** True when this edge type asserts an ordering. Everything else is decoration. */
export function isRankingEdgeType(type: EdgeType): boolean {
  return RANKING_EDGE_TYPES.has(type);
}
