"use client";

import { useCallback, useRef } from "react";
import type { ModalDoc } from "@/lib/modal-doc-model";

export function markdownPathForActive(docs: ModalDoc[], activePath: string | null): string | null {
  if (activePath === null) return null;
  const d = docs.find((doc) => doc.path === activePath);
  return d && d.isMarkdown ? d.path : null;
}

export function nextIndex(current: number, length: number): number {
  if (length <= 0) return -1;
  return (current + 1) % length;
}

export function prevIndex(current: number, length: number): number {
  if (length <= 0) return -1;
  return (current - 1 + length) % length;
}

/** New active index after deleting the item at `current` from a list of `length`. */
export function indexAfterDelete(current: number, length: number): number {
  const newLength = length - 1;
  if (newLength <= 0) return -1;
  return Math.min(current, newLength - 1);
}

export function modalKeyAction(key: string): 'prev' | 'next' | 'close' | null {
  if (key === 'ArrowLeft') return 'prev';
  if (key === 'ArrowRight') return 'next';
  if (key === 'Escape') return 'close';
  return null;
}

/**
 * The path `offset` steps away from `current` in the CURRENT ordered list,
 * wrapping modulo length. Identity is the path, not the index, so a list
 * that reordered underneath the modal lands on the neighbour of the document
 * the user is actually looking at — never a stale slot. If `current` is no
 * longer in the list, falls back to the first doc. Returns null for an empty
 * list. `offset` is +1 (next) or -1 (prev).
 */
export function fileNameAtOffset(
  docs: ModalDoc[],
  current: string | null,
  offset: 1 | -1,
): string | null {
  if (docs.length === 0) return null;
  const i = docs.findIndex((d) => d.path === current);
  if (i < 0) return docs[0]?.path ?? null;
  const stepped = offset === 1 ? nextIndex(i, docs.length) : prevIndex(i, docs.length);
  return docs[stepped]?.path ?? null;
}

/**
 * The path to focus after deleting `current` from the CURRENT ordered list
 * (the active doc is still present at call time). Mirrors `indexAfterDelete`'s
 * clamp semantics in path terms: keep position when a middle item goes,
 * clamp to the new last when the tail goes, and return null (closes) when the
 * only item is removed or `current` is absent.
 */
export function fileNameAfterDelete(docs: ModalDoc[], current: string | null): string | null {
  const i = docs.findIndex((d) => d.path === current);
  if (i < 0) return null;
  const remaining = docs.filter((_, idx) => idx !== i);
  if (remaining.length === 0) return null;
  return remaining[Math.min(i, remaining.length - 1)]?.path ?? null;
}

export function openNavMode(isOpen: boolean): 'push' | 'replace' { return isOpen ? 'replace' : 'push'; }
export function closeNavMode(openedViaPush: boolean): 'back' | 'replace' { return openedViaPush ? 'back' : 'replace'; }

/**
 * Modal identity is anchored to a PATH, not an array index. The document list
 * can reorder/insert/delete at runtime (live file changes); pinning to
 * `activePath` keeps focus on the same document across those mutations. A
 * root doc's path is its bare filename; a subfolder doc's path is its full
 * project-relative path.
 *
 * @param getArtifacts getter for the CURRENT ordered list — read at navigation
 *                     time so prev/next/onDeleted operate on live positions.
 * @param activePath   the URL-derived active path (source of truth).
 * @param navigate     callback to push a new path (or null to close) into
 *                     the router — the caller owns URL → modal wiring.
 */
export function useArtifactModal(
  getArtifacts: () => ModalDoc[],
  activePath: string | null,
  navigate: (path: string | null, mode: 'push' | 'replace' | 'back') => void,
) {
  const open = activePath !== null;
  const pushedRef = useRef(false);
  const openByName = useCallback((path: string) => {
    const mode = openNavMode(open);
    if (mode === 'push') pushedRef.current = true;
    navigate(path, mode);
  }, [open, navigate]);
  const close = useCallback(() => {
    const mode = closeNavMode(pushedRef.current);
    pushedRef.current = false;
    navigate(null, mode);
  }, [navigate]);
  const goNext = useCallback(() => navigate(fileNameAtOffset(getArtifacts(), activePath, 1), 'replace'), [getArtifacts, activePath, navigate]);
  const goPrev = useCallback(() => navigate(fileNameAtOffset(getArtifacts(), activePath, -1), 'replace'), [getArtifacts, activePath, navigate]);
  const onDeleted = useCallback(() => navigate(fileNameAfterDelete(getArtifacts(), activePath), 'replace'), [getArtifacts, activePath, navigate]);
  return { activePath, open, openByName, close, goNext, goPrev, onDeleted };
}
