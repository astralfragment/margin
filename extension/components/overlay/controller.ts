import { flushSync } from 'react-dom';
import { queryClient } from '@/lib/query';
import type { SeverityKey } from '@/components/margin/severity';
import { SEVERITY_ORDER } from '@/lib/severity.js';
import { fitRect, liveBox, mapPoint, reachesBar } from './geometry';
import { attachHost, container, deepAll, fitZoom, host, hostStyle, setTabZoom, shadow } from './host';
import { anchorFor, describe, elementAt, elementIn, pickAt } from './pick';
import { readPage, readSetting, refreshPage, settingQuery, writeSetting } from './queries';
import {
  getState,
  patchCard,
  setState,
  type Card,
  type CaptureMsg,
  type Draft,
  type ElementInfo,
  type FigmaFrame,
  type Mark,
  type PageComment,
  type Rect,
  type Viewport,
} from './store';
import { pad } from '@/lib/format.js';
export { pad };

declare global {
  interface Window {
    /** How the background reaches the overlay from scripts it runs in the page, and how a second injection knows it is here. */
    __uiAnnotator?: { setActive: (next: boolean) => boolean; isActive: () => boolean; hideForCapture: (hidden: boolean) => void };
  }
}

const MIN_DRAG = 6;
const SHOT_TIMEOUT = 10000;

/** Resolves after the next two animation frames, once the page has painted. */
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
/**
 * Waits for a number of milliseconds.
 * @param ms How long to wait.
 */
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/**
 * Sends a message to the background.
 * @param msg The message.
 */
const send = <T = Record<string, unknown>>(msg: object) => chrome.runtime.sendMessage(msg) as Promise<T>;
/**
 * Sends a message to the background and ignores a failure.
 * @param msg The message.
 */
const quiet = (msg: object) => send(msg).catch(() => null);
/**
 * True for an element the user types into.
 * @param el The element.
 */
const isEditable = (el: EventTarget | null | undefined) =>
  el instanceof HTMLElement && (el.isContentEditable || ['input', 'textarea', 'select'].includes(el.localName));
/**
 * True for an input or textarea.
 * @param el The element.
 */
const isField = (el: Element | null) => el?.localName === 'input' || el?.localName === 'textarea';
/**
 * The readable message of an error.
 * @param err The error.
 */
const errorText = (err: unknown) => String((err as Error)?.message ?? err);

type ShotResult = { id?: string; error?: string };

/** What reopening a composer needs to bring it back on the same area. */
type CardArgs = Pick<Card, 'id' | 'rect' | 'element' | 'msg' | 'number' | 'reopened' | 'hasShot' | 'viewport' | 'anchor' | 'extraMarks'>;

type OpenArgs = Partial<CardArgs> & {
  rect: Rect;
  error?: string | null;
  draft?: Partial<Draft>;
};

/** A redraw in progress: the fields to carry into the new area, with markers in page pixels, and the card to bring back on Esc. */
let pending: {
  draft: Partial<Draft> & { pageMarks?: { px: number; py: number; note: string }[] };
  old: (CardArgs & { error: string | null; draft: Draft }) | null;
} | null = null;
let saved: (CardArgs & { draft: Draft }) | null = null;
let dragStart: { x: number; y: number } | null = null;
let swallowPress = false;
let escAt = 0;
let keyMenuAt = 0;
let toastTimer = 0;
let toastSeq = 0;
let scrollFrame = 0;

/**
 * The overlay element with a data-scope name.
 * @param name The scope name.
 */
const scope = (name: string) => shadow.querySelector<HTMLElement>(`[data-scope="${name}"]`);
/**
 * True when an event path passes through a scope.
 * @param path The event path.
 * @param name The scope name.
 */
const inScope = (path: EventTarget[], name: string) => path.some((n) => n instanceof Element && n.getAttribute('data-scope') === name);
/**
 * The comment area's box as it sits on screen now.
 * @param card The comment and where it was captured.
 */
const liveRect = (card: Pick<Card, 'rect' | 'anchor' | 'viewport'>) => liveBox(card);

/** Moves the capture bar to the top while an area or a drag reaches into the strip it covers at the bottom. */
function placeBar(rect: Rect | null = getState().card && liveRect(getState().card!)) {
  const barAtTop = reachesBar(rect, getState().scale);
  if (barAtTop !== getState().barAtTop) setState({ barAtTop });
}

/**
 * Turns pick element on or off.
 * @param next True to turn it on.
 */
export function setPickElement(next: boolean) {
  writeSetting('pickElement', next);
  if (!next) setState({ hover: null });
}

/**
 * Turns numbered markers on or off.
 * @param next True to turn them on.
 */
export const setMarkers = (next: boolean) => writeSetting('markers', next);

/**
 * Opens a capture bar popover, or closes it.
 * @param popover The popover to open, or null.
 */
export function setPopover(popover: 'options' | 'help' | null) {
  setState({ popover, menu: null });
}

/** Opens the report. */
export const openReport = () => {
  clearToast();
  quiet({ type: 'openReport' });
};

/** Removes the toast, keeping keyboard focus in Margin when it was on the toast. */
function clearToast() {
  clearTimeout(toastTimer);
  if (!getState().toast) return;
  const focused = scope('toast')?.contains(shadow.activeElement);
  setState({ toast: null });
  if (focused && !getState().card) focusBar();
}

/** Keeps the toast up for a while longer, or until the pointer leaves it when `ms` is 0. */
export function holdToast(ms: number) {
  clearTimeout(toastTimer);
  if (ms) toastTimer = window.setTimeout(clearToast, ms);
}

/**
 * Shows a short message.
 * @param text The message.
 * @param ms How long it stays.
 */
