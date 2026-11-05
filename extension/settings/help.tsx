import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Kbd, KbdGroup } from '@/components/ui/kbd';

/** A gesture or key list, then what it does. */
type HelpLine = [keys: string[] | string, does: string];

const ANNOTATING: HelpLine[] = [
  ['Drag', 'Mark an area. A note opens beside it.'],
  ['Click', 'Pick the element under the pointer, when element selectors are on.'],
  [['S'], 'Turn element selectors on or off.'],
  ['Click in the box', 'Drop a numbered marker inside the region you just marked. Right-click one to remove it.'],
  [['M'], 'Turn numbered markers on or off.'],
  ['Right-click', 'Comment on one element or the whole visible area, switch selectors, or stop.'],
  [['Ctrl', 'Enter'], 'Save the note.'],
  [['Esc'], 'Close the menu or the note, then stop annotating.'],
];

const EDITOR: HelpLine[] = [
  [['V', 'M', 'B', 'A'], 'Select, Marker, Box and Arrow.'],
  ['Drag a handle', 'Resize a box, an arrow or the marked region.'],
  ['Right-click a number', 'Remove that item. The rest renumber.'],
  ['Right-click elsewhere', 'Add, duplicate, renumber, reset the region or change the zoom.'],
  ['Double-click', "Write the item's note."],
  [['Ctrl', 'Z'], 'Undo. Add Shift to redo.'],
  [['Delete'], 'Remove the selected item.'],
  ['Arrow keys', 'Nudge the selection by one pixel, or ten with Shift.'],
  [['+', '-', '0', '1'], 'Zoom in, zoom out, fit and actual size.'],
];

/**
 * A two-column list of gestures or keys and what each does.
 * @param props.lines The lines in order.
 */
function HelpList({ lines }: { lines: HelpLine[] }) {
  return (
    <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-2.5">
      {lines.map(([keys, does]) => (
        <div key={does} className="contents">
          <dt className="font-medium text-foreground">
            {typeof keys === 'string' ? (
              keys
            ) : (
              <KbdGroup>
                {keys.map((key) => (
                  <Kbd key={key}>{key}</Kbd>
                ))}
              </KbdGroup>
            )}
          </dt>
          <dd className="text-muted-foreground">{does}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Opens the welcome page in a new tab. */
const openWelcome = () => chrome.tabs.create({ url: chrome.runtime.getURL('/welcome.html') });

/** How Margin works, folded by topic so the settings above stay in view. */
export function Help() {
  return (
    <Accordion>
      <AccordionItem value="start">
        <AccordionTrigger>Getting started</AccordionTrigger>
        <AccordionContent className="flex flex-col items-start gap-3">
          <p>Open any website, start Margin, drag over what looks wrong and write a note. The welcome page walks through it.</p>
          <Button variant="outline" size="sm" onClick={openWelcome}>
            Open the welcome page
          </Button>
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="annotating">
        <AccordionTrigger>While annotating</AccordionTrigger>
        <AccordionContent>
          <HelpList lines={ANNOTATING} />
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="editor">
        <AccordionTrigger>In the image editor</AccordionTrigger>
        <AccordionContent className="flex flex-col gap-3">
          <p>Open it from the report by clicking any screenshot.</p>
          <HelpList lines={EDITOR} />
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="menu">
        <AccordionTrigger>Chrome's right-click menu</AccordionTrigger>
        <AccordionContent>
          <p>Right-click any page to start or stop annotating, comment on the whole visible area, or open the review report.</p>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
