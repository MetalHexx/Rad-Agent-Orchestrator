// graph-service/src/http/respond.ts — the uniform response envelope every route reuses, mirroring
// the existing `radorch` CLI convention: success carries `data`, failure carries a structured
// `error`, and the two shapes never mix.
import type { Result } from '@rad-orchestration/graph-engine';

export interface SuccessEnvelope<T> {
  readonly ok: true;
  readonly data: T;
}

export interface FailureEnvelope {
  readonly ok: false;
  readonly error: { readonly code: string; readonly message: string };
}

export type Envelope<T = unknown> = SuccessEnvelope<T> | FailureEnvelope;

/** Builds the success envelope every route replies with on the happy path. */
export function ok<T>(data: T): SuccessEnvelope<T> {
  return { ok: true, data };
}

/** Builds the failure envelope — the only shape a route ever replies with on the unhappy path. */
export function err(code: string, message: string): FailureEnvelope {
  return { ok: false, error: { code, message } };
}

/**
 * Maps an engine {@link Result} to the uniform envelope, so a rejected mutation becomes a
 * structured `{ ok: false, error }` body instead of a thrown exception a route would otherwise
 * have to turn into an unhandled 500.
 */
export function fromResult<T>(result: Result<T>): Envelope<T> {
  return result.ok ? ok(result.data) : err(result.error.code, result.error.message);
}
