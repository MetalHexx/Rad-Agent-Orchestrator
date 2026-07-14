// Closed vocabulary of known error codes — `as const` derived union, never a TS `enum`. The
// union stays open at the type edge (`GraphClientErrorCode | string`) on `GraphClientError.code`
// so an unforeseen server code is still delivered to the caller rather than swallowed.
export const GRAPH_CLIENT_ERROR_CODES = [
  // service transport-layer codes (from respond.ts / route call sites)
  'invalid_request', 'not_found', 'invalid_delta', 'driver_stalled', 'internal_error',
  // engine legality codes (surfaced through /steer and /dry-run on 400)
  'unknown_node_type', 'cycle', 'cross_axis_cycle', 'not_in_frontier', 'root_guarded',
  // client-side connectivity codes (no HTTP round-trip or unparseable response)
  'network_error', 'timeout', 'bad_response',
] as const;

export type GraphClientErrorCode = (typeof GRAPH_CLIENT_ERROR_CODES)[number];

/** A caller branches on `code`, never on `message` text. */
export class GraphClientError extends Error {
  readonly code: GraphClientErrorCode | string;
  readonly httpStatus: number | null;

  constructor(code: string, message: string, httpStatus: number | null) {
    super(message);
    this.name = 'GraphClientError';
    this.code = code;
    this.httpStatus = httpStatus;
    Object.setPrototypeOf(this, GraphClientError.prototype);
  }
}
