import type { AttentionEvent, AttentionEventType } from '../../types/firestore.js';

/**
 * Hard cap on the total number of attention events ever stored on a
 * submission (see m3-full-roadmap.md §11 — bounds document size, not a
 * security control). Once a submission already has this many events, the
 * client stops sending new ones; no Firestore read is needed to enforce
 * this — the UI already knows the count of the currently loaded submission.
 */
export const MAX_ATTENTION_EVENTS = 200;

const PREVENTABLE_EVENTS: { type: AttentionEventType; domEvent: string }[] = [
  { type: 'copy_attempt', domEvent: 'copy' },
  { type: 'cut_attempt', domEvent: 'cut' },
  { type: 'paste_attempt', domEvent: 'paste' },
  { type: 'context_menu_attempt', domEvent: 'contextmenu' },
  { type: 'drag_attempt', domEvent: 'dragstart' },
];

/**
 * Attaches the M3-full lightweight-deterrence listeners for the duration of
 * an online exam attempt and returns a cleanup function that removes every
 * listener it added. This is deterrence, not anti-cheat: nothing here blocks
 * navigation, invalidates the submission, or reports anywhere except into
 * `onEvent` (the caller decides whether/when to persist).
 *
 * - fullscreen exit and page-hidden/window-blur are only observed.
 * - copy/cut/paste/contextmenu/dragstart are also prevented (`preventDefault`).
 */
export function attachDeterrenceListeners(
  onEvent: (type: AttentionEventType) => void,
  onFullscreenChange?: (active: boolean) => void,
  onPreventedInteraction?: (type: AttentionEventType) => void,
): () => void {
  function handleFullscreenChange() {
    onFullscreenChange?.(Boolean(document.fullscreenElement));
    if (!document.fullscreenElement) onEvent('fullscreen_exit');
  }
  function handleVisibilityChange() {
    if (document.hidden) onEvent('visibility_hidden');
  }
  function handleWindowBlur() {
    onEvent('window_blur');
  }

  const preventHandlers = PREVENTABLE_EVENTS.map(({ type, domEvent }) => {
    const handler = (e: Event) => {
      e.preventDefault();
      onEvent(type);
      onPreventedInteraction?.(type);
    };
    return { domEvent, handler };
  });

  document.addEventListener('fullscreenchange', handleFullscreenChange);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('blur', handleWindowBlur);
  for (const { domEvent, handler } of preventHandlers) {
    document.addEventListener(domEvent, handler);
  }

  return function cleanup() {
    document.removeEventListener('fullscreenchange', handleFullscreenChange);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('blur', handleWindowBlur);
    for (const { domEvent, handler } of preventHandlers) {
      document.removeEventListener(domEvent, handler);
    }
  };
}

/**
 * Requests fullscreen best-effort. Must be called synchronously from within
 * a user-gesture handler (the "Svolgi online"/"Riprendi bozza" click) —
 * browsers require a direct user gesture to grant fullscreen. A rejection
 * (denied, unsupported, already fullscreen) is expected and never surfaced:
 * fullscreen is a soft deterrent, never a blocking requirement.
 */
export function requestFullscreenBestEffort(): void {
  const el = document.documentElement;
  if (typeof el.requestFullscreen === 'function') {
    el.requestFullscreen().catch(() => {
      // Ignored — see doc comment above.
    });
  }
}

/**
 * Trims a batch of not-yet-persisted events down to however many still fit
 * under MAX_ATTENTION_EVENTS, given how many the loaded submission already
 * has. No Firestore read involved — `existingCount` is always the count
 * already known from the currently loaded submission document.
 */
export function capAttentionEvents(
  existingCount: number,
  pending: AttentionEvent[],
): AttentionEvent[] {
  const room = Math.max(0, MAX_ATTENTION_EVENTS - existingCount);
  return pending.slice(0, room);
}
