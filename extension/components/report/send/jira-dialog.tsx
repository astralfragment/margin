import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useStorageValue } from '@/hooks/use-storage';
import { commentOnTicket, createIssues, createLink, defaultType, linkFields, listProjects, openSites, sessionProjects, siteOrigin } from '@/lib/jira.js';
import { patchGroup } from '@/lib/store.js';
import { useConnection } from '../queries';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import type { Group, Issue, JiraLink } from '../types';
import { pad, plural, send } from '../util';
import { ConnectCard } from './connect-card';

const SITE_KEY = 'jiraSite';
const CHOICE_KEY = 'jiraChoice';
const SITES_PERMISSION = { origins: ['https://*.atlassian.net/*'] };

type Site = { id: string; name: string; url: string };
type Project = { id: string; key: string; name: string; issueTypes: { id: string; name: string }[] };
type Connection = { sites: Site[]; account?: { name?: string; email?: string } };
type Result = { key?: string; url?: string; warning?: string; error?: string; issues: Issue[] };
type Mode = 'each' | 'review' | 'ticket';
type Shots = 'both' | 'detail' | 'viewport';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ordered: Issue[];
  numberOf: (issue: Issue) => number;
  group: Group | null;
  shots: string;
  reviewTitle: string;
};

type Choice = { siteId?: string; projectId?: string; typeId?: string; mode?: Mode };

function sameOrigin(a?: string, b?: string) {
  try {
    return new URL(a ?? '').origin === new URL(b ?? '').origin;
  } catch {
    return false;
  }
}

/** The lib's Jira helpers take a numbering over plain objects. */
const byNumber = (numberOf: (issue: Issue) => number) => numberOf as (issue: object) => number;
const label = (issue: Issue, numberOf: (issue: Issue) => number) => `${pad(numberOf(issue))} ${issue.title || 'Untitled comment'}`;
const valid = <T extends { id: string }>(items: T[], id?: string | null) => (id && items.some((i) => i.id === id) ? id : undefined);

