import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StudentDidatticaView } from '../StudentDidatticaView.js';

vi.mock('../../../lib/firebase.js', () => ({ db: {} }));
vi.mock('../../../lib/auth.js', () => ({
  useAuth: () => ({ user: { uid: 'student-uid', email: 's@test.com' } }),
}));

const mockLoadStudentLessons = vi.fn();
vi.mock('../../repository/programs/studentLessonsService.js', () => ({
  loadStudentLibrary: async (...args: unknown[]) => {
    const result = await mockLoadStudentLessons(...args);
    if (result.status !== 'ok') return result;
    return { status: 'ok', classId: 'class-a', programs: result.programs };
  },
  loadStudentCourseLessons: async (program: { id: string }) => {
    const result = await mockLoadStudentLessons.getMockImplementation()?.();
    return result.lessonsByProgram[program.id] ?? [];
  },
}));

/**
 * CONCEPT-MAP-04 — la scheda «Mappa concettuale» dello studente.
 *
 * L'invariante difesa qui non è grafica: la scheda esiste **soltanto** quando
 * la proiezione pubblica contiene davvero una mappa. Non deve esistere alcuna
 * combinazione — lezione non svolta, documento legacy, mappa rimossa — in cui
 * l'interfaccia lasci intuire una mappa che lo studente non può leggere.
 */

const MAP = '## Ossatura della lezione\n\n- densità\n';

const BASE = {
  id: 'l1',
  ownerUid: 'owner-uid',
  programId: 'prog-a',
  importId: 'imp-1',
  udaId: 'uda-1',
  udaDir: 'uda-01-reti',
  path: 'uda-01-reti/lezione-001.md',
  filename: 'lezione-001.md',
  contentPath: 'repository/owner-uid/imports/imp-1/uda-01-reti/lezione-001.md',
  createdAt: null,
  titolo: 'Internet e reti',
  sottotitolo: 'Concetti fondamentali',
  order: 0,
  completed: true,
  content: '# Titolo\n\nContenuto della lezione.',
  conceptMapMarkdown: null as string | null,
};

const PROGRAM = { id: 'prog-a', title: 'Informatica', classIds: ['class-a'] };

function loadWith(lessons: Record<string, unknown>[]) {
  mockLoadStudentLessons.mockResolvedValue({
    status: 'ok',
    programs: [PROGRAM],
    lessonsByProgram: { 'prog-a': lessons },
  });
}

/** Apre corso → UDA → lezione, che è il solo percorso reale della vista. */
async function openLesson(name = 'Internet e reti') {
  render(<StudentDidatticaView />);
  fireEvent.click(await screen.findByRole('button', { name: 'Apri il corso Informatica' }));
  const structure = await screen.findByRole('complementary', { name: 'Struttura del corso' });
  fireEvent.click(within(structure).getByRole('button', { name: /Reti/ }));
  fireEvent.click(within(structure).getByRole('button', { name: new RegExp(name) }));
}

/** Passa a un'altra lezione dalla struttura, senza ricaricare la vista. */
async function switchLesson(name: string) {
  const structure = await screen.findByRole('complementary', { name: 'Struttura del corso' });
  fireEvent.click(within(structure).getByRole('button', { name: new RegExp(name) }));
}

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
});

