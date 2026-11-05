import { useMutation } from '@tanstack/react-query';
import { CircleCheck, Frame, Kanban } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Spinner } from '@/components/ui/spinner';
import type { Connection, Provider } from '@/lib/model';
import { connect, disconnect, PROVIDERS, requestAccess } from '@/lib/oauth.js';
import { connectionsItem, reviewSheetDraftItem } from '@/lib/storage';
import { useStored } from './queries';

const SIGN_IN_WAIT = 2 * 60_000;

const SERVICES: Record<Provider, { icon: typeof Kanban; does: string }> = {
  jira: { icon: Kanban, does: 'Create Jira issues from a review, with the screenshots attached.' },
  figma: { icon: Frame, does: 'Post comments on the Figma frames your review links to.' },
};

/** The provider whose row the page was opened for, such as from a review sheet's Connect link. */
const arrivedFor = (['jira', 'figma'] as const).find((provider) => location.hash === `#connect-${provider}`);

/**
 * Brings the row's button into view and focuses it, for a page opened from a review sheet.
 * @param button The row's main button, or null when it unmounts.
 */
function focusOnArrival(button: HTMLButtonElement | null) {
  button?.scrollIntoView({ block: 'center' });
  button?.focus();
}

/**
 * Waits for the Chrome permission prompt, then runs the sign-in, giving up after two minutes.
 * @param provider The service.
 * @param access The permission request, made inside the click so Chrome allows it.
 */
async function signIn(provider: Provider, access: Promise<boolean>) {
  const { name } = PROVIDERS[provider];
  if (!(await access)) throw new Error(`Margin needs permission to reach ${name}. Choose Allow to connect.`);
  let timer = 0;
  const giveUp = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(`${name} sign-in did not finish. Connect to try again.`)), SIGN_IN_WAIT);
  });
  try {
    return await Promise.race([connect(provider), giveUp]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Says who a connection is signed in as, and which Jira sites it reaches.
 * @param connection The stored connection.
 */
function signedInAs(connection: Connection) {
  const who = [connection.account?.name, connection.account?.email].filter(Boolean).join(', ') || 'your account';
  const sites = connection.sites?.map((site) => site.name ?? site.url).join(', ');
  return `Signed in as ${who}.${sites ? ` Jira sites ${sites}.` : ''}`;
}

/**
 * One service with its Connect or Disconnect button and what it is doing now.
 * @param props.provider The service.
 */
function ConnectionRow({ provider }: { provider: Provider }) {
  const connection = useStored(connectionsItem)[provider];
  const { name } = PROVIDERS[provider];
  const { icon: Icon, does } = SERVICES[provider];
  const signInAttempt = useMutation({ mutationFn: (access: Promise<boolean>) => signIn(provider, access) });
  const disconnecting = useMutation({ mutationFn: () => disconnect(provider) });
  const problem = signInAttempt.error ?? disconnecting.error;
  const arrivalRef = arrivedFor === provider ? focusOnArrival : undefined;

  /** Asks Chrome for the service's host first, synchronously inside the click, then starts the sign-in. */
  const startSignIn = () => {
    disconnecting.reset();
    signInAttempt.mutate(requestAccess(provider));
  };

  let status = does;
  if (connection) status = signedInAs(connection);
  else if (signInAttempt.isPending) status = `Waiting for ${name} sign-in in the window that opened.`;

  return (
    <Item variant="outline" id={`connect-${provider}`}>
      <ItemMedia variant="icon" className="size-9 rounded-md bg-muted">
        <Icon />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>
          {name}
          {connection && (
            <Badge className="bg-[#e6f6eb] text-[#18794e] dark:bg-[#132d21] dark:text-[#3dd68c]">
              <CircleCheck data-icon="inline-start" />
              Connected
            </Badge>
          )}
        </ItemTitle>
        <ItemDescription className="line-clamp-none">{status}</ItemDescription>
        {problem && !signInAttempt.isPending && (
          <p role="alert" className="text-sm text-destructive">
            {problem.message}
          </p>
        )}
      </ItemContent>
      <ItemActions>
        {connection ? (
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="outline" ref={arrivalRef} />}>Disconnect</AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Disconnect {name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  Margin forgets the sign-in and gives back its access to {name}. Connecting again needs a full sign-in.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep connected</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => disconnecting.mutate()}>
                  Disconnect
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : signInAttempt.isPending ? (
          <Button variant="outline" onClick={() => signInAttempt.reset()}>
            <Spinner data-icon="inline-start" />
            Cancel
          </Button>
        ) : (
          <Button ref={arrivalRef} onClick={startSignIn}>
            Connect
          </Button>
        )}
      </ItemActions>
    </Item>
  );
}

/** Tells someone who left a review sheet to connect a service how to get back to it. */
function ReturnNote() {
  const draft = useStored(reviewSheetDraftItem);
  const connections = useStored(connectionsItem);
  if (!arrivedFor || !draft) return null;
  const { name } = PROVIDERS[arrivedFor];
  return (
    <Alert>
      <AlertDescription>
        {connections[arrivedFor]
          ? `${name} is connected. Click Margin in the toolbar to finish your review.`
          : 'Your review sheet is kept. Once connected, click Margin in the toolbar to finish it.'}
      </AlertDescription>
    </Alert>
  );
}

/** Jira and Figma, each one Connect button away. */
export function Connections() {
  return (
    <ItemGroup className="gap-3">
      <ReturnNote />
      <ConnectionRow provider="jira" />
      <ConnectionRow provider="figma" />
    </ItemGroup>
  );
}
