import { describe, expect, it } from 'vitest';
import { ROOT_NODE_ID, ROOT_TRAITS, createRootNode } from '../src/model/root.js';

describe('createRootNode', () => {
  it('mints the project-scoped root anchor: reserved id, in_progress, parent null, the contains trait', () => {
    const root = createRootNode();
    expect(root.id).toBe(ROOT_NODE_ID);
    expect(root.status).toBe('in_progress');
    expect(root.parent).toBeNull();
    expect(root.derivedFrom).toBeNull();
    expect(ROOT_TRAITS).toContain('contains');
  });

  it('returns a fresh object per call, so independent scopes never share (and mutate) one instance', () => {
    const a = createRootNode();
    const b = createRootNode();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
    a.data = { touched: true };
    expect(b.data).toEqual({});
  });
});
