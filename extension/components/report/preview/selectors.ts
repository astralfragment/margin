/** Hooks the export templates add to the preview markup, so the report screen can edit through it. */
export const CARD = 'article.issue[id^="c-"]';
export const TITLE = '[data-edit="title"]';
export const NOTE = '[data-edit="note"]';
export const SEVERITY = '[data-edit="severity"]';
export const STATUS = '[data-edit="status"]';
export const SHOT = 'img[data-shot]';

/** True when a screenshot is the full viewport rather than the marked region. */
export const isViewport = (img: HTMLImageElement) => img.dataset.shot === 'shot';

/** The position of a card in the listed order, from its c-n id. */
export const cardIndex = (card: Element) => Number(card.id.slice(2)) - 1;
