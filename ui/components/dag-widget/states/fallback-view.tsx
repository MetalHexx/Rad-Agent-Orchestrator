import { NodeKindIcon } from '@/components/dag-timeline/node-kind-icon';
import { getDisplayName } from '@/components/dag-timeline/dag-timeline-helpers';
import { RingSlot, TitleSlot } from '../card-slots';
import type { StateView } from '../types';

/**
 * The generic view for any unmapped / unknown node — the proof that the
 * resolver seam works end to end. It shows the node's kind icon in the ring
 * slot and a neutral title, and surfaces no controls. It sets no geometry: the
 * slot wrappers own layout, so an unmapped node always renders safely and
 * aligned with every other state.
 */
export const fallbackView: StateView = {
  id: 'fallback',
  render(ctx) {
    const kind = ctx.node?.kind ?? 'step';
    const title = ctx.nodeId.length > 0 ? getDisplayName(ctx.nodeId) : ctx.projectName;
    return (
      <>
        <RingSlot>
          <NodeKindIcon kind={kind} className="h-6 w-6" />
        </RingSlot>
        <TitleSlot>
          <span className="truncate text-base font-medium text-foreground">{title}</span>
          <span className="text-xs text-muted-foreground">Pipeline node</span>
        </TitleSlot>
      </>
    );
  },
};