export function toast(text: string, ms = 1600) {
  clearTimeout(toastTimer);
  setState({ toast: { kind: 'plain', id: ++toastSeq, text } });
  toastTimer = window.setTimeout(clearToast, ms);
}

/** Puts focus on the capture bar, so Margin's keys work and nothing on the page holds focus. */
function focusBar() {
  scope('bar')?.focus({ preventScroll: true });
}

/**
 * Puts focus on a control in the composer. React draws pending changes first, so a control added just now is there.
 * @param target The control's data-focus name.
 */
function focusCard(target: string) {
  flushSync(() => {});
  scope('card')?.querySelector<HTMLElement>(`[data-focus="${target}"]`)?.focus({ preventScroll: true });
}

/** Moves everything placed on the page once per frame while the page scrolls or resizes. */
function onScroll() {
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0;
    setState({ frame: getState().frame + 1 });
    placeBar();
  });
}

/** Refits the overlay when the window changes size. */
function onResize() {
  fitZoom();
  onScroll();
}

/** Applies a new browser zoom, then moves everything placed on the page to match. */
function refit() {
  fitZoom();
  setState({ menu: null, tip: null, frame: getState().frame + 1 });
  placeBar();
}

/** Hides the overlay while the background takes a screenshot, without waiting for React. */
export function hideForCapture(hidden: boolean) {
  container.style.visibility = hidden ? 'hidden' : '';
}

/** Asks the background to screenshot a region and store it as a draft comment, with the overlay hidden for the shot. */
async function takeShot(msg: CaptureMsg & { skipShot?: boolean }): Promise<ShotResult> {
  setState({ capturing: true, hover: null, tip: null, drag: null });
  hideForCapture(true);
  await Promise.race([nextFrame(), wait(1000)]);
  await wait(60);
  let res: ShotResult | null;
  if (document.visibilityState !== 'visible') {
    res = { error: 'The tab was in the background, so Margin did not take the screenshot' };
  } else {
    const sent = send<ShotResult>(msg).then(
      (answer) => answer ?? {},
      (err) => ({ error: errorText(err) }),
    );
    res = await Promise.race([sent, wait(SHOT_TIMEOUT).then(() => null)]);
    if (!res) {
      res = { error: 'Margin waited too long for the screenshot' };
      sent.then((late) => {
        if ('id' in late && late.id) quiet({ type: 'discard', id: late.id });
      });
    }
  }
  hideForCapture(false);
  setState({ capturing: false });
  return res.id ? res : { error: res.error ?? 'Screenshot failed' };
}

/**
 * Captures a region and opens the composer beside it. A failed capture still opens it, with the error and Try again.
 * A pending redraw carries its draft into the new composer and drops the old capture once the new one is stored.
 */
async function capture(rect: Rect, element: ElementInfo | null = readSetting('pickElement') ? elementIn(rect) : null) {
  const msg: CaptureMsg = {
    type: 'capture',
    rect,
    element,
    anchor: anchorFor(rect),
    viewport: { width: innerWidth, height: innerHeight, scrollY: Math.round(scrollY), dpr: devicePixelRatio },
  };
  const res = await takeShot(msg);
  setState({ saving: rect });
  const carry = pending;
  pending = null;
  setState({ pending: null });
  if (carry?.old?.id && res.id) quiet({ type: 'discard', id: carry.old.id });
  if (res.id) await refreshPage();
  setState({ saving: null });
  const carried = carry?.draft?.pageMarks ?? [];
  const marks = carried
    .map((m) => ({ x: Math.round(m.px - scrollX), y: Math.round(m.py - scrollY), note: m.note }))
    .filter((m) => m.x >= rect.x && m.x <= rect.x + rect.w && m.y >= rect.y && m.y <= rect.y + rect.h);
  const { pageMarks: _, ...fields } = carry?.draft ?? {};
  openCard({ id: res.id ?? null, rect, element, msg, error: res.error, draft: carry?.draft && { ...fields, marks } });
  const dropped = carried.length - marks.length;
  if (dropped === 1) toast('1 marker was outside the new area and was removed', 3600);
  else if (dropped > 1) toast(`${dropped} markers were outside the new area and were removed`, 3600);
}

/** Captures the whole visible area as one comment, unless an open composer would lose work. */
export function captureViewport() {
  if (getState().card && !replaceable()) {
    holdCard();
    return;
  }
  closeCard(true);
  capture(fitRect({ x: 0, y: 0, w: innerWidth, h: innerHeight }));
}

/** Captures the part of the element under a point that is in view, with its selector, whether or not Pick element is on. */
function captureElementAt(x: number, y: number) {
  const pick = pickAt(x, y, true);
  if (!pick) return;
  let element: ElementInfo | null = null;
  try {
    element = describe(pick.el, pick.frame);
  } catch {
    element = null;
  }
  const rect = fitRect(pick.rect);
  if (rect.w < 2 || rect.h < 2) {
    toast('That element is out of view. Scroll to it first.', 2400);
    return;
  }
  capture(rect, element);
}

/** Asks the background to capture comments again at mobile, tablet and desktop widths, then says how it went. */
async function captureWidths(which: { ids?: string[]; page?: boolean }) {
  let res: { error?: string; message?: string } | null;
  try {
    res = await send({ type: 'captureWidths', ...which });
  } catch (err) {
    res = { error: errorText(err) };
  }
  toast(res?.error ?? res?.message ?? 'Widths captured', 4200);
  return res;
}

/** Captures this page's comments at three widths. */
export const captureWidthsOnPage = () => captureWidths({ page: true });

