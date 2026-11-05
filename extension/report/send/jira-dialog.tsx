import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { withImages } from '@/lib/review-store';
import { jiraChoiceItem, jiraSiteItem } from '@/lib/storage';
import type { Comment, Connection, JiraLink } from '@/lib/model';
import { cn } from '@/lib/utils';
import { ask, connectionQuery, queryClient, useSettings } from '../data';
import { namesOf } from '../exports';
import { closeDialog, useReportUi } from '../ui-store';
import { useReportComments, useReviews } from '../use-report';
import { pad, plural } from '../format';
import {
  commentOnTicket,
  createIssues,
  createLink,
  defaultType,
  linkFields,
  listProjects,
  openSites,
  sessionProjects,
  siteOrigin,
  type JiraProject,
  type JiraResult,
  type JiraSite,
} from '../shared';
import { ConnectCard, connectionLine } from './connect-card';

/**
 * Send to Jira. Connected, Margin creates the issues itself with the screenshots attached. Not connected, it opens
 * Jira's own create form filled in, and offers to connect.
 */

const SITES_PERMISSION = { origins: ['https://*.atlassian.net/*'] };

type Mode = 'each' | 'review' | 'ticket';

/**
 * True when two addresses share an origin.
 * @param first One address.
 * @param second The other.
 */
function sameOrigin(first: string | undefined, second: string | undefined) {
  try {
    return new URL(first ?? '').origin === new URL(second ?? '').origin;
  } catch {
    return false;
  }
}

/**
 * A comment's number and title, as the results list it.
 * @param comment The comment.
 * @param numberOf Numbers a comment.
 */
const labelOf = (comment: Comment | undefined, numberOf: (comment: { id: string }) => number) =>
  comment ? `${pad(numberOf(comment))} ${comment.title || 'Untitled comment'}` : 'Untitled comment';

/**
 * A select over a list of id and name pairs.
 * @param props.id The control id.
 * @param props.label Its label.
 * @param props.items The options.
 * @param props.value The option picked.
 * @param props.onChange Called with the option picked.
 */
