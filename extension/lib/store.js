const KEY = 'issues';
const GROUPS_KEY = 'groups';
const ACTIVE_KEY = 'activeGroupId';
const VERSION_KEY = 'storeVersion';
const MIGRATION_KEY = 'storeMigration';
const STORE_VERSION = 2;
const MIGRATION_BATCH_BYTES = 16 * 1024 * 1024;

/**
 * The fields of a comment that hold images. They live under the comment's own `img:<id>` key, never in the issue list,
 * so reading or saving the list stays small however many screenshots a review holds.
 */
const IMAGE_FIELDS = ['shot', 'detail', 'after', 'shots'];

/**
 * The key a comment's images are stored under.
 * @param {string} id The comment id.
 */
const imgKey = (id) => `img:${id}`;

/**
 * The clean screenshot a comment's images are redrawn from. Kept outside the issue list so list reads stay small.
 * @param {string} id The comment id.
 */
const rawKey = (id) => `raw:${id}`;

let chain = Promise.resolve();

/**
 * Runs a read, change and write of stored comments after every one already queued in this page or worker,
 * so two saves never read the same list and the second never overwrites the first.
 * @template T
 * @param {() => Promise<T>} task The step to run.
 * @returns {Promise<T>}
 */
function queued(task) {
  const run = chain.then(task, task);
  chain = run.catch(() => {});
  return run;
}

/**
 * Splits a comment or a patch into its small fields and its image fields.
 * @param {object} record A comment or a patch.
 */
function splitImages(record) {
  const fields = {};
  const images = {};
  for (const [key, value] of Object.entries(record)) {
    if (IMAGE_FIELDS.includes(key)) images[key] = value;
    else fields[key] = value;
  }
  return { fields, images };
}

/**
 * True when a stored comment still carries image fields inside the list, as comments saved before the split do.
 * @param {object} issue A comment from the list.
 */
const holdsImages = (issue) => IMAGE_FIELDS.some((field) => field in issue);

/**
 * True when an image set holds at least one image.
 * @param {object} images Image fields by name.
 */
const hasImages = (images) => Object.values(images).some((value) => value != null);

/**
 * Rough size of an image set in bytes, used to keep migration batches bounded.
 * @param {object} images Image fields by name.
 */
function imageBytes(images) {
  let bytes = 0;
  for (const value of Object.values(images)) {
    if (typeof value === 'string') bytes += value.length;
    else if (value && typeof value === 'object') for (const shot of Object.values(value)) bytes += shot?.src?.length ?? 0;
  }
  return bytes;
}

/** Reads every stored issue, oldest first, without images. */
export async function readIssues() {
  const bag = await chrome.storage.local.get(KEY);
  return Array.isArray(bag[KEY]) ? bag[KEY] : [];
}

/**
 * Stores the issue list as given.
 * @param {object[]} issues Comments without image fields.
 */
async function saveList(issues) {
  await chrome.storage.local.set({ [KEY]: issues });
}

/**
 * Merges image fields into what is stored for each comment, in one read and one write.
 * A field set to null is kept as null, so a removed image is never brought back from an older copy.
 * The key is removed when nothing but nulls would be left.
 * @param {{ id: string, images: object }[]} entries Each comment's id and its image fields.
 * @param {boolean} keepStored True to let images already stored win over the given ones, as when moving old inline images out.
 */
async function putImages(entries, keepStored) {
  if (!entries.length) return;
  const stored = await chrome.storage.local.get(entries.map((entry) => imgKey(entry.id)));
  const write = {};
  const drop = [];
  for (const { id, images } of entries) {
    const before = stored[imgKey(id)] ?? {};
    const merged = keepStored ? { ...images, ...before } : { ...before, ...images };
    if (hasImages(merged)) write[imgKey(id)] = merged;
    else drop.push(imgKey(id));
  }
  if (Object.keys(write).length) await chrome.storage.local.set(write);
  if (drop.length) await chrome.storage.local.remove(drop);
}

/**
 * Reads one comment's images: shot, detail, after and the width shots, whichever it has.
 * @param {string} id The comment id.
 * @returns {Promise<object>} The image fields, or an empty object.
 */
export async function readImages(id) {
  return (await chrome.storage.local.get(imgKey(id)))[imgKey(id)] ?? {};
}

/**
 * Merges image fields into one comment's stored images. A field set to null removes that image.
 * @param {string} id The comment id.
 * @param {object} patch Image fields to change.
 */
export async function writeImages(id, patch) {
  await queued(() => putImages([{ id, images: patch }], false));
}

