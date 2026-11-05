/**
 * Small text helpers the report screens share.
 */

/**
 * A comment number as two digits, such as 07.
 * @param number The number.
 */
export const pad = (number: number) => String(number).padStart(2, '0');

/**
 * A count with its noun, such as 1 comment or 3 comments.
 * @param count How many.
 * @param one The noun for one.
 * @param many The noun for more than one.
 */
export const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * The host of an address, or the text itself when it is not one.
 * @param url The address.
 */
export function hostOf(url: string | undefined) {
  try {
    return new URL(url ?? '').host;
  } catch {
    return url ?? '';
  }
}

/**
 * True when two addresses are the same page, ignoring the query and hash.
 * @param first One address.
 * @param second The other.
 */
export function samePage(first: string | undefined, second: string | undefined) {
  try {
    const one = new URL(first ?? '');
    const two = new URL(second ?? '');
    return one.origin === two.origin && one.pathname === two.pathname;
  } catch {
    return false;
  }
}

/**
 * A date as a file name part, such as 20261031-0930.
 * @param date The date.
 */
export const stamp = (date: Date) =>
  `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
