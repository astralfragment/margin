/**
 * A comment number as the screens show it, with at least two digits.
 * @param value The number.
 */
export const padNumber = (value: number) => String(value).padStart(2, '0');
