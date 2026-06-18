import { describe, it, expect } from 'vitest';
import { worktreeFromCwd } from '../src/adapter/claude-code-adapter.js';

describe('worktreeFromCwd', () => {
  it('keeps a real cwd as the worktree (FR-8)', () => {
    expect(worktreeFromCwd('C:\\Users\\Metal\\.radorc\\worktrees\\TELEMETRY-2\\rad-orc-source')).toBe('C:\\Users\\Metal\\.radorc\\worktrees\\TELEMETRY-2\\rad-orc-source');
  });
  it('treats empty/whitespace/undefined cwd as absent — never a fallback dir (AD-2)', () => {
    expect(worktreeFromCwd('')).toBeUndefined();
    expect(worktreeFromCwd('   ')).toBeUndefined();
    expect(worktreeFromCwd(undefined)).toBeUndefined();
  });
});
