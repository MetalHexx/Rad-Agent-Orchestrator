import type { ChangeDelta } from '../model/delta.js';
import type { Result } from '../result.js';
import type { StateStore } from '../store/state-store.js';

/** One committed `ChangeDelta`, handed to every subscriber in commit order. */
export type ChangeListener = (delta: ChangeDelta) => void;

/** Detaches the listener passed to the `subscribe` call that returned it. */
export type Unsubscribe = () => void;

/**
 * The emission seam a host subscribes to for every primitive's committed `ChangeDelta`, in
 * commit order — the seam the append-only change-log + SSE broadcast are built on. Deltas arrive
 * exactly as the primitive produced them: no seq/time/actor is ever added here (the engine stays
 * deterministic); a host stamps those fields itself when it persists a delta.
 */
export interface ChangeStream {
  subscribe(listener: ChangeListener): Unsubscribe;
}

function createEmitter(): ChangeStream & { emit(delta: ChangeDelta): void } {
  const listeners = new Set<ChangeListener>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(delta) {
      for (const listener of listeners) listener(delta);
    },
  };
}

/**
 * Decorates `store` so every successful `apply` also emits its committed `ChangeDelta` on the
 * returned `ChangeStream`, in commit order — a host drives the engine exclusively through the
 * returned `store` to observe every primitive's write, `engage`'s included, without either the
 * store or the mutation primitives themselves knowing the stream exists. A failed `apply` emits
 * nothing, matching `StateStore.apply`'s own transactional, all-or-nothing contract.
 */
export function withChangeStream(store: StateStore): { readonly store: StateStore; readonly changeStream: ChangeStream } {
  const emitter = createEmitter();

  const wrapped: StateStore = {
    getNode: (scope, id) => store.getNode(scope, id),
    listNodes: (scope) => store.listNodes(scope),
    listEdges: (scope) => store.listEdges(scope),
    apply(scope, delta): Result<void> {
      const result = store.apply(scope, delta);
      if (result.ok) emitter.emit(delta);
      return result;
    },
  };

  return { store: wrapped, changeStream: emitter };
}