/** Captures the open composer's comment at three widths, showing progress in its More menu. */
export async function captureCardWidths() {
  const card = getState().card;
  if (!card?.id) return;
  patchCard({ widths: 'busy' });
  const res = await captureWidths({ ids: [card.id] });
  if (getState().card?.id !== card.id) return;
  patchCard({ widths: res?.error ? 'failed' : 'done' });
  setTimeout(() => getState().card?.id === card.id && patchCard({ more: false, widths: 'idle' }), 900);
}

/** Closes the right-click menu. */
export function closeMenu() {
  if (getState().menu) setState({ menu: null, hover: null });
}

/** Opens the page menu at a point, outlining the element under it. */
function openMenu(x: number, y: number) {
  const pick = pickAt(x, y);
  setState({ menu: { x, y, target: pick?.rect ?? null }, hover: pick, popover: null, tip: null });
}

/** Opens the page menu from the keyboard, at the focused page element or else the middle of the view. */
function openKeyMenu() {
  keyMenuAt = performance.now();
  if (getState().card) {
    holdCard();
    return;
  }
  const focused = document.activeElement;
  const usable = focused && focused !== document.body && focused !== document.documentElement && !focused.contains(container);
  const box = usable ? focused.getBoundingClientRect() : null;
  const visible = box && box.width && box.bottom > 0 && box.top < innerHeight;
  openMenu(visible ? box.left + Math.min(box.width / 2, 24) : innerWidth / 2, visible ? box.top + box.height / 2 : innerHeight / 2);
}

export const menuActions = {
  element: (x: number, y: number) => captureElementAt(x, y),
  stop: () => setActive(false),
};

/**
 * True when the comment has a title or a note.
 * @param card The open comment.
 */
export const filled = (card: Card) => Boolean(card.title.trim() || card.note.trim());
/**
 * True when the comment has anything that would be lost by closing it.
 * @param card The open comment.
 */
const hasWork = (card: Card) => Boolean(filled(card) || card.marks.length || card.frame || card.link.trim());

/** True when the open composer can give way to a new capture without losing anything. */
function replaceable() {
  const card = getState().card;
  return Boolean(card && !card.reopened && !hasWork(card));
}

/** Says the open composer has to be saved or discarded first, gives it a small shake and puts focus back in it. */
function holdCard() {
  const card = getState().card;
  if (!card) return;
  toast(`Save or discard comment ${pad(card.number)} first`, 2400);
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    scope('card')?.animate([{ translate: '0' }, { translate: '-6px 0' }, { translate: '6px 0' }, { translate: '0' }], { duration: 300, easing: 'ease-in-out' });
  }
  if (!scope('card')?.contains(shadow.activeElement)) focusCard('title');
}

/** Opens the composer beside a region, never over it, with the region kept highlighted. */
function openCard({ id = null, rect, element = null, msg = null, error, draft = {}, number, reopened = false, hasShot = Boolean(id), viewport, anchor, extraMarks = [] }: OpenArgs) {
  closeCard(false, false);
  clearToast();
  const page = readPage();
  const fields: Draft = {
    title: draft.title ?? '',
    note: draft.note ?? '',
    severity: draft.severity ?? (readSetting('severity') as SeverityKey),
    marks: (draft.marks ?? []).map((m) => ({ ...m })),
    frame: draft.frame ?? null,
    link: draft.link ?? '',
  };
  const card: Card = {
    ...fields,
    id,
    rect,
    element,
    msg,
    viewport: viewport ?? msg?.viewport ?? { width: innerWidth, height: innerHeight, scrollY: Math.round(scrollY) },
    anchor: anchor ?? msg?.anchor ?? null,
    extraMarks,
    number: number ?? page.comments.find((c) => c.id === id)?.n ?? page.total + 1,
    reopened,
    hasShot,
    hadFrame: Boolean(draft.frame),
    error: error ?? null,
    original: JSON.stringify(fields),
    showLink: Boolean(fields.link),
    placing: false,
    picker: null,
    asking: null,
    saving: false,
    retrying: false,
    more: false,
    widths: 'idle',
  };
  setState({ card, menu: null, popover: null, tip: null, hover: null });
  placeBar();
  focusCard('title');
}

/** Closes the composer, deleting its stored draft when `discard` is true. */
function closeCard(discard: boolean, refocus = true) {
  const card = getState().card;
  if (!card) return;
  const hadFocus = scope('card')?.contains(shadow.activeElement);
  setState({ card: null });
  placeBar(null);
  if (discard && card.id) quiet({ type: 'discard', id: card.id }).then(refreshPage);
  if (refocus && hadFocus) focusBar();
}

/**
 * The parts of a comment that count as edits.
 * @param card The open comment.
 */
const readDraft = (card: Card): Draft => ({
  title: card.title,
  note: card.note,
  severity: card.severity,
  marks: card.marks.map((m) => ({ ...m })),
  frame: card.frame,
  link: card.link,
});

/**
 * The fields needed to reopen a comment.
 * @param c The open comment.
 */
const cardArgs = (c: Card): CardArgs => ({
  id: c.id,
  rect: c.rect,
  element: c.element,
  msg: c.msg,
  number: c.number,
  reopened: c.reopened,
  hasShot: c.hasShot,
  viewport: c.viewport,
  anchor: c.anchor,
  extraMarks: c.extraMarks,
});

/**
 * Sets the open comment's severity.
 * @param severity The severity key.
 */
export function setSeverity(severity: SeverityKey) {
  patchCard({ severity });
}

/**
 * Updates the title, note or link of the open comment.
 * @param field Which field.
 * @param value The new text.
 */
export function setField(field: 'title' | 'note' | 'link', value: string) {
  patchCard((c) => ({ [field]: field === 'title' ? value.replace(/\s*\n\s*/g, ' ') : value, asking: c.asking && null }));
}

/** Waits for a click inside the area to place a marker. */
export function startPlacing() {
  patchCard({ placing: true });
}

