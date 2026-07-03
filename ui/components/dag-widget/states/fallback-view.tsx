import { NodeKindIcon } from '@/components/dag-timeline/node-kind-icon';
import { getDisplayName } from '@/components/dag-timeline/dag-timeline-helpers';
import { RingSlot, HeadingSlot, MetaSlot, ControlsSlot } from '../card-slots';
import type { StateView } from '../types';

/**
 * The generic view for any unmapped / unknown node — the proof that the
 * resolver seam works end to end. It shows the node's kind icon in the ring
 * slot, the node's display name as the heading, and the fixed "Pipeline
 * node" meta line, and surfaces no controls (rendered empty, still mounted
 * so its `min-h-8` floor applies — R8's identical-footprint guarantee). It
 * sets no geometry: the slot wrappers own layout, so an unmapped node always
 * renders safely and aligned with every other state.
 */
export const fallbackView: StateView = {
  id: 'fallback',
  render(ctx) {
    const kind = ctx.node?.kind ?? 'step';
    const heading = ctx.nodeId.length > 0 ? getDisplayName(ctx.nodeId) : ctx.projectName;
    const meta = 'Pipeline node';

    return (
      <>
        <RingSlot>
          <NodeKindIcon kind={kind} className="h-6 w-6" />
        </RingSlot>
        <HeadingSlot heading={heading} hasMeta={meta !== null} />
        <MetaSlot meta={meta} />
        <ControlsSlot />
      </>
    );
  },
};
