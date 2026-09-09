import chokidar from 'chokidar';
import { buildWatchOptions } from './watch-config';

export type RawWatchEventType = 'add' | 'change' | 'unlink';
export interface RawWatchEvent { type: RawWatchEventType; filePath: string; }
type Listener = (e: RawWatchEvent) => void;

interface MakeWatcherArgs { projectsRoot: string; makeWatcher?: () => MinimalWatcher; }
interface MinimalWatcher {
  on(event: string, cb: (p: string) => void): unknown;
  close(): Promise<void>;
}
interface SharedWatcher {
  subscribe(l: Listener): () => void;
  close(): Promise<void>;
  reopen(): void;
}

const GLOBAL_KEY = '__radLiveSharedWatcher__';
type GlobalHolder = { [GLOBAL_KEY]?: SharedWatcherImpl };

class SharedWatcherImpl implements SharedWatcher {
  private listeners = new Set<Listener>();
  private watcher: MinimalWatcher | null = null;
  constructor(private root: string, private factory: () => MinimalWatcher) {}
  private ensureWatcher(): void {
    if (this.watcher) return;
    const w = this.factory();
    (['add', 'change', 'unlink'] as RawWatchEventType[]).forEach((type) => {
      w.on(type, (filePath: string) => {
        for (const l of this.listeners) l({ type, filePath });
      });
    });
    w.on('error', (err: unknown) => console.error('[live] shared watcher error:', err));
    this.watcher = w;
  }
  subscribe(l: Listener): () => void {
    this.ensureWatcher();
    this.listeners.add(l);
    return () => { this.listeners.delete(l); };
  }
  // Closes the underlying watcher, if one was constructed, and nulls the
  // field. Deliberately does NOT clear `listeners` — subscribe() is the only
  // thing that re-arms ensureWatcher(), so a listener dropped here would be
  // dropped permanently and go silently dead for the process lifetime.
  async close(): Promise<void> {
    const outgoing = this.watcher;
    if (!outgoing) return;
    this.watcher = null;
    await outgoing.close();
  }
  // Re-arms the watcher via ensureWatcher() when there are listeners left to
  // serve. A no-op when nobody is subscribed — nothing to reopen for.
  reopen(): void {
    if (this.listeners.size > 0) this.ensureWatcher();
  }
}

export function getSharedWatcher(args: MakeWatcherArgs): SharedWatcher {
  const holder = globalThis as unknown as GlobalHolder;
  if (!holder[GLOBAL_KEY]) {
    const usePolling = process.env.CHOKIDAR_USEPOLLING === '1';
    const factory =
      args.makeWatcher ??
      (() => chokidar.watch(args.projectsRoot, buildWatchOptions(usePolling)) as unknown as MinimalWatcher);
    holder[GLOBAL_KEY] = new SharedWatcherImpl(args.projectsRoot, factory);
  }
  return holder[GLOBAL_KEY]!;
}

export function __resetSharedWatcherForTest(): void {
  const holder = globalThis as unknown as GlobalHolder;
  delete holder[GLOBAL_KEY];
}

// Reads the global holder directly rather than going through getSharedWatcher
// — that call constructs a watcher on a cold module, so this helper would
// create one purely to close it. No-ops when no singleton exists.
export function closeSharedWatcherIfActive(): Promise<void> {
  const holder = globalThis as unknown as GlobalHolder;
  const existing = holder[GLOBAL_KEY];
  return existing ? existing.close() : Promise.resolve();
}

// Same rationale as closeSharedWatcherIfActive: reads the global holder
// directly and no-ops when no singleton exists, never constructing one.
export function reopenSharedWatcherIfActive(): void {
  const holder = globalThis as unknown as GlobalHolder;
  holder[GLOBAL_KEY]?.reopen();
}
