import { ChevronDown, Copy, PenLine } from 'lucide-react';
import { iconMarkup } from './icon-markup';
import { NOTE, SEVERITY, SHOT, STATUS, TITLE } from './selectors';

/**
 * Turns one exported card into an editable one: the title and note edit in place, severity and status open a
 * menu, each screenshot gets an Annotate button, and each numbered note gets Edit and Remove.
 */
export function decorateCard(card: HTMLElement) {
  const doc = card.ownerDocument;
  const num = card.querySelector('.num')?.textContent ?? '';

  const title = card.querySelector<HTMLElement>(TITLE);
  if (title) {
    title.dataset.mEdit = 'title';
    title.tabIndex = 0;
    title.title = 'Click to edit the title';
  }

  const note = card.querySelector<HTMLElement>(NOTE);
  if (note) {
    note.dataset.mEdit = 'note';
    note.tabIndex = 0;
    note.title = note.textContent?.trim() ? 'Click to edit the note' : 'Click to add a note';
    note.setAttribute('aria-label', note.textContent?.trim() ? `Note of comment ${num}` : `Add a note to comment ${num}`);
  }

  for (const [selector, kind, label] of [
    [SEVERITY, 'severity', 'Severity'],
    [STATUS, 'status', 'Status'],
  ] as const) {
    const chip = card.querySelector<HTMLElement>(selector);
    if (!chip) continue;
    chip.dataset.mEdit = kind;
    chip.tabIndex = 0;
    chip.setAttribute('role', 'button');
    chip.setAttribute('aria-haspopup', 'menu');
    chip.setAttribute('aria-expanded', 'false');
    chip.setAttribute('aria-label', `${label} ${chip.textContent?.trim()}, comment ${num}. Change ${label.toLowerCase()}`);
    chip.insertAdjacentHTML('beforeend', `<span class="m-chev">${iconMarkup(ChevronDown)}</span>`);
  }

  const header = card.querySelector(':scope > header');
  (header?.querySelector('.labels') ?? header)?.insertAdjacentHTML(
    'beforeend',
    `<button type="button" class="m-btn m-icon" data-m-copy title="Copy this comment for Slack, Jira, GitHub or a doc" aria-label="Copy comment ${num}">${iconMarkup(Copy)}</button>`,
  );

  card.querySelectorAll<HTMLImageElement>(SHOT).forEach((img) => {
    const frame = img.parentElement;
    if (!frame || frame.querySelector('.m-annotate')) return;
    frame.classList.add('m-shot');
    img.title = 'Click to add a numbered marker. Right-click a marker to remove it.';
    frame.insertAdjacentHTML(
      'beforeend',
      `<button type="button" class="m-btn m-annotate" data-m-annotate aria-label="Annotate the screenshot of comment ${num}">${iconMarkup(PenLine)}Annotate</button>`,
    );
  });

  card.querySelectorAll<HTMLLIElement>('ol.marks li').forEach((li) => {
    const n = li.value;
    const tools = doc.createElement('span');
    tools.className = 'm-li-tools';
    tools.innerHTML = `<button type="button" class="m-btn" data-m-mark-edit="${n - 1}" aria-label="Edit note ${n}">Edit</button><button type="button" class="m-btn" data-m-mark-remove="${n - 1}" aria-label="Remove marker ${n}">Remove</button>`;
    (li.lastElementChild ?? li).append(tools);
  });
}
