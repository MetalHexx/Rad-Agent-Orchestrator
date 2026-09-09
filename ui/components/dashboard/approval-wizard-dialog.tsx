"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { GateErrorBanner } from "@/components/dashboard/gate-error-banner";
import { useApproveGate } from "@/hooks/use-approve-gate";
import { useDebriefLaunch } from "@/hooks/use-debrief-launch";
import type { GateEvent } from "@/types/state";

export type Harness = "claude" | "copilot";

function isHarness(value: unknown): value is Harness {
  return value === "claude" || value === "copilot";
}

/** What the operator is being walked through approving. */
export interface ApprovalWizardRequest {
  /** The pipeline gate event to fire: 'plan_approved' or 'final_approved'. */
  gateEvent: GateEvent;
  /** The project name (used in every API URL path). */
  projectName: string;
  /** Display name of the document being approved. */
  documentName: string;
}

export interface ApprovalWizardDialogProps extends ApprovalWizardRequest {
  open: boolean;
  /** Closes the wizard. Never called while a commit is in flight. */
  onClose: () => void;
}

/** Which panel the wizard is showing. Questions first, commit last. */
type WizardStep = "confirm" | "debrief" | "committing" | "debrief-failed";

const DIALOG_TITLES: Record<GateEvent, string> = {
  plan_approved: "Approve Plan",
  final_approved: "Approve Final Review",
};

// Reported only after the approval has already landed, so it must lead with
// what did NOT break. Worded to avoid implying every failure mode (e.g. a
// missing agent binary) is something the launcher could have caught and named.
const LAUNCH_FAILURE_MESSAGE =
  "The debrief didn't start. The approval already succeeded — only the debrief failed to open. You can run it later from the portfolio.";

/**
 * The approval wizard: every question the operator owes an answer to is asked
 * BEFORE anything is committed, then the answers are executed in one pass.
 *
 * Ordering is the whole point, and it is load-bearing in two directions:
 *
 *  - **No server mutation until the last question is answered.** Approving a
 *    final review completes the graph, which re-resolves the dag-widget card
 *    from `finalReviewView` to `completeView` — tearing down whatever the
 *    approval's own subtree was rendering. When the approval fired first and a
 *    debrief was offered afterwards, that offer was destroyed by the very
 *    event that created it. Asking first makes the race unreachable rather
 *    than merely survivable.
 *  - **Approval commits before the debrief launches.** The reverse order would
 *    open a debrief terminal for an approval that could still fail.
 *
 * The commit phase is why this dialog is mounted by `ApprovalWizardProvider`
 * high in the tree rather than by the Approve button: the same state change
 * that swaps the card out lands while the commit spinner is still up, so a
 * dialog living under that card would vanish mid-commit — functionally
 * complete, but visually indistinguishable from the bug this replaced.
 *
 * Failure handling splits on whether the approval landed. A failed gate call
 * changed nothing, so the wizard returns to the confirmation step and the
 * operator can retry. A failed debrief launch happens after an approval that
 * DID land, so it reports and offers only a way out — never a retry that might
 * read as re-approving.
 */