/**
 * Returns copies of comments with their images added back, for pages that render them. One storage read covers them all.
 * Images stored under the comment's key win over any older copy still inside the list.
 * @param {object[]} issues Comments as read from the list.
 */
export async function hydrate(issues) {
  if (!issues.length) return [];
  const bag = await chrome.storage.local.get(issues.map((issue) => imgKey(issue.id)));
  return issues.map((issue) => ({ ...issue, ...(bag[imgKey(issue.id)] ?? {}) }));
}

/**
 * Replaces the whole issue list. Images found on any entry move to that comment's image key,
 * without replacing images already stored there.
 * @param {object[]} issues The comments to store.
 */
export async function writeIssues(issues) {
  await queued(async () => {
    const parts = issues.map((issue) => ({ id: issue.id, ...splitImages(issue) }));
    await putImages(parts.filter((part) => hasImages(part.images)), true);
    await saveList(parts.map((part) => part.fields));
  });
}

/**
 * Appends one issue record, storing its images under its own key first.
 * @param {object} issue The new comment, which may carry images.
 */
export async function addIssue(issue) {
  return queued(async () => {
    const { fields, images } = splitImages(issue);
    if (hasImages(images)) await putImages([{ id: issue.id, images }], false);
    await saveList([...(await readIssues()), fields]);
    return issue;
  });
}

/**
 * Merges `patch` into the issue with the given id. Image fields go to the comment's image key and the list is only
 * rewritten when a small field changed. Returns the updated record with the patched images, or null when it is gone.
 * @param {string} id The comment id.
 * @param {object} patch Fields to change.
 */
export async function patchIssue(id, patch) {
  return queued(async () => {
    const issues = await readIssues();
    const found = issues.find((i) => i.id === id);
    if (!found) return null;
    const { fields, images } = splitImages(patch);
    if (Object.keys(images).length) await putImages([{ id, images }], false);
    if (Object.keys(fields).length) {
      Object.assign(found, fields);
      await saveList(issues);
    }
    return { ...found, ...images };
  });
}

/**
 * Drops one issue by id, with its images and clean screenshot.
 * @param {string} id The comment id.
 */
export async function removeIssue(id) {
  await queued(async () => {
    await saveList((await readIssues()).filter((i) => i.id !== id));
    await chrome.storage.local.remove([imgKey(id), rawKey(id)]);
  });
}

/** Drops every issue, with their images and clean screenshots. */
export async function clearIssues() {
  await queued(async () => {
    const issues = await readIssues();
    await saveList([]);
    await chrome.storage.local.remove(issues.flatMap((issue) => [imgKey(issue.id), rawKey(issue.id)]));
  });
}

/**
 * Reads a comment's clean screenshot, as `{ src, hasBox }`, or null when it has none.
 * `hasBox` is true for comments captured before clean screenshots were kept, whose base already shows the region outline.
 * @param {string} id The comment id.
 */
export async function readRaw(id) {
  return (await chrome.storage.local.get(rawKey(id)))[rawKey(id)] ?? null;
}

/**
 * Stores a comment's clean screenshot.
 * @param {string} id The comment id.
 * @param {{ src: string, hasBox: boolean }} raw The screenshot data URL and whether the region is burned into it.
 */
export async function writeRaw(id, raw) {
  await chrome.storage.local.set({ [rawKey(id)]: raw });
}

/**
 * Moves images out of the issue list into one `img:<id>` key per comment, for stores written before images were split out.
 * Works in batches of about MIGRATION_BATCH_BYTES. Each batch reads the list afresh, writes its comments' image keys,
 * and then saves the list without those images, so only one copy of the list is held at a time and a stop part way
 * loses nothing. The next start resumes with whatever is still inline, and images already moved win over the inline copy.
 * The store is marked done only after a check finds no inline images and an image key for every comment that had them.
 * @param {(line: string) => void} [log] Where progress lines go.
 * @returns {Promise<boolean>} True once the store is in the current shape.
 */