/** Opens the frame list when the review has a Figma file, or else a field for a pasted link. */
export function addFrame() {
  if (readPage().review?.figma?.frames?.length) togglePicker();
  else {
    patchCard({ showLink: true });
    focusCard('link');
  }
}

/** Removes the link from the open comment. */
export function removeLink() {
  patchCard({ link: '', showLink: false });
  focusCard('addFrame');
}

/** Removes the Figma frame from the open comment. */
export function removeFrame() {
  patchCard({ frame: null });
  focusCard('addFrame');
}

/** Scores how well a Figma page name matches this page's address and title, so the likeliest page opens first. */
function pageScore(page: string) {
  const words = `${location.pathname} ${document.title}`.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  const name = page.toLowerCase();
  const home = location.pathname.replace(/\/+$/, '') === '' && /home|landing|index/.test(name) ? 2 : 0;
  return home + words.filter((w) => name.includes(w)).length;
}

/** Opens or closes the Figma frame list. */
function togglePicker() {
  const card = getState().card;
  const frames = readPage().review?.figma?.frames ?? [];
  if (!card) return;
  if (card.picker) {
    patchCard({ picker: null });
    focusCard('addFrame');
    return;
  }
  const pages = [...new Set(frames.map((f) => f.page ?? ''))];
  const best = pages.reduce((a, b) => (pageScore(b) > pageScore(a) ? b : a), pages[0] ?? '');
  patchCard({ picker: { page: best, query: '', active: 0 } });
  focusCard('search');
}

type FrameGroup = { page: string; frames: { id: string; name: string; page?: string }[]; count: number };

/** The frames the list shows: the open page, or every frame that matches the search, grouped by page. */
export function pickerView() {
  const card = getState().card;
  const frames = readPage().review?.figma?.frames ?? [];
  const query = card?.picker?.query.trim().toLowerCase() ?? '';
  const pages = [...new Set(frames.map((f) => f.page ?? ''))];
  const shown = query ? pages : [card?.picker?.page ?? ''];
  const visible = frames.filter((f) => shown.includes(f.page ?? '') && (!query || f.name.toLowerCase().includes(query)));
  const groups: FrameGroup[] = pages.map((page) => ({
    page,
    frames: visible.filter((f) => (f.page ?? '') === page),
    count: frames.filter((f) => (f.page ?? '') === page).length,
  }));
  const count = visible.length;
  const active = count ? (((card?.picker?.active ?? 0) % count) + count) % count : 0;
  return { query, visible, groups, active };
}

/**
 * Updates the Figma frame list and keeps the active frame in view.
 * @param patch The fields to change.
 */
