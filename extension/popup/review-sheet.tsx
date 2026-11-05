/* oxlint-disable react/react-in-jsx-scope -- React 19 uses the automatic JSX runtime. The rule belongs off in .oxlintrc.json. */
import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import { TriangleAlertIcon, XIcon } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import type { Comment, FigmaFile, JiraLink, Review } from '@/lib/model';
import { sendMessage } from '@/lib/protocol';
import { cleanFigmaLink, cleanJiraLink } from '@/lib/review-file.js';
import { frameCount } from '@/lib/review-links.js';
import { openSettings, toggleAnnotating } from './actions';
import { MarginIcon } from './margin-icon';
import { LINK_COPY, linkTitle, resolveLink } from './links';
import { connectedQuery } from './queries';
import { BAD_STATUSES, EMPTY_LINK, LINKED_STATUSES, type LinkKind, type Sheet, usePopup } from './store';

interface ReviewSheetProps {
  sheet: Sheet;
  /** The review new comments go to, reused for a new review when it is still empty. */
  active: Review | null;
  comments: Comment[];
  tabUrl: string;
  host: string;
  restricted: boolean;
}

/**
 * Starts a review or edits the open one: its name and an optional Jira ticket and Figma file.
 * @param props.sheet The sheet being filled in.
 */
export function ReviewSheet({ sheet, active, comments, tabUrl, host, restricted }: ReviewSheetProps) {
  const { closeSheet, editSheet } = usePopup();
  const [problem, setProblem] = useState('');
  const editing = sheet.mode === 'edit';

  const save = useMutation({
    mutationFn: async () => {
      const name = sheet.name.trim();
      if (!name) throw new Error('Give the review a name.');
      await Promise.all([resolveLink('jira'), resolveLink('figma')]);
      const filled = usePopup.getState().sheet ?? sheet;
      const wrong = (['jira', 'figma'] as const).find((kind) => BAD_STATUSES.includes(filled[kind].status));
      if (wrong) throw new Error(`Fix or clear the ${LINK_COPY[wrong].label} first.`);
      const linked = (kind: LinkKind) => (LINKED_STATUSES.includes(filled[kind].status) ? filled[kind].value : null);
      const links = { jira: cleanJiraLink(linked('jira')) ?? null, figma: cleanFigmaLink(linked('figma')) ?? null } as Pick<Review, 'jira' | 'figma'>;
      if (editing && sheet.reviewId) {
        await sendMessage('patchReview', { id: sheet.reviewId, patch: { name, ...links } });
        return false;
      }
      const unused = active && !active.site && !active.jira && !active.figma && !comments.some((comment) => comment.groupId === active.id);
      const id = unused ? active.id : (await sendMessage('addReview', name)).id;
      await sendMessage('patchReview', { id, patch: { name, ...(restricted ? {} : { site: host }), ...links } });
      await sendMessage('selectReview', id);
      return !restricted;
    },
    onSuccess: async (start) => {
      closeSheet();
      if (start) await toggleAnnotating(tabUrl);
    },
    onError: (error) => setProblem(error.message),
  });

  /**
   * Saves the sheet.
   * @param event The submit event.
   */
  function submit(event: FormEvent) {
    event.preventDefault();
    setProblem('');
    save.mutate();
  }

  return (
    <form className="flex flex-col gap-4 p-4" onSubmit={submit} onKeyDown={(event) => event.key === 'Escape' && closeSheet()} noValidate>
      <div className="flex items-center gap-2">
        <h1 className="flex-1 text-base font-semibold">{editing ? 'Edit review' : 'New review'}</h1>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Close" onClick={closeSheet}>
          <XIcon />
        </Button>
      </div>
      <FieldGroup className="gap-4">
        <Field data-invalid={problem && !sheet.name.trim() ? true : undefined}>
          <FieldLabel htmlFor="review-name">Name</FieldLabel>
          <Input
            id="review-name"
            value={sheet.name}
            maxLength={120}
            autoComplete="off"
            autoFocus
            onFocus={(event) => !editing && event.currentTarget.select()}
            onChange={(event) => editSheet({ name: event.target.value })}
          />
        </Field>
        <LinkInput kind="jira" sheet={sheet} />
        <LinkInput kind="figma" sheet={sheet} />
      </FieldGroup>
      {problem && <p className="text-sm text-destructive" role="alert">{problem}</p>}
      <Button type="submit" size="lg" disabled={save.isPending}>
        {save.isPending && <Spinner />}
        {editing ? 'Save review' : 'Start review'}
      </Button>
    </form>
  );
}