export function ApprovalWizardDialog({
  gateEvent,
  projectName,
  documentName,
  open,
  onClose,
}: ApprovalWizardDialogProps) {
  const { approveGate, error: gateError, clearError: clearGateError } = useApproveGate();
  const { launchDebrief } = useDebriefLaunch();

  const [step, setStep] = React.useState<WizardStep>("confirm");
  const [checking, setChecking] = React.useState(false);
  const [defaultHarness, setDefaultHarness] = React.useState<Harness>("claude");
  const [selectedHarness, setSelectedHarness] = React.useState<Harness | null>(null);
  const harness = selectedHarness ?? defaultHarness;

  // Resolved once per wizard, while the operator is still reading the
  // confirmation step — so the answer is almost always in hand by the time
  // they confirm, and the debrief question can be asked BEFORE the approval
  // rather than derived from its response. Held as a promise, not state, so
  // `handleConfirm` can await a lookup that hasn't landed yet instead of
  // racing it. A plan approval never offers a debrief, so it skips the
  // request entirely.
  const portfolioLookup = React.useRef<Promise<{ name: string } | null> | null>(null);

  React.useEffect(() => {
    if (gateEvent !== "final_approved") {
      portfolioLookup.current = Promise.resolve(null);
      return;
    }
    portfolioLookup.current = fetch(`/api/projects/${encodeURIComponent(projectName)}/portfolio`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => json?.portfolio ?? null)
      .catch(() => null);
  }, [gateEvent, projectName]);

  // Infer the harness the project was most recently worked in, once the
  // debrief question is actually on screen. A slow or failed lookup must never
  // block answering, so 'claude' renders throughout; the request only ever
  // upgrades the pre-selection.
  React.useEffect(() => {
    if (step !== "debrief") return;
    let cancelled = false;
    fetch(`/api/projects/${encodeURIComponent(projectName)}/sessions`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled || !json) return;
        const inferred = json.sessions?.[0]?.harness;
        if (isHarness(inferred)) setDefaultHarness(inferred);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [step, projectName]);

  /**
   * Executes the collected answers. The approval is awaited first and aborts
   * the whole commit on failure — nothing has changed at that point, so the
   * wizard falls back to the confirmation step with the error shown.
   */
  const commit = async (withDebrief: boolean) => {
    setChecking(false);
    setStep("committing");

    const res = await approveGate(projectName, gateEvent);
    if (!res) {
      setStep("confirm");
      return;
    }

    if (withDebrief && !(await launchDebrief(projectName, harness))) {
      setStep("debrief-failed");
      return;
    }

    onClose();
  };

  const handleConfirm = async () => {
    setChecking(true);
    const portfolio = await (portfolioLookup.current ?? Promise.resolve(null));
    if (portfolio) {
      setChecking(false);
      setStep("debrief");
      return;
    }
    await commit(false);
  };

  // A commit in flight owns the dialog: dismissing mid-approval would strand
  // the operator with no idea whether it landed.
  const handleDismiss = () => {
    if (step === "committing") return;
    clearGateError();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) handleDismiss(); }}>
      <DialogContent>
        {step === "confirm" && (
          <>
            <DialogTitle>{DIALOG_TITLES[gateEvent]}</DialogTitle>
            <DialogDescription className="mt-2">
              You are approving <span className="font-medium text-foreground">{documentName}</span>. Proceed?
            </DialogDescription>
            {gateError && (
              <div className="mt-4">
                <GateErrorBanner
                  message={gateError.message}
                  detail={gateError.detail}
                  onDismiss={clearGateError}
                />
              </div>
            )}
            <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <Button variant="outline" onClick={handleDismiss} disabled={checking} autoFocus>
                Cancel
              </Button>
              <Button
                variant="default"
                onClick={handleConfirm}
                disabled={checking}
                aria-busy={checking ? "true" : undefined}
                aria-disabled={checking ? "true" : undefined}
              >
                {checking ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                    Checking…
                  </>
                ) : (
                  "Confirm Approval"
                )}
              </Button>
            </div>
          </>
        )}

        {step === "debrief" && (
          <>
            <DialogTitle>Record what this iteration delivered?</DialogTitle>
            <DialogDescription className="mt-2">
              A terminal will open to record what{" "}
              <span className="font-medium text-foreground">{projectName}</span> delivered into its
              portfolio. You can also do this later.
            </DialogDescription>
            <label className="mt-4 block text-xs text-muted-foreground">
              <span className="mb-1.5 block">Open in</span>
              <Select
                value={harness}
                onValueChange={(value) => {
                  if (isHarness(value)) setSelectedHarness(value);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="claude">Claude Code</SelectItem>
                  <SelectItem value="copilot">Copilot</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <Button variant="outline" onClick={() => commit(false)} autoFocus>
                Not now
              </Button>
              <Button variant="default" onClick={() => commit(true)}>
                Approve &amp; debrief
              </Button>
            </div>
          </>
        )}

        {step === "committing" && (
          <>
            <DialogTitle>Approving…</DialogTitle>
            <DialogDescription className="mt-2">
              Approving <span className="font-medium text-foreground">{projectName}</span>.
            </DialogDescription>
            <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Working…
            </div>
          </>
        )}

        {step === "debrief-failed" && (
          <>
            <DialogTitle>Approved — debrief didn&apos;t open</DialogTitle>
            <DialogDescription className="mt-2">
              <span className="font-medium text-foreground">{projectName}</span> was approved successfully.
            </DialogDescription>
            <div className="mt-4">
              <GateErrorBanner message={LAUNCH_FAILURE_MESSAGE} onDismiss={onClose} />
            </div>
            <div className="mt-6 flex justify-end">
              <Button variant="default" onClick={onClose} autoFocus>
                Close
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
