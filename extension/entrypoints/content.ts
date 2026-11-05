/**
 * The overlay's loader. The background injects it on demand as content.js, so wxt.config.ts builds it as an unlisted
 * script. It stays small and holds no React. It answers the background's messages and loads overlay.js, the React
 * overlay, as an ES module the first time annotation starts.
 */
import type { OverlayApi } from '@/overlay/api';
import { onOverlayMessage, type OverlayMessageName, type OverlayProtocolMap, type OverlayStart } from '@/lib/overlay-protocol';

type Answers = { [Name in OverlayMessageName]: (data: Parameters<OverlayProtocolMap[Name]>[0]) => Promise<ReturnType<OverlayProtocolMap[Name]>> };

let loading: Promise<OverlayApi> | null = null;

/** Loads the React overlay once. It registers itself on window, since Vite drops the exports of page entries. */
function loadOverlay() {
  loading ??= import(/* @vite-ignore */ chrome.runtime.getURL('/overlay.js'))
    .then(() => {
      if (!window.__marginOverlay) throw new Error('The Margin overlay did not start on this page');
      return window.__marginOverlay;
    })
    .catch((error: unknown) => {
      loading = null;
      console.error('Margin: the overlay could not load', error);
      throw error;
    });
  return loading;
}

/** The overlay when it has loaded, for messages that mean nothing before annotation has started. */
const loaded = () => window.__marginOverlay ?? null;

const answers: Answers = {
  async ping() {
    return { ok: true, active: loaded()?.isActive() ?? false };
  },
  async toggle(start) {
    const overlay = await loadOverlay();
    return { active: await overlay.setActive(!overlay.isActive(), start) };
  },
  async start({ notice, ...start }) {
    const overlay = await loadOverlay();
    const active = await overlay.setActive(true, start);
    if (notice) overlay.toast(notice);
    return { active };
  },
  async stop() {
    return { active: (await loaded()?.setActive(false)) ?? false };
  },
  async zoom({ zoom }) {
    loaded()?.setZoom(zoom);
    return { ok: true };
  },
  async toast({ text }) {
    loaded()?.toast(text);
    return { ok: true };
  },
  async captureViewport(start) {
    const overlay = await loadOverlay();
    await overlay.setActive(true, start);
    overlay.captureViewport();
    return { active: true };
  },
};

/**
 * Registers the typed answer to one message.
 * @param name The message name.
 */
function answer<Name extends OverlayMessageName>(name: Name) {
  onOverlayMessage(name, ({ data }) => answers[name](data as Parameters<OverlayProtocolMap[Name]>[0]) as never);
}

/** A message in the older `{ type, ...fields }` shape, which the popup still sends until it is rebuilt. */
interface LegacyMessage {
  type: OverlayMessageName;
  groupName?: string;
  zoom?: number;
  notice?: string;
  text?: string;
}

/**
 * True for an older-shaped message this script answers. Typed messages carry a timestamp and go to `answer`.
 * @param message What arrived.
 */
function isLegacy(message: unknown): message is LegacyMessage {
  return typeof message === 'object' && message !== null && 'type' in message && !('timestamp' in message) && (message.type as string) in answers;
}

/**
 * Answers an older-shaped message with the same answers as the typed ones.
 * @param message The message.
 */
function answerLegacy(message: LegacyMessage) {
  const start: OverlayStart = { reviewName: message.groupName ?? '', zoom: message.zoom ?? 1 };
  if (message.type === 'start') return answers.start({ ...start, notice: message.notice });
  if (message.type === 'toggle' || message.type === 'captureViewport') return answers[message.type](start);
  if (message.type === 'zoom') return answers.zoom({ zoom: message.zoom ?? 1 });
  if (message.type === 'toast') return answers.toast({ text: message.text ?? '' });
  if (message.type === 'stop') return answers.stop(undefined);
  return answers.ping(undefined);
}

export default defineUnlistedScript(() => {
  if (window.__uiAnnotator) return;
  window.__uiAnnotator = {
    setActive: async (active) => (active ? (await loadOverlay()).setActive(true) : ((await loaded()?.setActive(false)) ?? false)),
    isActive: () => loaded()?.isActive() ?? false,
    hideForCapture: (hidden) => loaded()?.hideForCapture(hidden),
  };
  (Object.keys(answers) as OverlayMessageName[]).forEach(answer);
  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isLegacy(message)) return false;
    answerLegacy(message).then(sendResponse, (error: unknown) => sendResponse({ error: error instanceof Error ? error.message : String(error) }));
    return true;
  });
});
