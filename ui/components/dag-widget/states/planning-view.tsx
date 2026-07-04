import { RingSlot, HeadingSlot, MetaSlot, ControlsSlot } from '../card-slots';
import { Ring } from '../ring';
import type { StateView } from '../types';

const TIER_CSS_VAR = '--tier-planning';

/**
 * The Planning milestone view (`master_plan`, and — once the resolver folds
 * it in — `explode_master_plan`). Blue tier, indeterminate ring — plan
 * authoring has no known duration or progress fraction to show, so the ring
 * sweeps rather than fills. "Building Plan" is heading-only (no meta line),
 * reading correctly for both authoring and exploding the plan since either
 * node resolves to this same view. No docs (the master plan doesn't exist
 * yet) and no commit, so the controls row renders empty — still mounted so
 * its `min-h-8` floor applies, keeping the card's footprint identical to
 * every other state (R8).
 */
export const planningView: StateView = {
  id: 'planning',
  render() {
    const heading = 'Building Plan';
    const meta = null;

    return (
      <>
        <RingSlot>
          <Ring value={0} max={1} color={`var(${TIER_CSS_VAR})`} mode="indeterminate" />
        </RingSlot>
        <HeadingSlot heading={heading} hasMeta={meta !== null} />
        <MetaSlot meta={meta} />
        <ControlsSlot />
      </>
    );
  },
};
