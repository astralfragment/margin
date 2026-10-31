import { ArrowLeft, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ControlsReference } from '@/components/margin/controls-reference';
import { Panel } from './panel';

/** Every key and gesture for the page and the report, in place of the popup body. */
export function ControlsPanel({ onBack, onSettings }: { onBack: () => void; onSettings: () => void }) {
  return (
    <Panel
      title="Controls"
      onEscape={onBack}
      back={
        <Button variant="ghost" size="icon-sm" aria-label="Back" autoFocus onClick={onBack}>
          <ArrowLeft />
        </Button>
      }
      footer={
        <Button variant="outline" className="w-full" onClick={onSettings}>
          <Settings />
          All settings
        </Button>
      }
    >
      <ControlsReference only={['page', 'report']} />
    </Panel>
  );
}
