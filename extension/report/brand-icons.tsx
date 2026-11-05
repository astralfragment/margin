import type { SVGProps } from 'react';

/**
 * The Jira mark, which Lucide does not carry.
 * @param props SVG attributes such as className.
 */
export function JiraIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" {...props}>
      <path fillRule="evenodd" d="M8 1L15 8L8 15L1 8L8 1ZM8 5.2L5.2 8L8 10.8L10.8 8L8 5.2Z" />
    </svg>
  );
}

/**
 * The Figma mark, which Lucide does not carry.
 * @param props SVG attributes such as className.
 */
export function FigmaIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M5.5 1H8V5.67H5.5C4.88 5.67 4.29 5.42 3.85 4.99C3.41 4.55 3.17 3.95 3.17 3.34C3.17 2.72 3.41 2.12 3.85 1.68C4.29 1.25 4.88 1 5.5 1ZM8 1H10.5C11.12 1 11.71 1.25 12.15 1.68C12.59 2.12 12.84 2.72 12.84 3.34C12.84 3.95 12.59 4.55 12.15 4.99C11.71 5.42 11.12 5.67 10.5 5.67H8V1ZM5.5 5.67H8V10.33H5.5C4.88 10.33 4.29 10.08 3.85 9.65C3.42 9.21 3.17 8.62 3.17 8C3.17 7.38 3.42 6.79 3.85 6.35C4.29 5.92 4.88 5.67 5.5 5.67ZM10.33 5.67C10.95 5.67 11.54 5.92 11.98 6.35C12.41 6.79 12.66 7.38 12.66 8C12.66 8.62 12.41 9.21 11.98 9.65C11.54 10.08 10.95 10.33 10.33 10.33C9.71 10.33 9.12 10.08 8.68 9.65C8.25 9.21 8 8.62 8 8C8 7.38 8.25 6.79 8.68 6.35C9.12 5.92 9.71 5.67 10.33 5.67ZM5.5 10.33H8V12.67C8 13.12 7.86 13.57 7.61 13.94C7.36 14.32 7.01 14.62 6.59 14.79C6.17 14.97 5.71 15.03 5.27 14.95C4.82 14.87 4.41 14.66 4.08 14.35C3.75 14.05 3.51 13.65 3.41 13.21C3.3 12.77 3.32 12.3 3.47 11.88C3.62 11.45 3.9 11.08 4.26 10.8C4.62 10.53 5.05 10.36 5.5 10.33Z" />
    </svg>
  );
}
