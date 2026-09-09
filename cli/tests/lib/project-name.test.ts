import { describe, it, expect } from 'vitest';
import { isProjectDirName } from '../../src/lib/project-name.js';

describe('isProjectDirName', () => {
  it('accepts an uppercase-led name with digits, hyphens, and dots', () => {
    expect(isProjectDirName('AIOPS-330-SESSION-TRACKING-1')).toBe(true);
    expect(isProjectDirName('PROJECT.2')).toBe(true);
    expect(isProjectDirName('9-PROJECT')).toBe(true);
  });

  it('rejects a lowercase-led name', () => {
    expect(isProjectDirName('aiops-330')).toBe(false);
  });

  it('rejects a traversal-shaped argument', () => {
    expect(isProjectDirName('../etc')).toBe(false);
    expect(isProjectDirName('..')).toBe(false);
    expect(isProjectDirName('A/../B')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isProjectDirName('')).toBe(false);
  });
});