/**
 * One optional link field. Pasting or leaving the field looks the link up. A found link shows as a row that can be removed.
 * @param props.kind Jira or Figma.
 * @param props.sheet The sheet being filled in.
 */
function LinkInput({ kind, sheet }: { kind: LinkKind; sheet: Sheet }) {
  const { editLink } = usePopup();
  const { data: connected } = useSuspenseQuery(connectedQuery);
  const field = sheet[kind];
  const copy = LINK_COPY[kind];
  const id = `review-${kind}`;
  const bad = BAD_STATUSES.includes(field.status);

  const label = (
    <FieldLabel htmlFor={id} className="justify-between">
      {copy.label}
      <span className="font-normal text-muted-foreground">Optional</span>
    </FieldLabel>
  );

  if (field.status === 'looking') {
    return (
      <Field>
        {label}
        <div className="flex h-9 items-center gap-2 text-sm text-muted-foreground" aria-busy>
          <Spinner /> Looking up {kind === 'jira' ? field.text.trim() : 'the file'}
        </div>
      </Field>
    );
  }

  if (LINKED_STATUSES.includes(field.status) && field.value) {
    return (
      <Field>
        {label}
        <div className="flex items-center gap-2.5 rounded-lg border px-2.5 py-2">
          <MarginIcon name={kind} className="size-4 text-muted-foreground" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="truncate font-medium">{linkTitle(kind, field.value)}</p>
            <LinkSubline kind={kind} value={field.value} status={field.status} detail={field.detail} connected={connected[kind]} />
          </div>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${copy.label}`} onClick={() => editLink(kind, EMPTY_LINK)}>
            <XIcon />
          </Button>
        </div>
      </Field>
    );
  }

  return (
    <Field data-invalid={bad || undefined}>
      {label}
      <Input
        id={id}
        value={field.text}
        placeholder={copy.placeholder}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={bad || undefined}
        onChange={(event) => editLink(kind, { text: event.target.value, status: 'typed', value: null, detail: '' })}
        onBlur={() => resolveLink(kind)}
        onPaste={() => setTimeout(() => resolveLink(kind))}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || field.status !== 'typed' || !field.text.trim()) return;
          event.preventDefault();
          resolveLink(kind);
        }}
      />
      {bad && (
        <FieldError>
          {field.status === 'error' ? `Could not look this up. ${field.detail}` : copy[field.status as 'invalid' | 'notFound']}
        </FieldError>
      )}
    </Field>
  );
}

/**
 * The line under a linked ticket or file: its summary or frames, a warning, or an offer to connect for details.
 * @param props.kind Jira or Figma.
 */
function LinkSubline({ kind, value, status, detail, connected }: { kind: LinkKind; value: JiraLink | FigmaFile; status: string; detail: string; connected: boolean }) {
  const copy = LINK_COPY[kind];
  if (status === 'noAccess' || status === 'otherSite') {
    return (
      <FieldDescription className="flex items-center gap-1 text-xs text-warning">
        <TriangleAlertIcon className="size-3 shrink-0" />
        <span className="truncate">{status === 'noAccess' ? copy.noAccess : copy.otherSite(detail)}</span>
      </FieldDescription>
    );
  }
  if (!value.fetchedAt && (status === 'notConnected' || !connected)) {
    return (
      <button type="button" className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground" onClick={() => openSettings(kind)}>
        Connect {kind === 'jira' ? 'Jira' : 'Figma'} to bring in details
      </button>
    );
  }
  const text = kind === 'jira' ? (value as JiraLink).summary : frameCount(value as FigmaFile);
  return <p className="truncate text-xs text-muted-foreground">{text}</p>;
}
