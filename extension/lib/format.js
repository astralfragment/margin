/**
 * Pads a number to two digits.
 * @param {number} n The number.
 */
export const pad = (n) => String(n).padStart(2, '0');

/**
 * A count with its word, using the plural form for anything but one.
 * @param {number} n The count.
 * @param {string} one The singular form.
 * @param {string} [many] The plural form, the singular with an s by default.
 */
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The host of an address, or an empty string when it is not a valid address.
 * @param {string} [url] The address.
 */
export function hostOf(url) {
  try {
    return new URL(url ?? '').host;
  } catch {
    return '';
  }
}
