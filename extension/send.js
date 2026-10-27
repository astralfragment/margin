import { connection, requestAccess, connect } from './lib/oauth.js';
import { listProjects, defaultType, createIssues, commentOnTicket, linkFields, createLink, siteOrigin, openSites, sessionProjects } from './lib/jira.js';
import { figmaTargets, figmaMessage, postComment } from './lib/figma.js';
import { patchGroup } from './lib/store.js';

const pad = (n) => String(n).padStart(2, '0');
const SITE_KEY = 'jiraSite';
const CHOICE_KEY = 'jiraChoice';
const SITES_PERMISSION = { origins: ['https://*.atlassian.net/*'] };

/**
 * Escapes text for HTML.
 * @param {unknown} value The text.
 */
function esc(value) {
  const node = document.createElement('span');
  node.textContent = String(value ?? '');
  return node.innerHTML;
}

/**
 * Fills a select with options and picks one.
 * @param {HTMLSelectElement} select The select.
 * @param {{ id: string, name: string }[]} items The options.
 * @param {string} [chosen] The id to pick when present.
 */
function fill(select, items, chosen) {
  select.innerHTML = items.map((item) => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('');
  if (items.some((item) => item.id === chosen)) select.value = chosen;
}

/**
 * Lists the chosen project's issue types, keeping a remembered type or falling back to Bug or Task.
 * @param {HTMLSelectElement} select The issue type select.
 * @param {object[]} projects The site's projects with their issue types.
 * @param {string} projectId The chosen project.
 * @param {string} [chosen] The issue type picked last time.
 */
function fillTypes(select, projects, projectId, chosen) {
  const types = projects.find((p) => p.id === projectId)?.issueTypes ?? [];
  fill(select, types, chosen);
  if (select.value !== chosen) select.value = defaultType(types)?.id ?? '';
}

/**
 * The two ways to split a review into Jira issues.
 * @param {number} count How many comments will be sent.
 * @param {string} mode The mode to pick.
 */
const modePicks = (count, mode, ticket) => {
  const whole = ticket ? 'ticket' : 'review';
  return `
  <label class="pick"><input type="radio" name="jira-mode" value="each"${mode === whole ? '' : ' checked'} /><b>One issue per comment</b><span class="hint">${count} ${count === 1 ? 'issue' : 'issues'}${ticket ? `, each linked to ${esc(ticket)}` : ''}</span></label>
  <label class="pick"><input type="radio" name="jira-mode" value="${whole}"${mode === whole ? ' checked' : ''} /><b>${ticket ? `One comment on ${esc(ticket)}` : 'One issue for the whole review'}</b><span class="hint">Every comment as a numbered section</span></label>`;
};

/**
 * True when two addresses share an origin.
 * @param {string} a One address.
 * @param {string} b The other.
 */
function sameOrigin(a, b) {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/**
 * A card that signs in to a service from inside a dialog, then calls back.
 * @param {HTMLElement} host Where the card goes.
 * @param {'jira' | 'figma'} provider The service.
 * @param {string} name The service's name.
 * @param {string} body What connecting gives.
 * @param {() => void} done Called once connected.
 */
function connectCard(host, provider, name, body, done) {
  host.insertAdjacentHTML(
    'beforeend',
    `<div class="plan-card"><b>Connect ${name}</b><p class="hint">${body}</p><div class="row"><button class="btn action" type="button" data-connect>Connect ${name}</button><span class="state" data-connect-state></span></div></div>`,
  );
  const card = host.lastElementChild;
  const state = card.querySelector('[data-connect-state]');
  card.querySelector('[data-connect]').addEventListener('click', async (event) => {
    const access = requestAccess(provider);
    const button = event.currentTarget;
    button.disabled = true;
    state.textContent = `Waiting for ${name} sign-in`;
    try {
      if (!(await access)) throw new Error(`Margin needs permission to reach ${name}. Choose Allow to connect.`);
      await connect(provider);
      done();
    } catch (err) {
      state.textContent = err.message;
      button.disabled = false;
    }
  });
}

/**
 * Wires the Send to Jira and Send to Figma dialogs of the report.
 * @param {object} context What the report is showing.
 * @param {object[]} context.ordered The comments in report order.
 * @param {(issue: object) => number} context.numberOf Each comment's number in the report.
 * @param {object | null} context.group The review, or null for every review.
 * @param {{ shots: 'both' | 'detail' | 'viewport' }} context.options The report settings, read at send time.
 * @param {string} context.reviewTitle The name of the review.
 * @param {(type: string, payload?: object) => Promise<any>} context.send Messages the background.
 * @param {() => void} context.onChange Redraws the report after comments gain a Jira key or a Figma post.
 */
export function wireSend({ ordered, numberOf, group, options, reviewTitle, send, onChange }) {
  const label = (issue) => `${pad(numberOf(issue))} ${issue.title || 'Untitled comment'}`;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  /* Jira ----------------------------------------------------------------- */

  const jiraDialog = document.querySelector('[data-jira-dialog]');
  const jiraBody = jiraDialog.querySelector('[data-jira-body]');
  const jiraAccount = jiraDialog.querySelector('[data-jira-account]');
  const jiraState = jiraDialog.querySelector('[data-jira-state]');
  const jiraGo = jiraDialog.querySelector('[data-jira-go]');
  const jiraClose = jiraDialog.querySelector('[data-jira-close]');
  let jiraRun = null;
  let jiraBusy = false;

  /**
   * Locks the Jira dialog while issues are being created, so it cannot close half way.
   * @param {boolean} busy True while a run is going.
   */
  function setJiraBusy(busy) {
    jiraBusy = busy;
    jiraClose.disabled = busy;
    jiraGo.disabled = busy;
    jiraGo.classList.toggle('busy', busy);
  }

  const jiraMode = () => jiraBody.querySelector('[name="jira-mode"]:checked')?.value ?? 'each';

  /** Opens the Jira dialog in the right view for the current sign-in. */
  async function openJira() {
    jiraState.textContent = '';
    jiraBody.innerHTML = '';
    jiraGo.hidden = false;
    jiraGo.disabled = false;
    const current = await connection('jira');
    if (current?.sites?.length) await connectedJira(current);
    else await linkJira();
    if (!jiraDialog.open) jiraDialog.showModal();
  }

  /**
   * The full send: pick a site, project and issue type, then create the issues through the API.
   * @param {object} current The stored Jira connection.
   */
  async function connectedJira(current) {
    const who = current.account?.name || current.account?.email || 'your Atlassian account';
    jiraAccount.textContent = `Connected as ${who}`;
    const choice = (await chrome.storage.local.get(CHOICE_KEY))[CHOICE_KEY] ?? {};
    const pending = ordered.filter((issue) => !issue.jira?.key);
    const linkedCount = ordered.length - pending.length;
    const ticket = group?.jira?.key ?? null;
    const ticketSite = ticket ? current.sites.find((s) => sameOrigin(s.url, group.jira.url)) : null;
    jiraBody.innerHTML = `
      ${ticket ? `<p class="hint">This review is linked to <b>${esc(ticket)}</b>${group.jira.summary ? ` ${esc(group.jira.summary)}` : ''}. A change here applies to this send only.</p>` : ''}
      <div class="grid-3">
        <div class="field"><label for="jira-site">Site</label><select id="jira-site" data-site></select></div>
        <div class="field"><label for="jira-project">Project</label><select id="jira-project" data-project></select></div>
        <div class="field"><label for="jira-type">Issue type</label><select id="jira-type" data-type></select></div>
      </div>
      ${modePicks(pending.length, ticket ? 'each' : choice.mode, ticket)}
      <p class="hint">Severity sets the priority, the numbered marker notes become a numbered list, and the screenshots are attached.${
        linkedCount ? ` ${plural(linkedCount, 'comment already has', 'comments already have')} an issue and ${linkedCount === 1 ? 'is' : 'are'} left out of one issue per comment.` : ''
      }</p>
      <div class="field" data-results hidden></div>`;
    const siteEl = jiraBody.querySelector('[data-site]');
    const projectEl = jiraBody.querySelector('[data-project]');
    const typeEl = jiraBody.querySelector('[data-type]');
    let projects = [];
    fill(siteEl, current.sites, ticketSite?.id ?? choice.siteId);

    const paintTypes = () => fillTypes(typeEl, projects, projectEl.value, choice.typeId);
    const loadProjects = async () => {
      projectEl.innerHTML = '<option>Loading</option>';
      typeEl.innerHTML = '';
      jiraGo.disabled = true;
      try {
        projects = await listProjects(siteEl.value);
        const ticketProject = ticket && siteEl.value === ticketSite?.id ? projects.find((p) => p.key === ticket.split('-')[0]) : null;
        fill(projectEl, projects.map((p) => ({ id: p.id, name: `${p.name} (${p.key})` })), ticketProject?.id ?? choice.projectId);
        paintTypes();
        jiraGo.disabled = !projects.length;
        jiraState.textContent = projects.length ? '' : 'This site has no projects you can create issues in.';
      } catch (err) {
        projectEl.innerHTML = '';
        jiraState.textContent = err.message;
      }
    };
    const paintGo = () => {
      const mode = jiraMode();
      const count = mode === 'each' ? pending.length : 1;
      jiraGo.textContent = mode === 'ticket' ? `Comment on ${ticket}` : mode === 'each' ? `Create ${plural(count, 'issue', 'issues')}` : 'Create 1 issue';
      jiraGo.hidden = !count;
      jiraState.textContent = count ? jiraState.textContent : 'Every comment already has a Jira issue.';
    };
    siteEl.addEventListener('change', loadProjects);
    projectEl.addEventListener('change', paintTypes);
    jiraBody.querySelectorAll('[name="jira-mode"]').forEach((radio) => radio.addEventListener('change', paintGo));
    jiraGo.hidden = false;
    jiraRun = () => (jiraMode() === 'ticket' ? runTicketComment(current) : runJira({ siteEl, projectEl, typeEl, current }));
    await loadProjects();
    paintGo();
  }

  /**
   * Posts the whole review as one comment on the linked ticket, with the screenshots attached to it.
   * @param {object} current The stored Jira connection.
   */
  async function runTicketComment(current) {
    const key = group.jira.key;
    const site = current.sites.find((s) => sameOrigin(s.url, group.jira.url)) ?? current.sites[0];
    const resultsEl = jiraBody.querySelector('[data-results]');
    setJiraBusy(true);
    jiraState.textContent = `Commenting on ${key}. Keep this open until it finishes.`;
    resultsEl.hidden = false;
    try {
      const result = await commentOnTicket({ site, key, issues: ordered, shots: options.shots, reviewTitle, numberOf });
      resultsEl.innerHTML = `<div class="plan-card"><b><a href="${esc(result.url)}" target="_blank" rel="noopener">${esc(key)}</a> has the review as a comment</b>${
        result.warning ? `<p class="hint">${esc(result.warning)}</p>` : ''
      }</div>`;
      jiraState.textContent = 'Comment added';
      jiraGo.hidden = true;
    } catch (err) {
      resultsEl.innerHTML = `<div class="plan-card plan-block"><b>The comment was not added to ${esc(key)}</b><p class="hint">${esc(err.message)}</p></div>`;
      jiraState.textContent = '';
    } finally {
      setJiraBusy(false);
    }
  }

  /**
   * Creates the issues, shows each result, and links the comments or the review to what was created.
   * @param {object} els The dialog's selects and the stored connection.
   */
  async function runJira({ siteEl, projectEl, typeEl, current }) {
    const mode = jiraMode();
    const issues = mode === 'review' ? ordered : ordered.filter((issue) => !issue.jira?.key);
    if (!issues.length) {
      jiraState.textContent = 'Every comment already has a Jira issue.';
      return;
    }
    await chrome.storage.local.set({
      [CHOICE_KEY]: { siteId: siteEl.value, projectId: projectEl.value, typeId: typeEl.value, mode },
    });
    const site = current.sites.find((s) => s.id === siteEl.value);
    const resultsEl = jiraBody.querySelector('[data-results]');
    setJiraBusy(true);
    jiraGo.textContent = 'Creating';
    jiraState.textContent = 'Creating. Keep this open until it finishes.';
    let results;
    try {
      results = await createIssues({
        site,
        projectId: projectEl.value,
        issueTypeId: typeEl.value,
        issues,
        mode,
        shots: options.shots,
        reviewTitle,
        numberOf,
        linkTo: mode === 'each' ? group?.jira?.key : undefined,
        onProgress: (done, total) => {
          jiraState.textContent = `Created ${done} of ${total}. Keep this open until it finishes.`;
        },
      });
    } catch (err) {
      jiraState.textContent = err.message;
      setJiraBusy(false);
      jiraGo.textContent = 'Create issues';
      return;
    }
    for (const result of results.filter((r) => r.key)) {
      const jira = { key: result.key, url: result.url };
      if (mode === 'review') {
        if (group) await patchGroup(group.id, { jira: { ...group.jira, ...jira } });
      } else {
        await send('update', { id: result.issues[0].id, patch: { jira } });
        result.issues[0].jira = jira;
      }
    }
    if (results.some((r) => r.key)) onChange();
    resultsEl.hidden = false;
    resultsEl.innerHTML = results
      .map((r) =>
        r.key
          ? `<div class="plan-card"><b><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.key)}</a> ${esc(mode === 'review' ? reviewTitle : label(r.issues[0]))}</b>${
              r.warning ? `<p class="hint">${esc(r.warning)}</p>` : ''
            }</div>`
          : `<div class="plan-card plan-block"><b>${esc(r.issues[0] ? label(r.issues[0]) : 'Untitled comment')}</b><p class="hint">${esc(r.error)}</p></div>`,
      )
      .join('');
    const made = results.filter((r) => r.key).length;
    jiraState.textContent = made === results.length ? `Created ${plural(made, 'issue', 'issues')}` : `${made} of ${results.length} created`;
    setJiraBusy(false);
    jiraGo.textContent = 'Try the rest again';
    jiraGo.hidden = made === results.length;
  }

  /** The no sign-in path: Jira's own create form, filled in, plus the offer to connect. */
  async function linkJira() {
    jiraAccount.textContent = 'Not connected';
    jiraBody.innerHTML = '';
    connectCard(jiraBody, 'jira', 'Jira', 'Margin creates the issues for you, sets the priority from the severity and attaches the screenshots. It takes one sign-in.', openJira);
    jiraBody.insertAdjacentHTML(
      'beforeend',
      `<div class="plan-heading">Or use Jira's create form, no sign-in</div>
      <p class="hint">Jira opens with the summary and description filled in. Check it and press Create there. Screenshots stay in the Margin report.</p>
      <div class="grid-3">
        <div class="field"><label for="jira-site-input">Jira site</label><input id="jira-site-input" type="text" data-site-input placeholder="yourteam.atlassian.net" /></div>
        <div class="field" data-project-field hidden><label for="jira-link-project">Project</label><select id="jira-link-project" data-project></select></div>
        <div class="field" data-type-field hidden><label for="jira-link-type">Issue type</label><select id="jira-link-type" data-type></select></div>
      </div>
      <div class="row"><button class="btn sm" type="button" data-find-site>Find my site</button><span class="state" data-site-state></span></div>
      ${modePicks(ordered.length, 'each')}
      <div class="field" data-link-list></div>`,
    );
    const input = jiraBody.querySelector('[data-site-input]');
    const projectEl = jiraBody.querySelector('[data-project]');
    const typeEl = jiraBody.querySelector('[data-type]');
    const siteState = jiraBody.querySelector('[data-site-state]');
    const list = jiraBody.querySelector('[data-link-list]');
    let projects = [];

    const paintTypes = () => fillTypes(typeEl, projects, projectEl.value);
    projectEl.addEventListener('change', paintTypes);

    /** Uses the browser's own Jira sign-in, when Margin may reach the site, to offer the site's projects. */
    const loadProjects = async () => {
      const site = siteOrigin(input.value);
      projects = site && (await chrome.permissions.contains(SITES_PERMISSION)) ? (await sessionProjects(site)) ?? [] : [];
      jiraBody.querySelector('[data-project-field]').hidden = !projects.length;
      jiraBody.querySelector('[data-type-field]').hidden = !projects.length;
      if (projects.length) {
        fill(projectEl, projects.map((p) => ({ id: p.id, name: `${p.name} (${p.key})` })), projects.find((p) => p.key === group?.jira?.key?.split('-')[0])?.id);
        paintTypes();
      }
    };

    /** Lists a create button per comment, or one for the review. */
    const paintLinks = () => {
      const review = jiraMode() === 'review';
      jiraGo.hidden = !review;
      jiraGo.textContent = 'Open in Jira';
      list.innerHTML = review
        ? ''
        : ordered
            .map(
              (issue, i) => `<div class="row"><button class="btn sm" type="button" data-open-one="${i}">Open in Jira</button><span class="hint">${pad(numberOf(issue))}</span><b>${esc(
                issue.title || 'Untitled comment',
              )}</b>${issue.jira?.key ? `<span class="tag">${esc(issue.jira.key)}</span>` : ''}</div>`,
            )
            .join('');
    };

    /**
     * Opens Jira's create form for some comments in a new tab.
     * @param {object[]} issues The comments.
     */
    const openForm = async (issues) => {
      const site = siteOrigin(input.value);
      if (!site) {
        siteState.textContent = 'Type your Jira site, like yourteam.atlassian.net.';
        input.focus();
        return;
      }
      await chrome.storage.local.set({ [SITE_KEY]: site });
      const url = createLink(site, { ...linkFields(issues, reviewTitle, numberOf), projectId: projectEl.value || undefined, issueTypeId: typeEl.value || undefined });
      chrome.tabs.create({ url });
    };

    jiraBody.querySelectorAll('[name="jira-mode"]').forEach((radio) => radio.addEventListener('change', paintLinks));
    list.addEventListener('click', (event) => {
      const button = event.target.closest('[data-open-one]');
      if (button) openForm([ordered[Number(button.dataset.openOne)]]);
    });
    input.addEventListener('change', () => {
      siteState.textContent = '';
      loadProjects();
    });
    jiraBody.querySelector('[data-find-site]').addEventListener('click', async () => {
      const granted = await chrome.permissions.request(SITES_PERMISSION);
      if (!granted) {
        siteState.textContent = 'Type your Jira site instead.';
        return;
      }
      const sites = await openSites();
      if (sites.length) input.value = new URL(sites[0]).host;
      siteState.textContent = sites.length ? `Found ${new URL(sites[0]).host}` : 'Open your Jira site in a tab, or type it here.';
      await loadProjects();
    });
    jiraRun = () => openForm(ordered);

    const linked = siteOrigin(group?.jira?.url);
    const stored = linked ?? (await chrome.storage.local.get(SITE_KEY))[SITE_KEY];
    const found = !stored && (await chrome.permissions.contains(SITES_PERMISSION)) ? (await openSites())[0] : null;
    if (stored || found) input.value = new URL(stored || found).host;
    paintLinks();
    await loadProjects();
  }

  jiraGo.addEventListener('click', () => jiraRun?.());
  jiraClose.addEventListener('click', () => jiraDialog.close());
  jiraDialog.addEventListener('cancel', (event) => {
    if (jiraBusy) event.preventDefault();
  });
  document.querySelector('[data-send-jira]').addEventListener('click', () => {
    document.querySelector('.menu:not(.review-menu)').open = false;
    openJira();
  });

  /* Figma ---------------------------------------------------------------- */

  const figmaDialog = document.querySelector('[data-figma-dialog]');
  const figmaBody = figmaDialog.querySelector('[data-figma-body]');
  const figmaAccount = figmaDialog.querySelector('[data-figma-account]');
  const figmaState = figmaDialog.querySelector('[data-figma-state]');
  const figmaGo = figmaDialog.querySelector('[data-figma-go]');

  /** Opens the Figma dialog: the connect card, or every comment with a Figma link and where it will be posted. */
  async function openFigma() {
    figmaState.textContent = '';
    figmaBody.innerHTML = '';
    const current = await connection('figma');
    figmaGo.hidden = !current;
    if (!current) {
      figmaAccount.textContent = 'Not connected';
      connectCard(figmaBody, 'figma', 'Figma', 'Margin posts each comment on the frame its Figma link points at, with the numbered marker notes as a list. It takes one sign-in.', openFigma);
    } else {
      figmaAccount.textContent = `Connected as ${current.account?.name || current.account?.email || 'your Figma account'}`;
      paintFigma();
    }
    if (!figmaDialog.open) figmaDialog.showModal();
  }

  const linkedFile = group?.figma?.fileKey ? group.figma : null;
  const framePicks = new Map();

  /**
   * The name of a frame in the review's linked file, or its id when the file does not list it.
   * @param {{ fileKey: string, nodeId: string }} target Where a comment posts.
   */
  function frameName(target) {
    const frame = linkedFile?.fileKey === target.fileKey ? linkedFile.frames?.find((f) => f.id === target.nodeId) : null;
    return frame ? frame.name : `Frame ${target.nodeId}`;
  }

  const postedNow = new Set();
  const openPickers = new Set();

  /**
   * The frames a comment posts to: its own Figma frame links, or the frame picked here from the review's linked file.
   * @param {object} issue The comment.
   * @param {number} i Its place in the report.
   */
  function targetsFor(issue, i) {
    const own = figmaTargets(issue).targets;
    if (own.length || !framePicks.has(i)) return own;
    return [{ fileKey: linkedFile.fileKey, nodeId: framePicks.get(i), url: linkedFile.url }];
  }

  /**
   * A frame picker over the review's linked file, grouped by page.
   * @param {number} i The comment's place in the report.
   */
  function framePicker(i) {
    const pages = [...new Set(linkedFile.frames.map((frame) => frame.page))];
    const open = openPickers.has(i) || framePicks.has(i);
    return `<button class="text-link" type="button" data-show-picker="${i}"${open ? ' hidden' : ''}>Pick a frame</button><select data-frame="${i}" aria-label="Pick a frame for comment ${pad(numberOf(ordered[i]))}"${open ? '' : ' hidden'}><option value="">Pick a frame</option>${pages
      .map(
        (page) =>
          `<optgroup label="${esc(page)}">${linkedFile.frames
            .filter((frame) => frame.page === page)
            .map((frame) => `<option value="${esc(frame.id)}"${framePicks.get(i) === frame.id ? ' selected' : ''}>${esc(frame.name)}</option>`)
            .join('')}</optgroup>`,
      )
      .join('')}</select>`;
  }

  /** Counts the ticked comments that have somewhere to post, and names the count on the button. */
  function paintFigmaGo() {
    const ready = [...figmaBody.querySelectorAll('[data-post]:checked')].filter((box) => targetsFor(ordered[Number(box.dataset.post)], Number(box.dataset.post)).length).length;
    figmaGo.disabled = !ready;
    figmaGo.textContent = ready ? `Post ${ready} ${ready === 1 ? 'comment' : 'comments'}` : 'Post comments';
  }

  /**
   * Lists the comments that carry Figma links, ticked unless already posted, and says which links are skipped.
   * When the review links a Figma file, comments without a frame can pick one from it for this send.
   */
  function paintFigma() {
    const picking = Boolean(linkedFile?.frames?.length);
    const linked = ordered
      .map((issue, i) => ({ issue, i, ...figmaTargets(issue) }))
      .filter((row) => picking || row.targets.length || row.skipped.length);
    const without = ordered.length - linked.length;
    const context = linkedFile
      ? `<p class="hint">Posting to <b>${esc(linkedFile.name || 'the linked Figma file')}</b>${picking ? '. Comments without a frame can pick one here, for this send only.' : '.'}</p>`
      : '';
    figmaBody.innerHTML = linked.length
      ? `${context}${linked
          .map(({ issue, i, targets, skipped }) => {
            const posted = Boolean(issue.figmaPosts?.length);
            const ready = targetsFor(issue, i).length > 0;
            return `<div class="plan-card"${ready ? '' : ' data-skip'}>
              <label class="pick"><input type="checkbox" data-post="${i}"${ready && !posted ? ' checked' : ''}${ready ? '' : ' disabled'} /><b>${esc(label(issue))}</b></label>
              <div class="plan-meta">${targets.map((t) => `<span class="tag">${esc(frameName(t))}</span>`).join('')}${!targets.length && picking ? framePicker(i) : ''}${
                postedNow.has(issue.id)
                  ? `<span class="tag tone-done">Posted just now</span>${(issue.figmaPosts ?? []).slice(-1).map((p) => `<a class="text-link" href="${esc(`https://www.figma.com/design/${p.fileKey}?node-id=${String(p.nodeId).replace(':', '-')}#${p.commentId}`)}" target="_blank" rel="noopener">Open in Figma</a>`).join('')}`
                  : posted
                    ? '<span class="tag">Posted before</span>'
                    : ''
              }</div>
              ${skipped.map((s) => `<p class="hint">Skipped ${esc(s.url)}. ${s.reason === 'no-node' ? 'This link has no frame in it. In Figma, right-click the frame and choose Copy link to selection.' : 'This is not a Figma file link.'}</p>`).join('')}
            </div>`;
          })
          .join('')}${without ? `<p class="hint">${without} ${without === 1 ? 'comment has' : 'comments have'} no Figma link and ${without === 1 ? 'is' : 'are'} left out.</p>` : ''}`
      : `${context}<p class="hint">No comment in this review has a Figma link. Add one in Edit comments, then send again.</p>`;
    paintFigmaGo();
  }

  figmaBody.addEventListener('click', (event) => {
    const show = event.target.closest('[data-show-picker]');
    if (!show) return;
    const i = Number(show.dataset.showPicker);
    openPickers.add(i);
    show.hidden = true;
    const select = figmaBody.querySelector(`[data-frame="${i}"]`);
    select.hidden = false;
    select.focus();
  });

  figmaBody.addEventListener('change', (event) => {
    const select = event.target.closest('[data-frame]');
    if (select) {
      const i = Number(select.dataset.frame);
      if (select.value) framePicks.set(i, select.value);
      else framePicks.delete(i);
      const box = figmaBody.querySelector(`[data-post="${i}"]`);
      box.disabled = !select.value;
      box.checked = Boolean(select.value);
    }
    paintFigmaGo();
  });

  /** Posts every ticked comment to each frame it links to and records what was posted. */
  async function runFigma() {
    const picked = [...figmaBody.querySelectorAll('[data-post]:checked')].map((box) => Number(box.dataset.post));
    figmaGo.disabled = true;
    postedNow.clear();
    let posted = 0;
    const failures = [];
    for (const i of picked) {
      const issue = ordered[i];
      const message = figmaMessage(issue);
      const posts = [...(issue.figmaPosts ?? [])];
      for (const target of targetsFor(issue, i)) {
        try {
          const id = await postComment(target, message);
          posts.push({ fileKey: target.fileKey, nodeId: target.nodeId, commentId: id, at: new Date().toISOString() });
          postedNow.add(issue.id);
          posted += 1;
        } catch (err) {
          failures.push(`${label(issue)}. ${err.message}`);
        }
        figmaState.textContent = `Posted ${posted}`;
      }
      if (posts.length !== (issue.figmaPosts ?? []).length) {
        issue.figmaPosts = posts;
        await send('update', { id: issue.id, patch: { figmaPosts: posts } });
      }
    }
    paintFigma();
    if (failures.length) {
      figmaBody.insertAdjacentHTML('afterbegin', `<div class="plan-card plan-block"><b>Some comments did not post</b>${failures.map((f) => `<p class="hint">${esc(f)}</p>`).join('')}</div>`);
    }
    figmaState.textContent = `Posted ${posted} ${posted === 1 ? 'comment' : 'comments'} to Figma`;
  }

  figmaGo.addEventListener('click', runFigma);
  figmaDialog.querySelector('[data-figma-close]').addEventListener('click', () => figmaDialog.close());
  document.querySelector('[data-send-figma]').addEventListener('click', () => {
    document.querySelector('.menu:not(.review-menu)').open = false;
    openFigma();
  });

}
