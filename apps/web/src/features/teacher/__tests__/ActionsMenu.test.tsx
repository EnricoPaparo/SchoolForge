import { useRef } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActionsMenu } from '../ActionsMenu.js';
import { ActionsSubmenu } from '../ActionsSubmenu.js';

// jsdom has no layout: stub the trigger rect, the viewport size and the menu
// box so the pure positioning math is deterministic.
const MENU_W = 200;
const MENU_H = 300;

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
}

function mockAnchorRect(rect: Partial<DOMRect>) {
  const full = {
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
    ...rect,
  } as DOMRect;
  HTMLButtonElement.prototype.getBoundingClientRect = () => full;
}

function Harness() {
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={ref} type="button">
        Azioni
      </button>
      <ActionsMenu open anchorRef={ref} ariaLabel="Azioni corso">
        <button type="button" role="menuitem">
          Azione
        </button>
      </ActionsMenu>
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// Menu box: offsetWidth / scrollHeight are 0 in jsdom → stub on the prototype.
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
  configurable: true,
  get() {
    return MENU_W;
  },
});
Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
  configurable: true,
  get() {
    return MENU_H;
  },
});

describe('ActionsMenu — portal + positioning', () => {
  it('focuses only after the portal becomes visible and does not steal focus on resize', () => {
    setViewport(1000, 800);
    mockAnchorRect({ left: 50, top: 80, bottom: 100, right: 130 });
    const nativeFocus = HTMLButtonElement.prototype.focus;
    const focusVisibility: string[] = [];
    vi.spyOn(HTMLButtonElement.prototype, 'focus').mockImplementation(function (
      this: HTMLButtonElement,
      options,
    ) {
      const menu = this.closest<HTMLElement>('[role="menu"]');
      if (menu) {
        focusVisibility.push(menu.style.visibility);
        // jsdom allows focus on hidden nodes; reproduce the browser restriction.
        if (menu.style.visibility === 'hidden') return;
      }
      nativeFocus.call(this, options);
    });
    render(<Harness />);
    expect(focusVisibility).toEqual(['visible']);
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Azione' }));
    const trigger = screen.getByRole('button', { name: 'Azioni' });
    trigger.focus();
    fireEvent.resize(window);
    expect(document.activeElement).toBe(trigger);
    expect(focusVisibility).toEqual(['visible']);
  });

  it('renders into document.body, not next to the trigger', () => {
    setViewport(1000, 800);
    mockAnchorRect({ left: 50, top: 80, bottom: 100, right: 130, width: 80, height: 20 });
    render(<Harness />);
    const menu = screen.getByRole('menu', { name: 'Azioni corso' });
    expect(menu.parentElement).toBe(document.body);
  });

  it('opens below the trigger when there is room', () => {
    setViewport(1000, 800);
    mockAnchorRect({ left: 50, top: 80, bottom: 100, right: 130, width: 80, height: 20 });
    render(<Harness />);
    const menu = screen.getByRole('menu') as HTMLElement;
    // below: top = rect.bottom (100) + gap (4) = 104; left = rect.left (50).
    expect(menu.style.top).toBe('104px');
    expect(menu.style.left).toBe('50px');
    expect(menu.style.visibility).toBe('visible');
  });

  it('opens above the trigger when there is not enough room below', () => {
    setViewport(1000, 800);
    // Trigger near the bottom edge: spaceBelow ≈ 8 < menuH 300 → open above.
    mockAnchorRect({ left: 50, top: 750, bottom: 780, right: 130, width: 80, height: 30 });
    render(<Harness />);
    const menu = screen.getByRole('menu') as HTMLElement;
    // above: top = rect.top (750) − gap (4) − min(menuH 300, spaceAbove) = 446.
    expect(menu.style.top).toBe('446px');
  });

  it('clamps horizontally so the menu never leaves the viewport', () => {
    setViewport(1000, 800);
    // Trigger near the right edge: left would overflow → clamp to vw−menuW−margin.
    mockAnchorRect({ left: 950, top: 80, bottom: 100, right: 990, width: 40, height: 20 });
    render(<Harness />);
    const menu = screen.getByRole('menu') as HTMLElement;
    // left = min(950, 1000 − 200 − 8) = 792.
    expect(menu.style.left).toBe('792px');
  });
});

function SubmenuHarness({ onAction = () => {} }: { onAction?: () => void }) {
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={anchor}>Azioni</button>
      <ActionsMenu open anchorRef={anchor} ariaLabel="Azioni" onAction={onAction}>
        <button role="menuitem">Prima</button>
        <ActionsSubmenu label="Copia prompt" icon={<span aria-hidden="true">+</span>}>
          <button role="menuitem">Lezione</button>
          <button role="menuitem" disabled>
            Mappa
          </button>
          <button role="menuitem">Pool</button>
        </ActionsSubmenu>
      </ActionsMenu>
    </>
  );
}

describe('ActionsSubmenu navigation', () => {
  it('keeps parent open, skips disabled children with arrows and restores trigger on Escape', () => {
    setViewport(1000, 800);
    const action = vi.fn();
    render(<SubmenuHarness onAction={action} />);
    const trigger = screen.getByRole('menuitem', { name: 'Copia prompt' });
    fireEvent.keyDown(trigger, { key: 'ArrowRight' });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(action).not.toHaveBeenCalled();
    const lesson = screen.getByRole('menuitem', { name: 'Lezione' });
    lesson.focus();
    fireEvent.keyDown(lesson, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Pool' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: 'Copia prompt' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
  it('opens a touch next level inside the same panel with a back button', () => {
    setViewport(390, 800);
    render(<SubmenuHarness />);
    const root = screen.getByRole('menu', { name: 'Azioni' });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copia prompt' }));
    const submenu = within(root).getByRole('menu', { name: 'Copia prompt' });
    expect(submenu.style.left).toBe('');
    fireEvent.click(within(submenu).getByRole('button', { name: 'Indietro da Copia prompt' }));
    expect(screen.queryByRole('menu', { name: 'Copia prompt' })).toBeNull();
  });
  it('clamps a desktop flyout at the right and bottom viewport edges and selects its action', () => {
    setViewport(1000, 800);
    mockAnchorRect({ left: 850, right: 990, top: 750, bottom: 780 });
    const action = vi.fn();
    render(<SubmenuHarness onAction={action} />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copia prompt' }));
    const submenu = screen.getByRole('menu', { name: 'Copia prompt' });
    expect(submenu.style.left).toBe('650px');
    expect(submenu.style.top).toBe('492px');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Lezione' }));
    expect(action).toHaveBeenCalledOnce();
  });
});
