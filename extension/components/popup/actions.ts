import { useMutation } from '@tanstack/react-query';
import { addGroup, patchGroup, readImages, readIssues, readRaw, removeIssue, setActiveGroup, writeImages, writeIssues, writeRaw } from '@/lib/store.js';
import { cleanFigmaLink, cleanJiraLink } from '@/lib/review-file.js';
import { reviewName } from '@/lib/review-name.js';
import type { SheetMode } from './draft';
import { send, startError, type PopupData } from './io';
import { belongsHere, type Group, type Issue, type TabInfo } from './model';
import type { SheetResult } from './review-sheet';
import { usePopup } from './store';

const UNDO_MS = 5000;

type Context = { tab: TabInfo; data: PopupData; group: Group | null; host: string; restricted: boolean; open: boolean };

const focusLater = (selector: string) => requestAnimationFrame(() => document.querySelector<HTMLElement>(selector)?.focus());

/**
 * Everything the popup writes. Storage changes refresh the queries that read them, so nothing here reloads by hand.
 * Starting to annotate closes the popup, or shows why Margin cannot run on the page.
 */
export function usePopupActions({ tab, data, group, host, restricted, open }: Context) {
  const { setAlert, show, setWidth, setRenaming, setConfirmingDelete, keepDeleted, forgetDeleted } = usePopup();

  /** A review that was made but never used, which a new review takes over instead of piling up beside it. */
  const unused = () => (group && !group.site && !group.jira && !group.figma && !data.issues.some((issue) => issue.groupId === group.id) ? group : null);

  const annotate = async () => {
    const res = await send('toggle');
    if (res?.error) setAlert(startError(res.error));
    else window.close();
  };

  const toggle = useMutation({ mutationFn: annotate });

  /** One click: a review named after the site, and annotating straight away. */
  const startReview = useMutation({
    mutationFn: async () => {
      const spare = unused();
      const name = reviewName(tab, data.groups.filter((g) => g !== spare).map((g) => g.name));
      const id = spare ? spare.id : (await addGroup(name)).id;
      await patchGroup(id, { name, site: host });
      await setActiveGroup(id);
      await annotate();
    },
  });

  const submitSheet = async (mode: SheetMode, { name, jira, figma }: SheetResult) => {
    const links = { jira: cleanJiraLink(jira), figma: cleanFigmaLink(figma) };
    if (mode === 'edit' && group) {
      await patchGroup(group.id, { name, ...links });
    } else {
      const spare = unused();
      const id = spare ? spare.id : (await addGroup(name)).id;
      await patchGroup(id, { name, ...(restricted ? {} : { site: host }), ...links });
      await setActiveGroup(id);
      if (!open && !restricted) await annotate();
    }
    setWidth(null);
    show({ name: 'home' });
    focusLater('[data-tour="lead"]');
  };

  const pick = useMutation({
    mutationFn: async (id: string) => {
      await send('groupSelect', { id });
      const picked = data.groups.find((g) => g.id === id);
      if (host && picked && !belongsHere(picked, data.issues, host)) await patchGroup(id, { pickedOn: [...(picked.pickedOn ?? []), host] });
      setWidth(null);
      setAlert(null);
    },
  });

  const rename = useMutation({
    mutationFn: async (name: string | null) => {
      setRenaming(false);
      if (name && group) await patchGroup(group.id, { name });
    },
  });

  const deleteReview = useMutation({
    mutationFn: async () => {
      if (group) await send('groupDelete', { id: group.id });
      setConfirmingDelete(false);
    },
  });

  /** Deletes a comment at once and keeps its row as an Undo offer for five seconds. */
  const deleteComment = useMutation({
    mutationFn: async ({ issue, reviewIndex }: { issue: Issue; reviewIndex: number }) => {
      const index = ((await readIssues()) as Issue[]).findIndex((i) => i.id === issue.id);
      const [raw, images] = await Promise.all([readRaw(issue.id), readImages(issue.id)]);
      const timer = window.setTimeout(() => {
        const row = document.querySelector(`[data-comment="${issue.id}"]`);
        const after = row?.contains(document.activeElement) ? (row.nextElementSibling ?? row.previousElementSibling) : null;
        forgetDeleted(issue.id);
        if (after) requestAnimationFrame(() => after.querySelector('button')?.focus());
      }, UNDO_MS);
      keepDeleted({ issue, index, reviewIndex, raw, images: images as Record<string, unknown>, timer });
      await removeIssue(issue.id);
    },
  });

  /** Puts a deleted comment back where it was, with its images and clean screenshot. */
  const undoDelete = useMutation({
    mutationFn: async (id: string) => {
      const kept = usePopup.getState().deleted[id];
      if (!kept) return;
      clearTimeout(kept.timer);
      if (kept.raw) await writeRaw(id, kept.raw as Parameters<typeof writeRaw>[1]);
      if (Object.keys(kept.images).length) await writeImages(id, kept.images);
      const stored = (await readIssues()) as Issue[];
      stored.splice(kept.index < 0 ? stored.length : Math.min(kept.index, stored.length), 0, kept.issue);
      await writeIssues(stored);
      forgetDeleted(id);
      focusLater(`[data-comment="${id}"] button`);
    },
  });

  const verify = useMutation({
    mutationFn: (width: number | undefined) => send('verifyStart', { groupId: group?.id, width }),
  });

  return { toggle, startReview, submitSheet, pick, rename, deleteReview, deleteComment, undoDelete, verify };
}
