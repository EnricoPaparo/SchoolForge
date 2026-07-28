import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as PrefsModule from '../../repository/corrections/teacherAiPreferencesService.js';

vi.mock('../../../lib/firebase.js', () => ({ db: {}, storage: {}, functions: {} }));

const mockSave = vi.fn();
vi.mock('../../repository/corrections/teacherAiPreferencesService.js', async (importOriginal) => {
  const actual = await importOriginal<typeof PrefsModule>();
  return { ...actual, saveTeacherAiPreferences: (...args: unknown[]) => mockSave(...args) };
});

afterEach(cleanup);

import { AiCorrectionSettingsDialog } from '../AiCorrectionSettingsDialog.js';
import type { Firestore } from 'firebase/firestore';
import type { TeacherAiPreferences } from '../../repository/corrections/teacherAiPreferencesService.js';

const db = {} as Firestore;
const OWNER = 'owner-uid';
const INITIAL: TeacherAiPreferences = {
  modelProfile: 'economy',
  gradingMode: 'rigorous',
  teacherGuidance: 'Premia il metodo.',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockSave.mockResolvedValue(undefined);
});

function setup(overrides: Partial<Parameters<typeof AiCorrectionSettingsDialog>[0]> = {}) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(
    <AiCorrectionSettingsDialog
      ownerUid={OWNER}
      db={db}
      initial={INITIAL}
      onClose={onClose}
      onSaved={onSaved}
      {...overrides}
    />,
  );
  return { onClose, onSaved };
}

describe('AiCorrectionSettingsDialog (TWU-02)', () => {
  it('renders the shared settings fields prefilled from the initial preferences', () => {
    setup();
    expect(screen.getByRole('heading', { name: /Impostazioni correzione IA/i })).toBeTruthy();
    expect((screen.getByLabelText('Profilo modello') as HTMLSelectElement).value).toBe('economy');
    expect((screen.getByLabelText('Stile di valutazione') as HTMLSelectElement).value).toBe(
      'rigorous',
    );
    expect(
      (screen.getByLabelText('Indicazioni aggiuntive per la correzione') as HTMLTextAreaElement)
        .value,
    ).toBe('Premia il metodo.');
    // The technical model id is shown as small metadata (informational, not a price).
    expect(screen.getByText('gpt-5.4-nano-2026-03-17')).toBeTruthy();
    const gradingMode = screen.getByLabelText('Stile di valutazione');
    expect(gradingMode.getAttribute('aria-describedby')).toBeNull();
    fireEvent.change(gradingMode, { target: { value: 'compassionate' } });
    expect(screen.queryByText(/Valorizza la comprensione sostanziale/i)).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    const textarea = screen.getByLabelText('Indicazioni aggiuntive per la correzione');
    const cancel = screen.getByRole('button', { name: 'Annulla' });
    expect(
      textarea.compareDocumentPosition(cancel) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('saves the current values and reports success via aria-live', async () => {
    const { onSaved } = setup();
    fireEvent.change(screen.getByLabelText('Profilo modello'), { target: { value: 'quality' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));

    await waitFor(() => expect(screen.getByText('Impostazioni salvate.')).toBeTruthy());
    expect(mockSave).toHaveBeenCalledTimes(1);
    const [ownerArg, prefsArg] = mockSave.mock.calls[0];
    expect(ownerArg).toBe(OWNER);
    expect(prefsArg).toEqual({
      modelProfile: 'quality',
      gradingMode: 'rigorous',
      teacherGuidance: 'Premia il metodo.',
    });
    expect(onSaved).toHaveBeenCalledWith({
      modelProfile: 'quality',
      gradingMode: 'rigorous',
      teacherGuidance: 'Premia il metodo.',
    });
  });

  it('guards against a double click (single save)', async () => {
    setup();
    const btn = screen.getByRole('button', { name: 'Salva' });
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByText('Impostazioni salvate.')).toBeTruthy());
    expect(mockSave).toHaveBeenCalledTimes(1);
  });

  it('keeps the dialog open and shows a readable error when the save fails', async () => {
    mockSave.mockRejectedValueOnce(new Error('permission-denied'));
    const { onSaved } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));
    await waitFor(() =>
      expect(screen.getByText(/Impossibile salvare le impostazioni/i)).toBeTruthy(),
    );
    expect(onSaved).not.toHaveBeenCalled();
    // Still interactive (not auto-closed).
    expect(screen.getByRole('button', { name: 'Salva' })).toBeTruthy();
  });
});