function PickField({
  id,
  label,
  items,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  items: { id: string; name: string }[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const options = items.map((item) => ({ value: item.id, label: item.name }));
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select items={options} value={value || null} onValueChange={(next) => next && onChange(next)} disabled={disabled || !options.length}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={disabled ? 'Loading' : 'None'} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

/**
 * One issue per comment, or the whole review in one issue or as one comment on the linked ticket.
 * @param props.count How many comments one issue each would create.
 * @param props.ticket The review's linked ticket key.
 * @param props.value The mode picked.
 * @param props.onChange Called with the mode picked.
 */
function ModePicker({ count, ticket, value, onChange }: { count: number; ticket: string | null; value: Mode; onChange: (mode: Mode) => void }) {
  const whole: Mode = ticket ? 'ticket' : 'review';
  const choices = [
    { value: 'each' as Mode, title: 'One issue per comment', hint: `${plural(count, 'issue', 'issues')}${ticket ? `, each linked to ${ticket}` : ''}` },
    { value: whole, title: ticket ? `One comment on ${ticket}` : 'One issue for the whole review', hint: 'Every comment as a numbered section' },
  ];
  return (
    <RadioGroup value={value} onValueChange={(next) => onChange(next as Mode)} className="gap-2">
      {choices.map((choice) => (
        <label key={choice.value} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-data-checked:border-ring">
          <RadioGroupItem value={choice.value} className="mt-0.5" />
          <span className="grid gap-0.5">
            <b className="text-sm">{choice.title}</b>
            <span className="text-xs text-muted-foreground">{choice.hint}</span>
          </span>
        </label>
      ))}
    </RadioGroup>
  );
}

/**
 * What a send created, each with a link, and what failed with why.
 * @param props.results The results.
 * @param props.title The name of a result that holds the whole review.
 */
function Results({ results, title }: { results: JiraResult[]; title: (result: JiraResult) => string }) {
  return (
    <div className="grid gap-2">
      {results.map((result, index) => (
        <div key={result.key ?? index} className={cn('rounded-lg border p-3 text-sm', !result.key && 'border-destructive/40')}>
          {result.key ? (
            <b>
              <a href={result.url} target="_blank" rel="noopener" className="underline underline-offset-3">
                {result.key}
              </a>{' '}
              {title(result)}
            </b>
          ) : (
            <b>{title(result)}</b>
          )}
          {(result.warning || result.error) && <p className="mt-1 text-xs text-muted-foreground">{result.warning ?? result.error}</p>}
        </div>
      ))}
    </div>
  );
}

/**
 * The connected send: pick a site, project and issue type, then create the issues through the API.
 * @param props.current The stored Jira connection.
 * @param props.onBusy Locks the dialog while issues are being created.
 */
function ConnectedJira({ current, onBusy }: { current: Connection; onBusy: (busy: boolean) => void }) {
  const sites = current.sites ?? [];
  const { review } = useReviews();
  const { ordered, numberOf } = useReportComments();
  const settings = useSettings().data;
  const choice = useQuery({ queryKey: ['jiraChoice'], queryFn: async () => (await jiraChoiceItem.getValue()) ?? null }).data;
  const ticket = review?.jira?.key ?? null;
  const ticketSite = ticket ? sites.find((site) => sameOrigin(site.url, review?.jira?.url)) : undefined;
  const [picked, setPicked] = useState<{ siteId?: string; projectId?: string; typeId?: string; mode?: Mode }>({});
  const siteId = picked.siteId ?? ticketSite?.id ?? (sites.some((site) => site.id === choice?.siteId) ? choice?.siteId : undefined) ?? sites[0]?.id ?? '';
  const projects = useQuery({ queryKey: ['jiraProjects', siteId], enabled: Boolean(siteId), queryFn: () => listProjects(siteId) });
  const list = projects.data ?? [];
  const ticketProject = ticket && siteId === ticketSite?.id ? list.find((project) => project.key === ticket.split('-')[0]) : undefined;
  const projectId =
    [picked.projectId, ticketProject?.id, choice?.projectId].find((id) => id && list.some((project) => project.id === id)) ?? list[0]?.id ?? '';
  const types = list.find((project) => project.id === projectId)?.issueTypes ?? [];
  const typeId = [picked.typeId, choice?.typeId].find((id) => id && types.some((type) => type.id === id)) ?? defaultType(types)?.id ?? '';
  const mode: Mode = picked.mode ?? (!ticket && choice?.mode === 'review' ? 'review' : 'each');
  const pending = ordered.filter((comment) => !comment.jira?.key);
  const linkedCount = ordered.length - pending.length;
  const [state, setState] = useState('');
  const [results, setResults] = useState<JiraResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const reviewTitle = namesOf({ review, comments: ordered }).docsTitle;
  const site = sites.find((entry) => entry.id === siteId) as JiraSite | undefined;
  const count = mode === 'each' ? pending.length : 1;

  const resultTitle = (result: JiraResult) => {
    if (mode === 'each') return labelOf(result.issues[0], numberOf);
    if (mode === 'ticket') return 'has the review as a comment';
    return reviewTitle;
  };

  const goLabel = () => {
    if (busy) return 'Creating';
    if (results) return 'Try the rest again';
    if (mode === 'ticket') return `Comment on ${ticket}`;
    return `Create ${plural(count, 'issue', 'issues')}`;
  };

  const lock = (next: boolean) => {
    setBusy(next);
    onBusy(next);
  };

  const run = async () => {
    if (!site || !settings) return;
    lock(true);
    try {
      if (mode === 'ticket' && ticket) {
        setState(`Commenting on ${ticket}. Keep this open until it finishes.`);
        const ticketHome = sites.find((entry) => sameOrigin(entry.url, review?.jira?.url)) ?? site;
        const result = await commentOnTicket({ site: ticketHome, key: ticket, issues: await withImages(ordered), shots: settings.shots, reviewTitle, numberOf });
        setResults([{ key: ticket, url: result.url, warning: result.warning, issues: [] }]);
        setState('Comment added');
        return;
      }
      const issues = mode === 'review' ? ordered : pending;
      if (!issues.length) {
        setState('Every comment already has a Jira issue.');
        return;
      }
      await jiraChoiceItem.setValue({ siteId, projectId, typeId, mode });
      queryClient.invalidateQueries({ queryKey: ['jiraChoice'] });
      setState('Creating. Keep this open until it finishes.');
      const created = await createIssues({
        site,
        projectId,
        issueTypeId: typeId,
        issues: await withImages(issues),
        mode,
        shots: settings.shots,
        reviewTitle,
        numberOf,
        linkTo: mode === 'each' ? (ticket ?? undefined) : undefined,
        onProgress: (done, total) => setState(`Created ${done} of ${total}. Keep this open until it finishes.`),
      });
      for (const result of created) {
        if (!result.key || !result.url) continue;
        const jira: JiraLink = { key: result.key, url: result.url };
        const first = result.issues[0];
        if (mode === 'review' && review) await ask('patchReview', { id: review.id, patch: { jira: { ...review.jira, ...jira } } });
        else if (mode !== 'review' && first) await ask('update', { id: first.id, patch: { jira } });
      }
      setResults(created);
      const made = created.filter((result) => result.key).length;
      setState(made === created.length ? `Created ${plural(made, 'issue', 'issues')}` : `${made} of ${created.length} created`);
    } catch (error) {
      setState(error instanceof Error ? error.message : String(error));
    } finally {
      lock(false);
    }
  };

  return (
    <>
      <div className="grid grid-cols-1 gap-4 overflow-y-auto">
        {ticket && (
          <p className="text-sm text-muted-foreground">
            This review is linked to <b className="text-foreground">{ticket}</b>
            {review?.jira?.summary ? ` ${review.jira.summary}` : ''}. A change here applies to this send only.
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <PickField id="jira-site" label="Site" items={sites.map((entry) => ({ id: entry.id, name: entry.name ?? entry.url }))} value={siteId} onChange={(id) => setPicked({ ...picked, siteId: id, projectId: undefined, typeId: undefined })} />
          <PickField
            id="jira-project"
            label="Project"
            items={list.map((project: JiraProject) => ({ id: project.id, name: `${project.name} (${project.key})` }))}
            value={projectId}
            disabled={projects.isPending}
            onChange={(id) => setPicked({ ...picked, projectId: id, typeId: undefined })}
          />
          <PickField id="jira-type" label="Issue type" items={types} value={typeId} disabled={projects.isPending} onChange={(id) => setPicked({ ...picked, typeId: id })} />
        </div>
        {projects.error && <p className="text-sm text-destructive">{projects.error.message}</p>}
        {projects.data && !list.length && <p className="text-sm text-muted-foreground">This site has no projects you can create issues in.</p>}
        <ModePicker count={pending.length} ticket={ticket} value={mode} onChange={(next) => setPicked({ ...picked, mode: next })} />
        <p className="text-sm text-muted-foreground">
          Severity sets the priority, the numbered marker notes become a numbered list, and the screenshots are attached.
          {linkedCount > 0 &&
            ` ${plural(linkedCount, 'comment already has', 'comments already have')} an issue and ${linkedCount === 1 ? 'is' : 'are'} left out of one issue per comment.`}
        </p>
        {results && <Results results={results} title={resultTitle} />}
      </div>
      <DialogFooter className="items-center">
        <span className="mr-auto text-sm text-muted-foreground" role="status">
          {count ? state : 'Every comment already has a Jira issue.'}
        </span>
        <Button variant="outline" disabled={busy} onClick={closeDialog}>
          Close
        </Button>
        {count > 0 && !(results && results.every((result) => result.key)) && (
          <Button disabled={busy || !projectId || !typeId} onClick={run}>
            {goLabel()}
          </Button>
        )}
      </DialogFooter>
    </>
  );
}

/** The send without a sign-in: Jira's own create form, filled in, one per comment or one for the review. */
function LinkJira() {
  const { review } = useReviews();
  const { ordered, numberOf } = useReportComments();
  const reviewTitle = namesOf({ review, comments: ordered }).docsTitle;
  const remembered = useQuery({
    queryKey: ['jiraSite', review?.jira?.url],
    queryFn: async () => {
      const linked = siteOrigin(review?.jira?.url);
      const stored = linked ?? (await jiraSiteItem.getValue()) ?? null;
      const found = !stored && (await chrome.permissions.contains(SITES_PERMISSION)) ? ((await openSites())[0] ?? null) : null;
      const origin = stored || found;
      return origin ? new URL(origin).host : '';
    },
  }).data;
  const [typed, setTyped] = useState<string | null>(null);
  const siteText = typed ?? remembered ?? '';
  const site = siteOrigin(siteText);
  const projects = useQuery({
    queryKey: ['jiraSessionProjects', site],
    enabled: Boolean(site),
    queryFn: async () => (site && (await chrome.permissions.contains(SITES_PERMISSION)) ? ((await sessionProjects(site)) ?? []) : []),
  }).data;
  const [picked, setPicked] = useState<{ projectId?: string; typeId?: string }>({});
  const list = projects ?? [];
  const projectId = [picked.projectId, list.find((project) => project.key === review?.jira?.key?.split('-')[0])?.id].find((id) => id && list.some((project) => project.id === id)) ?? list[0]?.id ?? '';
  const types = list.find((project) => project.id === projectId)?.issueTypes ?? [];
  const typeId = (picked.typeId && types.some((type) => type.id === picked.typeId) ? picked.typeId : defaultType(types)?.id) ?? '';
  const [mode, setMode] = useState<Mode>('each');
  const [siteState, setSiteState] = useState('');

  const findSite = async () => {
    const granted = await chrome.permissions.request(SITES_PERMISSION);
    if (!granted) {
      setSiteState('Type your Jira site instead.');
      return;
    }
    const sites = await openSites();
    const first = sites[0];
    if (first) setTyped(new URL(first).host);
    setSiteState(first ? `Found ${new URL(first).host}` : 'Open your Jira site in a tab, or type it here.');
    queryClient.invalidateQueries({ queryKey: ['jiraSessionProjects'] });
  };

  const openForm = async (issues: Comment[]) => {
    if (!site) {
      setSiteState('Type your Jira site, like yourteam.atlassian.net.');
      document.getElementById('jira-site-input')?.focus();
      return;
    }
    await jiraSiteItem.setValue(site);
    const url = createLink(site, { ...linkFields(issues, reviewTitle, numberOf), projectId: projectId || undefined, issueTypeId: typeId || undefined });
    chrome.tabs.create({ url });
  };

  return (
    <>
      <div className="grid grid-cols-1 gap-4 overflow-y-auto">
        <ConnectCard provider="jira" body="Margin creates the issues for you, sets the priority from the severity and attaches the screenshots. It takes one sign-in." />
        <div className="grid gap-1">
          <b className="text-sm">Or use Jira's create form, no sign-in</b>
          <p className="text-sm text-muted-foreground">Jira opens with the summary and description filled in. Check it and press Create there. Screenshots stay in the Margin report.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field>
            <FieldLabel htmlFor="jira-site-input">Jira site</FieldLabel>
            <Input
              id="jira-site-input"
              value={siteText}
              placeholder="yourteam.atlassian.net"
              onChange={(event) => {
                setTyped(event.target.value);
                setSiteState('');
              }}
            />
          </Field>
          {list.length > 0 && (
            <>
              <PickField id="jira-link-project" label="Project" items={list.map((project) => ({ id: project.id, name: `${project.name} (${project.key})` }))} value={projectId} onChange={(id) => setPicked({ projectId: id })} />
              <PickField id="jira-link-type" label="Issue type" items={types} value={typeId} onChange={(id) => setPicked({ ...picked, typeId: id })} />
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" variant="outline" onClick={findSite}>
            <Search />
            Find my site
          </Button>
          <span className="text-sm text-muted-foreground" role="status">
            {siteState}
          </span>
        </div>
        <ModePicker count={ordered.length} ticket={null} value={mode} onChange={setMode} />
        {mode === 'each' && (
          <div className="grid grid-cols-1 gap-1.5">
            {ordered.map((comment) => (
              <div key={comment.id} className="flex items-center gap-3 text-sm">
                <Button size="xs" variant="outline" onClick={() => openForm([comment])}>
                  <ExternalLink />
                  Open in Jira
                </Button>
                <span className="text-xs text-muted-foreground tabular-nums">{pad(numberOf(comment))}</span>
                <b className="min-w-0 truncate">{comment.title || 'Untitled comment'}</b>
                {comment.jira?.key && <span className="text-xs text-muted-foreground">{comment.jira.key}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={closeDialog}>
          Close
        </Button>
        {mode !== 'each' && (
          <Button onClick={() => openForm(ordered)}>
            <ExternalLink />
            Open in Jira
          </Button>
        )}
      </DialogFooter>
    </>
  );
}

/** Send to Jira, in the view that fits the sign-in. */
export default function JiraDialog() {
  const open = useReportUi((state) => state.dialog === 'jira');
  const current = useQuery(connectionQuery('jira'));
  const [busy, setBusy] = useState(false);
  const connected = Boolean(current.data?.sites?.length);
  const account = current.data && !connected ? null : current.data;
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && closeDialog()}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-2xl" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>Send to Jira</DialogTitle>
          <DialogDescription>{connectionLine(account, 'your Atlassian account')}</DialogDescription>
        </DialogHeader>
        {current.data && connected ? <ConnectedJira current={current.data} onBusy={setBusy} /> : !current.isPending && <LinkJira />}
      </DialogContent>
    </Dialog>
  );
}