export function setPicker(patch: Partial<NonNullable<Card['picker']>>) {
  patchCard((c) => ({ picker: c.picker && { ...c.picker, ...patch } }));
  requestAnimationFrame(() => scope('card')?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' }));
}

/**
 * Links the open comment to a Figma frame.
 * @param frame The frame, or undefined for none.
 */
export function pickFrame(frame: { id: string; name: string; page?: string } | undefined) {
  const file = readPage().review?.figma;
  if (!frame || !file) return;
  const picked: FigmaFrame = { fileKey: file.fileKey, nodeId: frame.id, name: frame.name, page: frame.page ?? '' };
  patchCard({ frame: picked, picker: null });
  focusCard('title');
}

/**
 * Updates one marker's note.
 * @param index The marker position.
 * @param note The new note.
 */
export function setMarkNote(index: number, note: string) {
  patchCard((c) => ({ marks: c.marks.map((m, i) => (i === index ? { ...m, note: note.replace(/\s*\n\s*/g, ' ') } : m)) }));
}

/** Removes one numbered marker and renumbers the rest. From the composer, focus moves to the next marker's note. */
export function removeMark(index: number, fromCard = false) {
  const card = getState().card;
  if (!card) return;
  const marks = card.marks.filter((_, i) => i !== index);
  patchCard({ marks });
  if (!fromCard) return;
  if (marks.length) focusCard(`mark-${Math.min(index, marks.length - 1)}`);
  else focusCard('addMarker');
}

/** Drops the next numbered marker at a point inside the area, stored in the capture's viewport pixels, and focuses its note. */
function addMark(x: number, y: number) {
  const card = getState().card!;
  const at = mapPoint(card.rect, liveRect(card), { x, y }, true);
  const marks: Mark[] = [...card.marks, { x: Math.round(at.x), y: Math.round(at.y), note: '' }];
  patchCard({ marks, placing: false });
  focusCard(`mark-${marks.length - 1}`);
}

/** Where a marker shows on the page now, in viewport pixels. */
export const markOnPage = (card: Card, mark: Mark) => mapPoint(card.rect, liveRect(card), mark);

/**
 * Discards an untouched draft at once, or asks in place of the footer when something would be lost. On a saved
 * comment the button deletes it, after asking.
 */
export function askDiscard() {
  const card = getState().card;
  if (!card) return;
  if (card.reopened) patchCard({ asking: 'delete' });
  else if (hasWork(card)) patchCard({ asking: 'discard' });
  else return closeCard(true);
  focusCard('keep');
}

/** Dismisses the question and returns to the title. */
export function keepEditing() {
  patchCard({ asking: null });
  focusCard('title');
}

/** Answers yes to the question in the footer. */
export function confirmAsk() {
  const card = getState().card;
  if (card) closeCard(card.asking !== 'changes');
}

/**
 * True when the comment differs from when it opened.
 * @param card The open comment.
 */
const changed = (card: Card) => JSON.stringify(readDraft(card)) !== card.original;

/** Steps back one level on Esc: the More menu, the frame list, marker placing, the question in the footer, then the composer. */
function escapeCard() {
  const card = getState().card!;
  if (card.more) patchCard({ more: false });
  else if (card.picker) togglePicker();
  else if (card.placing) patchCard({ placing: false });
  else if (card.asking) keepEditing();
  else if (!card.reopened) askDiscard();
  else if (changed(card)) {
    patchCard({ asking: 'changes' });
    focusCard('keep');
  } else closeCard(false);
}

/** Captures the area again after a failed screenshot, keeping everything typed. */
export async function retry() {
  const card = getState().card;
  if (!card?.msg || card.retrying) return;
  patchCard({ retrying: true });
  const res = await takeShot(card.msg);
  if (getState().card?.number !== card.number) return;
  if (res.id) {
    patchCard({ id: res.id, hasShot: true, error: null, retrying: false });
    await refreshPage();
  } else patchCard({ error: res.error ?? 'Screenshot failed', retrying: false });
  focusCard('title');
}

/** Stores the comment without a screenshot when Chrome keeps refusing one, then saves it. */
export async function saveWithoutShot() {
  const card = getState().card;
  if (!card?.msg || !filled(card)) {
    focusCard('title');
    return;
  }
  let res: ShotResult | null;
  try {
    res = await send({ ...card.msg, skipShot: true });
  } catch (err) {
    res = { error: errorText(err) };
  }
  if (!res?.id) {
    toast(res?.error ?? 'Could not save the comment', 4200);
    return;
  }
  patchCard({ id: res.id, hasShot: false, error: null });
  await save();
}

/** Closes the composer and waits for a new area, keeping the draft. Esc brings the composer back as it was. */
export function redraw() {
  const card = getState().card;
  if (!card) return;
  const pageMarks = card.marks.map((m) => {
    const at = markOnPage(card, m);
    return { px: at.x + scrollX, py: at.y + scrollY, note: m.note };
  });
  pending = { draft: { ...readDraft(card), marks: [], pageMarks }, old: { ...cardArgs(card), error: card.error, draft: readDraft(card) } };
  setState({ pending: { oldId: card.id } });
  closeCard(false);
  const kept = pageMarks.length ? ' Markers inside it are kept.' : '';
  toast(`Drag over the new area.${kept} Esc keeps the old one.`, 4200);
}

/** Abandons a redraw and restores the comment it replaced. */
function cancelRedraw() {
  const old = pending?.old;
  pending = null;
  setState({ pending: null });
  clearToast();
  if (old) openCard({ ...old });
}

/** Turns the composer's fields into what is stored: the comment fields, the markers, and whether the images need redrawing. */
function patchFor(card: Pick<Card, 'extraMarks' | 'hadFrame' | 'hasShot' | 'reopened' | 'original'>, draft: Draft) {
  const note = draft.note.trim();
  const dots = draft.marks.map((m) => ({ kind: 'dot', x: m.x, y: m.y, note: m.note.trim() })).filter((m) => m.note);
  const marks = [...card.extraMarks, ...dots];
  const pasted = draft.link.split(/[\s,]+/).filter((part) => /^https?:\/\//i.test(part));
  const links = [...new Set([...pasted, ...(draft.frame ? [frameUrl(draft.frame)] : [])])];
  const patch: Record<string, unknown> = {
    severity: draft.severity,
    title: draft.title.trim() || (note.split('\n')[0] ?? '').slice(0, 80),
    note,
    links,
  };
  if (draft.frame) patch.figmaFrame = { ...draft.frame };
  else if (card.hadFrame) patch.figmaFrame = null;
  if (!card.hasShot) patch.marks = marks;
  const moved = JSON.stringify(draft.marks) !== JSON.stringify(JSON.parse(card.original).marks);
  const redrawImages = card.hasShot && (card.reopened ? moved : dots.length > 0);
  return { patch, marks, redrawImages };
}

/** The link to a Figma frame, which the Post to Figma flow reads back as a file key and node id. */
const frameUrl = (frame: { fileKey: string; nodeId: string }) =>
  `https://www.figma.com/design/${frame.fileKey}/?node-id=${frame.nodeId.replace(/:/g, '-')}`;

/** New comments start on the severity saved last. */
const rememberSeverity = (severity: SeverityKey) => writeSetting('severity', severity);

/** Saves the composer's fields to the draft comment, with markers drawn into its images, then confirms it. */
export async function save() {
  const card = getState().card;
  if (!card?.id || !filled(card) || card.saving) return;
  patchCard({ saving: true });
  const draft = readDraft(card);
  const { patch, marks, redrawImages } = patchFor(card, draft);
  try {
    await send({ type: 'update', id: card.id, patch });
    if (redrawImages) await send({ type: 'annotate', id: card.id, marks });
  } catch (err) {
    patchCard({ saving: false });
    toast(`Could not save. ${errorText(err)}`, 4200);
    return;
  }
  rememberSeverity(draft.severity);
  const box = scope('card')?.getBoundingClientRect();
  saved = { ...cardArgs(card), draft };
  closeCard(false, false);
  await refreshPage();
  clearTimeout(toastTimer);
  setState({ toast: { kind: 'saved', id: ++toastSeq, number: card.number, box: { left: box?.left ?? 0, bottom: box?.bottom ?? innerHeight } } });
  toastTimer = window.setTimeout(clearToast, 5000);
}

/** Reopens the comment just saved, with its fields as they were. */
export function undoSave() {
  const last = saved;
  clearToast();
  if (!last) return;
  saved = null;
  openCard({ ...last, reopened: true });
}

/** Opens a saved comment from its flag for editing, with its fields, markers and area as stored. */
export async function editSaved(comment: PageComment) {
  const card = getState().card;
  if (card) {
    if (card.id === comment.id) return;
    if (!replaceable()) return holdCard();
    closeCard(true);
  }
  setState({ tip: null });
  type Full = PageComment & { element?: ElementInfo; hasShot: boolean; viewport: Viewport; marks?: (Mark & { kind?: string })[]; links?: string[]; figmaFrame?: FigmaFrame };
  const full = (await quiet({ type: 'comment', id: comment.id })) as Full | null;
  if (!full?.id || !getState().active || getState().card) return;
  const figma = full.figmaFrame?.nodeId ? full.figmaFrame : null;
  const frameLink = figma ? frameUrl(figma) : '';
  const marks = full.marks ?? [];
  openCard({
    id: full.id,
    rect: full.rect,
    element: full.element ?? null,
    number: comment.n,
    reopened: true,
    hasShot: full.hasShot,
    viewport: full.viewport,
    anchor: full.anchor ?? null,
    extraMarks: marks.filter((m) => m.kind && m.kind !== 'dot'),
    draft: {
      title: full.title ?? '',
      note: full.note ?? '',
      severity: (full.severity as SeverityKey) ?? 'major',
      marks: marks.filter((m) => !m.kind || m.kind === 'dot').map((m) => ({ x: m.x, y: m.y, note: m.note ?? '' })),
      frame: figma,
      link: (full.links ?? []).filter((link) => link !== frameLink).join(' '),
    },
  });
}

/**
 * Keeps what was typed when the page goes away. A composer with a title or note is saved with its markers and the
 * next page says so. An empty new draft is dropped, and edits to a saved comment are let go.
 */
function onLeave() {
  const card = getState().card;
  const old = pending?.old;
  const args = card ?? (old && { ...old, hadFrame: false, original: JSON.stringify({ marks: [] }) });
  const draft = card ? readDraft(card) : old?.draft;
  if (args?.id && !args.reopened && draft) {
    if (draft.title.trim() || draft.note.trim()) {
      const { patch, marks, redrawImages } = patchFor(args, draft);
      const notice = `Comment ${pad(args.number)} was saved when the page changed`;
      rememberSeverity(draft.severity);
      quiet({ type: 'keep', id: args.id, patch, marks: redrawImages ? marks : null, notice });
    } else quiet({ type: 'discard', id: args.id });
  }
  pending = null;
  setState({ pending: null });
  closeCard(false, false);
}

/**
 * Follows the pointer with the drag band, or with the element outline when Pick element is on. Over Margin's own
 * bar, composer, menus and flags there is no outline.
 */
function onMove(e: MouseEvent) {
  const s = getState();
  if (dragStart) {
    const drag = { x: Math.min(e.clientX, dragStart.x), y: Math.min(e.clientY, dragStart.y), w: Math.abs(e.clientX - dragStart.x), h: Math.abs(e.clientY - dragStart.y) };
    setState({ drag });
    placeBar(drag);
    return;
  }
  if (s.card || s.menu || !readSetting('pickElement')) return;
  const over = e.composedPath()[0];
  if (over instanceof Element && container.contains(over) && !over.hasAttribute('data-sheet')) {
    if (s.hover) setState({ hover: null });
    return;
  }
  setState({ hover: pickAt(e.clientX, e.clientY, true) });
}

/** Feeds pointer moves that land on the page, over or around the overlay, to the outline and the drag band. */
function onStrayMove(e: MouseEvent) {
  if (e.target !== host && e.isTrusted && !getState().passing) onMove(e);
}

/** Closes popovers and menus when a press lands outside them. A press on the sheet that closed one does nothing else. */
function onPressCapture(e: Event) {
  const s = getState();
  const path = e.composedPath();
  const onSheet = path[0] instanceof Element && path[0].hasAttribute('data-sheet');
  let closed = false;
  if (s.popover && !inScope(path, 'popover') && !inScope(path, 'popover-trigger')) {
    setPopover(null);
    closed = true;
  }
  if (s.card?.more && !inScope(path, 'menu') && !inScope(path, 'more-trigger')) {
    patchCard({ more: false });
    closed = true;
  }
  if (s.menu && !inScope(path, 'menu') && !onSheet) closeMenu();
  swallowPress = closed && onSheet;
}

/**
 * Starts a drag, or with a composer open drops a marker when the press lands inside its area. A press outside the
 * area starts a drag that replaces an empty draft.
 */
export function onSheetDown(e: MouseEvent) {
  const s = getState();
  if (s.menu) {
    e.preventDefault();
    if (e.button === 0) closeMenu();
    return;
  }
  if (swallowPress) {
    swallowPress = false;
    e.preventDefault();
    return;
  }
  if (e.button !== 0) return;
  e.preventDefault();
  if (s.tip) setState({ tip: null });
  const card = s.card;
  if (card) {
    const r = liveRect(card);
    const inside = e.clientX >= r.x && e.clientX <= r.x + r.w && e.clientY >= r.y && e.clientY <= r.y + r.h;
    if (inside) {
      if ((readSetting('markers') || card.placing) && !card.asking) addMark(e.clientX, e.clientY);
      return;
    }
  }
  dragStart = { x: e.clientX, y: e.clientY };
  setState({ hover: null });
}

/**
 * Finishes a drag and captures the area, or the element under the pointer for a click with Pick element on.
 * With a composer open, a drag replaces an empty draft and is refused for one with work in it.
 */
function onUp(e: MouseEvent) {
  if (!dragStart) return;
  const start = dragStart;
  dragStart = null;
  setState({ drag: null });
  let rect = { x: Math.min(e.clientX, start.x), y: Math.min(e.clientY, start.y), w: Math.abs(e.clientX - start.x), h: Math.abs(e.clientY - start.y) };
  const tiny = rect.w < MIN_DRAG || rect.h < MIN_DRAG;
  const card = getState().card;
  if (card) {
    placeBar();
    if (tiny) return;
    if (!replaceable()) return holdCard();
    closeCard(true, false);
    pending = { draft: { severity: card.severity }, old: null };
    rect = fitRect(rect);
    if (rect.w >= 2 && rect.h >= 2) capture(rect);
    else pending = null;
    return;
  }
  placeBar(null);
  if (tiny) {
    if (!readSetting('pickElement')) {
      toast('Drag over an area to comment, or press S to pick an element', 2400);
      return;
    }
    const pick = pickAt(e.clientX, e.clientY, true);
    if (!pick) return;
    rect = pick.rect;
  }
  rect = fitRect(rect);
  if (rect.w < 2 || rect.h < 2) return;
  capture(rect);
}

/**
 * Opens the page menu on right-click, unless a comment is being dragged. With a composer open it says to finish it
 * first. The contextmenu event Chrome sends after Shift+F10 or the menu key is skipped, since the key opened the menu.
 */
export function onSheetContext(e: MouseEvent) {
  e.preventDefault();
  if (dragStart || performance.now() - keyMenuAt < 1000) return;
  if (getState().card) return holdCard();
  openMenu(e.clientX, e.clientY);
}

/**
 * Scrolls the scrollable page element under the pointer. The overlay covers the page, so without this every wheel
 * scrolls the document and inner panels never move.
 */
function onWheel(e: WheelEvent) {
  if (e.ctrlKey || !(e.target instanceof Element && e.target.hasAttribute('data-sheet'))) return;
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1;
  const dx = e.deltaX * unit;
  const dy = e.deltaY * unit;
  const top = document.scrollingElement;
  const room = (overflow: string, pos: number, size: number, full: number, delta: number) =>
    delta !== 0 && /auto|scroll|overlay/.test(overflow) && (delta > 0 ? pos + size < full - 1 : pos > 0);
  for (let el = elementAt(e.clientX, e.clientY); el && el !== top && el !== document.body; el = el.parentElement) {
    const style = getComputedStyle(el);
    const canY = room(style.overflowY, el.scrollTop, el.clientHeight, el.scrollHeight, dy);
    const canX = room(style.overflowX, el.scrollLeft, el.clientWidth, el.scrollWidth, dx);
    if (canY || canX) {
      e.preventDefault();
      el.scrollBy({ left: canX ? dx : 0, top: canY ? dy : 0 });
      return;
    }
  }
}

/** Hands the pointer to the page while Alt is held, and takes it back when Alt is let go or the window loses focus. */
function passThrough(next: boolean) {
  if (getState().passing === next) return;
  hostStyle('pointer-events', next ? 'none' : '');
  if (next) dragStart = null;
  setState(next ? { passing: true, drag: null, hover: null } : { passing: false });
}

/** Ends the Alt hold on release. The release is cancelled so Chrome does not move focus to its menu. */
function onKeyUp(e: KeyboardEvent) {
  if (e.key !== 'Alt') return;
  e.preventDefault();
  passThrough(false);
}

/** Gives the page back to Margin after holding Alt. */
const endPass = () => passThrough(false);

/** Takes back the last marker on Ctrl+Z when focus is not in a field with text to undo, or is in the last marker's empty note. */
function undoMarkKey() {
  const card = getState().card!;
  if (!card.marks.length) return false;
  const active = shadow.activeElement as HTMLTextAreaElement | null;
  const lastEmpty = active?.dataset.mark === String(card.marks.length - 1) && !active.value;
  if (isField(active) && !lastEmpty) return false;
  removeMark(card.marks.length - 1);
  focusCard('title');
  return true;
}

/**
 * Moves keyboard focus to the next or previous control, staying inside the open menu or popover, the open composer,
 * or else the bar, the toast and the saved flags, so Tab never wanders into the page hidden under the overlay.
 */
function stepFocus(step: number) {
  const s = getState();
  let scopes = ['bar', 'toast', 'saved'];
  if (s.menu || s.card?.more) scopes = ['menu'];
  else if (s.popover) scopes = ['popover'];
  else if (s.card) scopes = ['card'];
  const items = scopes
    .flatMap((name) => [...shadow.querySelectorAll<HTMLElement>(`[data-scope="${name}"]`)])
    .flatMap((el) => [...el.querySelectorAll<HTMLElement>('button, input, textarea, [tabindex], [role="menuitem"]')])
    .filter((el) => !(el as HTMLButtonElement).disabled && (el.tabIndex >= 0 || el.getAttribute('role') === 'menuitem') && el.getClientRects().length);
  if (!items.length) return;
  const at = items.indexOf(shadow.activeElement as HTMLElement);
  const next = at < 0 ? (step > 0 ? 0 : items.length - 1) : (at + step + items.length) % items.length;
  items[next]?.focus({ preventScroll: true });
}

/** True when the page has its own modal dialog, popover or fullscreen element open, which Esc should close first. */
function pageLayerOpen() {
  return Boolean(document.fullscreenElement) || deepAll('dialog:modal, :popover-open').some((el) => el !== host);
}

/** Stops annotating on the second Esc within a moment, and says so after the first. */
function escapeToStop() {
  const now = performance.now();
  if (now - escAt < 1600) {
    escAt = 0;
    setActive(false);
    return;
  }
  escAt = now;
  toast('Press Esc again to stop annotating', 1600);
}

/**
 * Keyboard shortcuts while annotating: S and M toggle modes, V comments on the visible area, 1 to 4 and R act on the
 * composer, Ctrl+Z takes back the last marker, Tab stays inside Margin, Shift+F10 and the menu key open the page menu,
 * Esc steps back, and holding Alt hands the pointer to the page. Letters typed into a field stay there. With nothing
 * of Margin's open, Esc pressed twice stops annotating, and an Esc meant for the page never does.
 */
function onKey(e: KeyboardEvent) {
  if (e.key === 'Alt') {
    e.preventDefault();
    passThrough(true);
    return;
  }
  const s = getState();
  const typing = isEditable(document.activeElement) || isEditable(e.composedPath()[0]);
  const plain = !e.ctrlKey && !e.metaKey && !e.altKey && !typing;
  const key = e.key?.toLowerCase();
  const layer = s.menu || s.popover || s.card?.more;
  const stop = () => {
    e.preventDefault();
    e.stopPropagation();
  };
  if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey && !(typing && !e.composedPath().includes(container))) {
    stop();
    stepFocus(e.shiftKey ? -1 : 1);
    return;
  }
  if (e.key === 'Escape') {
    if (layer) {
      stop();
      if (s.popover) setPopover(null);
      else if (s.menu) closeMenu();
      else patchCard({ more: false });
      return;
    }
    if (!s.card && !s.pending) {
      if (typing || pageLayerOpen()) return;
      if (e.composedPath().includes(container)) {
        stop();
        escapeToStop();
        return;
      }
      window.addEventListener('keydown', (after) => after === e && !e.defaultPrevented && escapeToStop(), { once: true });
      return;
    }
    stop();
    if (s.card) escapeCard();
    else cancelRedraw();
    return;
  }
  if (s.menu || s.card?.more) return;
  if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
    stop();
    openKeyMenu();
    return;
  }
  if (s.card && (e.ctrlKey || e.metaKey) && key === 'z' && !e.shiftKey && undoMarkKey()) {
    stop();
    return;
  }
  if (!plain) return;
  if (s.card) {
    if (isField(shadow.activeElement)) return;
    if (/^[1-4]$/.test(e.key)) {
      stop();
      setSeverity(SEVERITY_ORDER[Number(e.key) - 1] as SeverityKey);
    } else if (key === 'r' && !s.card.asking) {
      stop();
      redraw();
    }
    return;
  }
  if (key === 's') {
    stop();
    setPickElement(!readSetting('pickElement'));
  } else if (key === 'm') {
    stop();
    setMarkers(!readSetting('markers'));
  } else if (key === 'v' && !e.shiftKey && !s.pending) {
    stop();
    captureViewport();
  }
}

