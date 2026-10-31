import { useQuery } from '@tanstack/react-query';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { annotateShortcut } from '@/lib/controls.js';

/**
 * The start and stop shortcut as Chrome has it set, or an empty string when none is set.
 * Chrome has no change event for shortcuts, so it is read again when the page regains focus,
 * which is when someone comes back from Chrome's shortcut page.
 */
export function useAnnotateShortcut() {
  const { data = '' } = useQuery({ queryKey: ['shortcut'], queryFn: annotateShortcut, refetchOnWindowFocus: true, staleTime: 0 });
  return data;
}

/** Keys as keycaps, from a list or a Chrome shortcut string such as Alt+Shift+M. */
export function Keys({ keys, className }: { keys: string[] | string; className?: string }) {
  const list = Array.isArray(keys) ? keys : keys.split('+');
  return (
    <KbdGroup className={className}>
      {list.map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
    </KbdGroup>
  );
}
