/**
 * Jira and Figma sign-in. Each provider needs a client secret to hand out tokens, so codes and refresh tokens
 * are swapped by Margin's helper on lilacfragment.co.za, which keeps the secrets and stores nothing.
 * Every other request goes from here straight to the provider's API.
 */

export const TOKEN_ENDPOINT = 'https://lilacfragment.co.za/margin-oauth.php';
const KEY = 'connections';
const EARLY = 60_000;

export const PROVIDERS = {
  jira: {
    name: 'Jira',
    clientId: '',
    origins: ['https://api.atlassian.com/*'],
    scopes: ['read:jira-work', 'write:jira-work', 'read:me', 'offline_access'],
    authorize: (p) =>
      `https://auth.atlassian.com/authorize?${new URLSearchParams({
        audience: 'api.atlassian.com',
        client_id: p.clientId,
        scope: p.scopes.join(' '),
        redirect_uri: TOKEN_ENDPOINT,
        state: p.state,
        response_type: 'code',
        prompt: 'consent',
      })}`,
  },
  figma: {
    name: 'Figma',
    clientId: '',
    origins: ['https://api.figma.com/*'],
    scopes: ['file_comments:write', 'current_user:read'],
    authorize: (p) =>
      `https://www.figma.com/oauth?${new URLSearchParams({
        client_id: p.clientId,
        redirect_uri: TOKEN_ENDPOINT,
        scope: p.scopes.join(' '),
        state: p.state,
        response_type: 'code',
        code_challenge: p.challenge,
        code_challenge_method: 'S256',
      })}`,
  },
};

/**
 * Encodes bytes as base64url without padding.
 * @param {ArrayBuffer | Uint8Array} bytes The bytes to encode.
 */
function base64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

/**
 * A random base64url string.
 * @param {number} size How many random bytes it carries.
 */
const randomText = (size) => base64url(crypto.getRandomValues(new Uint8Array(size)));

/** Reads every stored connection, keyed by provider. */
export async function readConnections() {
  return (await chrome.storage.local.get(KEY))[KEY] ?? {};
}

/**
 * Reads one provider's connection, or null when it is not connected.
 * @param {'jira' | 'figma'} provider The provider.
 */
export async function connection(provider) {
  return (await readConnections())[provider] ?? null;
}

/**
 * Replaces one provider's stored connection, or removes it when given null.
 * @param {'jira' | 'figma'} provider The provider.
 * @param {object | null} value The connection to keep.
 */
async function writeConnection(provider, value) {
  const all = await readConnections();
  if (value) all[provider] = value;
  else delete all[provider];
  await chrome.storage.local.set({ [KEY]: all });
}

/**
 * Asks the sign-in helper for tokens and turns the answer into stored token fields.
 * @param {'jira' | 'figma'} provider The provider.
 * @param {object} body The code or refresh token to swap.
 */
async function swap(provider, body) {
  let res;
  try {
    res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, ...body }),
    });
  } catch {
    throw new Error('Could not reach the Margin sign-in helper. Check your connection and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const reason = data.error === 'not_configured' ? 'Sign-in is not set up on the server yet.' : data.error_description || data.message || data.error;
    throw Object.assign(new Error(`${PROVIDERS[provider].name} sign-in failed${reason ? `. ${reason}` : ''}`), { code: data.error });
  }
  return {
    access: data.access_token,
    refresh: data.refresh_token ?? body.refresh_token ?? null,
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
  };
}

/**
 * Asks Chrome for the provider's API host. Call it straight from a click, before any other await, or Chrome refuses.
 * @param {'jira' | 'figma'} provider The provider.
 */
export function requestAccess(provider) {
  return chrome.permissions.request({ origins: PROVIDERS[provider].origins });
}

/**
 * Runs the whole sign-in: the provider's consent page in a Chrome window, the code swap, then the account details.
 * The caller asks for host access first with requestAccess, inside the click.
 * @param {'jira' | 'figma'} provider The provider.
 */
