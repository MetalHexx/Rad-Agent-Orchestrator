import { RingSlot, TitleSlot, ControlsSlot } from '../card-slots';
import { Ring } from '../ring';
import type { StateView } from '../types';

const TIER_CSS_VAR = '--tier-planning';

/**
 * The Planning milestone view (`master_plan`). Blue tier, indeterminate ring —
 * plan authoring has no known duration or progress fraction to show, so the
 * ring sweeps rather than fills. No docs (the master plan doesn't exist yet)
 * and no commit, so the controls row renders empty — still mounted so its
 * `min-h-8` floor applies, keeping the card's footprint identical to every
 * other state (R8).
 */
export const planningView: StateView = {
  id: 'planning',
  render() {
    return (
      <>
        <RingSlot>
          <Ring value={0} max={1} color={`var(${TIER_CSS_VAR})`} mode="indeterminate" />
        </RingSlot>
        <TitleSlot>
          <span className="truncate text-base font-medium text-foreground">Scribing Master Plan…</span>
        </TitleSlot>
        <ControlsSlot />
      </>
    );
  },
};