const WINDOW_EVENTS: [string, EventListener, AddEventListenerOptions | boolean][] = [
  ['keydown', onKey as EventListener, true],
  ['keyup', onKeyUp as EventListener, true],
  ['blur', endPass, false],
  ['mousemove', onStrayMove as EventListener, true],
  ['scroll', onScroll, { passive: true, capture: true }],
  ['resize', onResize, false],
  ['pagehide', onLeave, false],
];

/** Starts or stops annotation mode on this page. */
export function setActive(next: boolean) {
  const s = getState();
  if (s.active === next) return next;
  if (next) {
    setState({ active: true });
    attachHost(true);
    for (const [type, fn, opts] of WINDOW_EVENTS) window.addEventListener(type, fn, opts);
    refreshPage();
    if (!isEditable(document.activeElement)) requestAnimationFrame(focusBar);
  } else {
    closeCard(!s.card?.reopened, false);
    if (pending?.old?.id && !pending.old.reopened) quiet({ type: 'discard', id: pending.old.id });
    pending = null;
    saved = null;
    dragStart = null;
    clearToast();
    passThrough(false);
    for (const [type, fn, opts] of WINDOW_EVENTS) window.removeEventListener(type, fn, opts);
    attachHost(false);
    setState({ active: false, menu: null, popover: null, tip: null, drag: null, hover: null, saving: null, pending: null, barAtTop: false });
  }
  quiet({ type: 'annotating', active: next });
  return next;
}