export async function connect(provider) {
  const p = PROVIDERS[provider];
  if (!p.clientId) throw new Error(`${p.name} sign-in is not set up in this build yet.`);
  if (!(await chrome.permissions.contains({ origins: p.origins }))) {
    throw new Error(`Margin needs permission to reach ${p.name}. Try Connect again and choose Allow.`);
  }
  const state = `${provider}.${chrome.runtime.id}.${randomText(24)}`;
  const verifier = randomText(48);
  const challenge = base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  let redirect;
  try {
    redirect = await chrome.identity.launchWebAuthFlow({
      url: p.authorize({ ...p, state, challenge }),
      interactive: true,
    });
  } catch {
    throw new Error(`${p.name} sign-in was closed before it finished.`);
  }
  const params = new URL(redirect).searchParams;
  if (params.get('state') !== state) throw new Error(`${p.name} sign-in came back from a different attempt. Try again.`);
  if (params.get('error')) throw new Error(`${p.name} sign-in was cancelled.`);
  const tokens = await swap(provider, { grant: 'code', code: params.get('code'), code_verifier: verifier });
  await writeConnection(provider, { ...tokens, connectedAt: new Date().toISOString() });
  let details;
  try {
    details = provider === 'jira' ? await jiraDetails() : await figmaDetails();
  } catch (err) {
    await writeConnection(provider, null);
    throw new Error(`${p.name} sign-in worked, but reading the account failed. ${err.message}`);
  }
  await writeConnection(provider, { ...(await connection(provider)), ...details });
  return connection(provider);
}

/** The signed-in Atlassian account and the Jira sites it can reach. */
async function jiraDetails() {
  const [me, resources] = await Promise.all([
    authedJson('jira', 'https://api.atlassian.com/me'),
    authedJson('jira', 'https://api.atlassian.com/oauth/token/accessible-resources'),
  ]);
  return {
    account: { name: me.name ?? me.nickname ?? '', email: me.email ?? '' },
    sites: resources
      .filter((r) => r.scopes?.some((s) => s.includes('jira')))
      .map((r) => ({ id: r.id, name: r.name, url: r.url })),
  };
}

/** The signed-in Figma account. */
async function figmaDetails() {
  const me = await authedJson('figma', 'https://api.figma.com/v1/me');
  return { account: { name: me.handle ?? '', email: me.email ?? '' } };
}

/**
 * Forgets a provider's tokens and gives back its API host permission.
 * @param {'jira' | 'figma'} provider The provider.
 */
export async function disconnect(provider) {
  await writeConnection(provider, null);
  await chrome.permissions.remove({ origins: PROVIDERS[provider].origins }).catch(() => {});
}

/**
 * Swaps the refresh token for a new access token and stores the result.
 * @param {'jira' | 'figma'} provider The provider.
 * @param {object} current The stored connection.
 */
async function renew(provider, current) {
  if (!current.refresh) throw new Error(`${PROVIDERS[provider].name} sign-in has expired. Connect again.`);
  const tokens = await swap(provider, { grant: 'refresh', refresh_token: current.refresh }).catch(async (err) => {
    if (err.code === 'invalid_grant') await writeConnection(provider, null);
    throw new Error(`${PROVIDERS[provider].name} sign-in has expired. Connect again.`);
  });
  const next = { ...current, ...tokens };
  await writeConnection(provider, next);
  return next;
}

/**
 * Fetches with the provider's access token, renewing it first when it is about to run out, and once more after a 401.
 * @param {'jira' | 'figma'} provider The provider.
 * @param {string} url The API address.
 * @param {RequestInit} [init] The request options.
 */
export async function authedFetch(provider, url, init = {}) {
  let current = await connection(provider);
  if (!current) throw new Error(`Connect ${PROVIDERS[provider].name} first.`);
  if (Date.now() > current.expiresAt - EARLY) current = await renew(provider, current);
  const send = (token) => fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
  let res = await send(current.access);
  if (res.status === 401) {
    current = await renew(provider, current);
    res = await send(current.access);
  }
  return res;
}

/**
 * Fetches JSON with the provider's access token and throws the API's own message on failure.
 * @param {'jira' | 'figma'} provider The provider.
 * @param {string} url The API address.
 * @param {RequestInit} [init] The request options.
 */
export async function authedJson(provider, url, init) {
  const res = await authedFetch(provider, url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(apiError(data) || `${PROVIDERS[provider].name} answered ${res.status}`), { status: res.status, data });
  return data;
}

/**
 * Pulls a readable message out of a Jira or Figma error body.
 * @param {object} data The parsed error body.
 */
function apiError(data) {
  const fields = Object.values(data?.errors ?? {});
  return [...(data?.errorMessages ?? []), ...fields, data?.message, data?.err].filter(Boolean).join(' ');
}
