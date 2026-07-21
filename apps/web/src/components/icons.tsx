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

/** Open book — didactic workspace */
export function IconBookOpen(props: IconProps = {}) {
  return icon(
    <>
      <path d="M2 4h6a4 4 0 0 1 4 4v12a4 4 0 0 0-4-4H2z" />
      <path d="M22 4h-6a4 4 0 0 0-4 4v12a4 4 0 0 1 4-4h6z" />
    </>,
    props,
  );
}

/** Clipboard with check — verifications */
export function IconClipboardCheck(props: IconProps = {}) {
  return icon(
    <>
      <rect x="5" y="4" width="14" height="18" rx="2" />
      <path d="M9 4V2h6v2M9 13l2 2 4-4" />
    </>,
    props,
  );
}

/** Graduation cap — students */
export function IconGraduationCap(props: IconProps = {}) {
  return icon(
    <>
      <path d="M2 10l10-5 10 5-10 5z" />
      <path d="M6 12v5c3 2 9 2 12 0v-5M22 10v6" />
    </>,
    props,
  );
}

/** File — templates */
export function IconFileText(props: IconProps = {}) {
  return icon(
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="16" y2="17" />
    </>,
    props,
  );
}

/** File with check — completed lesson */
export function IconFileCheck(props: IconProps = {}) {
  return icon(
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <polyline points="8 15 10.5 17.5 16 12" />
    </>,
    props,
  );
}

/** Stacked layers — UDA/group in the didactic tree */
export function IconLayers(props: IconProps = {}) {
  return icon(
    <>
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 12 12 17 22 12" />
      <polyline points="2 17 12 22 22 17" />
    </>,
    props,
  );
}

/** Question mark in a circle — question-pool status */
export function IconCircleQuestion(props: IconProps = {}) {
  return icon(
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.1 9a3 3 0 1 1 5.6 1.5c-.9 1.2-2.7 1.5-2.7 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </>,
    props,
  );
}

/** Check in a circle — completed lesson status */
export function IconCircleCheck(props: IconProps = {}) {
  return icon(
    <>
      <circle cx="12" cy="12" r="10" />
      <polyline points="8 12 11 15 16 9" />
    </>,
    props,
  );
}

/** Warning triangle — invalid question pool */
export function IconTriangleAlert(props: IconProps = {}) {
  return icon(
    <>
      <path d="M10.3 2.9 1.8 17a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 2.9a2 2 0 0 0-3.4 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </>,
    props,
  );
}

/** Info in a circle — informational note (primary/info color) */
export function IconInfo(props: IconProps = {}) {
  return icon(
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </>,
    props,
  );
}

/** X in a circle — blocking error (error color) */
export function IconCircleX(props: IconProps = {}) {
  return icon(
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </>,
    props,
  );
}

/** Panel with left rail — lesson focus mode */
export function IconPanelLeft(props: IconProps = {}) {
  return icon(
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
    </>,
    props,
  );
}

/** Three horizontal dots — contextual actions menu */
export function IconMoreHorizontal(props: IconProps = {}) {
  return icon(
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>,
    props,
  );
}

/** Download arrow into tray */
export function IconDownload(props: IconProps = {}) {
  return icon(
    <>
      <path d="M12 3v12" />
      <polyline points="7 10 12 15 17 10" />
      <path d="M5 21h14a2 2 0 0 0 2-2v-2M3 17v2a2 2 0 0 0 2 2" />
    </>,
    props,
  );
}

/** Magnifying glass — search fields */
export function IconSearch(props: IconProps = {}) {
  return icon(
    <>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </>,
    props,
  );
}

/** Upload arrow from tray — import actions */
export function IconUpload(props: IconProps = {}) {
  return icon(
    <>
      <path d="M12 21V9" />
      <polyline points="7 14 12 9 17 14" />
      <path d="M5 3h14a2 2 0 0 1 2 2v2M3 7V5a2 2 0 0 1 2-2" />
    </>,
    props,
  );
}

/** Eraser — azzera correzione (M5-04C), bicolore come le azioni tabellari. */
export function IconEraser(props: IconProps = {}) {
  return icon(
    <>
      <path
        d="m4.3 14.6 8.9-8.9a2 2 0 0 1 2.8 0l2.3 2.3a2 2 0 0 1 0 2.8l-8.5 8.5H7.2l-2.9-2.9a1.3 1.3 0 0 1 0-1.8Z"
        fill="#fb7185"
        stroke="#fecdd3"
        strokeWidth="1.2"
      />
      <path
        d="m11 7.9 4.9 4.9 2.4-2.4a2 2 0 0 0 0-2.8L16 5.3a2 2 0 0 0-2.8 0Z"
        fill="#60a5fa"
        stroke="#bfdbfe"
        strokeWidth="1.2"
      />
      <path d="M8.5 19.3H20" stroke="currentColor" strokeWidth="1.6" />
    </>,
    props,
  );
}

/** Sparkles — AI-assisted actions (Correggi con IA) */
export function IconSparkles(props: IconProps = {}) {
  return icon(
    <>
      <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z" />
      <path d="M19 14l.7 1.8L21.5 16.5l-1.8.7L19 19l-.7-1.8L16.5 16.5l1.8-.7L19 14z" />
    </>,
    props,
  );
}

/** Counter-clockwise circular arrow — reopen a correction (Riapri) */
export function IconRotateCcw(props: IconProps = {}) {
  return icon(
    <>
      <polyline points="3 4 3 10 9 10" />
      <path d="M3.5 15a9 9 0 1 0 2.1-9.4L3 10" />
    </>,
    props,
  );
}

/** Paper plane — return to student (Restituisci) */
export function IconSend(props: IconProps = {}) {
  return icon(
    <>
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </>,
    props,
  );
}
