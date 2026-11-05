import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CircleAlert, CircleCheck, ExternalLink, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import { withImages } from '@/lib/review-store';
import { jiraChoiceItem, jiraSiteItem } from '@/lib/storage';
import type { Comment, Connection, JiraLink } from '@/lib/model';
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
import { ConnectButton, ConnectIntro, connectionLine, useConnect } from './connect-card';

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
 * A select over a list of id and name pairs, with a line under it saying what it is for.
 * @param props.id The control id.
 * @param props.label Its label.
 * @param props.description The line under it.
 * @param props.items The options.
 * @param props.value The option picked.
 * @param props.onChange Called with the option picked.
 * @param props.loading True while the options load.
 */
function PickField({
  id,
  label,
  description,
  items,
  value,
  onChange,
  loading,
}: {
  id: string;
  label: string;
  description?: string;
  items: { id: string; name: string }[];
  value: string;
  onChange: (value: string) => void;
  loading?: boolean;
}) {
  const options = items.map((item) => ({ value: item.id, label: item.name }));
  return (
    <Field className="gap-2">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select items={options} value={value || null} onValueChange={(next) => next && onChange(next)} disabled={loading || !options.length}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={loading ? 'Loading' : 'None'} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {description && <FieldDescription className="text-xs">{description}</FieldDescription>}
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
    {
      value: 'each' as Mode,
      title: `One issue per comment (${plural(count, 'issue', 'issues')})`,
      hint: ticket ? `Each issue is linked to ${ticket}.` : 'Best when different people fix different comments.',
    },
    {
      value: whole,
      title: ticket ? `One comment on ${ticket}` : 'One issue for the whole review',
      hint: ticket ? 'Every comment goes into the ticket as a numbered list.' : 'Every comment becomes a numbered section in one issue.',
    },
  ];
  return (
    <FieldSet className="gap-3">
      <FieldLegend variant="label" className="mb-3">
        What to create
      </FieldLegend>
      <RadioGroup value={value} onValueChange={(next) => onChange(next as Mode)} className="gap-3">
        {choices.map((choice) => (
          <label key={choice.value} className="flex cursor-pointer items-start gap-3">
            <RadioGroupItem value={choice.value} className="mt-0.5" />
            <span className="grid gap-0.5">
              <span className="text-sm font-medium">{choice.title}</span>
              <span className="text-sm text-muted-foreground">{choice.hint}</span>
            </span>
          </label>
        ))}
      </RadioGroup>
    </FieldSet>
  );
}

/**
 * What a send created, each with a link, and what failed with why.
 * @param props.results The results.
 * @param props.title The name of a result that holds the whole review.
 */
