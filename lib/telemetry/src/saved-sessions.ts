import fs from 'node:fs';
import path from 'node:path';
import type { AgentNode } from './transcript-model.js';
import { readUsageForDates } from './read/usage-reader.js';
import { listSessionAgents, getAgentTranscript } from './read/transcript-reader.js';
import { effectiveTokens } from './read/effective-tokens.js';

export interface SavedSessionSnapshot {
  worktree: string | null;
  model: string | null;
  startedAt: string;
  durationMs: number;
  totalSpend: number;
  tokens: { input: number; output: number; cacheRead: number; cacheCreation: number };
  toolCalls: number;
  toolErrors: number;
  subagents: number;
  filesTouched: number;
}

export interface SavedSession {
  sessionId: string;
  title: string;
  savedAt: string;
  snapshot: SavedSessionSnapshot;
}

export interface SavedSessionsIndex {
  version: 1;
  sessions: SavedSession[];
  updatedAt: string;
}

const INDEX_FILE = '.saved-sessions.json';
export function savedIndexPath(root: string): string { return path.join(root, INDEX_FILE); }

// Absent or malformed index reads as a valid empty index; unknown fields are ignored. (NFR-4)
export function readSavedIndex(root: string): SavedSessionsIndex {
  try {
    const raw = JSON.parse(fs.readFileSync(savedIndexPath(root), 'utf8')) as Partial<SavedSessionsIndex>;
    return {
      version: 1,
      sessions: Array.isArray(raw.sessions) ? (raw.sessions as SavedSession[]) : [],
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
    };
  } catch { return { version: 1, sessions: [], updatedAt: '' }; }
}

export function isSessionSaved(root: string, sessionId: string): boolean {
  return readSavedIndex(root).sessions.some((s) => s.sessionId === sessionId);
}

// Atomic write: temp + rename, matching FileCheckpointStore.commit. (AD-3, NFR-1)
function writeIndex(root: string, index: SavedSessionsIndex): void {
  const file = savedIndexPath(root);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(index, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

export function saveSession(root: string, input: { sessionId: string; snapshot: SavedSessionSnapshot }): SavedSession {
  const index = readSavedIndex(root);
  const savedAt = new Date().toISOString();
  const existing = index.sessions.find((s) => s.sessionId === input.sessionId);
  if (existing) { existing.snapshot = input.snapshot; existing.savedAt = savedAt; }
  const record: SavedSession = existing ?? { sessionId: input.sessionId, title: input.sessionId, savedAt, snapshot: input.snapshot };
  if (!existing) index.sessions.push(record);
  index.updatedAt = savedAt;
  writeIndex(root, index);
  return record;
}

export function updateSavedSession(root: string, sessionId: string, patch: { title?: string }): SavedSession {
  const index = readSavedIndex(root);
  const record = index.sessions.find((s) => s.sessionId === sessionId);
  if (!record) throw new Error(`saved session not found: ${sessionId}`);
  if (typeof patch.title === 'string' && patch.title.trim() !== '') record.title = patch.title.trim();
  index.updatedAt = new Date().toISOString();
  writeIndex(root, index);
  return record;
}

export function unsaveSession(root: string, sessionId: string): void {
  const index = readSavedIndex(root);
  index.sessions = index.sessions.filter((s) => s.sessionId !== sessionId);
  index.updatedAt = new Date().toISOString();
  writeIndex(root, index);
}

function sessionUsageDates(root: string, sessionId: string): string[] {
  let files: string[]; try { files = fs.readdirSync(path.join(root, 'usage')); } catch { return []; }
  const dates = new Set<string>();
  for (const f of files) {
    const m = /^usage-(\d{4}-\d{2}-\d{2})-(.+)\.ndjson$/.exec(f);
    if (m && m[2] === sessionId) dates.add(m[1]);
  }
  return [...dates];
}

function flatten(nodes: AgentNode[]): AgentNode[] {
  const out: AgentNode[] = [];
  const walk = (ns: AgentNode[]): void => { for (const n of ns) { out.push(n); walk(n.children); } };
  walk(nodes); return out;
}

/** Point-in-time aggregate read from usage NDJSON + transcripts. Not auto-refreshed. (FR-9, AD-10) */
export function computeSessionSnapshot(root: string, sessionId: string): SavedSessionSnapshot {
  const records = readUsageForDates({ root, dates: sessionUsageDates(root, sessionId), filter: (r) => r.sessionId === sessionId });
  let input = 0, output = 0, cacheRead = 0, cacheCreation = 0, totalSpend = 0;
  let startMs = Infinity, lastMs = -Infinity;
  let worktree: string | null = null, model: string | null = null;
  for (const r of records) {
    input += r.inputTokens; output += r.outputTokens;
    cacheRead += r.cacheReadTokens ?? 0; cacheCreation += r.cacheCreationTokens ?? 0;
    totalSpend += effectiveTokens(r);
    const t = Date.parse(r.timestamp);
    if (t < startMs) startMs = t;
    if (t > lastMs) lastMs = t;
    if (!worktree && r.worktree) worktree = r.worktree;
    if (!model && r.source === 'main-agent') model = r.model;
  }
  let toolCalls = 0, toolErrors = 0, subagents = 0;
  const files = new Set<string>();
  for (const n of flatten(listSessionAgents(root, sessionId))) {
    toolCalls += n.toolSummary.total; toolErrors += n.toolSummary.errors;
    if (n.role === 'subagent') subagents++;
    const tx = getAgentTranscript(root, sessionId, n.transcriptId);
    if (tx) for (const f of tx.filesTouched) files.add(f);
  }
  return {
    worktree, model,
    startedAt: Number.isFinite(startMs) ? new Date(startMs).toISOString() : '',
    durationMs: Number.isFinite(startMs) && Number.isFinite(lastMs) ? lastMs - startMs : 0,
    totalSpend,
    tokens: { input, output, cacheRead, cacheCreation },
    toolCalls, toolErrors, subagents, filesTouched: files.size,
  };
}
