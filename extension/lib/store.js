const KEY = 'issues';
const GROUPS_KEY = 'groups';
const ACTIVE_KEY = 'activeGroupId';

/** Reads every stored issue, oldest first. */
export async function readIssues() {
  const bag = await chrome.storage.local.get(KEY);
  return Array.isArray(bag[KEY]) ? bag[KEY] : [];
}

/** Replaces the whole issue list. */
export async function writeIssues(issues) {
  await chrome.storage.local.set({ [KEY]: issues });
}

/** Appends one issue record. */
export async function addIssue(issue) {
  const issues = await readIssues();
  issues.push(issue);
  await writeIssues(issues);
  return issue;
}

/** Merges `patch` into the issue with the given id. Returns the updated record. */
export async function patchIssue(id, patch) {
  const issues = await readIssues();
  const found = issues.find((i) => i.id === id);
  if (!found) return null;
  Object.assign(found, patch);
  await writeIssues(issues);
  return found;
}

/** Drops one issue by id. */
export async function removeIssue(id) {
  const issues = await readIssues();
  await writeIssues(issues.filter((i) => i.id !== id));
  await chrome.storage.local.remove(rawKey(id));
}

/** Drops every issue. */
export async function clearIssues() {
  const issues = await readIssues();
  await writeIssues([]);
  await chrome.storage.local.remove(issues.map((issue) => rawKey(issue.id)));
}

/**
 * The clean screenshot a comment's images are redrawn from. Kept outside the issue list so list reads stay small.
 * @param {string} id The comment id.
 */
const rawKey = (id) => `raw:${id}`;

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

/** Removes a group together with the comments captured in it. */
export async function removeGroup(id) {
  await writeGroups((await readGroups()).filter((s) => s.id !== id));
  const issues = await readIssues();
  await writeIssues(issues.filter((issue) => issue.groupId !== id));
  await chrome.storage.local.remove(issues.filter((issue) => issue.groupId === id).map((issue) => rawKey(issue.id)));
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

/** Issues captured in one group, or every issue when no id is given. */
export async function issuesInGroup(groupId) {
  const issues = await readIssues();
  return groupId ? issues.filter((issue) => issue.groupId === groupId) : issues;
}