export async function migrateImages(log = (line) => console.log(line)) {
  const state = await chrome.storage.local.get([VERSION_KEY, MIGRATION_KEY]);
  if (state[VERSION_KEY] === STORE_VERSION) return true;
  const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;
  const resumed = Boolean(state[MIGRATION_KEY]);
  if (resumed) log(`Margin: resuming the image migration started ${state[MIGRATION_KEY].startedAt}`);

  const withImages = new Set();
  let moved = 0;
  let movedBytes = 0;
  let startCount = null;
  for (;;) {
    const step = await queued(async () => {
      const issues = await readIssues();
      const batch = [];
      let bytes = 0;
      for (const issue of issues.filter(holdsImages)) {
        const { images } = splitImages(issue);
        const size = imageBytes(images);
        if (batch.length && bytes + size > MIGRATION_BATCH_BYTES) break;
        batch.push({ id: issue.id, images });
        bytes += size;
      }
      if (!batch.length) return { done: true, total: issues.length };
      if (!resumed && !moved) {
        log(`Margin: moving images out of the comment list, ${issues.length} comments`);
        await chrome.storage.local.set({ [MIGRATION_KEY]: { startedAt: new Date().toISOString() } });
      }
      const filled = batch.filter((entry) => hasImages(entry.images));
      await putImages(filled, true);
      const ids = new Set(batch.map((entry) => entry.id));
      await saveList(issues.map((issue) => (ids.has(issue.id) ? splitImages(issue).fields : issue)));
      filled.forEach((entry) => withImages.add(entry.id));
      const left = issues.filter((issue) => !ids.has(issue.id) && holdsImages(issue)).length;
      return { done: false, total: issues.length, count: batch.length, bytes, left };
    });
    startCount ??= step.total;
    if (step.done) break;
    moved += step.count;
    movedBytes += step.bytes;
    log(`Margin: moved images for ${moved} comments, ${mb(movedBytes)} so far, ${step.left} of ${step.total} comments still to move`);
  }

  if (!resumed && !moved) {
    await chrome.storage.local.set({ [VERSION_KEY]: STORE_VERSION });
    return true;
  }
  const issues = await readIssues();
  const inline = issues.filter(holdsImages).length;
  const sizes = await Promise.all([...withImages].map((id) => chrome.storage.local.getBytesInUse(imgKey(id))));
  const missing = sizes.filter((bytes) => !bytes).length;
  if (inline || missing) {
    log(`Margin: image migration check failed, ${inline} comments still hold images and ${missing} image keys are missing. It will run again on the next start.`);
    return false;
  }
  await chrome.storage.local.set({ [VERSION_KEY]: STORE_VERSION });
  await chrome.storage.local.remove(MIGRATION_KEY);
  log(`Margin: image migration done, ${startCount} comments before and ${issues.length} after, ${withImages.size} image keys written this run, list now ${mb(await chrome.storage.local.getBytesInUse(KEY))}`);
  return true;
}

/** Review groups group the comments captured in one sitting. */
export async function readGroups() {
  const bag = await chrome.storage.local.get(GROUPS_KEY);
  return Array.isArray(bag[GROUPS_KEY]) ? bag[GROUPS_KEY] : [];
}

async function writeGroups(groups) {
  await chrome.storage.local.set({ [GROUPS_KEY]: groups });
}

/** Creates a group and makes it the one new captures land in. */
export async function addGroup(name) {
  const group = {
    id: crypto.randomUUID(),
    name: name?.trim() || `Review ${new Date().toLocaleDateString()}`,
    createdAt: new Date().toISOString(),
  };
  await writeGroups([...(await readGroups()), group]);
  await chrome.storage.local.set({ [ACTIVE_KEY]: group.id });
  return group;
}

export async function patchGroup(id, patch) {
  const groups = await readGroups();
  const found = groups.find((s) => s.id === id);
  if (!found) return null;
  Object.assign(found, patch);
  await writeGroups(groups);
  return found;
}

/** Removes a group together with the comments captured in it, their images and clean screenshots. */
export async function removeGroup(id) {
  await writeGroups((await readGroups()).filter((s) => s.id !== id));
  await queued(async () => {
    const issues = await readIssues();
    await saveList(issues.filter((issue) => issue.groupId !== id));
    await chrome.storage.local.remove(issues.filter((issue) => issue.groupId === id).flatMap((issue) => [imgKey(issue.id), rawKey(issue.id)]));
  });
  const active = (await chrome.storage.local.get(ACTIVE_KEY))[ACTIVE_KEY];
  if (active === id) await chrome.storage.local.remove(ACTIVE_KEY);
}

export async function setActiveGroup(id) {
  await chrome.storage.local.set({ [ACTIVE_KEY]: id });
}

/** The group new captures belong to, created on first use. */
export async function activeGroup() {
  const groups = await readGroups();
  const active = (await chrome.storage.local.get(ACTIVE_KEY))[ACTIVE_KEY];
  return groups.find((s) => s.id === active) ?? groups.at(-1) ?? addGroup();
}

/** Issues captured in one group, or every issue when no id is given, without images. */
export async function issuesInGroup(groupId) {
  const issues = await readIssues();
  return groupId ? issues.filter((issue) => issue.groupId === groupId) : issues;
}
