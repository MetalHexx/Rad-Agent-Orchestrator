// graph-service/tests/fixtures/relay.ts
//
// The canned completion a real orchestrator would relay for each built-in external-actor node
// type — a `driveToQuiescence` `resolve` callback for scenarios that just want every node to
// converge, over the real HTTP surface, never a faked in-service auto-resolve (there is none: the
// drive loop stops at every `spawn-sub-agent`/`orchestrator-inline` node). `rad-orc:code_review`'s
// own verdict is never carried here — the service always re-derives it from the report doc-read
// (`rad-orc:code_review`'s own `resolve` hook), so this signal's `data` is deliberately empty;
// control a scenario's verdict by staging the report itself (`daemon.seedDoc`).
import type { ExplicitEvent, StoppedActor } from '../harness/drive.js';
import { FIXTURE_REPO } from './repos.js';

const TASK_COMMIT_RESULTS = [{ name: FIXTURE_REPO.name, committed: true, commitHash: 'abc123', pushed: true }];
const PR_RESULTS = [{ name: FIXTURE_REPO.name, pr_url: 'https://example.invalid/pulls/1' }];

export function autoRelay(actor: StoppedActor): ExplicitEvent | undefined {
  switch (actor.type) {
    case 'rad-orc:task':
    case 'rad-orc:corrective':
      return { event: 'rad-orc:task.completed', payload: { outcome: 'ok', data: { results: TASK_COMMIT_RESULTS } } };
    case 'rad-orc:pr':
      return { event: 'rad-orc:pr.created', payload: { outcome: 'ok', data: { results: PR_RESULTS } } };
    case 'rad-orc:code_review':
      return { event: 'rad-orc:code_review.reviewed', payload: { outcome: 'ok', data: {} } };
    default:
      return undefined;
  }
}
