import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VerificationTopicsDialog } from './VerificationTopicsDialog.js';
import {
  TOPICS_UNAVAILABLE_LABEL,
  VerificationTopicsControl,
} from './VerificationTopicsControl.js';

afterEach(cleanup);

const OUTLINE = [
  {
    udaTitle: 'Il Web',
    lessonTitles: ['Come funziona Internet', 'Il server non è necessariamente una sola macchina'],
  },
  { udaTitle: 'Intelligenza artificiale', lessonTitles: ['Introduzione ai modelli linguistici'] },
];

describe('VerificationTopicsDialog (UI-VERIFICHE-06B)', () => {
  it('mostra UDA e lezioni in una lista accessibile, senza id tecnici', () => {
    render(
      <VerificationTopicsDialog
        verificationTitle="Verifica Reti"
        topicOutline={OUTLINE}
        onClose={() => {}}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'Argomenti della verifica' })).toBeTruthy();
    expect(screen.getByText('Verifica Reti')).toBeTruthy();

    const list = screen.getByRole('list', { name: 'Argomenti della verifica' });
    const udas = within(list).getAllByRole('listitem', { name: '' });
    expect(udas.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Il Web')).toBeTruthy();
    expect(screen.getByText('Intelligenza artificiale')).toBeTruthy();

    // Ogni UDA ha la propria sotto-lista etichettata: le lezioni sono
    // semanticamente annidate, non una sequenza piatta.
    const webLessons = screen.getByRole('list', { name: 'Lezioni — Il Web' });
    expect(within(webLessons).getAllByRole('listitem')).toHaveLength(2);

    const html = document.body.innerHTML;
    for (const forbidden of ['UDA1', 'UDA2', '.md', 'questionIndexEntryId', 'poolStorageRef']) {
      expect(html).not.toContain(forbidden);
    }
  });

  it('si chiude con il pulsante, con Escape e con il backdrop', () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <VerificationTopicsDialog
        verificationTitle="Verifica Reti"
        topicOutline={OUTLINE}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Chiudi' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);

    // Il backdrop è il genitore del dialog nel portale.
    fireEvent.click(screen.getByRole('dialog').parentElement!);
    expect(onClose).toHaveBeenCalledTimes(3);
    unmount();
  });
});

describe('VerificationTopicsControl (UI-VERIFICHE-06B)', () => {
  it('apre la popup con il dato già in memoria, senza alcuna lettura', () => {
    render(<VerificationTopicsControl verificationTitle="Verifica Reti" topicOutline={OUTLINE} />);

    const trigger = screen.getByRole('button', {
      name: 'Argomenti della verifica — Verifica Reti',
    });
    expect((trigger as HTMLButtonElement).disabled).toBe(false);
    expect(trigger.textContent).toContain('2 UDA');
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Argomenti della verifica' })).toBeTruthy();
  });

  it('resta disabilitato e spiegato su una verifica legacy senza perimetro', () => {
    render(<VerificationTopicsControl verificationTitle="Verifica Reti" topicOutline={null} />);

    const trigger = screen.getByRole('button', { name: new RegExp(TOPICS_UNAVAILABLE_LABEL) });
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
    expect(trigger.getAttribute('title')).toBe(TOPICS_UNAVAILABLE_LABEL);

    fireEvent.click(trigger);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('tratta un perimetro vuoto o assente esattamente come non disponibile', () => {
    const { rerender } = render(
      <VerificationTopicsControl verificationTitle="V" topicOutline={[]} />,
    );
    expect(screen.getByRole('button').hasAttribute('disabled')).toBe(true);
    rerender(<VerificationTopicsControl verificationTitle="V" topicOutline={undefined} />);
    expect(screen.getByRole('button').hasAttribute('disabled')).toBe(true);
  });
});