type Incoming = { type?: string; groupName?: string; zoom?: number; notice?: string; text?: string };

/** Answers the background: start, stop, toggle, ping, zoom, toast and visible area capture. */
function onMessage(msg: Incoming, _sender: chrome.runtime.MessageSender, reply: (response: unknown) => void) {
  if (msg?.groupName) setState({ reviewName: msg.groupName });
  if (msg?.type === 'ping') reply({ ok: true, active: getState().active });
  else if (msg?.type === 'toggle') {
    if (msg.zoom) setTabZoom(msg.zoom);
    reply({ active: setActive(!getState().active) });
  } else if (msg?.type === 'zoom') {
    setTabZoom(msg.zoom ?? 1);
    if (getState().active) refit();
    reply({ ok: true });
  } else if (msg?.type === 'start') {
    if (msg.zoom) setTabZoom(msg.zoom);
    reply({ active: setActive(true) });
    if (msg.notice) toast(msg.notice, 4200);
  } else if (msg?.type === 'stop') reply({ active: setActive(false) });
  else if (msg?.type === 'toast') {
    if (getState().active && msg.text) toast(msg.text, 4200);
    reply({ ok: true });
  } else if (msg?.type === 'captureViewport') {
    if (msg.zoom) setTabZoom(msg.zoom);
    setActive(true);
    fitZoom();
    captureViewport();
    reply({ active: true });
  }
  return false;
}

/** Reads the settings the pointer and key handlers need, listens inside the shadow root, and starts answering the background. */
export function start() {
  for (const name of ['pickElement', 'markers', 'severity'] as const) queryClient.prefetchQuery(settingQuery(name));
  container.addEventListener('pointerdown', onPressCapture, true);
  container.addEventListener('mousemove', onMove);
  container.addEventListener('mouseup', onUp);
  container.addEventListener('wheel', onWheel, { passive: false });
  for (const type of ['keydown', 'keyup', 'keypress', 'input', 'beforeinput']) container.addEventListener(type, (e) => e.stopPropagation());
  chrome.runtime.onMessage.addListener(onMessage);
  fitZoom();
}
