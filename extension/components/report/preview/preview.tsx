import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { REPORT_CSS, PREVIEW_DARK_CSS } from '@/lib/report-template.js';
import { cn } from '@/lib/utils';
import { decorateCard } from './decorate';
import { PREVIEW_EDIT_CSS, tokenCss } from './preview-css';
import { CARD, cardIndex, isViewport, SHOT } from './selectors';

export type EditField = 'title' | 'note';
export type MenuKind = 'severity' | 'status';

/** Where a click on a screenshot landed, as the background's quickMark message wants it. */
export type ShotClick = {
  image: 'shot' | 'detail';
  fx: number;
  fy: number;
  aspect: number;
  reach: number;
  /** The click in this page's coordinates, for the note box. */
  at: { x: number; y: number };
};

export type PreviewEvents = {
  onLoad: () => void;
  onField: (index: number, field: EditField, value: string) => void;
  onMenu: (index: number, kind: MenuKind, chip: HTMLElement) => void;
  onAnnotate: (index: number) => void;
  onCopy: (index: number) => void;
  onShotClick: (index: number, click: ShotClick, action: 'add' | 'remove') => void;
  onMarkEdit: (index: number, mark: number, at: { x: number; y: number }) => void;
  onMarkRemove: (index: number, mark: number) => void;
  onClearFilters: () => void;
  onSpy: (index: number) => void;
  onPointerDown: () => void;
  onHelpKey: () => void;
};

export type PreviewHandle = {
  jumpTo: (index: number, behavior?: ScrollBehavior) => void;
  print: () => void;
  /** The first editable screenshot in this page's coordinates, for the tour. */
  firstShotRect: () => DOMRect | null;
  revealFirstShot: () => void;
  frameRect: () => DOMRect | null;
};

const FONT_CSS = `@font-face { font-family: Inter; font-weight: 100 900; font-display: swap; src: url("${chrome.runtime.getURL('fonts/inter-latin-wght-normal.woff2')}") format("woff2"); }`;

const ARTICLE = /<article\b[\s\S]*?<\/article>/g;

