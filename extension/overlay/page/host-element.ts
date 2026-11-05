let hostElement: HTMLElement | null = null;

/**
 * Records the element that hosts the overlay's shadow root, so page searches can skip it.
 * @param element The host.
 */
export function setHostElement(element: HTMLElement | null) {
  hostElement = element;
}

/** The element that hosts the overlay's shadow root, once it is mounted. */
export const getHostElement = () => hostElement;
