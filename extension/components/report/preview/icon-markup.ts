import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { LucideIcon } from 'lucide-react';

const cache = new Map<LucideIcon, string>();

/** A Lucide icon as SVG markup, for the controls added inside the preview document, which React does not render. */
export function iconMarkup(icon: LucideIcon) {
  const cached = cache.get(icon);
  if (cached) return cached;
  const host = document.createElement('div');
  const root = createRoot(host);
  flushSync(() => root.render(createElement(icon, { 'aria-hidden': true, size: 16, strokeWidth: 2 })));
  const html = host.innerHTML;
  root.unmount();
  cache.set(icon, html);
  return html;
}
