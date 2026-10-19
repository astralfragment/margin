const TOURS_KEY = 'tours';
const GAP = 10;
const EDGE = 8;

/** Forgets which tours were finished, so each one shows again next time its page opens. */
export async function resetTours() {
  await chrome.storage.local.remove(TOURS_KEY);
}

/**
 * Shows a tour once per page, unless it has already been finished or skipped.
 * @param {string} name Which page the tour belongs to.
 * @param {TourStep[]} steps The steps in order.
 */
export async function tourOnce(name, steps) {
  const done = (await chrome.storage.local.get(TOURS_KEY))[TOURS_KEY] ?? {};
  if (!done[name]) startTour(name, steps);
}

/**
 * @typedef {object} TourStep
 * @property {string | (() => DOMRect | null)} target A selector, or a function that measures the spot to point at.
 * @property {string} title A short heading.
 * @property {string} body One or two sentences.
 */

/**
 * Walks through steps that point at real controls, dimming the rest of the page.
 * Steps whose target is missing are skipped. Finishing or skipping marks the tour done.
 * @param {string} name Which page the tour belongs to.
 * @param {TourStep[]} steps The steps in order.
 */
export function startTour(name, steps) {
  const rectOf = (step) => {
    if (typeof step.target === 'function') return step.target();
    const el = document.querySelector(step.target);
    if (!el || !el.getClientRects().length) return null;
    el.scrollIntoView({ block: 'nearest' });
    return el.getBoundingClientRect();
  };
  const live = steps.filter((step) => rectOf(step));
  if (!live.length) return;

  const root = document.createElement('div');
  root.className = 'tour';
  root.innerHTML = `
    <div class="tour-spot"></div>
    <div class="tour-tip" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      <header><span class="disc" data-n></span><h2 id="tour-title" data-title></h2></header>
      <p data-body></p>
      <div class="row">
        <span class="tour-count" data-count></span>
        <button class="btn ghost sm" type="button" data-skip>Skip</button>
        <button class="btn sm" type="button" data-back>Back</button>
        <button class="btn action sm" type="button" data-next>Next</button>
      </div>
    </div>`;
  document.body.append(root);
  const spot = root.querySelector('.tour-spot');
  const tip = root.querySelector('.tour-tip');
  const next = root.querySelector('[data-next]');
  const back = root.querySelector('[data-back]');
  let index = 0;

  const place = () => {
    const r = rectOf(live[index]);
    if (!r) return;
    const pad = 4;
    Object.assign(spot.style, {
      left: `${r.left - pad}px`,
      top: `${r.top - pad}px`,
      width: `${r.width + pad * 2}px`,
      height: `${r.height + pad * 2}px`,
    });
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const below = r.bottom + pad + GAP;
    const above = r.top - pad - GAP - h;
    let top = below + h <= innerHeight - EDGE ? below : above >= EDGE ? above : innerHeight - h - EDGE;
    let left = r.left;
    if (top === innerHeight - h - EDGE && r.right + GAP + w <= innerWidth - EDGE) {
      left = r.right + GAP;
      top = r.top;
    }
    tip.style.left = `${Math.min(Math.max(EDGE, left), innerWidth - w - EDGE)}px`;
    tip.style.top = `${Math.min(Math.max(EDGE, top), innerHeight - h - EDGE)}px`;
  };

  const show = () => {
    const step = live[index];
    root.querySelector('[data-n]').textContent = String(index + 1);
    root.querySelector('[data-title]').textContent = step.title;
    root.querySelector('[data-body]').textContent = step.body;
    root.querySelector('[data-count]').textContent = `${index + 1} of ${live.length}`;
    back.hidden = index === 0;
    next.textContent = index === live.length - 1 ? 'Done' : 'Next';
    place();
    next.focus();
  };

  const finish = async () => {
    removeEventListener('resize', place);
    removeEventListener('keydown', onKey, true);
    root.remove();
    const done = (await chrome.storage.local.get(TOURS_KEY))[TOURS_KEY] ?? {};
    await chrome.storage.local.set({ [TOURS_KEY]: { ...done, [name]: true } });
  };

  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      finish();
    } else if (e.key === 'ArrowRight') {
      next.click();
    } else if (e.key === 'ArrowLeft' && index > 0) {
      back.click();
    }
  };

  next.addEventListener('click', () => {
    if (index === live.length - 1) finish();
    else {
      index += 1;
      show();
    }
  });
  back.addEventListener('click', () => {
    index = Math.max(0, index - 1);
    show();
  });
  root.querySelector('[data-skip]').addEventListener('click', finish);
  root.addEventListener('click', (e) => {
    if (!tip.contains(e.target)) finish();
  });
  addEventListener('resize', place);
  addEventListener('keydown', onKey, true);
  show();
}
