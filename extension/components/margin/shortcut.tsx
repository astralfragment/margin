import { useEffect, useState } from 'react';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { annotateShortcut } from '@/lib/controls.js';

/** The start and stop shortcut as Chrome has it set, or an empty string while loading or when none is set. */
export function useAnnotateShortcut() {
  const [shortcut, setShortcut] = useState('');
  useEffect(() => {
    annotateShortcut().then(setShortcut);
  }, []);
  return shortcut;
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
