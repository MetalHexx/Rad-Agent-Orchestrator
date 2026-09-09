"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type {
  DeletionPlan,
  DeletionReport,
  DeletionItem,
  DeletionItemResult,
  DeletionSkip,
  ProjectKind,
} from "@rad-orchestration/work-graph";

export interface DeleteProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName: string;
  /** null while the preview is loading (or failed — see planError). */
  plan: DeletionPlan | null;
  planError: string | null;
  /** Set after an attempt; drives the failure view when report.complete is false. */
  report: DeletionReport | null;
  isPending: boolean;
  onConfirm: (skip: DeletionSkip[]) => void;
  projectType?: ProjectKind;
}

const KIND_LABELS: Record<DeletionItem["kind"], string> = {
  "project-dir": "Project directory",
  "worktree": "Worktree",
  "side-project-repo": "Side-project repo",
  "graph-edges": "Graph edges",
};

export function describeKind(kind: DeletionItem["kind"]): string {
  return KIND_LABELS[kind];
}

export function groupByDisposition<T extends DeletionItem>(
  items: T[],
): { toRemove: T[]; protected: T[] } {
  return {
    toRemove: items.filter((item) => item.disposition === "remove"),
    protected: items.filter((item) => item.disposition === "protected"),
  };
}

/** A partial delete: an attempt was made and something is still unresolved. */
export function isRetryMode(report: DeletionReport | null): boolean {
  return report !== null && !report.complete;
}

export function confirmButtonLabel(report: DeletionReport | null, isPending: boolean): string {
  if (isPending) return "Deleting…";
  return isRetryMode(report) ? "Retry" : "Delete project";
}

function isDeletionItemResult(item: DeletionItem): item is DeletionItemResult {
  return "outcome" in item;
}

/** Row key mirrors the existing list-render key: kind + path-or-label. */
function rowKey(item: DeletionItem): string {
  return `${item.kind}-${item.path ?? item.label}`;
}

/**
 * Only worktree/side-project-repo "remove" rows are selectable — the server
 * 400s on any other kind in the skip list. In report mode a settled outcome
 * ('removed'/'already-absent') drops the checkbox; only rows still needing
 * attention ('failed', 'held-back', 'skipped', or no outcome yet) stay
 * interactive.
 */
function isCheckableRow(item: DeletionItem | DeletionItemResult): boolean {
  if (item.disposition !== "remove") return false;
  if (item.kind !== "worktree" && item.kind !== "side-project-repo") return false;
  if (isDeletionItemResult(item) && (item.outcome === "removed" || item.outcome === "already-absent")) {
    return false;
  }
  return true;
}

