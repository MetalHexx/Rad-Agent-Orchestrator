import type { AnyProjectState } from "@/types/state";
import type { ProjectSummary } from "@/types/components";

/** A project's pipeline state paired with the project it was fetched for. */
export interface OwnedProjectState {
  owner: string;
  state: AnyProjectState;
}

/**
 * A failure paired with the project it belongs to. `owner` is null for a
 * project-list failure, which occurs with no project selected.
 */
export interface OwnedError {
  owner: string | null;
  message: string;
}

export type ProjectView = "loading" | "plan" | "launch" | "error";

export interface ProjectViewInput {
  /** The project on screen — every ownership comparison is made against this. */
  selectedName: string;
  tier: ProjectSummary["tier"];
  schemaVersion: ProjectSummary["schemaVersion"];
  hasMalformedState: boolean;
  /** Straight off the hook: its owner is compared here, not by the caller. */
  ownedState: OwnedProjectState | null;
  /** Straight off the hook: its owner is compared here, not by the caller. */
  ownedError: OwnedError | null;
  /** The project whose state fetch has resolved, whatever the outcome was. */
  stateSettledFor: string | null;
  /** The minimum-visible floor still wants the placeholder on screen. */
  placeholderHeld: boolean;
}

/**
 * The single place the projects page chooses which view to render.
 *
 * State and error count only when they belong to `selectedName`, so a value
 * left over from a previously selected project can never reach the plan view.
 * An unsettled fetch resolves to 'loading' rather than guessing between the
 * remaining views. A settled fetch that produced no state for a project whose
 * summary claims one resolves to 'error': that is a state which could not be
 * read, not a project still waiting to be launched.
 */
export function selectProjectView(input: ProjectViewInput): ProjectView {
  const {
    selectedName,
    tier,
    schemaVersion,
    hasMalformedState,
    ownedState,
    ownedError,
    stateSettledFor,
    placeholderHeld,
  } = input;

  if (ownedError?.owner === selectedName) return "error";
  // The malformed flag comes from the project-list summary, which a Retry's
  // state re-fetch never refreshes. Without the carve-out below, a successful
  // retry could never escape 'error' until the next full list refetch. A
  // valid, settled, owner-matched state means the retry actually worked, so
  // it's allowed to win over the stale flag.
  const recoveredViaRetry = ownedState?.owner === selectedName && stateSettledFor === selectedName;
  if (hasMalformedState && !recoveredViaRetry) return "error";
  if (stateSettledFor !== selectedName) return "loading";
  if (placeholderHeld) return "loading";
  if (ownedState?.owner === selectedName) return "plan";
  if (tier === "not_initialized" && schemaVersion === undefined) return "launch";
  return "error";
}
