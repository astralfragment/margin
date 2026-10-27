/**
 * A stand-in for the chrome extension APIs, so extension pages and the content
 * script run in a normal tab for screenshots. Storage starts from window.__SEED.
 */
(() => {
  const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
  const bag = clone(window.__SEED) ?? {};
  const session = {};
  const changeListeners = [];
  const messageListeners = [];
  const noopEvent = { addListener() {} };
  const fallback = { capture: { id: 'demo' } };

  window.__bag = bag;
  window.chrome = {
    storage: {
      local: {
        async get(keys) {
          const list = keys == null ? Object.keys(bag) : [].concat(keys);
          return Object.fromEntries(list.filter((k) => k in bag).map((k) => [k, clone(bag[k])]));
        },
        async set(values) {
          const changes = {};
          for (const [k, v] of Object.entries(values)) {
            changes[k] = { oldValue: bag[k], newValue: clone(v) };
            bag[k] = clone(v);
          }
          changeListeners.forEach((fn) => fn(changes, 'local'));
        },
        async remove(keys) {
          for (const k of [].concat(keys)) delete bag[k];
        },
        async getBytesInUse() {
          return JSON.stringify(bag).length;
        },
      },
      session: {
        async get(keys) {
          return Object.fromEntries([].concat(keys).filter((k) => k in session).map((k) => [k, clone(session[k])]));
        },
        async set(values) {
          Object.assign(session, clone(values));
        },
      },
      onChanged: { addListener: (fn) => changeListeners.push(fn) },
    },
    runtime: {
      onMessage: { addListener: (fn) => messageListeners.push(fn) },
      onStartup: noopEvent,
      onInstalled: noopEvent,
      getURL: (path) => path,
      getManifest: () => ({ version: window.__VERSION ?? '0.0.0' }),
      async openOptionsPage() {},
      sendMessage(msg) {
        return new Promise((resolve) => {
          for (const fn of messageListeners) if (fn(msg, {}, resolve)) return;
          resolve(fallback[msg?.type] ?? { ok: true });
        });
      },
    },
    action: { async setBadgeBackgroundColor() {}, async setBadgeText() {} },
    contextMenus: { async removeAll() {}, create() {}, onClicked: noopEvent },
    commands: { onCommand: noopEvent, getAll: async () => [{ name: 'toggle-annotate', shortcut: 'Alt+Shift+A' }] },
    tabs: {
      query: async () => [{ id: 1, windowId: 1, url: window.__TAB_URL ?? 'https://lilacfragment.co.za/', title: 'Lilac Fragment' }],
      async create() {},
      async update() {},
      captureVisibleTab: async () => window.__CAPTURE ?? blankCapture(),
      onZoomChange: noopEvent,
      onUpdated: noopEvent,
      onRemoved: noopEvent,
    },
    scripting: {
      executeScript: async ({ func, args = [] }) => (func ? [{ result: await func(...args) }] : [{ result: undefined }]),
    },
  };

  /** A plain capture the size of the window, used when no stand-in screenshot was seeded. */
  function blankCapture() {
    const canvas = document.createElement('canvas');
    canvas.width = innerWidth;
    canvas.height = innerHeight;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.92);
  }
})();
