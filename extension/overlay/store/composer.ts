import { toast } from 'sonner';
import type { CommentPatch, FigmaFrame, Marker } from '@/lib/model';
import { sendMessage, type PageComment } from '@/lib/protocol';
import { padNumber } from '@/lib/format';
import { currentViewport, liveBox, mapBetween } from '../page/geometry';
import { currentHost } from '../page/host';
import { messageOf, pageCommentsQuery, queryClient, refreshComments } from '../query';
import { discardDraft, takeShot } from './capture';
import { markerHistory, type OverlaySlice } from '.';
import type { Card, CardDraft, CardFields, MarkerDraft, OpenCardOptions } from './types';

export interface ComposerSlice {
  card: Card | null;
  /** The comment saved last, which the saved toast's Edit reopens. */
  lastSaved: (OpenCardOptions & { draft: CardDraft }) | null;
  openCard(options: OpenCardOptions): void;
  editCard(patch: Partial<Card>): void;
  closeCard(discard: boolean): void;
  replaceable(): boolean;
  holdCard(): void;
  askDiscard(): void;
  confirmAsk(): void;
  keepEditing(): void;
  stepBack(): void;
  save(): Promise<void>;
  saveWithoutShot(): Promise<void>;
  retry(): Promise<void>;
  redraw(): void;
  cancelRedraw(): void;
  editSaved(comment: PageComment): Promise<void>;
  reopenLastSaved(): void;
  keepOnLeave(): void;
}

/** A card's fields with its markers, as they are saved and compared. */
type Fields = CardFields & { marks: MarkerDraft[] };

/**
 * The link to a Figma frame, which the Post to Figma flow reads back as a file key and node id.
 * @param frame The frame.
 */
const frameUrl = (frame: FigmaFrame) => `https://www.figma.com/design/${frame.fileKey}/?node-id=${frame.nodeId.replace(/:/g, '-')}`;

/**
 * Splits pasted reference links on whitespace or commas, keeping real URLs.
 * @param value What was pasted.
 */
