import type { ReactNode } from 'react';

/** Minimal inline SVG icon set — stroke-based, 18 px viewport, no external deps. */

type IconProps = { size?: number; 'aria-hidden'?: boolean | 'true' | 'false' };

const defaults: IconProps = { size: 18, 'aria-hidden': true };

function icon(path: ReactNode, props: IconProps = {}) {
  const { size = 18 } = { ...defaults, ...props };
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {path}
    </svg>
  );
}

/** ‹ chevron left — collapse sidebar */
export function IconChevronLeft(props: IconProps = {}) {
  return icon(<polyline points="15 18 9 12 15 6" />, props);
}

/** › chevron right — expand sidebar */
export function IconChevronRight(props: IconProps = {}) {
  return icon(<polyline points="9 18 15 12 9 6" />, props);
}

/** Pencil — edit/structure mode */
export function IconPencil(props: IconProps = {}) {
  return icon(
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />,
    props,
  );
}

/** Up-down arrows — reorder */
export function IconArrowUpDown(props: IconProps = {}) {
  return icon(
    <>
      <polyline points="17 11 12 6 7 11" />
      <polyline points="17 18 12 13 7 18" />
    </>,
    props,
  );
}

/** Plus — create */
export function IconPlus(props: IconProps = {}) {
  return icon(
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </>,
    props,
  );
}

/** Trash — delete */
export function IconTrash(props: IconProps = {}) {
  return icon(
    <>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </>,
    props,
  );
}

/** Chevron up — move up */
export function IconChevronUp(props: IconProps = {}) {
  return icon(<polyline points="18 15 12 9 6 15" />, props);
}

/** Chevron down — move down */
export function IconChevronDown(props: IconProps = {}) {
  return icon(<polyline points="6 9 12 15 18 9" />, props);
}