function RemovalRow({
  item, checked, onCheckedChange, disabled,
}: {
  item: DeletionItem | DeletionItemResult;
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const result = isDeletionItemResult(item) ? item : null;
  const unresolved = result !== null && (result.outcome === "failed" || result.outcome === "held-back");
  const showCheckbox = onCheckedChange !== undefined;
  return (
    <li className={cn("flex items-start gap-2", unresolved && "text-destructive")}>
      {showCheckbox && (
        <Checkbox
          checked={checked}
          onCheckedChange={onCheckedChange}
          disabled={disabled}
          aria-label={`Remove ${describeKind(item.kind)} ${item.label}`}
          className="mt-0.5"
        />
      )}
      <div className="flex flex-1 flex-col">
        <span>
          <span className="text-xs font-medium uppercase text-muted-foreground">{describeKind(item.kind)}</span>{" "}
          <span>{item.label}</span>
        </span>
        {result && result.outcome === "failed" && (
          <span className="text-xs">
            Could not be removed{result.error ? `: ${result.error}` : "."}
          </span>
        )}
        {result && result.outcome === "held-back" && (
          <span className="text-xs">
            Held back so the project stays recoverable{result.error ? ` — ${result.error}` : "."} Fix the failure above and retry.
          </span>
        )}
        {result && result.outcome === "skipped" && (
          <span className="text-xs text-muted-foreground">Kept — not removed.</span>
        )}
      </div>
    </li>
  );
}

function ProtectedRow({ item }: { item: DeletionItem }) {
  return (
    <li className="flex flex-col">
      <span>
        <span className="text-xs font-medium uppercase text-muted-foreground">{describeKind(item.kind)}</span>{" "}
        <span>{item.label}</span>
      </span>
      {item.protectedReason && <span className="block text-xs text-muted-foreground">{item.protectedReason}</span>}
    </li>
  );
}

export function DeleteProjectDialog({
  open,
  onOpenChange,
  projectName,
  plan,
  planError,
  report,
  isPending,
  onConfirm,
  projectType,
}: DeleteProjectDialogProps) {
  const guardedOnOpenChange = (value: boolean) => {
    if (!isPending) {
      onOpenChange(value);
    }
  };

  // The dialog owns a set of *deselected* row keys — deselected rather than
  // selected, so the default (everything checked) needs no seeding and a
  // newly-appearing row is checked automatically.
  const [deselectedKeys, setDeselectedKeys] = useState<Set<string>>(new Set());
  const wasOpenRef = useRef(open);

  // Reset on the closed → open transition.
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setDeselectedKeys(new Set());
    }
    wasOpenRef.current = open;
  }, [open]);

  // Reset whenever `report` changes identity — a retry after a partial
  // failure starts from a clean slate, exactly like a fresh open. Nothing
  // about a prior attempt's selection survives.
  useEffect(() => {
    setDeselectedKeys(new Set());
  }, [report]);

  const handleCheckedChange = useCallback((key: string) => (checked: boolean) => {
    setDeselectedKeys((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  // The report (once an attempt has been made) supersedes the plan as the
  // source of truth for what's shown — its items carry the same shape plus
  // each one's outcome, so a retry keeps showing the same list, now
  // annotated with what happened.
  const items: (DeletionItem | DeletionItemResult)[] | null = report ? report.items : plan?.items ?? null;
  const { toRemove, protected: protectedItems } = groupByDisposition(items ?? []);
  const mandatory = toRemove.filter((item) => !isCheckableRow(item));
  const optional = toRemove.filter((item) => isCheckableRow(item));
  const partial = isRetryMode(report);

  const handleConfirm = () => {
    const skip: DeletionSkip[] = toRemove
      .filter((item) => isCheckableRow(item) && deselectedKeys.has(rowKey(item)))
      .map((item) => ({ kind: item.kind, label: item.label }));
    onConfirm(skip);
  };

  return (
    <Dialog open={open} onOpenChange={guardedOnOpenChange}>
      <DialogContent>
        <DialogTitle>Delete {projectName}</DialogTitle>
        <DialogDescription className="mt-2">
          This permanently removes the project&rsquo;s files and history from this machine. Sessions recorded
          against this project stop being attributed to it; usage, transcripts, checkpoints, and spend are kept.
        </DialogDescription>

        {projectType === "portfolio" && (
          <p className="mt-3 text-sm text-muted-foreground" role="note">
            This is a portfolio root. Deleting it destroys the folder and documents it contains. The
            project-group it belongs to, and the other iteration projects within it, are not deleted.
          </p>
        )}

        {partial && (
          <p className="mt-3 text-sm text-destructive" role="alert">
            The delete did not finish — some items below could not be removed.
          </p>
        )}

        {items === null && planError && (
          <p className="mt-3 text-sm text-destructive" role="alert">{planError}</p>
        )}

        {items === null && !planError && (
          <p className="mt-3 text-sm text-muted-foreground" role="status">Loading what will be removed…</p>
        )}

        {items !== null && (
          <div className="mt-3 flex flex-col gap-4">
            <div>
              <h3 className="text-sm font-medium text-foreground">Will be removed</h3>
              {mandatory.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing to remove.</p>
              ) : (
                <ul className="mt-1 list-disc space-y-1.5 pl-5 text-sm">
                  {mandatory.map((item) => {
                    const key = rowKey(item);
                    return (
                      <RemovalRow
                        key={key}
                        item={item}
                        checked={undefined}
                        onCheckedChange={undefined}
                        disabled={isPending}
                      />
                    );
                  })}
                </ul>
              )}
            </div>

            {optional.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-foreground">Optionally removed</h3>
                <ul className="mt-1 space-y-1.5 text-sm">
                  {optional.map((item) => {
                    const key = rowKey(item);
                    return (
                      <RemovalRow
                        key={key}
                        item={item}
                        checked={!deselectedKeys.has(key)}
                        onCheckedChange={handleCheckedChange(key)}
                        disabled={isPending}
                      />
                    );
                  })}
                </ul>
              </div>
            )}

            {protectedItems.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-foreground">Protected — left in place</h3>
                <ul className="mt-1 space-y-1.5 text-sm text-muted-foreground">
                  {protectedItems.map((item) => (
                    <ProtectedRow key={rowKey(item)} item={item} />
                  ))}
                </ul>
              </div>
            )}

            <p
              className="rounded-md border px-3 py-2 text-xs"
              style={{
                color: "var(--model-red)",
                borderColor: "var(--color-error-border)",
                background: "color-mix(in oklab, var(--model-red) 9%, transparent)",
              }}
            >
              <span className="font-medium">Warning:</span> A workspace folder can be shared with a related project — removing it here removes it for both.
            </p>
          </div>
        )}

        <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => guardedOnOpenChange(false)}
            disabled={isPending}
            autoFocus
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={isPending || items === null}
            aria-busy={isPending ? "true" : undefined}
          >
            {isPending && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
            {confirmButtonLabel(report, isPending)}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
