import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

const ICONS = {
  16: 'icons/icon16.png',
  48: 'icons/icon48.png',
  128: 'icons/icon128.png',
};

export default defineConfig({
  srcDir: 'extension',
  publicDir: 'extension/public',
  modules: ['@wxt-dev/module-react'],
  vite: () => ({ plugins: [tailwindcss()] }),
  zip: { artifactTemplate: 'margin-{{version}}-chrome.zip' },
  manifest: {
    name: 'Margin - Website Annotation, Screenshots & Bug Reports',
    description:
      'Annotate any website and mark up screenshots for UI review, design QA and client feedback. Send bug reports to Jira, Figma or Docs.',
    permissions: ['activeTab', 'scripting', 'storage', 'unlimitedStorage', 'clipboardWrite', 'contextMenus', 'identity'],
    optional_host_permissions: ['https://api.atlassian.com/*', 'https://api.figma.com/*', 'https://*.atlassian.net/*'],
    web_accessible_resources: [{ resources: ['fonts/*.woff2', 'icons/ui/*.svg'], matches: ['<all_urls>'] }],
    action: { default_title: 'Margin', default_icon: ICONS },
    icons: ICONS,
    commands: {
      'toggle-annotate': {
        suggested_key: { default: 'Alt+Shift+M' },
        description: 'Toggle annotation mode on the current tab',
      },
    },
  },
  hooks: {
    /** WXT treats content.ts as a manifest content script, but the background injects it on demand. */
    'entrypoints:found': (_wxt, infos) => {
      for (const info of infos) if (info.name === 'content') info.type = 'unlisted-script';
    },
    /** Help and settings opens in a full tab, which options_page gives and WXT's default options_ui does not. */
    'build:manifestGenerated': (_wxt, manifest) => {
      if (!manifest.options_ui) return;
      manifest.options_page = manifest.options_ui.page;
      delete manifest.options_ui;
    },
  },
});
