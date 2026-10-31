import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Joins class names and lets later Tailwind utilities win over earlier ones, so components can take a className override. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