const parseLinks = (value: string) =>
  value
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter((part) => /^https?:\/\//i.test(part));

/**
 * A card's fields with its markers.
 * @param card The card.
 * @param markers Its markers.
 */
export const fieldsOf = (card: CardFields, markers: MarkerDraft[]): Fields => ({
  title: card.title,
  note: card.note,
  severity: card.severity,
  frame: card.frame,
  link: card.link,
  marks: markers.map((marker) => ({ ...marker })),
});

/**
 * True when the fields hold a title or a note, the least a comment needs to be saved.
 * @param fields The fields.
 */
export const isFilled = (fields: Pick<CardFields, 'title' | 'note'>) => Boolean(fields.title.trim() || fields.note.trim());

/**
 * True when discarding would lose anything typed or placed.
 * @param card The card.
 * @param markers Its markers.
 */
export const hasWork = (card: CardFields, markers: MarkerDraft[]) => Boolean(isFilled(card) || markers.length || card.frame || card.link.trim());

/**
 * The card a set of options opens.
 * @param options What the card is for.
 */
function buildCard(options: OpenCardOptions): Card {
  const draft = options.draft ?? {};
  const comments = queryClient.getQueryData(pageCommentsQuery.queryKey);
  const card: Card = {
    id: options.id,
    request: options.request ?? null,
    rect: options.rect,
    viewport: options.viewport ?? options.request?.viewport ?? currentViewport(),
    anchor: options.anchor ?? options.request?.anchor ?? null,
    element: options.element,
    extraMarks: options.extraMarks ?? [],
    number: options.number ?? comments?.comments.find((comment) => comment.id === options.id)?.number ?? (comments?.total ?? 0) + 1,
    reopened: options.reopened ?? false,
    hasShot: options.hasShot ?? Boolean(options.id),
    hadFrame: Boolean(draft.frame),
    error: options.error ?? null,
    title: draft.title ?? '',
    note: draft.note ?? '',
    severity: draft.severity ?? 'major',
    frame: draft.frame ?? null,
    link: draft.link ?? '',
    noteOpen: Boolean(draft.note),
    linkOpen: Boolean(draft.link),
    framePickerOpen: false,
    asking: null,
    busy: null,
    original: '',
  };
  card.original = JSON.stringify(fieldsOf(card, draft.marks ?? []));
  return card;
}

/**
 * What reopening a card needs to bring it back on the same area.
 * @param card The card.
 */
const reopenOptions = (card: Card): OpenCardOptions => ({
  id: card.id,
  rect: card.rect,
  element: card.element,
  request: card.request,
  number: card.number,
  reopened: card.reopened,
  hasShot: card.hasShot,
  viewport: card.viewport,
  anchor: card.anchor,
  extraMarks: card.extraMarks,
});

/**
 * Turns a card's fields into what is stored: the comment fields, the markers, and whether the images need redrawing.
 * Markers are kept whether or not they have a note, so every marker placed shows in the image.
 * @param card The card.
 * @param fields Its fields and markers.
 */
function patchFor(card: Card, fields: Fields) {
  const note = fields.note.trim();
  const dots: Marker[] = fields.marks.map((marker) => ({ kind: 'dot', x: marker.x, y: marker.y, note: marker.note.trim() }));
  const marks = [...card.extraMarks, ...dots];
  const links = [...new Set([...parseLinks(fields.link), ...(fields.frame ? [frameUrl(fields.frame)] : [])])];
  const patch: CommentPatch = { severity: fields.severity, title: fields.title.trim() || (note.split('\n')[0] ?? '').slice(0, 80), note, links };
  if (fields.frame) patch.figmaFrame = { ...fields.frame };
  else if (card.hadFrame) patch.figmaFrame = null;
  if (!card.hasShot) patch.marks = marks;
  const moved = JSON.stringify(fields.marks) !== JSON.stringify((JSON.parse(card.original) as Fields).marks);
  const redrawImages = card.hasShot && (card.reopened ? moved : dots.length > 0);
  return { patch, marks, redrawImages };
}

/**
 * Focuses an element of the card, such as its title, once React has drawn it.
 * @param selector Which element.
 */
function focusInCard(selector: string) {
  requestAnimationFrame(() => {
    const target = currentHost()?.shadow.querySelector<HTMLElement>(`[data-margin-card] ${selector}`);
    target?.focus({ preventScroll: true });
  });
}

/** Opens the review report in a new tab. */
export function openReport() {
  sendMessage('openReport').catch((error: unknown) => toast.error('Margin could not open the report', { description: messageOf(error) }));
}

export const createComposerSlice: OverlaySlice<ComposerSlice> = (set, get) => ({
  card: null,
  lastSaved: null,

  openCard(options) {
    get().closeCard(false);
    const card = buildCard(options);
    set({ card, markers: (options.draft?.marks ?? []).map((marker) => ({ ...marker })), placing: false, menu: null, hover: null });
    markerHistory().clear();
    focusInCard('[data-card-title]');
  },

  editCard(patch) {
    set((state) => (state.card ? { card: { ...state.card, ...patch } } : {}));
  },

  closeCard(discard) {
    const { card } = get();
    if (!card) return;
    set({ card: null, markers: [], placing: false });
    markerHistory().clear();
    if (discard && card.id) void discardDraft(card.id);
  },

  replaceable() {
    const { card, markers } = get();
    return Boolean(card && !card.reopened && !hasWork(card, markers));
  },

  holdCard() {
    const { card } = get();
    if (!card) return;
    toast(`Save or discard comment ${padNumber(card.number)} first`);
    const shadow = currentHost()?.shadow;
    const element = shadow?.querySelector<HTMLElement>('[data-margin-card]');
    if (element && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      element.animate([{ translate: '0 0' }, { translate: '-6px 0' }, { translate: '6px 0' }, { translate: '0 0' }], { duration: 300, easing: 'ease-in-out' });
    }
    if (!element?.contains(shadow?.activeElement ?? null)) focusInCard('[data-card-title]');
  },

  askDiscard() {
    const { card, markers } = get();
    if (!card) return;
    if (card.reopened) get().editCard({ asking: 'delete' });
    else if (hasWork(card, markers)) get().editCard({ asking: 'discard' });
    else get().closeCard(true);
  },

  confirmAsk() {
    const { card } = get();
    if (card?.asking) get().closeCard(card.asking !== 'changes');
  },

  keepEditing() {
    get().editCard({ asking: null });
    focusInCard('[data-card-title]');
  },

  stepBack() {
    const { card, markers, placing } = get();
    if (!card) return;
    if (card.framePickerOpen) get().editCard({ framePickerOpen: false });
    else if (placing) set({ placing: false });
    else if (card.asking) get().keepEditing();
    else if (!card.reopened) get().askDiscard();
    else if (JSON.stringify(fieldsOf(card, markers)) !== card.original) get().editCard({ asking: 'changes' });
    else get().closeCard(false);
  },

  async save() {
    const { card, markers } = get();
    if (!card?.id || !isFilled(card) || card.busy) return;
    get().editCard({ busy: 'saving' });
    const fields = fieldsOf(card, markers);
    const { patch, marks, redrawImages } = patchFor(card, fields);
    try {
      await sendMessage('update', { id: card.id, patch });
      if (redrawImages) {
        const drawn = await sendMessage('annotate', { id: card.id, marks });
        if ('error' in drawn) throw new Error(drawn.error);
      }
    } catch (error) {
      if (get().card?.id === card.id) get().editCard({ busy: null });
      toast.error('Margin could not save the comment', { description: messageOf(error) });
      return;
    }
    set({ lastSaved: { ...reopenOptions(card), draft: fields } });
    if (get().card?.id === card.id) get().closeCard(false);
    await refreshComments();
    toast.success(`Comment ${padNumber(card.number)} saved`, {
      duration: 5000,
      action: { label: 'Edit', onClick: () => get().reopenLastSaved() },
      cancel: { label: 'Open report', onClick: openReport },
    });
  },

  async saveWithoutShot() {
    const { card } = get();
    if (!card?.request || !isFilled(card) || card.busy) {
      focusInCard('[data-card-title]');
      return;
    }
    get().editCard({ busy: 'saving' });
    try {
      const { id } = await sendMessage('capture', { ...card.request, skipShot: true });
      get().editCard({ id, hasShot: false, error: null, busy: null });
    } catch (error) {
      get().editCard({ busy: null });
      toast.error('Margin could not save the comment', { description: messageOf(error) });
      return;
    }
    await get().save();
  },

  async retry() {
    const { card } = get();
    if (!card?.request || card.busy) return;
    get().editCard({ busy: 'retrying' });
    const reply = await takeShot(card.request);
    if (get().card?.request !== card.request) {
      if ('id' in reply) void discardDraft(reply.id);
      return;
    }
    if ('id' in reply) {
      get().editCard({ id: reply.id, hasShot: true, error: null, busy: null });
      await refreshComments();
    } else get().editCard({ error: reply.error, busy: null });
    focusInCard('[data-card-title]');
  },

  redraw() {
    const { card, markers } = get();
    if (!card) return;
    const live = liveBox(card);
    const pageMarks = markers.map((marker) => {
      const at = mapBetween(marker, card.rect, live);
      return { pageX: at.x + scrollX, pageY: at.y + scrollY, note: marker.note };
    });
    const fields = fieldsOf(card, markers);
    set({ pending: { draft: { ...fields, marks: [], pageMarks }, old: { ...reopenOptions(card), error: card.error, draft: fields } } });
    get().closeCard(false);
    toast(`Drag over the new area.${pageMarks.length ? ' Markers inside it are kept.' : ''} Esc keeps the old one.`);
  },

  cancelRedraw() {
    const { pending } = get();
    set({ pending: null });
    toast.dismiss();
    if (pending?.old) get().openCard(pending.old);
  },

  async editSaved(comment) {
    const { card } = get();
    if (card) {
      if (card.id === comment.id) return;
      if (!get().replaceable()) {
        get().holdCard();
        return;
      }
      get().closeCard(true);
    }
    let full;
    try {
      full = await sendMessage('comment', { id: comment.id });
    } catch (error) {
      toast.error(`Margin could not open comment ${padNumber(comment.number)}`, { description: messageOf(error) });
      return;
    }
    if ('error' in full) {
      toast.error(`Margin could not open comment ${padNumber(comment.number)}`, { description: full.error });
      return;
    }
    if (!get().active || get().card) return;
    const frame = full.figmaFrame?.nodeId ? full.figmaFrame : null;
    const frameLink = frame ? frameUrl(frame) : '';
    const marks = full.marks ?? [];
    get().openCard({
      id: full.id,
      rect: full.rect,
      element: full.element ?? null,
      number: comment.number,
      reopened: true,
      hasShot: full.hasShot,
      viewport: full.viewport,
      anchor: full.anchor ?? null,
      extraMarks: marks.filter((marker) => marker.kind && marker.kind !== 'dot'),
      draft: {
        title: full.title ?? '',
        note: full.note ?? '',
        severity: full.severity ?? 'major',
        marks: marks.filter((marker) => !marker.kind || marker.kind === 'dot').map((marker) => ({ x: marker.x, y: marker.y, note: marker.note ?? '' })),
        frame,
        link: (full.links ?? []).filter((link) => link !== frameLink).join(' '),
      },
    });
  },

  reopenLastSaved() {
    const { lastSaved } = get();
    if (!lastSaved) return;
    set({ lastSaved: null });
    get().openCard({ ...lastSaved, reopened: true });
  },

  /**
   * Keeps what was typed in the open card when the page goes away. A card with a title or note is saved with its
   * markers and the next page says so. An empty new draft is dropped, and edits to a saved comment are let go.
   */
  keepOnLeave() {
    const { card, markers, pending } = get();
    const oldCard = pending?.old ? buildCard(pending.old) : null;
    const leaving = card
      ? { card, fields: fieldsOf(card, markers) }
      : oldCard && pending?.old
        ? { card: oldCard, fields: fieldsOf(oldCard, pending.old.draft.marks ?? []) }
        : null;
    set({ pending: null });
    get().closeCard(false);
    if (!leaving?.card.id || leaving.card.reopened) return;
    const { id } = leaving.card;
    if (!isFilled(leaving.fields)) {
      sendMessage('discard', { id }).catch((error: unknown) => console.error('Margin: could not drop the empty draft as the page closed', error));
      return;
    }
    const { patch, marks, redrawImages } = patchFor(leaving.card, leaving.fields);
    const notice = `Comment ${padNumber(leaving.card.number)} was saved when the page changed`;
    sendMessage('keep', { id, patch, marks: redrawImages ? marks : null, notice }).catch((error: unknown) =>
      console.error('Margin: could not keep the open comment as the page closed', error),
    );
  },
});