function Results({ results, title }: { results: JiraResult[]; title: (result: JiraResult) => string }) {
  return (
    <section className="grid gap-2">
      <h3 className="text-sm font-medium">Result</h3>
      <ul className="grid divide-y">
        {results.map((result, index) => (
          <li key={result.key ?? index} className="flex items-start gap-3 py-2 text-sm">
            {result.key ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-label="Created" /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-label="Failed" />}
            <span className="grid min-w-0 gap-0.5">
              <span>
                {result.key && (
                  <a href={result.url} target="_blank" rel="noopener" className="font-medium underline underline-offset-3">
                    {result.key}
                  </a>
                )}{' '}
                {title(result)}
              </span>
              {(result.warning || result.error) && <span className="text-xs text-muted-foreground">{result.warning ?? result.error}</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The connected send: pick a project and issue type, then create the issues through the API.
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
  const project = list.find((entry) => entry.id === projectId);
  const types = project?.issueTypes ?? [];
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
  const typeName = types.find((type) => type.id === typeId)?.name;

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
      <div className="-mx-6 grid min-h-0 gap-6 overflow-y-auto px-6">
        {ticket && (
          <p className="text-sm text-muted-foreground">
            This review is linked to <b className="font-medium text-foreground">{ticket}</b>
            {review?.jira?.summary ? `, ${review.jira.summary}` : ''}. Changes here apply to this send only.
          </p>
        )}
        <FieldSet className="gap-4">
          <FieldLegend variant="label" className="mb-3">
            Where the issues go
          </FieldLegend>
          {sites.length > 1 && (
            <PickField
              id="jira-site"
              label="Site"
              items={sites.map((entry) => ({ id: entry.id, name: entry.name ?? entry.url }))}
              value={siteId}
              onChange={(id) => setPicked({ ...picked, siteId: id, projectId: undefined, typeId: undefined })}
            />
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <PickField
              id="jira-project"
              label="Project"
              description="Projects you can create issues in, most active first."
              items={list.map((entry: JiraProject) => ({ id: entry.id, name: `${entry.name} (${entry.key})` }))}
              value={projectId}
              loading={projects.isPending}
              onChange={(id) => setPicked({ ...picked, projectId: id, typeId: undefined })}
            />
            <PickField
              id="jira-type"
              label="Issue type"
              description="Bug suits most review comments."
              items={types}
              value={typeId}
              loading={projects.isPending}
              onChange={(id) => setPicked({ ...picked, typeId: id })}
            />
          </div>
          {projects.error && <p className="text-sm text-destructive">{projects.error.message}</p>}
          {projects.data && !list.length && <p className="text-sm text-muted-foreground">This site has no projects you can create issues in.</p>}
        </FieldSet>
        <Separator />
        <ModePicker count={pending.length} ticket={ticket} value={mode} onChange={(next) => setPicked({ ...picked, mode: next })} />
        <p className="text-sm text-muted-foreground">
          {mode !== 'ticket' && project && typeName ? `Margin creates ${plural(count, `${typeName.toLowerCase()} issue`, `${typeName.toLowerCase()} issues`)} in ${project.name}. ` : ''}
          Severity sets the priority, marker notes become a numbered list, and the screenshots are attached.
          {linkedCount > 0 && mode === 'each' && ` ${plural(linkedCount, 'comment already has', 'comments already have')} an issue and ${linkedCount === 1 ? 'is' : 'are'} left out.`}
        </p>
        {results && <Results results={results} title={resultTitle} />}
      </div>
      <DialogFooter className="items-center">
        <span className="text-sm text-muted-foreground sm:mr-auto" role="status">
          {count ? state : 'Every comment already has a Jira issue.'}
        </span>
        <Button variant="outline" disabled={busy} onClick={closeDialog}>
          Close
        </Button>
        {count > 0 && !(results && results.every((result) => result.key)) && (
          <Button disabled={busy || !projectId || !typeId} onClick={run}>
            {busy && <Spinner />}
            {goLabel()}
          </Button>
        )}
      </DialogFooter>
    </>
  );
}

/**
 * The send without a sign-in: Jira's own create form, filled in, one per comment or one for the review.
 * @param props.onBack Goes back to the offer to connect.
 */
function LinkJira({ onBack }: { onBack: () => void }) {
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
    setSiteState(first ? `Found ${new URL(first).host}` : 'No Jira tab is open. Open your Jira site in a tab, or type it here.');
    queryClient.invalidateQueries({ queryKey: ['jiraSessionProjects'] });
  };

  /**
   * Opens Jira's create form filled in, one tab per group of comments. The first tab comes to the front.
   * @param groups The comments each form holds.
   */
  const openForms = async (groups: Comment[][]) => {
    if (!site) {
      setSiteState('Type your Jira site first, like yourteam.atlassian.net.');
      document.getElementById('jira-site-input')?.focus();
      return;
    }
    await jiraSiteItem.setValue(site);
    for (const [index, issues] of groups.entries()) {
      const url = createLink(site, { ...linkFields(issues, reviewTitle, numberOf), projectId: projectId || undefined, issueTypeId: typeId || undefined });
      await chrome.tabs.create({ url, active: index === 0 });
    }
  };

  return (
    <>
      <div className="-mx-6 grid min-h-0 gap-6 overflow-y-auto px-6">
        <p className="text-sm">Jira's create form opens with the summary and description filled in. Check it and press Create there. Screenshots are not attached.</p>
        <Field className="gap-2">
          <FieldLabel htmlFor="jira-site-input">Your Jira site</FieldLabel>
          <div className="flex gap-2">
            <Input
              id="jira-site-input"
              value={siteText}
              placeholder="yourteam.atlassian.net"
              className="flex-1"
              onChange={(event) => {
                setTyped(event.target.value);
                setSiteState('');
              }}
            />
            <Button variant="outline" onClick={findSite}>
              <Search />
              Find in my tabs
            </Button>
          </div>
          <FieldDescription className="text-xs" role="status">
            {siteState}
          </FieldDescription>
        </Field>
        {list.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <PickField id="jira-link-project" label="Project" items={list.map((project) => ({ id: project.id, name: `${project.name} (${project.key})` }))} value={projectId} onChange={(id) => setPicked({ projectId: id })} />
            <PickField id="jira-link-type" label="Issue type" items={types} value={typeId} onChange={(id) => setPicked({ ...picked, typeId: id })} />
          </div>
        )}
        <ModePicker count={ordered.length} ticket={null} value={mode} onChange={setMode} />
        {mode === 'each' && (
          <ul className="grid divide-y">
            {ordered.map((comment) => (
              <li key={comment.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="text-xs font-extrabold text-muted-foreground tabular-nums">{pad(numberOf(comment))}</span>
                <span className="min-w-0 flex-1 truncate">{comment.title || 'Untitled comment'}</span>
                {comment.jira?.key && <span className="text-xs text-muted-foreground">{comment.jira.key}</span>}
                <Button size="sm" variant="outline" aria-label={`Open comment ${pad(numberOf(comment))} in Jira`} onClick={() => openForms([[comment]])}>
                  Open
                  <ExternalLink />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <DialogFooter className="items-center">
        <Button variant="ghost" className="sm:mr-auto" onClick={onBack}>
          <ArrowLeft />
          Back
        </Button>
        <Button disabled={!ordered.length} onClick={() => openForms(mode === 'each' ? ordered.map((comment) => [comment]) : [ordered])}>
          {mode === 'each' && ordered.length > 1 ? `Open all ${ordered.length} in Jira` : 'Open in Jira'}
          <ExternalLink />
        </Button>
      </DialogFooter>
    </>
  );
}

/** Not connected: the offer to connect, with Jira's own form as the way that needs no sign-in. */
function NotConnectedJira() {
  const connection = useConnect('jira');
  const [path, setPath] = useState<'connect' | 'form'>('connect');
  if (path === 'form') return <LinkJira onBack={() => setPath('connect')} />;
  return (
    <>
      <ConnectIntro
        body="Connect Jira and Margin creates the issues for you. It sets the priority from the severity and attaches the screenshots. It takes one sign-in."
        state={connection.state}
      >
        <p className="text-muted-foreground">Or skip the sign-in and use Jira's own create form, filled in for you. Screenshots are not attached that way.</p>
      </ConnectIntro>
      <DialogFooter className="items-center">
        <Button variant="ghost" className="sm:mr-auto" onClick={() => setPath('form')}>
          Use Jira's form instead
        </Button>
        <ConnectButton connection={connection} />
      </DialogFooter>
    </>
  );
}

/** Send to Jira, in the view that fits the sign-in. */
export default function JiraDialog() {
  const open = useReportUi((state) => state.dialog === 'jira');
  const current = useQuery(connectionQuery('jira'));
  const [busy, setBusy] = useState(false);
  const popup = useRef<HTMLDivElement>(null);
  const connected = Boolean(current.data?.sites?.length);
  const account = current.data && !connected ? null : current.data;
  const onlySite = connected && current.data?.sites?.length === 1 ? current.data.sites[0] : undefined;
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && closeDialog()}>
      <DialogContent ref={popup} initialFocus={popup} className="flex max-h-[90vh] flex-col sm:max-w-2xl" showCloseButton={!busy}>
        <DialogHeader className="gap-1 pr-8">
          <DialogTitle>Send to Jira</DialogTitle>
          <DialogDescription>
            {connectionLine(account, 'your Atlassian account')}
            {onlySite ? ` on ${onlySite.name ?? new URL(onlySite.url).host}` : ''}
          </DialogDescription>
        </DialogHeader>
        {current.data && connected ? <ConnectedJira current={current.data} onBusy={setBusy} /> : !current.isPending && <NotConnectedJira />}
      </DialogContent>
    </Dialog>
  );
}
