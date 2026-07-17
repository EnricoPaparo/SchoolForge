import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  attachDeterrenceListeners,
  capAttentionEvents,
  MAX_ATTENTION_EVENTS,
  requestFullscreenBestEffort,
} from '../examDeterrence.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('attachDeterrenceListeners', () => {
  it('attaches one listener per tracked event and removes exactly those on cleanup', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const winAddSpy = vi.spyOn(window, 'addEventListener');
    const winRemoveSpy = vi.spyOn(window, 'removeEventListener');

    const cleanup = attachDeterrenceListeners(() => {});

    const addedDocEvents = addSpy.mock.calls.map((call) => call[0]);
    expect(addedDocEvents).toEqual(
      expect.arrayContaining([
        'fullscreenchange',
        'visibilitychange',
        'copy',
        'cut',
        'paste',
        'contextmenu',
        'dragstart',
      ]),
    );
    expect(winAddSpy).toHaveBeenCalledWith('blur', expect.any(Function));

    cleanup();

    const removedDocEvents = removeSpy.mock.calls.map((call) => call[0]);
    expect(removedDocEvents).toEqual(addedDocEvents);
    expect(winRemoveSpy).toHaveBeenCalledWith('blur', expect.any(Function));
  });

  it('reports visibility_hidden only when the page is actually hidden', () => {
    const onEvent = vi.fn();
    const cleanup = attachDeterrenceListeners(onEvent);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);

    document.dispatchEvent(new Event('visibilitychange'));

    expect(onEvent).toHaveBeenCalledWith('visibility_hidden');
    cleanup();
  });

  it('reports fullscreen_exit only when no element is fullscreen', () => {
    const onEvent = vi.fn();
    const cleanup = attachDeterrenceListeners(onEvent);
    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });

    document.dispatchEvent(new Event('fullscreenchange'));

    expect(onEvent).toHaveBeenCalledWith('fullscreen_exit');
    cleanup();
  });

  it('reports the current fullscreen state to the optional UI callback', () => {
    const onFullscreenChange = vi.fn();
    const cleanup = attachDeterrenceListeners(vi.fn(), onFullscreenChange);
    Object.defineProperty(document, 'fullscreenElement', {
      value: document.documentElement,
      configurable: true,
    });

    document.dispatchEvent(new Event('fullscreenchange'));

    expect(onFullscreenChange).toHaveBeenCalledWith(true);
    cleanup();
    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
  });

  it('reports window_blur on window blur', () => {
    const onEvent = vi.fn();
    const cleanup = attachDeterrenceListeners(onEvent);

    window.dispatchEvent(new Event('blur'));

    expect(onEvent).toHaveBeenCalledWith('window_blur');
    cleanup();
  });

  it.each([
    ['copy', 'copy_attempt'],
    ['cut', 'cut_attempt'],
    ['paste', 'paste_attempt'],
    ['contextmenu', 'context_menu_attempt'],
    ['dragstart', 'drag_attempt'],
  ] as const)('prevents default and reports %s -> %s', (domEvent, expectedType) => {
    const onEvent = vi.fn();
    const onPreventedInteraction = vi.fn();
    const cleanup = attachDeterrenceListeners(onEvent, undefined, onPreventedInteraction);
    const event = new Event(domEvent, { cancelable: true });

    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(onEvent).toHaveBeenCalledWith(expectedType);
    expect(onPreventedInteraction).toHaveBeenCalledWith(expectedType);
    cleanup();
  });

  it('stops reporting events entirely once cleanup has run', () => {
    const onEvent = vi.fn();
    const cleanup = attachDeterrenceListeners(onEvent);
    cleanup();

    window.dispatchEvent(new Event('blur'));
    document.dispatchEvent(new Event('copy', { cancelable: true }));

    expect(onEvent).not.toHaveBeenCalled();
  });
});

describe('requestFullscreenBestEffort', () => {
  it('calls requestFullscreen when available and swallows a rejection', async () => {
    const requestFullscreen = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      value: requestFullscreen,
      configurable: true,
    });

    expect(() => requestFullscreenBestEffort()).not.toThrow();
    expect(requestFullscreen).toHaveBeenCalledOnce();
    // Let the rejected promise's .catch() microtask settle before the test ends.
    await Promise.resolve();
  });

  it('does nothing when requestFullscreen is unsupported', () => {
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      value: undefined,
      configurable: true,
    });

    expect(() => requestFullscreenBestEffort()).not.toThrow();
  });
});

describe('capAttentionEvents', () => {
  it('returns all pending events when there is room under the cap', () => {
    const pending = [{ type: 'window_blur' as const, ts: 1 }];
    expect(capAttentionEvents(0, pending)).toEqual(pending);
  });

  it('trims pending events to exactly fill the remaining room', () => {
    const pending = Array.from({ length: 10 }, (_, i) => ({
      type: 'window_blur' as const,
      ts: i,
    }));
    const result = capAttentionEvents(MAX_ATTENTION_EVENTS - 3, pending);
    expect(result).toHaveLength(3);
    expect(result).toEqual(pending.slice(0, 3));
  });

  it('returns an empty array once the cap has already been reached', () => {
    const pending = [{ type: 'window_blur' as const, ts: 1 }];
    expect(capAttentionEvents(MAX_ATTENTION_EVENTS, pending)).toEqual([]);
    expect(capAttentionEvents(MAX_ATTENTION_EVENTS + 5, pending)).toEqual([]);
  });
});
