import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ForceCloseBanner } from '../ForceCloseBanner.js';

afterEach(cleanup);

const DEADLINE = 60_000;

function renderBanner(over: Partial<Parameters<typeof ForceCloseBanner>[0]> = {}, now = 0) {
  const onSaveNow = vi.fn();
  let clock = now;
  render(
    <ForceCloseBanner
      deadlineMs={DEADLINE}
      lastSavedLabel="10:42"
      saving={false}
      onSaveNow={onSaveNow}
      nowMs={() => clock}
      {...over}
    />,
  );
  return {
    onSaveNow,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('ForceCloseBanner', () => {
  it('annuncia una sola volta e mostra i tre contenuti richiesti', () => {
    renderBanner();

    const banner = screen.getByRole('alert');
    expect(banner.textContent).toContain('Chiusura richiesta dal docente');
    expect(banner.textContent).toContain('Salva il lavoro entro');
    expect(banner.textContent).toContain('01:00');
    expect(banner.textContent).toContain('Ultimo salvataggio: 10:42');
    expect(screen.getByRole('button', { name: 'Salva ora' })).toBeTruthy();
    // Il countdown non è annunciato a ogni secondo.
    expect(banner.querySelector('[aria-live]')).toBeNull();
  });

  it('non promette un salvataggio mai avvenuto', () => {
    renderBanner({ lastSavedLabel: null });
    expect(screen.getByRole('alert').textContent).toContain('Nessun salvataggio ancora');
    expect(screen.getByRole('alert').textContent).not.toContain('Ultimo salvataggio');
  });

  it('il countdown è ricalcolato dalla deadline, non decrementato', async () => {
    vi.useFakeTimers();
    try {
      const { advance } = renderBanner();
      // 45 secondi di scheda sospesa: un solo tick, ma il valore è quello reale.
      advance(45_000);
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.getByRole('alert').textContent).toContain('00:15');
    } finally {
      vi.useRealTimers();
    }
  });

  it('gli ultimi 10 secondi sono evidenziati', async () => {
    vi.useFakeTimers();
    try {
      const { advance } = renderBanner();
      advance(51_000);
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      const countdown = screen.getByText('00:09');
      expect(countdown.className).toMatch(/countdownUrgent/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a zero mostra «Chiusura in corso…» e blocca «Salva ora»', async () => {
    vi.useFakeTimers();
    try {
      const { advance, onSaveNow } = renderBanner();
      advance(60_000);
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.getByRole('alert').textContent).toContain('Chiusura in corso…');
      const save = screen.getByRole('button', { name: 'Salva ora' }) as HTMLButtonElement;
      expect(save.disabled).toBe(true);
      fireEvent.click(save);
      expect(onSaveNow).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('«Salva ora» invoca l’handler e riflette il salvataggio in corso', () => {
    const { onSaveNow } = renderBanner();
    fireEvent.click(screen.getByRole('button', { name: 'Salva ora' }));
    expect(onSaveNow).toHaveBeenCalledTimes(1);

    cleanup();
    renderBanner({ saving: true });
    const save = screen.getByRole('button', { name: 'Salvataggio…' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it('riserva nello scorrimento lo spazio che il banner fisso occupa', () => {
    const { container } = render(
      <ForceCloseBanner
        deadlineMs={DEADLINE}
        lastSavedLabel={null}
        saving={false}
        onSaveNow={vi.fn()}
        nowMs={() => 0}
      />,
    );
    const hidden = [...container.querySelectorAll('[aria-hidden="true"]')];
    expect(hidden.at(-1)?.className).toMatch(/spacer/);
  });
});
