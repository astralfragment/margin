import { useShallow } from 'zustand/react/shallow';
import { hintAtTop, liveBox, rectBetween } from '../page/geometry';
import { useOverlay } from '../store';
import { useLayout } from './use-layout';

/** True while the hint bar sits at the top of the view, out of the way of the area being dragged or commented on. */
export function useHintAtTop() {
  const { drag, card } = useOverlay(useShallow((state) => ({ drag: state.drag, card: state.card })));
  const { scale } = useLayout();
  const box = drag ? rectBetween(drag.from, drag.to) : card ? liveBox(card) : null;
  return hintAtTop(box, scale);
}