/** The body with every card replaced by its id, so a change that only touches cards can patch them in place. */
const skeletonOf = (html: string) => html.replace(ARTICLE, (m) => m.match(/id="([^"]+)"/)?.[1] ?? '');
const articlesOf = (html: string) => new Map((html.match(ARTICLE) ?? []).map((m) => [m.match(/id="([^"]+)"/)?.[1] ?? '', m]));

type Props = {
  html: string;
  theme: 'light' | 'dark';
  visible: boolean[];
  noMatch: string;
  events: PreviewEvents;
  className?: string;
  ref?: Ref<PreviewHandle>;
};

/**
 * The report preview: the export markup from renderBody in an iframe, so it matches the HTML file exactly,
 * with in-place editing added on top. Changes patch only the cards that differ, so the page does not flash.
 */
export function Preview({ html, theme, visible, noMatch, events, className, ref }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const shown = useRef({ html: '', skeleton: '', articles: new Map<string, string>() });
  const loaded = useRef(false);
  const spyHold = useRef(0);
  const live = useRef({ events, visible, noMatch, theme });
  live.current = { events, visible, noMatch, theme };

  const doc = () => (loaded.current ? frame.current?.contentDocument ?? null : null);

  /** Hides the cards and page sections the sidebar filters leave out, and says so when none are left. */
  const applyVisible = () => {
    const d = doc();
    if (!d) return;
    const { visible: vis, noMatch: text } = live.current;
    d.querySelectorAll<HTMLElement>(CARD).forEach((card) => card.classList.toggle('hide', vis[cardIndex(card)] === false));
    d.querySelectorAll('.comm').forEach((section) => section.classList.toggle('hide', !section.querySelector('.issue:not(.hide)')));
    const none = d.querySelector<HTMLElement>('[data-no-match]');
    if (none) {
      none.hidden = vis.length === 0 || vis.some(Boolean);
      const label = none.querySelector('[data-no-match-text]');
      if (label) label.textContent = text;
    }
  };

  /** Brings the preview document in line with the markup, patching only the cards that changed. */
  const write = (next: string) => {
    const d = doc();
    if (!d || next === shown.current.html) return;
    const skeleton = skeletonOf(next);
    const articles = articlesOf(next);
    if (skeleton === shown.current.skeleton) {
      for (const [id, markup] of articles) {
        if (shown.current.articles.get(id) === markup) continue;
        const old = d.getElementById(id);
        if (!old || old.querySelector('[data-m-editing]')) continue;
        const holder = d.createElement('template');
        holder.innerHTML = markup;
        const card = holder.content.firstElementChild as HTMLElement;
        decorateCard(card);
        old.replaceWith(card);
      }
    } else {
      const y = d.defaultView?.scrollY ?? 0;
      d.body.innerHTML = next;
      d.querySelectorAll<HTMLElement>(CARD).forEach(decorateCard);
      d.defaultView?.scrollTo(0, y);
    }
    shown.current = { html: next, skeleton, articles };
  };

  /** Follows the screen's theme and accent, and copies its colour tokens in for the editing controls. */
  const painted = useRef('');
  const paintTheme = () => {
    const d = doc();
    const key = `${live.current.theme} ${document.documentElement.dataset.accent ?? ''}`;
    if (!d || painted.current === key) return;
    painted.current = key;
    d.documentElement.setAttribute('data-theme', live.current.theme);
    let tokens = d.getElementById('m-tokens');
    if (!tokens) {
      tokens = d.createElement('style');
      tokens.id = 'm-tokens';
      d.head.append(tokens);
    }
    tokens.textContent = tokenCss();
  };

  /** The iframe is a document React does not render, so each render syncs it: markup, filters and theme. */
  useEffect(() => {
    write(html);
    applyVisible();
    paintTheme();
  });

  useImperativeHandle(ref, () => ({
    jumpTo(index, behavior = 'smooth') {
      spyHold.current = Date.now() + 1200;
      doc()?.getElementById(`c-${index + 1}`)?.scrollIntoView({ behavior, block: 'start' });
    },
    print() {
      const d = doc();
      const win = frame.current?.contentWindow;
      if (!d || !win) return;
      const folded = [...d.querySelectorAll<HTMLDetailsElement>('details:not([open])')];
      folded.forEach((details) => (details.open = true));
      win.focus();
      win.print();
      folded.forEach((details) => (details.open = false));
    },
    firstShotRect() {
      const outer = frame.current?.getBoundingClientRect();
      const shot = doc()?.querySelector(SHOT);
      if (!outer || !shot) return null;
      const inner = shot.getBoundingClientRect();
      const top = Math.max(outer.top, outer.top + inner.top);
      const bottom = Math.min(outer.bottom, outer.top + inner.bottom);
      if (bottom - top < 24) return outer;
      return new DOMRect(outer.left + inner.left, top, inner.width, bottom - top);
    },
    revealFirstShot: () => doc()?.querySelector(SHOT)?.scrollIntoView({ block: 'center' }),
    frameRect: () => frame.current?.getBoundingClientRect() ?? null,
  }));

  const onLoad = () => {
    const d = frame.current?.contentDocument;
    const win = frame.current?.contentWindow;
    if (!d || !win || loaded.current) return;
    loaded.current = true;
    shown.current = { html: '', skeleton: '', articles: new Map() };
    paintTheme();
    write(html);
    applyVisible();
    wire(d, win);
    live.current.events.onLoad();
  };

  /** One set of listeners on the preview document. They read the latest handlers from a ref. */
  const wire = (d: Document, win: Window) => {
    const ev = () => live.current.events;
    const outer = () => frame.current!.getBoundingClientRect();
    const indexOf = (el: Element) => cardIndex(el.closest(CARD)!);
    let editing: { el: HTMLElement; field: EditField; before: string; cancelled: boolean } | null = null;

    const startEdit = (el: HTMLElement, field: EditField) => {
      if (editing) return;
      editing = { el, field, before: el.innerHTML, cancelled: false };
      el.dataset.mEditing = '';
      el.contentEditable = 'plaintext-only';
      el.spellcheck = true;
      if (field === 'title' && el.textContent?.trim() === 'Untitled comment') el.textContent = '';
      el.focus();
      const range = d.createRange();
      range.selectNodeContents(el);
      const sel = win.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    };

    const endEdit = () => {
      if (!editing) return;
      const { el, field, before, cancelled } = editing;
      editing = null;
      const value = (el.innerText ?? '').replace(/ /g, ' ').trim();
      el.removeAttribute('contenteditable');
      delete el.dataset.mEditing;
      win.getSelection()?.removeAllRanges();
      if (cancelled) {
        el.innerHTML = before;
        return;
      }
      ev().onField(indexOf(el), field, value);
    };

    d.addEventListener('focusout', (event) => {
      if (editing && event.target === editing.el) endEdit();
    });

    d.addEventListener('keydown', (event) => {
      const target = event.target as HTMLElement;
      if (editing && target === editing.el) {
        const commit = editing.field === 'title' ? event.key === 'Enter' : event.key === 'Enter' && (event.metaKey || event.ctrlKey);
        if (event.key === 'Escape') {
          event.preventDefault();
          editing.cancelled = true;
          target.blur();
        } else if (commit) {
          event.preventDefault();
          target.blur();
        }
        return;
      }
      const edit = target.dataset?.mEdit;
      if ((event.key === 'Enter' || event.key === ' ') && edit) {
        event.preventDefault();
        if (edit === 'title' || edit === 'note') startEdit(target, edit);
        else ev().onMenu(indexOf(target), edit as MenuKind, target);
        return;
      }
      if (event.key === '?' && !target.isContentEditable) ev().onHelpKey();
    });

    d.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      if (editing && editing.el.contains(target)) return;
      const link = target.closest<HTMLAnchorElement>('a[href]');
      if (link) {
        event.preventDefault();
        chrome.tabs.create({ url: link.href });
        return;
      }
      if (target.closest('[data-clear-filters]')) return ev().onClearFilters();
      if (target.closest('[data-m-copy]')) return ev().onCopy(indexOf(target));
      if (target.closest('[data-m-annotate]')) return ev().onAnnotate(indexOf(target));
      const markEdit = target.closest<HTMLElement>('[data-m-mark-edit]');
      if (markEdit) {
        const r = markEdit.getBoundingClientRect();
        return ev().onMarkEdit(indexOf(markEdit), Number(markEdit.dataset.mMarkEdit), { x: outer().left + r.left, y: outer().top + r.bottom });
      }
      const markRemove = target.closest<HTMLElement>('[data-m-mark-remove]');
      if (markRemove) return ev().onMarkRemove(indexOf(markRemove), Number(markRemove.dataset.mMarkRemove));
      const editable = target.closest<HTMLElement>('[data-m-edit]');
      if (editable) {
        const kind = editable.dataset.mEdit!;
        if (kind === 'title' || kind === 'note') startEdit(editable, kind);
        else ev().onMenu(indexOf(editable), kind as MenuKind, editable);
        return;
      }
      const img = target.closest<HTMLImageElement>(SHOT);
      if (img?.closest(CARD)) shotClick(img, event, 'add');
    });

    d.addEventListener('contextmenu', (event) => {
      const img = (event.target as HTMLElement).closest<HTMLImageElement>(SHOT);
      if (!img?.closest(CARD)) return;
      event.preventDefault();
      shotClick(img, event, 'remove');
    });

    const shotClick = (img: HTMLImageElement, event: MouseEvent, action: 'add' | 'remove') => {
      const box = img.getBoundingClientRect();
      ev().onShotClick(
        indexOf(img),
        {
          image: isViewport(img) ? 'shot' : 'detail',
          fx: (event.clientX - box.left) / box.width,
          fy: (event.clientY - box.top) / box.height,
          aspect: img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 0,
          reach: 18 / box.width,
          at: { x: outer().left + event.clientX, y: outer().top + event.clientY },
        },
        action,
      );
    };

    d.addEventListener('pointerdown', () => ev().onPointerDown());

    let ticking = false;
    win.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        if (Date.now() < spyHold.current) return;
        const top = [...d.querySelectorAll<HTMLElement>(`${CARD}:not(.hide)`)].find((card) => card.getBoundingClientRect().bottom > 72);
        if (top) ev().onSpy(cardIndex(top));
      });
    });
  };

  const srcDoc = `<!doctype html><html lang="en" data-theme="${theme}"><head><meta charset="utf-8" /><base target="_blank" /><style>${FONT_CSS}${REPORT_CSS}${PREVIEW_DARK_CSS}${PREVIEW_EDIT_CSS}</style></head><body></body></html>`;

  return <iframe ref={frame} title="Report preview" srcDoc={useRef(srcDoc).current} onLoad={onLoad} className={cn('size-full border-0 bg-background', className)} />;
}

