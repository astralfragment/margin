/**
 * The New review sheet, also used to edit a review's name and links. The popup shows it in place of its body
 * and the report shows it in a dialog. Both links are optional. The popup keeps what is typed as a draft, so
 * leaving the popup to copy a link never loses the sheet.
 */
import { icon } from './icons.js';
import { connection } from './oauth.js';
import {
  lookUpJira,
  lookUpFigma,
  recentJiraIssues,
  recentFigmaFiles,
  rememberFigmaFile,
  parseJiraInput,
  parseFigmaInput,
  frameCount,
  statusTone,
} from './review-links.js';

const DRAFT_KEY = 'reviewDraft';
const DRAFT_AGE = 15 * 60_000;
const UNDO_MS = 5000;
const LINKED = new Set(['ok', 'notConnected', 'noAccess', 'otherSite']);
const TYPED = new Set(['input', 'invalid', 'notFound', 'error']);
const BAD = new Set(['invalid', 'notFound', 'error']);

/**
 * Escapes text for HTML.
 * @param {unknown} value The text.
 */
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const COPY = {
  jira: {
    label: 'Jira ticket',
    placeholder: 'Paste a key like SS-112 or a Jira link',
    search: 'Search your tickets or paste a key',
    invalid: 'That is not a Jira key or link. Paste a key like SS-112 or the link to the issue.',
    notFound: (v) => `No ticket ${v.key} in your Jira sites. Check the key, it stays here to fix.`,
    noAccess: (v) => `You do not have access to ${v.key}`,
    otherSite: (v, site) => `${site} is not one of your connected Jira sites.`,
    looking: (v) => `Looking up ${v.key}`,
    removed: (v) => `${v.key} removed`,
    title: (v) => v.key,
    preview: (text) => {
      const parsed = parseJiraInput(text);
      return parsed && { key: parsed.key };
    },
  },
  figma: {
    label: 'Figma file',
    placeholder: 'Paste a Figma file link',
    search: 'Search recent files or paste a link',
    invalid: 'That is not a Figma file link. In Figma, choose Share and then Copy link.',
    notFound: () => 'No Figma file at that link. Check the link, it stays here to fix.',
    noAccess: () => 'You do not have access to this Figma file. Connecting Figma again in Help and settings may fix it.',
    otherSite: () => '',
    looking: (v) => `Looking up ${v.name || 'the Figma file'}`,
    removed: (v) => `${v.name || 'Figma file'} removed`,
    title: (v) => v.name || 'Figma file',
    preview: (text) => parseFigmaInput(text),
  },
};

/**
 * The draft kept for a sheet scope, when it is less than fifteen minutes old.
 * @param {string} scope Where the draft was typed, such as the popup on one tab.
 * @returns {Promise<{ mode: 'new' | 'edit', groupId: string | null, name: string, jira: string, figma: string } | null>} The draft.
 */
export async function pendingDraft(scope) {
  const draft = (await chrome.storage.local.get(DRAFT_KEY))[DRAFT_KEY];
  if (!draft || draft.scope !== scope || Date.now() - draft.at > DRAFT_AGE) return null;
  return draft;
}

/**
 * Shows the review sheet inside a host element and wires it.
 * @param {HTMLElement} host Where the sheet goes. Its content is replaced.
 * @param {object} options How to open it.
 * @param {'new' | 'edit'} [options.mode] Start a new review, or edit the one given.
 * @param {{ name: string, jira?: object, figma?: object }} [options.group] The review to edit.
 * @param {string} [options.name] The name to prefill for a new review, usually the page title.
 * @param {'name' | 'jira' | 'figma'} [options.focus] The field to focus first.
 * @param {string | null} [options.draftScope] Keeps every change as a draft for this scope, until the sheet is saved or closed.
 * @param {(result: { name: string, jira: object | null, figma: object | null }) => Promise<void>} options.onSubmit Saves the review.
 * @param {() => void} options.onClose Called when the sheet is closed without saving.
 */
