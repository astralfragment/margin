import { createContext, useContext } from 'react';

/**
 * Where menus, tooltips and lists render. Pages leave it empty, so they render into the body. The overlay sets it to
 * an element inside its shadow root, where its styles apply and the page cannot reach.
 */
export const PortalContainerContext = createContext<HTMLElement | null>(null);

/** The element popups render into, or undefined for the document body. */
export const usePortalContainer = () => useContext(PortalContainerContext) ?? undefined;