describe('la scheda esiste solo quando la mappa è davvero proiettata', () => {
  it('con una mappa valida compaiono due schede, nell’ordine giusto', async () => {
    loadWith([{ ...BASE, conceptMapMarkdown: MAP }]);
    await openLesson();
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Contenuto', 'Mappa concettuale']);
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
  });

  it('senza mappa non c’è nessuna tablist, né alcun segnaposto', async () => {
    loadWith([{ ...BASE, conceptMapMarkdown: null }]);
    await openLesson();
    await screen.findByText(/Contenuto della lezione/);
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(document.body.textContent).not.toContain('Mappa concettuale');
    expect(document.body.textContent).not.toContain('non disponibile');
  });

  it('lezione non svolta: la proiezione non porta la mappa, quindi nessuna scheda', async () => {
    // CONCEPT-MAP-02 non proietta la mappa finché `completed !== true`: la
    // vista riceve `null` e non deve inventarsi nulla.
    loadWith([{ ...BASE, completed: false, conceptMapMarkdown: null }]);
    await openLesson();
    await screen.findByText(/Contenuto della lezione/);
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('documento legacy privo del campo: nessuna esposizione', async () => {
    const legacy: Record<string, unknown> = { ...BASE };
    delete legacy.conceptMapMarkdown;
    loadWith([legacy]);
    await openLesson();
    await screen.findByText(/Contenuto della lezione/);
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('mappa vuota o solo spazi: trattata come assente', async () => {
    loadWith([{ ...BASE, conceptMapMarkdown: '' }]);
    await openLesson();
    await screen.findByText(/Contenuto della lezione/);
    expect(screen.queryByRole('tab')).toBeNull();
  });
});

describe('contenuto delle schede', () => {
  it('la mappa vive nel proprio tabpanel e il corpo nel suo', async () => {
    loadWith([{ ...BASE, conceptMapMarkdown: MAP }]);
    await openLesson();
    const mapTab = await screen.findByRole('tab', { name: 'Mappa concettuale' });
    const panel = document.getElementById('student-panel-mappa')!;
    expect(mapTab.getAttribute('aria-controls')).toBe('student-panel-mappa');
    expect(panel.getAttribute('aria-labelledby')).toBe('student-tab-mappa');
    expect(panel.textContent).toContain('densità');
    // Il corpo resta nel proprio pannello: la mappa non lo duplica.
    expect(panel.textContent).not.toContain('Contenuto della lezione');
  });

  it('non c’è più alcuna sezione mappa sotto il contenuto', async () => {
    loadWith([{ ...BASE, conceptMapMarkdown: MAP }]);
    await openLesson();
    await screen.findByRole('tab', { name: 'Mappa concettuale' });
    // Una sola occorrenza dell'etichetta: quella della scheda. Se la vecchia
    // sezione fosse rimasta, la mappa comparirebbe due volte nella pagina.
    const occurrences = (document.body.textContent!.match(/Mappa concettuale/g) ?? []).length;
    expect(occurrences).toBe(1);
    expect(document.querySelectorAll('h3')).toBeTruthy();
  });

  it('selezionare la mappa mostra il suo pannello e nasconde il contenuto', async () => {
    loadWith([{ ...BASE, conceptMapMarkdown: MAP }]);
    await openLesson();
    fireEvent.click(await screen.findByRole('tab', { name: 'Mappa concettuale' }));
    expect(document.getElementById('student-panel-mappa')!.hasAttribute('hidden')).toBe(false);
    expect(document.getElementById('student-panel-contenuto')!.hasAttribute('hidden')).toBe(true);
  });
});

describe('navigazione da tastiera', () => {
  it('←/→ ciclici, Home ed End, come nelle schede docente', async () => {
    loadWith([{ ...BASE, conceptMapMarkdown: MAP }]);
    await openLesson();
    await screen.findByRole('tablist', { name: 'Schede lezione' });
    const [contenuto, mappa] = screen.getAllByRole('tab');
    // I tasti arrivano alla scheda che ha il focus, com'è per le schede
    // docente: il gestore vive sul pulsante, non sul contenitore.
    const selected = () =>
      screen.getAllByRole('tab').find((t) => t.getAttribute('aria-selected') === 'true')!;

    fireEvent.keyDown(selected(), { key: 'ArrowRight' });
    expect(mappa!.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(selected(), { key: 'ArrowRight' });
    expect(contenuto!.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(selected(), { key: 'ArrowLeft' });
    expect(mappa!.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(selected(), { key: 'Home' });
    expect(contenuto!.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(selected(), { key: 'End' });
    expect(mappa!.getAttribute('aria-selected')).toBe('true');
  });

  it('solo la scheda attiva è raggiungibile con Tab (roving tabindex)', async () => {
    loadWith([{ ...BASE, conceptMapMarkdown: MAP }]);
    await openLesson();
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1']);
  });
});

describe('cambio lezione', () => {
  it('torna sempre su Contenuto', async () => {
    loadWith([
      { ...BASE, conceptMapMarkdown: MAP },
      {
        ...BASE,
        id: 'l2',
        filename: 'lezione-002.md',
        path: 'uda-01-reti/lezione-002.md',
        titolo: 'Il Web',
        order: 1,
        conceptMapMarkdown: MAP,
      },
    ]);
    await openLesson();
    fireEvent.click(await screen.findByRole('tab', { name: 'Mappa concettuale' }));
    expect(
      screen.getByRole('tab', { name: 'Mappa concettuale' }).getAttribute('aria-selected'),
    ).toBe('true');

    await switchLesson('Il Web');
    // La mappa della lezione precedente non deve restare selezionata su una
    // lezione diversa: si riparte sempre dal contenuto.
    expect(screen.getByRole('tab', { name: 'Contenuto' }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });
});

describe('costo', () => {
  it('mostrare le schede non produce alcuna lettura aggiuntiva', async () => {
    loadWith([{ ...BASE, conceptMapMarkdown: MAP }]);
    await openLesson();
    fireEvent.click(await screen.findByRole('tab', { name: 'Mappa concettuale' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Contenuto' }));
    // Una sola chiamata: quella iniziale della vista. La mappa arriva dentro
    // la proiezione già caricata, non da una query per scheda.
    expect(mockLoadStudentLessons).toHaveBeenCalledTimes(1);
  });
});