export async function mountReviewSheet(host, { mode = 'new', group = null, name = '', focus = 'name', draftScope = null, onSubmit, onClose }) {
  const editing = mode === 'edit';
  host.innerHTML = `
    <form class="session" data-session novalidate>
      <div class="session-head">
        <span class="brand-mark">${icon('mark')}</span>
        <h1>${editing ? 'Edit review' : 'New review'}</h1>
        <button class="icon-btn" type="button" data-session-close title="Close" aria-label="Close">${icon('close')}</button>
      </div>
      <div class="session-body">
        <div class="field">
          <div class="field-label"><label for="session-name">Name</label></div>
          <input id="session-name" type="text" data-session-name autocomplete="off" maxlength="120" />
        </div>
        <div class="field" data-link-field="jira"></div>
        <div class="field" data-link-field="figma"></div>
      </div>
      <div class="session-foot">
        <span class="state" data-session-state role="status"></span>
        <kbd>Enter</kbd>
        <button class="btn primary" type="submit" data-session-go>${editing ? 'Save review' : 'Start review'}</button>
      </div>
    </form>`;

  const form = host.querySelector('[data-session]');
  form.addEventListener('submit', (event) => event.preventDefault());
  const nameEl = form.querySelector('[data-session-name]');
  const go = form.querySelector('[data-session-go]');
  const stateEl = form.querySelector('[data-session-state]');
  const connected = { jira: Boolean((await connection('jira'))?.sites?.length), figma: Boolean(await connection('figma')) };
  const suggestions = { jira: null, figma: null };
  let keeping = false;

  const fields = Object.fromEntries(
    ['jira', 'figma'].map((kind) => {
      const value = group?.[kind] ?? null;
      const known = value && (kind === 'jira' ? value.summary || value.status : value.frames?.length);
      return [
        kind,
        {
          kind,
          el: form.querySelector(`[data-link-field="${kind}"]`),
          status: value ? (known ? 'ok' : 'notConnected') : 'input',
          text: '',
          value,
          site: '',
          message: '',
          previous: null,
          open: false,
          pending: null,
          token: 0,
          timer: 0,
          highlight: -1,
        },
      ];
    }),
  );

  nameEl.value = group?.name ?? name;
  nameEl.addEventListener('input', () => {
    stateEl.textContent = '';
    nameEl.removeAttribute('aria-invalid');
    saveDraft();
  });

  /**
   * What a link field holds, as text that can be looked up again.
   * @param {object} field The field state.
   */
  function linkText(field) {
    if (field.status === 'removed') return '';
    if (LINKED.has(field.status)) return field.kind === 'jira' ? field.value?.url || field.value?.key || '' : field.value?.url ?? '';
    return field.el.querySelector('input')?.value ?? field.text;
  }

  /** Stores what the sheet holds, so it comes back after the popup closes. */
  async function saveDraft() {
    if (!keeping) return;
    await chrome.storage.local.set({
      [DRAFT_KEY]: { mode, scope: draftScope, groupId: group?.id ?? null, name: nameEl.value, jira: linkText(fields.jira), figma: linkText(fields.figma), at: Date.now() },
    });
  }

  /** Forgets the draft, once the sheet is saved or closed on purpose. */
  async function dropDraft() {
    keeping = false;
    await chrome.storage.local.remove(DRAFT_KEY);
  }

  /**
   * The control after a link field, where focus goes once the link is set.
   * @param {object} field The field state.
   */
  function nextAfter(field) {
    return field.kind === 'jira' ? fields.figma.el.querySelector('input') ?? go : go;
  }

  /**
   * Draws one link field in its current state. Typing states keep the same input element so focus and caret stay.
   * @param {object} field The field state.
   */
  function render(field) {
    const copy = COPY[field.kind];
    const input = field.el.querySelector('input');
    saveDraft();
    if (TYPED.has(field.status) && input) {
      paintTyped(field, input);
      return;
    }
    const label = `<div class="field-label"><label for="session-${field.kind}">${copy.label}</label><span>Optional</span></div>`;
    if (TYPED.has(field.status)) {
      const list = `session-${field.kind}-list`;
      field.el.innerHTML = `${label}<input id="session-${field.kind}" type="text" autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-controls="${list}" aria-expanded="false" data-link-input /><ul class="link-suggest" id="${list}" role="listbox" aria-label="${copy.label} suggestions" data-suggest hidden></ul><div data-link-extra></div>`;
      const fresh = field.el.querySelector('input');
      fresh.value = field.text;
      wireInput(field, fresh);
      paintTyped(field, fresh);
      return;
    }
    field.el.innerHTML = `${label}${rowFor(field)}`;
    field.el.querySelector('[data-remove]')?.addEventListener('click', () => remove(field));
    field.el.querySelector('[data-undo]')?.addEventListener('click', () => undo(field));
    field.el.querySelector('[data-connect]')?.addEventListener('click', () => openSettings(field.kind));
    field.el.querySelector('[data-more]')?.addEventListener('click', (event) => {
      const desc = field.el.querySelector('[data-desc]');
      desc.classList.toggle('open');
      event.currentTarget.textContent = desc.classList.contains('open') ? 'Show less' : 'Show more';
    });
    const desc = field.el.querySelector('[data-desc]');
    if (desc && desc.scrollHeight <= desc.clientHeight + 1) field.el.querySelector('[data-more]')?.remove();
  }

  /**
   * The markup for a field that holds a link or is busy with one.
   * @param {object} field The field state.
   */
  function rowFor(field) {
    const copy = COPY[field.kind];
    const v = field.value ?? {};
    const mark = icon(field.kind);
    const title = (text) => `<b title="${esc(text)}">${esc(text)}</b>`;
    if (field.status === 'looking') {
      return `<div class="link-row" aria-busy="true">${mark}<div class="link-text"><i class="skeleton"></i><div class="link-sub">${esc(copy.looking(v))}</div></div></div>`;
    }
    if (field.status === 'removed') {
      return `<div class="link-row is-removed"><div class="link-text">${esc(copy.removed(v))}</div><button class="btn ghost" type="button" data-undo>Undo</button></div>`;
    }
    if (field.status === 'noAccess' || field.status === 'otherSite') {
      const message = field.status === 'noAccess' ? esc(copy.noAccess(v)) : `${esc(copy.otherSite(v, field.site))} <button class="text-link" type="button" data-connect>Connect it in Help and settings</button>`;
      return `<div class="link-row is-error" role="alert">${icon('alert')}<div class="link-text"><div class="link-line">${title(copy.title(v))}</div><div class="link-sub wrap"><span>${message}</span></div></div><button class="btn ghost" type="button" data-remove>Remove link</button></div>`;
    }
    if (field.status === 'notConnected') {
      return `<div class="link-row">${mark}<div class="link-text"><div class="link-line">${title(copy.title(v))}</div><div class="link-sub"><button class="text-link" type="button" data-connect>Connect to bring in details</button></div></div><button class="icon-btn" type="button" data-remove title="Remove link" aria-label="Remove link">${icon('close')}</button></div>`;
    }
    if (field.kind === 'jira') {
      return `<div class="link-row">${mark}<div class="link-text"><div class="link-line"><b>${esc(v.key)}</b><span title="${esc(v.summary)}">${esc(v.summary)}</span></div><div class="link-sub"><span class="tone-${statusTone(v.statusCategory)}">${esc(v.status)}</span><span class="muted">${esc(v.assignee)}</span></div></div><button class="btn ghost" type="button" data-remove>Remove</button></div>${
        v.description ? `<p class="link-desc" data-desc>${esc(v.description)}</p><button class="btn ghost sm link-more" type="button" data-more>Show more</button>` : ''
      }`;
    }
    return `<div class="link-row">${mark}<div class="link-text"><div class="link-line">${title(v.name || 'Figma file')}</div><div class="link-sub">${esc(frameCount(v))}</div></div><button class="btn ghost" type="button" data-remove>Remove</button></div>`;
  }

  /**
   * The error shown under a link input, or an empty string when there is none.
   * @param {object} field The field state.
   */
  function errorText(field) {
    const copy = COPY[field.kind];
    if (field.status === 'invalid') return copy.invalid;
    if (field.status === 'notFound') return copy.notFound(field.value ?? {});
    if (field.status === 'error') return `Could not look this up. ${field.message}`;
    return '';
  }

  /**
   * Updates an input field's error look, message and suggestion list without replacing the input.
   * @param {object} field The field state.
   * @param {HTMLInputElement} input The field's input.
   */
  function paintTyped(field, input) {
    const copy = COPY[field.kind];
    input.placeholder = field.open && suggestions[field.kind]?.length ? copy.search : copy.placeholder;
    const bad = BAD.has(field.status);
    input.classList.toggle('is-invalid', bad);
    input.setAttribute('aria-invalid', String(bad));
    const extra = field.el.querySelector('[data-link-extra]');
    const message = esc(errorText(field)).replace(/\b[A-Z][A-Z0-9_]*-\d+\b/g, '<span class="nowrap">$&</span>');
    extra.innerHTML = message
      ? `<div class="link-error" role="alert">${icon('alert')}<span>${message}</span>${field.status === 'error' ? '<button class="btn ghost sm" type="button" data-retry>Try again</button>' : ''}</div>`
      : '';
    extra.querySelector('[data-retry]')?.addEventListener('click', () => resolve(field));
    paintSuggestions(field, input);
  }

  /**
   * Shows the recent tickets or files that match what is typed, while the input has focus.
   * @param {object} field The field state.
   * @param {HTMLInputElement} input The field's input.
   */
  function paintSuggestions(field, input) {
    const list = field.el.querySelector('[data-suggest]');
    const query = input.value.trim().toLowerCase();
    const items = (suggestions[field.kind] ?? []).filter((item) =>
      [item.key, item.summary, item.name].some((part) => part && part.toLowerCase().includes(query)),
    );
    field.items = items;
    const show = field.open && items.length > 0 && field.status === 'input';
    list.hidden = !show;
    input.setAttribute('aria-expanded', String(show));
    field.highlight = Math.min(field.highlight, items.length - 1);
    const optionId = (i) => `session-${field.kind}-option-${i}`;
    if (show && field.highlight >= 0) input.setAttribute('aria-activedescendant', optionId(field.highlight));
    else input.removeAttribute('aria-activedescendant');
    if (!show) return;
    list.innerHTML = items
      .map((item, i) =>
        field.kind === 'jira'
          ? `<li role="option" id="${optionId(i)}" data-pick="${i}" aria-selected="${i === field.highlight}">${icon('jira')}<b>${esc(item.key)}</b><span class="name" title="${esc(item.summary)}">${esc(item.summary)}</span><span class="status">${esc(item.status)}</span></li>`
          : `<li role="option" id="${optionId(i)}" data-pick="${i}" aria-selected="${i === field.highlight}">${icon('figma')}<span class="name" title="${esc(item.name || item.fileKey)}">${esc(item.name || item.fileKey)}</span></li>`,
      )
      .join('');
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }

  /**
   * Wires typing, pasting, picking and Enter on a link input.
   * @param {object} field The field state.
   * @param {HTMLInputElement} input The field's input.
   */
  function wireInput(field, input) {
    const list = field.el.querySelector('[data-suggest]');
    input.addEventListener('focus', async () => {
      field.open = true;
      await loadSuggestions(field.kind);
      if (input.isConnected) paintTyped(field, input);
    });
    input.addEventListener('blur', () => {
      setTimeout(() => {
        field.open = false;
        if (!field.el.contains(document.activeElement) && input.isConnected) {
          if (input.value.trim() && field.status === 'input') resolve(field);
          else paintTyped(field, input);
        }
      }, 150);
    });
    input.addEventListener('input', () => {
      field.text = input.value;
      field.highlight = -1;
      if (field.status !== 'input') field.status = 'input';
      stateEl.textContent = '';
      paintTyped(field, input);
      saveDraft();
    });
    input.addEventListener('paste', () => setTimeout(() => {
      field.text = input.value;
      if (input.value.trim()) resolve(field);
    }));
    input.addEventListener('keydown', (event) => {
      const count = field.items?.length ?? 0;
      if (event.key === 'ArrowDown' && !list.hidden) {
        event.preventDefault();
        field.highlight = (field.highlight + 1) % count;
        paintSuggestions(field, input);
      } else if (event.key === 'ArrowUp' && !list.hidden) {
        event.preventDefault();
        field.highlight = (field.highlight - 1 + count) % count;
        paintSuggestions(field, input);
      } else if (event.key === 'Enter' && !list.hidden && field.highlight >= 0) {
        event.preventDefault();
        pick(field, field.items[field.highlight]);
      } else if (event.key === 'Enter' && input.value.trim() && field.status === 'input') {
        event.preventDefault();
        resolve(field);
      } else if (event.key === 'Escape' && !list.hidden) {
        event.preventDefault();
        event.stopPropagation();
        field.open = false;
        paintSuggestions(field, input);
      }
    });
    list.addEventListener('mousedown', (event) => event.preventDefault());
    list.addEventListener('click', (event) => {
      const row = event.target.closest('[data-pick]');
      if (row) pick(field, field.items[Number(row.dataset.pick)]);
    });
  }

  /**
   * Loads the recent tickets once, and the recent files on every focus since linking a file adds to them.
   * @param {'jira' | 'figma'} kind Which list.
   */
  async function loadSuggestions(kind) {
    if (!connected[kind] || (kind === 'jira' && suggestions.jira !== null)) return;
    suggestions[kind] = kind === 'jira' ? await recentJiraIssues() : await recentFigmaFiles();
  }

  /**
   * Links a suggested ticket at once, or looks up a suggested file, then moves on to the next field.
   * @param {object} field The field state.
   * @param {object} item The suggestion.
   */
  function pick(field, item) {
    if (!item) return;
    field.open = false;
    if (field.kind === 'jira') {
      field.token += 1;
      field.text = item.key;
      field.value = item;
      field.status = 'ok';
      render(field);
      nextAfter(field).focus();
      return;
    }
    field.text = item.url;
    resolve(field);
  }

  /**
   * Looks up what was typed in a link field and shows the outcome. A newer lookup replaces an older one.
   * When the input had focus, focus moves on to the next field while the lookup runs.
   * @param {object} field The field state.
   */
  function resolve(field) {
    const copy = COPY[field.kind];
    const text = field.el.querySelector('input')?.value ?? field.text;
    const focused = field.el.contains(document.activeElement);
    field.text = text;
    if (!text.trim()) {
      field.status = 'input';
      render(field);
      return Promise.resolve();
    }
    const preview = copy.preview(text);
    if (!preview) {
      field.status = 'invalid';
      render(field);
      return Promise.resolve();
    }
    const token = ++field.token;
    field.value = preview;
    field.status = 'looking';
    render(field);
    if (focused) nextAfter(field).focus();
    field.pending = (field.kind === 'jira' ? lookUpJira(text) : lookUpFigma(text)).then(async (res) => {
      if (token !== field.token) return;
      field.pending = null;
      field.value = res.jira ?? res.figma ?? preview;
      field.message = res.message ?? '';
      field.site = res.site ?? '';
      field.status = res.state;
      if (field.kind === 'figma' && LINKED.has(res.state)) await rememberFigmaFile(field.value);
      render(field);
    });
    return field.pending;
  }

  /**
   * Takes a link off the field and offers Undo for five seconds, then leaves an empty input.
   * Focus follows: to Undo, and to the empty input when the five seconds end.
   * @param {object} field The field state.
   */
  function remove(field) {
    field.previous = { status: field.status, value: field.value, text: field.text, site: field.site };
    field.status = 'removed';
    render(field);
    field.el.querySelector('[data-undo]').focus();
    clearTimeout(field.timer);
    field.timer = setTimeout(() => {
      if (field.status !== 'removed') return;
      const focused = field.el.contains(document.activeElement);
      Object.assign(field, { status: 'input', value: null, text: '', previous: null });
      render(field);
      if (focused) field.el.querySelector('input').focus();
    }, UNDO_MS);
  }

  /**
   * Puts back the link that was just removed, with focus on its Remove button.
   * @param {object} field The field state.
   */
  function undo(field) {
    clearTimeout(field.timer);
    if (field.previous) Object.assign(field, field.previous, { previous: null });
    render(field);
    field.el.querySelector('[data-remove], input')?.focus();
  }

  /**
   * Keeps what has been typed, then opens Help and settings at the service's Connect button.
   * @param {'jira' | 'figma'} kind The service to connect.
   */
  async function openSettings(kind) {
    keeping = true;
    await saveDraft();
    chrome.tabs.create({ url: chrome.runtime.getURL(`options.html#connect-${kind}`) });
  }

  /** Restores a sheet that was left before it was saved, and looks its links up again. */
  async function restoreDraft() {
    const draft = (await chrome.storage.local.get(DRAFT_KEY))[DRAFT_KEY];
    if (!draft || (draft.scope ?? null) !== draftScope || draft.mode !== mode || draft.groupId !== (group?.id ?? null) || Date.now() - draft.at > DRAFT_AGE) return;
    nameEl.value = draft.name ?? nameEl.value;
    for (const kind of ['jira', 'figma']) {
      if (draft[kind] === undefined || draft[kind] === linkText(fields[kind])) continue;
      fields[kind].text = draft[kind];
      fields[kind].status = 'input';
      render(fields[kind]);
      const input = fields[kind].el.querySelector('input');
      if (input) input.value = draft[kind];
      if (draft[kind]) resolve(fields[kind]);
    }
  }

  /** Closes the sheet on purpose, which drops the draft. */
  async function close() {
    await dropDraft();
    onClose();
  }

  render(fields.jira);
  render(fields.figma);
  await restoreDraft();
  keeping = Boolean(draftScope);

  form.querySelector('[data-session-close]').addEventListener('click', close);
  form.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = nameEl.value.trim();
    if (!name) {
      stateEl.textContent = 'Give the review a name';
      nameEl.setAttribute('aria-invalid', 'true');
      nameEl.focus();
      return;
    }
    go.disabled = true;
    stateEl.textContent = '';
    for (const field of Object.values(fields)) {
      if (field.status === 'input' && field.el.querySelector('input')?.value.trim()) resolve(field);
    }
    await Promise.all(Object.values(fields).map((field) => field.pending));
    const wrong = Object.values(fields).find((field) => BAD.has(field.status));
    if (wrong) {
      stateEl.textContent = `Fix or clear the ${COPY[wrong.kind].label} to ${editing ? 'save' : 'start'}`;
      go.disabled = false;
      wrong.el.querySelector('input')?.focus();
      return;
    }
    const linkOf = (field) => (LINKED.has(field.status) ? field.value : null);
    const kept = keeping;
    await dropDraft();
    try {
      await onSubmit({ name, jira: linkOf(fields.jira), figma: linkOf(fields.figma) });
    } catch (err) {
      keeping = kept;
      saveDraft();
      stateEl.textContent = err.message;
      go.disabled = false;
    }
  });

  const first = focus === 'name' ? nameEl : fields[focus]?.el.querySelector('input, button');
  (first ?? nameEl).focus();
  if (first === nameEl && !editing) nameEl.select();
}