/** Creates Jira issues from the review through the API once connected, or opens Jira's own create form without a sign-in. */
export function JiraDialog({ open, onOpenChange, ...rest }: Props) {
  const connection = useConnection<Connection>('jira', open);
  const current = connection.data?.sites?.length ? connection.data : connection.isPending ? undefined : null;
  const [busy, setBusy] = useState(false);
  const who = current ? current.account?.name || current.account?.email || 'your Atlassian account' : '';

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent showCloseButton={!busy} className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)] gap-0 p-0 sm:max-w-xl">
        <DialogHeader className="border-b p-5 pr-12">
          <DialogTitle>Send to Jira</DialogTitle>
          <DialogDescription>{current === undefined ? 'Checking your Jira connection' : current ? `Connected as ${who}` : 'Not connected'}</DialogDescription>
        </DialogHeader>
        {current === undefined ? (
          <div className="grid gap-3 p-5" aria-busy>
            <span className="h-8 animate-pulse rounded-lg bg-muted" />
            <span className="h-20 animate-pulse rounded-lg bg-muted" />
          </div>
        ) : current ? (
          <Connected current={current} {...rest} onBusy={setBusy} onClose={() => onOpenChange(false)} />
        ) : (
          <NotConnected {...rest} onClose={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Layout({ body, state, children }: { body: ReactNode; state: string; children: ReactNode }) {
  return (
    <>
      <div className="grid grid-cols-[minmax(0,1fr)] content-start gap-5 overflow-y-auto p-5">{body}</div>
      <DialogFooter className="m-0 items-center rounded-b-xl">
        <p className="mr-auto text-sm font-medium text-muted-foreground" role="status">
          {state}
        </p>
        {children}
      </DialogFooter>
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </div>
  );
}

function Picker({ label: name, value, items, onChange, disabled }: { label: string; value: string; items: { id: string; name: string }[]; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <Field label={name}>
      <Select value={value || null} onValueChange={(v) => v && onChange(v as string)} items={items.map((i) => ({ value: i.id, label: i.name }))} disabled={disabled || !items.length}>
        <SelectTrigger aria-label={name} className="w-full min-w-0">
          <SelectValue placeholder={items.length ? 'Pick one' : 'Loading'} />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.id} value={item.id}>
              {item.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function ModePicks({ value, onChange, count, ticket }: { value: Mode; onChange: (mode: Mode) => void; count: number; ticket: string | null }) {
  const whole = ticket ? 'ticket' : 'review';
  const options = [
    { value: 'each', title: 'One issue per comment', hint: `${plural(count, 'issue', 'issues')}${ticket ? `, each linked to ${ticket}` : ''}` },
    { value: whole, title: ticket ? `One comment on ${ticket}` : 'One issue for the whole review', hint: 'Every comment as a numbered section' },
  ];
  return (
    <RadioGroup value={value} onValueChange={(v) => onChange(v as Mode)} aria-label="How to send" className="gap-2">
      {options.map((o) => (
        <label key={o.value} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-data-checked:border-primary">
          <RadioGroupItem value={o.value} className="mt-0.5" />
          <span className="grid gap-0.5">
            <span className="text-sm font-medium">{o.title}</span>
            <span className="text-sm font-medium text-muted-foreground">{o.hint}</span>
          </span>
        </label>
      ))}
    </RadioGroup>
  );
}

function ResultCard({ ok, title, url, text }: { ok: boolean; title: ReactNode; url?: string; text?: string }) {
  return (
    <div className={ok ? 'grid gap-1 rounded-lg border p-3' : 'grid gap-1 rounded-lg border border-destructive/50 p-3'}>
      <p className="flex items-center gap-2 text-sm font-medium">
        {url && (
          <a href={url} target="_blank" rel="noopener" className="inline-flex items-center gap-1 font-semibold underline underline-offset-3">
            {title}
            <ExternalLink className="size-4" />
          </a>
        )}
        {!url && title}
      </p>
      {text && <p className="text-sm font-medium text-muted-foreground">{text}</p>}
    </div>
  );
}

type ConnectedProps = Omit<Props, 'open' | 'onOpenChange'> & { current: Connection; onBusy: (busy: boolean) => void; onClose: () => void };

/** The full send: pick a site, project and issue type, then create the issues through the API. */
function Connected({ current, ordered, numberOf, group, shots, reviewTitle, onBusy, onClose }: ConnectedProps) {
  const ticket = group?.jira?.key ?? null;
  const ticketSite = ticket ? current.sites.find((s) => sameOrigin(s.url, group?.jira?.url)) : undefined;
  const pending = ordered.filter((issue) => !issue.jira?.key);
  const linkedCount = ordered.length - pending.length;
  const choice = useStorageValue<Choice>(CHOICE_KEY, {}).data;
  const [picked, setPicked] = useState<Choice>({});
  const siteId = valid(current.sites, picked.siteId) ?? ticketSite?.id ?? valid(current.sites, choice.siteId) ?? current.sites[0]!.id;
  const projectsQuery = useQuery({ queryKey: ['jira-projects', siteId], queryFn: () => listProjects(siteId) as Promise<Project[]> });
  const projects = projectsQuery.data ?? [];
  const ticketProject = ticket && siteId === ticketSite?.id ? projects.find((p) => p.key === ticket.split('-')[0])?.id : undefined;
  const projectId = valid(projects, picked.projectId) ?? ticketProject ?? valid(projects, choice.projectId) ?? projects[0]?.id ?? '';
  const types = projects.find((p) => p.id === projectId)?.issueTypes ?? [];
  const typeId = valid(types, picked.typeId) ?? valid(types, choice.typeId) ?? defaultType(types)?.id ?? '';
  const mode: Mode = picked.mode ?? (ticket ? 'each' : choice.mode === 'review' ? 'review' : 'each');
  const [state, setState] = useState('');
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<ReactNode>(null);
  const [goLabel, setGoLabel] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const loadState = projectsQuery.error ? (projectsQuery.error as Error).message : projectsQuery.isSuccess && !projects.length ? 'This site has no projects you can create issues in.' : '';

  const count = mode === 'each' ? pending.length : 1;
  const busy = (on: boolean) => {
    setRunning(on);
    onBusy(on);
  };

  const run = async () => {
    if (mode === 'ticket') {
      const site = ticketSite ?? current.sites[0]!;
      busy(true);
      setState(`Commenting on ${ticket}. Keep this open until it finishes.`);
      try {
        const result = await commentOnTicket({ site, key: ticket!, issues: ordered, shots: shots as Shots, reviewTitle, numberOf: byNumber(numberOf) });
        setResults(<ResultCard ok title={`${ticket} has the review as a comment`} url={result.url} text={result.warning} />);
        setState('Comment added');
        setDone(true);
      } catch (err) {
        setResults(<ResultCard ok={false} title={`The comment was not added to ${ticket}`} text={(err as Error).message} />);
        setState('');
      } finally {
        busy(false);
      }
      return;
    }
    const issues = mode === 'review' ? ordered : pending;
    if (!issues.length) return setState('Every comment already has a Jira issue.');
    await chrome.storage.local.set({ [CHOICE_KEY]: { siteId, projectId, typeId, mode } });
    const site = current.sites.find((s) => s.id === siteId)!;
    busy(true);
    setGoLabel('Creating');
    setState('Creating. Keep this open until it finishes.');
    let made: Result[];
    try {
      made = (await createIssues({
        site,
        projectId,
        issueTypeId: typeId,
        issues,
        mode,
        shots: shots as Shots,
        reviewTitle,
        numberOf: byNumber(numberOf),
        linkTo: mode === 'each' ? group?.jira?.key : undefined,
        onProgress: (n: number, total: number) => setState(`Created ${n} of ${total}. Keep this open until it finishes.`),
      })) as Result[];
    } catch (err) {
      setState((err as Error).message);
      setGoLabel(null);
      busy(false);
      return;
    }
    for (const r of made.filter((x) => x.key)) {
      const jira: JiraLink = { key: r.key!, url: r.url };
      if (mode === 'review') {
        if (group) await patchGroup(group.id, { jira: { ...group.jira, ...jira } });
      } else if (r.issues[0]) {
        await send('update', { id: r.issues[0].id, patch: { jira } });
      }
    }
    setResults(
      made.map((r, i) =>
        r.key ? (
          <ResultCard key={i} ok title={`${r.key} ${mode === 'review' || !r.issues[0] ? reviewTitle : label(r.issues[0], numberOf)}`} url={r.url} text={r.warning} />
        ) : (
          <ResultCard key={i} ok={false} title={r.issues[0] ? label(r.issues[0], numberOf) : 'Untitled comment'} text={r.error} />
        ),
      ),
    );
    const ok = made.filter((r) => r.key).length;
    setState(ok === made.length ? `Created ${plural(ok, 'issue', 'issues')}` : `${ok} of ${made.length} created`);
    setGoLabel(ok === made.length ? null : 'Try the rest again');
    setDone(ok === made.length);
    busy(false);
  };

  const go = goLabel ?? (mode === 'ticket' ? `Comment on ${ticket}` : mode === 'each' ? `Create ${plural(count, 'issue', 'issues')}` : 'Create 1 issue');

  return (
    <Layout
      state={state || loadState || (count ? '' : 'Every comment already has a Jira issue.')}
      body={
        <>
          {ticket && (
            <p className="text-sm">
              This review is linked to <b className="font-semibold">{ticket}</b>
              {group?.jira?.summary ? ` ${group.jira.summary}` : ''}. A change here applies to this send only.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <Picker label="Site" value={siteId} items={current.sites} onChange={(v) => setPicked({ mode: picked.mode, siteId: v })} disabled={running} />
            <Picker
              label="Project"
              value={projectId}
              items={projects.map((p) => ({ id: p.id, name: `${p.name} (${p.key})` }))}
              onChange={(v) => setPicked({ ...picked, projectId: v, typeId: undefined })}
              disabled={running}
            />
            <Picker label="Issue type" value={typeId} items={types} onChange={(v) => setPicked({ ...picked, typeId: v })} disabled={running} />
          </div>
          <ModePicks value={mode} onChange={(v) => setPicked({ ...picked, mode: v })} count={pending.length} ticket={ticket} />
          <p className="text-sm font-medium text-muted-foreground">
            Severity sets the priority, the numbered marker notes become a numbered list, and the screenshots are attached.
            {linkedCount ? ` ${plural(linkedCount, 'comment already has', 'comments already have')} an issue and ${linkedCount === 1 ? 'is' : 'are'} left out of one issue per comment.` : ''}
          </p>
          {results && <div className="grid gap-2">{results}</div>}
        </>
      }
    >
      <Button variant="outline" onClick={onClose} disabled={running}>
        Close
      </Button>
      {!done && count > 0 && (
        <Button onClick={run} disabled={running || (mode !== 'ticket' && !projects.length)}>
          {go}
        </Button>
      )}
    </Layout>
  );
}

type NotConnectedProps = Pick<Props, 'ordered' | 'numberOf' | 'group' | 'reviewTitle'> & { onClose: () => void };

/** A site to start from: the review's ticket, the last site used, or an open Jira tab when Margin may see it. */
async function guessSite(linked: string | null) {
  const stored = linked ?? ((await chrome.storage.local.get(SITE_KEY))[SITE_KEY] as string | undefined);
  const found = !stored && (await chrome.permissions.contains(SITES_PERMISSION)) ? ((await openSites()) as string[])[0] : null;
  return stored || found ? new URL((stored || found)!).host : '';
}

/** The no sign-in path: Jira's own create form, filled in, plus the offer to connect. */
function NotConnected({ ordered, numberOf, group, reviewTitle, onClose }: NotConnectedProps) {
  const guess = useQuery({ queryKey: ['jira-site-guess', group?.jira?.url], queryFn: () => guessSite(siteOrigin(group?.jira?.url ?? '')) });
  const [typed, setTyped] = useState<string | null>(null);
  const [looked, setLooked] = useState<string | null>(null);
  const [siteState, setSiteState] = useState('');
  const [picked, setPicked] = useState<{ projectId?: string; typeId?: string }>({});
  const [mode, setMode] = useState<Mode>('each');
  const site = typed ?? guess.data ?? '';
  const origin = siteOrigin(looked ?? guess.data ?? '');
  /** Uses the browser's own Jira sign-in, when Margin may reach the site, to offer the site's projects. */
  const projectsQuery = useQuery({
    queryKey: ['jira-session-projects', origin],
    enabled: Boolean(origin),
    queryFn: async () => ((await chrome.permissions.contains(SITES_PERMISSION)) ? (((await sessionProjects(origin!)) as Project[] | null) ?? []) : []),
  });
  const projects = projectsQuery.data ?? [];
  const projectId = valid(projects, picked.projectId) ?? projects.find((p) => p.key === group?.jira?.key?.split('-')[0])?.id ?? projects[0]?.id ?? '';
  const types = projects.find((p) => p.id === projectId)?.issueTypes ?? [];
  const typeId = valid(types, picked.typeId) ?? defaultType(types)?.id ?? '';

  const findSite = async () => {
    if (!(await chrome.permissions.request(SITES_PERMISSION))) return setSiteState('Type your Jira site instead.');
    const sites = (await openSites()) as string[];
    const host = sites[0] ? new URL(sites[0]).host : null;
    if (host) {
      setTyped(host);
      setLooked(host);
    }
    setSiteState(host ? `Found ${host}` : 'Open your Jira site in a tab, or type it here.');
  };

  /** Opens Jira's create form for some comments in a new tab. */
  const openForm = async (issues: Issue[]) => {
    const target = siteOrigin(site);
    if (!target) return setSiteState('Type your Jira site, like yourteam.atlassian.net.');
    await chrome.storage.local.set({ [SITE_KEY]: target });
    chrome.tabs.create({ url: createLink(target, { ...linkFields(issues, reviewTitle, byNumber(numberOf)), projectId: projectId || undefined, issueTypeId: typeId || undefined }) });
  };

  return (
    <Layout
      state=""
      body={
        <>
          <ConnectCard
            provider="jira"
            name="Jira"
            body="Margin creates the issues for you, sets the priority from the severity and attaches the screenshots. It takes one sign-in."
          />
          <div className="grid gap-1">
            <h3 className="text-sm font-semibold">Or use Jira's create form, no sign-in</h3>
            <p className="text-sm font-medium text-muted-foreground">Jira opens with the summary and description filled in. Check it and press Create there. Screenshots stay in the Margin report.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Jira site">
              <Input
                value={site}
                placeholder="yourteam.atlassian.net"
                aria-label="Jira site"
                onChange={(e) => {
                  setTyped(e.target.value);
                  setSiteState('');
                }}
                onBlur={() => setLooked(site)}
              />
            </Field>
            {projects.length > 0 && (
              <>
                <Picker
                  label="Project"
                  value={projectId}
                  items={projects.map((p) => ({ id: p.id, name: `${p.name} (${p.key})` }))}
                  onChange={(v) => setPicked({ projectId: v })}
                />
                <Picker label="Issue type" value={typeId} items={types} onChange={(v) => setPicked({ ...picked, typeId: v })} />
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" size="sm" onClick={findSite}>
              Find my site
            </Button>
            <span className="text-sm font-medium text-muted-foreground" role="status">
              {siteState}
            </span>
          </div>
          <ModePicks value={mode} onChange={setMode} count={ordered.length} ticket={null} />
          {mode === 'each' && (
            <ul className="grid divide-y rounded-lg border">
              {ordered.map((issue) => (
                <li key={issue.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="text-xs font-medium text-muted-foreground tabular-nums">{pad(numberOf(issue))}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">{issue.title || 'Untitled comment'}</span>
                  {issue.jira?.key && <span className="text-sm font-medium text-muted-foreground">{issue.jira.key}</span>}
                  <Button variant="outline" size="sm" onClick={() => openForm([issue])}>
                    Open in Jira
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </>
      }
    >
      <Button variant="outline" onClick={onClose}>
        Close
      </Button>
      {mode === 'review' && <Button onClick={() => openForm(ordered)}>Open in Jira</Button>}
    </Layout>
  );
}
