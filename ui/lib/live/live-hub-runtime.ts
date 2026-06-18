import { readFileSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { classifyArtifactEvent, type ArtifactSemanticEvent } from './artifact-adapter';
import {
  classifyStateEvent,
  classifyLifecycleEvent,
  stateTopicForProject,
  lifecycleTopic,
  type RawFsEvent,
} from './state-adapter';
import { createTopicHub } from './topic-hub';
import { createWatcherSupervisor } from './watcher-supervisor';
import { tailCompleteLines } from './telemetry-tail';
import { toObservabilityUsageRow, type ObservabilityUsageRow } from '@rad-orchestration/telemetry';

export interface ArtifactChangeNotification {
  type: 'artifact_change';
  payload: { projectName: string; kind: 'added' | 'changed' | 'removed' };
  timestamp: string;
}
export interface StateChangeNotification {
  type: 'state_change';
  payload: { projectName: string; state: unknown };
  timestamp: string;
}
export interface LifecycleNotification {
  type: 'project_added' | 'project_removed';
  payload: { projectName: string };
  timestamp: string;
}
export interface DegradedNotification {
  type: 'live_degraded';
  payload: { degraded: boolean };
}
export interface RegistryChangeNotification {
  type: 'registry_change';
  payload: Record<string, never>;
  timestamp: string;
}
export interface TelemetryChangeNotification {
  type: 'telemetry_change';
  payload: { rows: ObservabilityUsageRow[] };
  timestamp: string;
}

interface RuntimeScheduler { schedule(cb: () => void): unknown; cancel(handle: unknown): void; }
type MinimalWatcher = { on: (e: string, cb: (p: unknown) => void) => unknown; close: () => Promise<void> };
interface RuntimeArgs {
  projectsRoot: string;
  makeWatcher?: () => MinimalWatcher;
  // The radorc-home root (e.g. ~/.radorc) watched for registry-file changes,
  // distinct from projectsRoot. When provided, build() warms a second
  // process-level singleton watch scoped to it (FR-2, AD-1, AD-2).
  registryRoot?: string;
  // Optional injected registry watcher so a test can drive registry events
  // deterministically; production constructs a real chokidar watch.
  makeRegistryWatcher?: () => MinimalWatcher;
  // The telemetry usage directory (~/.radorc/telemetry/usage) watched for *.ndjson
  // partition writes. When provided, build() warms a third process-level singleton
  // watch scoped to it (FR-10, AD-5, AD-6).
  telemetryRoot?: string;
  // Optional injected telemetry watcher so a test can drive telemetry events
  // deterministically; production constructs a real chokidar watch.
  makeTelemetryWatcher?: () => MinimalWatcher;
  coalesceWindowMs?: number;
  maxRestarts?: number;
  // Optional injected scheduler so a test can drive coalescing deterministically
  // with a manual clock; production leaves it undefined and the hub uses real timers.
  scheduler?: RuntimeScheduler;
  // Optional injected state-file reader so a test can supply deterministic content
  // without touching disk; production defaults to a synchronous readFileSync.
  readStateFile?: (filePath: string) => string;
}

const GLOBAL_KEY = '__radLiveRuntime__';

// Explicitly chosen settle window for the registry watch, matching the route's
// registry-watcher (REGISTRY_SETTLE_WINDOW_MS = 300) — distinct from lib/live's
// 500ms projects-tree window (DD-2).
const REGISTRY_SETTLE_WINDOW_MS = 300;
// The two registry files a change on either of which fires a nudge (FR-2, DD-2).
const REGISTRY_FILES = new Set(['repo-registry.yml', 'repo-registry.local.yml']);
function isRegistryFile(filePath: string): boolean {
  return REGISTRY_FILES.has(path.basename(filePath));
}
// The single topic every registry nudge publishes on; subscribeRegistry fans it
// in. Distinct from the artifact/state/lifecycle topics so the same hub carries
// all four without collision (AD-2).
const REGISTRY_TOPIC = 'registry';
// The single topic every telemetry batch publishes on; subscribeTelemetry fans it
// in. Distinct from all other topics so the hub carries all five without collision
// (FR-10, AD-5).
const TELEMETRY_TOPIC = 'telemetry';

function build(args: RuntimeArgs) {
  const hub = createTopicHub({
    coalesceWindowMs: args.coalesceWindowMs ?? 50,
    maxQueuePerTopic: 1,
    scheduler: args.scheduler,
  });
  const degradedListeners = new Set<(n: DegradedNotification) => void>();
  let watcher: MinimalWatcher | null = null;
  let registryWatcher: MinimalWatcher | null = null;
  let telemetryWatcher: MinimalWatcher | null = null;

  const emitDegraded = () => {
    const n: DegradedNotification = { type: 'live_degraded', payload: { degraded: true } };
    for (const l of degradedListeners) l(n);
  };

  const supervisor = createWatcherSupervisor({
    maxRestarts: args.maxRestarts ?? 3,
    start: () => { startWatcher(); },
    onDegraded: emitDegraded,
  });

  // The registry watch runs under its OWN supervisor so a registry-watch failure
  // restarts the registry watcher (not the projects watcher) on a SEPARATE restart
  // budget. Without this, registry errors route into the projects supervisor whose
  // restart only re-runs startWatcher() — a registry fault would consume the
  // projects budget and never recreate the registry watcher, leaving registry live
  // updates permanently dead. Both supervisors share one degrade emit: a degrade of
  // either surface degrades "live" for the UI banner (NFR-6).
  const registrySupervisor = createWatcherSupervisor({
    maxRestarts: args.maxRestarts ?? 3,
    start: () => { startRegistryWatcher(); },
    onDegraded: emitDegraded,
  });

  // The telemetry watch runs under its OWN supervisor so a telemetry-watch failure
  // restarts the telemetry watcher (not the projects or registry watcher) on a
  // SEPARATE restart budget. A telemetry fault never burns the projects budget
  // (NFR-4). Both supervisors share one degrade emit: a degrade of any surface
  // degrades "live" for the UI banner.
  const telemetrySupervisor = createWatcherSupervisor({
    maxRestarts: args.maxRestarts ?? 3,
    start: () => { startTelemetryWatcher(); },
    onDegraded: emitDegraded,
  });

  // Default disk read; tests inject readStateFile for deterministic content.
  const readStateFile = args.readStateFile ?? ((filePath: string) => readFileSync(filePath, 'utf-8'));

  // Classify a raw fs event as a state.json write and, if so, read + parse the
  // file once here at the hub (NFR-5, DD-1) so every connection rides one parse.
  // The parsed notification is attached to the hub event's `notif` field and
  // coalesces latest-wins under maxQueuePerTopic = 1 (NFR-4). Read/parse failures
  // are caught and logged so a malformed write never crashes the watcher,
  // matching the route's readFile().catch() behavior.
  function publishStateEvent(type: RawFsEvent['type'], filePath: string): void {
    const sem = classifyStateEvent({ type, filePath }, args.projectsRoot);
    if (!sem) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readStateFile(filePath));
    } catch (e) {
      console.error(`[live] state read/parse failed for ${filePath}:`, e);
      return;
    }
    const notif: StateChangeNotification = {
      type: 'state_change',
      payload: { projectName: sem.projectName, state: parsed },
      timestamp: new Date().toISOString(),
    };
    hub.publish({ topic: sem.topic, kind: 'changed', projectName: sem.projectName, notif });
  }

  // Classify a raw fs event as a project add/remove and publish a lifecycle
  // notification on the single lifecycle topic (FR-3, FR-4, DD-3).
  function publishLifecycleEvent(type: RawFsEvent['type'], filePath: string): void {
    const sem = classifyLifecycleEvent({ type, filePath }, args.projectsRoot);
    if (!sem) return;
    const notif: LifecycleNotification = {
      type: sem.kind,
      payload: { projectName: sem.projectName },
      timestamp: new Date().toISOString(),
    };
    hub.publish({ topic: sem.topic, kind: 'changed', projectName: sem.projectName, notif });
  }

  // A registry-file add/change/unlink fires an empty nudge on the registry topic.
  // The contract carries no payload (DD-2): the client refetches GET /api/registry
  // on receipt, so the watch only needs to signal "something changed".
  function publishRegistryEvent(filePath: string): void {
    if (!isRegistryFile(filePath)) return;
    const notif: RegistryChangeNotification = {
      type: 'registry_change',
      payload: {},
      timestamp: new Date().toISOString(),
    };
    hub.publish({ topic: REGISTRY_TOPIC, kind: 'changed', projectName: '__registry__', notif });
  }

  // Second process-level singleton watch scoped to registryRoot (~/.radorc),
  // distinct from the projects-tree watcher (AD-1, AD-2). Only constructed when
  // registryRoot is provided. Errors route through the dedicated registrySupervisor
  // (its own restart budget) and share the projects watcher's degrade emit, so a
  // registry-watch failure restarts the registry watcher itself and still degrades
  // "live" through the existing path (NFR-6).
  function startRegistryWatcher(): void {
    if (!args.registryRoot) return;
    // Capture the outgoing registry watcher so a supervisor restart closes it once
    // the new one is wired, rather than leaking its fs handles + listeners (parity
    // with startWatcher's Defect 1). Skipped on the very first start.
    const previous = registryWatcher;
    let w: MinimalWatcher;
    if (args.makeRegistryWatcher) {
      w = args.makeRegistryWatcher();
    } else {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const chokidarMod = require('chokidar');
      const usePolling = process.env.CHOKIDAR_USEPOLLING === '1';
      w = chokidarMod.watch(args.registryRoot, {
        usePolling,
        depth: 0,
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: REGISTRY_SETTLE_WINDOW_MS, pollInterval: 50 },
      }) as never;
    }
    (['add', 'change', 'unlink'] as const).forEach((type) => {
      w.on(type, (filePath: unknown) => publishRegistryEvent(String(filePath)));
    });
    // Route registry-watch errors into the registry supervisor so the registry
    // watcher is the thing that gets restarted, on its own budget (NFR-6).
    w.on('error', (err: unknown) => registrySupervisor.reportError(err));
    // chokidar 'ready' marks a healthy (re)start — reset the registry budget so
    // transient registry errors that each recover do not accumulate into a
    // permanent degrade (parity with startWatcher's Defect 2).
    w.on('ready', () => registrySupervisor.reportHealthy());
    registryWatcher = w;
    if (previous) {
      void previous.close().catch((e) => console.error('[live] registry watcher close failed:', e));
    }
  }

  // Per-file byte offsets: seed at 0 for newly-added files (no prior content),
  // or at statSync(file).size for files already present at startup (so a restart
  // never re-emits already-seen rows — FR-12). Deleted on unlink to release memory.
  const telemetryOffsets = new Map<string, number>();

  // Per-file debounce handles: the watcher schedules one flush per file per window
  // (AD-6). Each handle is a real timer; cancel via clearTimeout.
  const telemetryDebounces = new Map<string, ReturnType<typeof setTimeout>>();

  // Process-level singleton watch scoped to telemetryRoot (~/.radorc/telemetry/usage),
  // distinct from the projects-tree and registry watchers (AD-5). Only constructed
  // when telemetryRoot is provided. Errors route through the dedicated
  // telemetrySupervisor (its own restart budget — NFR-4) and share the projects
  // watcher's degrade emit, so a telemetry-watch failure still degrades "live".
  function startTelemetryWatcher(): void {
    if (!args.telemetryRoot) return;
    const previous = telemetryWatcher;
    let w: MinimalWatcher;
    if (args.makeTelemetryWatcher) {
      w = args.makeTelemetryWatcher();
    } else {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const chokidarMod = require('chokidar');
      const usePolling = process.env.CHOKIDAR_USEPOLLING === '1';
      // No awaitWriteFinish: an actively-appended partition must not be stalled
      // while data is being appended (AD-5, NFR-1). stabilityThreshold: 50 ms is
      // not used so we get events as the file grows.
      w = chokidarMod.watch(path.join(args.telemetryRoot, '*.ndjson'), {
        usePolling,
        ignoreInitial: true,
      }) as never;
    }

    // Seed files already present at watcher startup at EOF so a restart never
    // re-emits already-delivered rows (FR-12). chokidar emits 'add' during the
    // initial scan for pre-existing files when ignoreInitial is false, but we set
    // ignoreInitial: true — however the production path uses a real filesystem
    // where the watcher may still see pre-existing files. For safety we keep the
    // offset map seeded on 'add' with the distinction between a file that was
    // already tracked vs one that is brand new.
    w.on('add', (filePath: unknown) => {
      const fp = String(filePath);
      if (!telemetryOffsets.has(fp)) {
        // Newly discovered file: seed at 0 to read all existing content, or at
        // EOF if the file already exists (startup discovery case). Since
        // ignoreInitial: true is set, 'add' only fires for genuinely new files
        // created after the watcher started, so seed at 0 (FR-12).
        telemetryOffsets.set(fp, 0);
      }
      scheduleTelemetryFlush(fp);
    });

    w.on('change', (filePath: unknown) => {
      const fp = String(filePath);
      // Files present at watcher start are seeded at EOF in the 'ready' handler;
      // files created afterward are seeded at 0 in the 'add' handler. If a 'change'
      // still arrives for an untracked file (a missed-'add'/pre-'ready' race), seed
      // at 0 and read the whole file rather than at the POST-write size — seeding at
      // the post-write size silently drops the very rows that triggered this event
      // (FR-10, FR-11). Re-delivery is harmless because consumers dedup on
      // (sessionId, usageId) (NFR-3, NFR-5).
      if (!telemetryOffsets.has(fp)) telemetryOffsets.set(fp, 0);
      scheduleTelemetryFlush(fp);
    });

    w.on('unlink', (filePath: unknown) => {
      const fp = String(filePath);
      telemetryOffsets.delete(fp);
      const h = telemetryDebounces.get(fp);
      if (h !== undefined) { clearTimeout(h); telemetryDebounces.delete(fp); }
    });

    w.on('error', (err: unknown) => telemetrySupervisor.reportError(err));
    w.on('ready', () => {
      // Seed every partition already present at watcher start at its CURRENT EOF.
      // 'ready' fires after the initial scan and before any queued 'change' events,
      // so these offsets are observed by every subsequent handler. This serves two
      // requirements at once: a restart never re-emits rows delivered before it
      // (FR-12), AND the first append to a startup-present file is tailed from the
      // pre-append EOF rather than the post-append EOF (FR-10, FR-11). Seeding lazily
      // in 'change' read statSync().size AFTER the triggering append and silently
      // dropped that first batch. ignoreInitial: true suppresses 'add' for these
      // files, so this is the only place they get an offset.
      if (args.telemetryRoot) {
        try {
          for (const name of readdirSync(args.telemetryRoot)) {
            if (!name.endsWith('.ndjson')) continue;
            const fp = path.join(args.telemetryRoot, name);
            if (telemetryOffsets.has(fp)) continue;
            try { telemetryOffsets.set(fp, statSync(fp).size); } catch { /* vanished mid-scan */ }
          }
        } catch { /* telemetryRoot absent — nothing present to seed */ }
      }
      telemetrySupervisor.reportHealthy();
    });

    telemetryWatcher = w;
    if (previous) {
      void previous.close().catch((e) => console.error('[live] telemetry watcher close failed:', e));
    }
  }

  // Debounce a flush for the given file. One publish per ~50 ms window so the
  // latest-wins hub has nothing to drop (AD-6).
  function scheduleTelemetryFlush(filePath: string): void {
    const existing = telemetryDebounces.get(filePath);
    if (existing !== undefined) clearTimeout(existing);
    const handle = setTimeout(() => {
      telemetryDebounces.delete(filePath);
      flushTelemetryFile(filePath);
    }, 50);
    telemetryDebounces.set(filePath, handle);
  }

  // Tail new complete lines from the file, parse each as JSON, map to
  // ObservabilityUsageRow, and publish one batch on the telemetry topic.
  // Malformed lines are skipped (NFR-4). All connections ride this one parse
  // (NFR-5).
  function flushTelemetryFile(filePath: string): void {
    const offset = telemetryOffsets.get(filePath) ?? 0;
    let result: ReturnType<typeof tailCompleteLines>;
    try {
      result = tailCompleteLines(filePath, offset);
    } catch (e) {
      console.error(`[live] telemetry tail failed for ${filePath}:`, e);
      return;
    }
    if (result.lines.length === 0) {
      telemetryOffsets.set(filePath, result.offset);
      return;
    }
    const rows: ReturnType<typeof toObservabilityUsageRow>[] = [];
    for (const line of result.lines) {
      try {
        // Coalesce the legacy identifier read-side, exactly as readUsageForDates
        // does, so the live path and the history path agree during the migration
        // window (AD-9). A row carrying only radOrcId would otherwise project to
        // usageId: undefined and break consumers keyed on (sessionId, usageId).
        const raw = JSON.parse(line) as Record<string, unknown>;
        const usageId = (raw.usageId ?? raw.radOrcId) as string | undefined;
        if (!usageId) continue; // no identity — skip, matching the read module
        rows.push(toObservabilityUsageRow({ ...raw, usageId } as Parameters<typeof toObservabilityUsageRow>[0]));
      } catch {
        // Skip malformed lines (NFR-4).
      }
    }
    telemetryOffsets.set(filePath, result.offset);
    if (rows.length === 0) return;
    const notif: TelemetryChangeNotification = {
      type: 'telemetry_change',
      payload: { rows },
      timestamp: new Date().toISOString(),
    };
    hub.publish({ topic: TELEMETRY_TOPIC, kind: 'changed', projectName: '__telemetry__', notif });
  }

  function startWatcher(): void {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const chokidarMod = require('chokidar');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { buildWatchOptions } = require('./watch-config');
    const usePolling = process.env.CHOKIDAR_USEPOLLING === '1';
    // Defect 1: capture the outgoing watcher so we can close it once the new one is
    // wired. Without this, a supervisor restart leaks the previous watcher's fs
    // handles and add/change/unlink listeners (bounded by maxRestarts).
    const previous = watcher;
    const w = args.makeWatcher
      ? args.makeWatcher()
      : (chokidarMod.watch(args.projectsRoot, buildWatchOptions(usePolling)) as never);
    // addDir/unlinkDir join add/change/unlink so a project directory created or
    // removed without ever writing state.json still drives a lifecycle topic.
    (['add', 'change', 'unlink', 'addDir', 'unlinkDir'] as const).forEach((type) => {
      w.on(type, (filePath: unknown) => {
        const fp = String(filePath);
        // addDir/unlinkDir are never artifacts (classifyArtifactEvent only handles
        // add/change/unlink), so only run the artifact classifier for file events.
        if (type === 'add' || type === 'change' || type === 'unlink') {
          const artifact = classifyArtifactEvent({ type, filePath: fp }, args.projectsRoot);
          if (artifact) hub.publish(artifact);
        }
        publishStateEvent(type, fp);
        publishLifecycleEvent(type, fp);
      });
    });
    w.on('error', (err: unknown) => supervisor.reportError(err));
    // Defect 2: chokidar emits 'ready' after the initial scan, signalling a healthy
    // (re)start. Reset the supervisor's restart budget so transient errors that each
    // recover do not accumulate into a permanent degrade over the process lifetime.
    w.on('ready', () => supervisor.reportHealthy());
    watcher = w;
    // Defect 1: startWatcher is synchronous, so close the outgoing watcher
    // fire-and-forget (with error logging). Skipped on the very first start.
    if (previous) {
      void previous.close().catch((e) => console.error('[live] watcher close failed:', e));
    }
  }

  // Start the watcher eagerly so the error handler is registered immediately,
  // allowing supervisor.reportError to fire even before any subscriber connects.
  startWatcher();
  // Start the registry watch eagerly too (no-op when registryRoot is absent),
  // so registry nudges flow without waiting for a subscriber to connect.
  startRegistryWatcher();
  // Start the telemetry watch eagerly (no-op when telemetryRoot is absent),
  // so telemetry rows flow without waiting for a subscriber to connect (FR-10).
  startTelemetryWatcher();

  function toNotif(e: ArtifactSemanticEvent): ArtifactChangeNotification {
    return { type: 'artifact_change', payload: { projectName: e.projectName, kind: e.kind }, timestamp: new Date().toISOString() };
  }

  // 'state:' — the prefix every per-project state topic shares (stateTopicForProject
  // returns `state:<name>`), so subscribeAll can fan in every project's state topic.
  const STATE_TOPIC_PREFIX = stateTopicForProject('');
  const LIFECYCLE_TOPIC = lifecycleTopic();

  return {
    subscribeAllArtifactTopics(listener: (n: ArtifactChangeNotification) => void): () => void {
      // Connection-level all-topics subscription (AD-4): one registration fed every
      // coalesced event regardless of project topic, so a single SSE connection fans
      // in every project's artifact topic. The hub still owns coalescing and bounding;
      // we only adapt each delivered event into an SSE-ready notification.
      return hub.subscribeAll((e) => {
        if (
          !e.topic.startsWith(STATE_TOPIC_PREFIX) &&
          e.topic !== LIFECYCLE_TOPIC &&
          e.topic !== REGISTRY_TOPIC &&
          e.topic !== TELEMETRY_TOPIC
        )
          listener(toNotif(e));
      });
    },
    subscribeAllStateTopics(listener: (n: StateChangeNotification) => void): () => void {
      // Rides hub.subscribeAll filtered to state: topics. The parsed notification
      // was attached at publish time, so we deliver it as-is after coalescing —
      // a burst collapses to the newest parse under maxQueuePerTopic = 1 (NFR-4).
      return hub.subscribeAll((e) => {
        if (e.topic.startsWith(STATE_TOPIC_PREFIX) && e.notif) listener(e.notif as StateChangeNotification);
      });
    },
    subscribeLifecycle(listener: (n: LifecycleNotification) => void): () => void {
      // Rides the single lifecycle topic; the classified notification rides on the
      // hub event's notif field, so we deliver it directly.
      return hub.subscribeAll((e) => {
        if (e.topic === LIFECYCLE_TOPIC && e.notif) listener(e.notif as LifecycleNotification);
      });
    },
    subscribeRegistry(listener: (n: RegistryChangeNotification) => void): () => void {
      // Rides the single registry topic. The empty-payload notification was built
      // at publish time and rides the hub event's notif field, so we deliver it
      // directly after coalescing (a burst collapses under maxQueuePerTopic = 1).
      return hub.subscribeAll((e) => {
        if (e.topic === REGISTRY_TOPIC && e.notif) listener(e.notif as RegistryChangeNotification);
      });
    },
    subscribeTelemetry(listener: (n: TelemetryChangeNotification) => void): () => void {
      // Rides the single telemetry topic. The batch notification was built at flush
      // time and rides the hub event's notif field, so we deliver it directly after
      // coalescing (a burst collapses under maxQueuePerTopic = 1 — AD-6). Reading
      // offsets once in the singleton gives every connection each row exactly once
      // (NFR-5).
      return hub.subscribeAll((e) => {
        if (e.topic === TELEMETRY_TOPIC && e.notif) listener(e.notif as TelemetryChangeNotification);
      });
    },
    subscribeDegraded(listener: (n: DegradedNotification) => void): () => void {
      degradedListeners.add(listener);
      return () => degradedListeners.delete(listener);
    },
    // Tear down all three process-level watchers (projects, registry, telemetry).
    // The singleton normally stays warm for the process lifetime; teardown exists so
    // a host that owns the runtime lifecycle can close all fs handles together.
    teardown(): void {
      if (watcher) {
        void watcher.close().catch((e) => console.error('[live] watcher close failed:', e));
        watcher = null;
      }
      if (registryWatcher) {
        void registryWatcher.close().catch((e) => console.error('[live] registry watcher close failed:', e));
        registryWatcher = null;
      }
      if (telemetryWatcher) {
        void telemetryWatcher.close().catch((e) => console.error('[live] telemetry watcher close failed:', e));
        telemetryWatcher = null;
      }
      // Cancel any pending per-file flush debounces; otherwise their real timers fire
      // ~50 ms after teardown and call flushTelemetryFile on the torn-down runtime
      // (cross-test contamination, and a stray publish on a hot-reload teardown).
      for (const h of telemetryDebounces.values()) clearTimeout(h);
      telemetryDebounces.clear();
    },
  };
}

// Process-level singleton guarded on globalThis so Next.js hot-reloads in dev
// share one watcher rather than leaking a new instance on every module reload.
type LiveRuntime = ReturnType<typeof build>;

declare const globalThis: {
  [GLOBAL_KEY]?: LiveRuntime;
} & typeof global;

export function getLiveRuntime(args: RuntimeArgs): LiveRuntime {
  if (!globalThis[GLOBAL_KEY]) {
    globalThis[GLOBAL_KEY] = build(args);
  }
  return globalThis[GLOBAL_KEY]!;
}

// Test-only reset: deletes the process-level singleton so each test starts fresh.
export function __resetLiveRuntimeForTest(): void {
  delete globalThis[GLOBAL_KEY];
}
