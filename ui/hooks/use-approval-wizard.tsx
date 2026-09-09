"use client";

import * as React from "react";
import {
  ApprovalWizardDialog,
  type ApprovalWizardRequest,
} from "@/components/dashboard/approval-wizard-dialog";

export interface ApprovalWizardValue {
  /** Opens the approval wizard for one gate. Replaces any wizard already open. */
  openApprovalWizard: (request: ApprovalWizardRequest) => void;
}

const defaultApprovalWizardValue: ApprovalWizardValue = {
  openApprovalWizard: () => {
    // Reached only when an Approve control renders outside the provider. A
    // silent no-op there is a dead button with no explanation, which is how
    // this whole class of bug stays invisible — so it is loud instead.
    console.error(
      "[approval-wizard] ApprovalWizardProvider is not mounted — the Approve control cannot open its wizard.",
    );
  },
};

export const ApprovalWizardContext = React.createContext<ApprovalWizardValue>(
  defaultApprovalWizardValue,
);

export function useApprovalWizard(): ApprovalWizardValue {
  return React.useContext(ApprovalWizardContext);
}

/** One opened wizard. `id` keys the dialog so each open starts at step one. */
interface WizardSession {
  id: number;
  request: ApprovalWizardRequest;
}

/**
 * Owns the approval wizard and renders it, deliberately ABOVE anything driven
 * by live pipeline state.
 *
 * This placement is the fix, not a convention. Approving a final review
 * completes the graph, and `resolveStateId` returns `'complete'` for a
 * completed graph before it looks at anything else — so the dag-widget card
 * stops rendering `finalReviewView` entirely and swaps in `completeView`. Any
 * dialog owned by a component under that card is unmounted by the approval it
 * just performed. Hoisting the wizard here puts it out of reach of every
 * pipeline state transition, so the commit phase can keep a spinner up and
 * report a failure afterwards.
 *
 * Mount this above the project page's live-state tree. `ApproveGateButton`
 * only triggers the wizard; it never owns dialog state.
 */
export function ApprovalWizardProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = React.useState<WizardSession | null>(null);
  const [open, setOpen] = React.useState(false);
  const nextId = React.useRef(0);

  const openApprovalWizard = React.useCallback((request: ApprovalWizardRequest) => {
    nextId.current += 1;
    setSession({ id: nextId.current, request });
    setOpen(true);
  }, []);

  const value = React.useMemo<ApprovalWizardValue>(
    () => ({ openApprovalWizard }),
    [openApprovalWizard],
  );

  return (
    <ApprovalWizardContext.Provider value={value}>
      {children}
      {/* The session outlives `open: false` so the dialog can play its close
          animation; `key` resets the wizard's step state on the next open. */}
      {session && (
        <ApprovalWizardDialog
          key={session.id}
          {...session.request}
          open={open}
          onClose={() => setOpen(false)}
        />
      )}
    </ApprovalWizardContext.Provider>
  );
}
