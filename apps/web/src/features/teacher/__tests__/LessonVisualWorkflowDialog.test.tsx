import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { StrictMode, useState } from 'react';
import { LessonVisualWorkflowDialog } from '../LessonVisualWorkflowDialog.js';
import type {
  VisualProposalRequest,
  VisualWorkflowPorts,
} from '../../repository/programs/visualGenerationClient.js';

const proposalRequest: VisualProposalRequest = {
  kind: 'visual_proposal',
  requestId: '11111111-1111-4111-8111-111111111111',
  modelProfile: 'quality',
  titolo: 'Reti',
  sottotitolo: null,
  difficolta: '2',
  concettiChiave: ['rete'],
  obiettivi: ['capire'],
  udaTitle: 'Sistemi',
  udaContext: {
    title: 'Sistemi',
    descrizione: null,
    competenze: [],
    obiettivi: [],
    currentLessonPosition: 1,
    lessons: [{ position: 1, titolo: 'Reti', sottotitolo: null }],
  },
  lessonBody: '## Topologie\nTesto',
};

function ports(
  output:
    | { decision: 'none'; reason: string }
    | {
        decision: 'image';
        subject: string;
        rationale: string;
        anchorHeadingText: string;
        caption: string;
        altText: string;
      },
): VisualWorkflowPorts {
  return {
    previewProposal: vi.fn().mockResolvedValue({
      kind: 'visual_proposal',
      modelProfile: 'quality',
      estimatedInputTokens: 10,
      maxOutputTokens: 20,
      estimatedCostMicroUsd: 30,
      reservationCostMicroUsd: 40,
      requestedTotal: null,
    }),
    generateProposal: vi.fn().mockResolvedValue({
      status: 'completed',
      kind: 'visual_proposal',
      modelProfile: 'quality',
      output,
      actualCostMicroUsd: 30,
      replayed: false,
    }),
    bind: vi.fn().mockResolvedValue({ status: 'bound' }),
    previewImage: vi.fn().mockResolvedValue({
      requestId: '',
      styleVersion: 'schoolforge-sketch-v1',
      preset: {},
      estimatedInputTokens: 1,
      expectedOutputTokens: 1,
      estimatedCostMicroUsd: 100,
      reservationCostMicroUsd: 200,
    }),
    generateImage: vi.fn().mockResolvedValue({
      requestId: '',
      replayed: false,
      dataUri: 'data:image/webp;base64,UklGRg==',
      width: 800,
      height: 600,
      byteLength: 8,
      sha256: 'x',
      mimeType: 'image/webp',
      styleVersion: 'schoolforge-sketch-v1',
      estimatedCostMicroUsd: 100,
      actualCostMicroUsd: 90,
      settledCostMicroUsd: 90,
    }),
    promote: vi.fn().mockResolvedValue({ requestId: '', replayed: false, assetId: 'a' }),
    abandon: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  };
}

const imageProposal = {
  decision: 'image' as const,
  subject: 'Una rete a stella',
  rationale: 'Rende visibili i collegamenti.',
  anchorHeadingText: 'Topologie',
  caption: 'Rete a stella.',
  altText: 'Schema di una rete a stella.',
};

const currentManifest = {
  assetId: '11111111-1111-4111-8111-111111111111',
  anchor: {
    headingSlug: 'topologie',
    headingText: 'Topologie',
    placement: 'after-heading' as const,
  },
  caption: 'Attuale',
  altText: 'Attuale',
  width: 640,
  height: 480,
  storageRef: 'repository/o/i/u/visuals/11111111-1111-4111-8111-111111111111.webp',
  sha256: 'a'.repeat(64),
  sourceBodyHash: 'b'.repeat(64),
  byteLength: 100,
  mimeType: 'image/webp' as const,
  styleVersion: 'schoolforge-sketch/v1' as const,
  approvedAt: {} as never,
};

afterEach(cleanup);

function open(p: VisualWorkflowPorts, onRefresh = vi.fn().mockResolvedValue(undefined)) {
  return render(
    <LessonVisualWorkflowDialog
      proposalRequest={proposalRequest}
      identity={{ programId: 'p', importId: 'i', lessonId: 'l' }}
      headings={[{ text: 'Topologie', index: 0 }]}
      currentManifest={null}
      currentBytes={null}
      ports={p}
      onRefresh={onRefresh}
      onClose={vi.fn()}
    />,
  );
}

function openWithCurrent(p: VisualWorkflowPorts, onRefresh = vi.fn().mockResolvedValue(undefined)) {
  return render(
    <LessonVisualWorkflowDialog
      proposalRequest={proposalRequest}
      identity={{ programId: 'p', importId: 'i', lessonId: 'l' }}
      headings={[{ text: 'Topologie', index: 0 }]}
      currentManifest={currentManifest}
      currentBytes={{ status: 'ready', dataUri: 'data:image/webp;base64,UklGRg==' }}
      ports={p}
      onRefresh={onRefresh}
      onClose={vi.fn()}
    />,
  );
}

describe('LessonVisualWorkflowDialog', () => {
  it('all’apertura esegue soltanto la preview testuale', async () => {
    const p = ports(imageProposal);
    open(p);
    await screen.findByText('Stima della proposta testuale');
    expect(p.previewProposal).toHaveBeenCalledOnce();
    expect(p.generateProposal).not.toHaveBeenCalled();
    expect(p.bind).not.toHaveBeenCalled();
  });

  it('in StrictMode la preview testuale parte una sola volta', async () => {
    const p = ports(imageProposal);
    render(
      <StrictMode>
        <LessonVisualWorkflowDialog
          proposalRequest={proposalRequest}
          identity={{ programId: 'p', importId: 'i', lessonId: 'l' }}
          headings={[{ text: 'Topologie', index: 0 }]}
          currentManifest={null}
          currentBytes={null}
          ports={p}
          onRefresh={vi.fn()}
          onClose={vi.fn()}
        />
      </StrictMode>,
    );
    await screen.findByText('Stima della proposta testuale');
    expect(p.previewProposal).toHaveBeenCalledOnce();
  });

  it('dopo un errore iniziale un solo retry esegue una nuova preview', async () => {
    const p = ports(imageProposal);
    (p.previewProposal as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('rete'));

    open(p);
    await screen.findByText('Risposta non ricevuta: verifica o riprova sullo stesso tentativo.');
    expect(p.previewProposal).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByText('Riprova preview'));

    await screen.findByText('Stima della proposta testuale');
    expect(p.previewProposal).toHaveBeenCalledTimes(2);
  });

  it('con immagine corrente apre la gestione a costo IA zero e avvia la preview solo su richiesta', async () => {
    const p = ports(imageProposal);
    openWithCurrent(p);
    expect(await screen.findByRole('heading', { name: 'Immagine attuale' })).toBeTruthy();
    expect(p.previewProposal).not.toHaveBeenCalled();
    expect(p.generateProposal).not.toHaveBeenCalled();
    expect(p.bind).not.toHaveBeenCalled();
    expect(p.previewImage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Proponi una sostituzione'));
    await screen.findByText('Stima della proposta testuale');
    expect(p.previewProposal).toHaveBeenCalledOnce();
    expect(p.generateProposal).not.toHaveBeenCalled();
  });

  it('mantiene la stessa request testuale tra preview e generate anche dopo un rerender', async () => {
    const p = ports(imageProposal);
    const view = open(p);
    await screen.findByText('Stima della proposta testuale');
    const changedRequest = {
      ...proposalRequest,
      requestId: '22222222-2222-4222-8222-222222222222',
    };
    view.rerender(
      <LessonVisualWorkflowDialog
        proposalRequest={changedRequest}
        identity={{ programId: 'p', importId: 'i', lessonId: 'l' }}
        headings={[{ text: 'Topologie', index: 0 }]}
        currentManifest={null}
        currentBytes={null}
        ports={p}
        onRefresh={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('Genera proposta'));
    await screen.findByText('Cosa deve mostrare l’immagine');
    expect(p.previewProposal).toHaveBeenCalledWith(proposalRequest);
    expect(p.generateProposal).toHaveBeenCalledWith(proposalRequest);
  });

  it('decision none termina senza callable immagini', async () => {
    const p = ports({ decision: 'none', reason: 'Il testo è già sufficiente.' });
    open(p);
    await screen.findByText('Genera proposta');
    fireEvent.click(screen.getByText('Genera proposta'));
    await screen.findByText('Nessuna immagine utile');
    expect(screen.getByText('Il testo è già sufficiente.')).toBeTruthy();
    expect(p.bind).not.toHaveBeenCalled();
  });

  it('il doppio click sulla conferma testuale produce una sola generazione', async () => {
    const p = ports(imageProposal);
    open(p);
    const button = await screen.findByText('Genera proposta');
    fireEvent.click(button);
    fireEvent.click(button);
    await screen.findByText('Cosa deve mostrare l’immagine');
    expect(p.generateProposal).toHaveBeenCalledOnce();
  });

  it('segue proposta → bind → preview → generate → promote con lo stesso requestId', async () => {
    const p = ports(imageProposal);
    const refresh = vi.fn().mockResolvedValue(undefined);
    open(p, refresh);
    fireEvent.click(await screen.findByText('Genera proposta'));
    fireEvent.click(await screen.findByText('Stima immagine'));
    await screen.findByText('Conferma generazione immagine');
    const boundId = (p.bind as ReturnType<typeof vi.fn>).mock.calls[0]![0].requestId;
    expect((p.previewImage as ReturnType<typeof vi.fn>).mock.calls[0]![0].requestId).toBe(boundId);
    fireEvent.click(screen.getByText('Genera immagine'));
    await screen.findByText('Anteprima — non ancora applicata');
    expect((p.generateImage as ReturnType<typeof vi.fn>).mock.calls[0]![0].requestId).toBe(boundId);
    fireEvent.click(screen.getByText('Applica alla lezione'));
    await waitFor(() => expect(p.promote).toHaveBeenCalledOnce());
    expect((p.promote as ReturnType<typeof vi.fn>).mock.calls[0]![0].requestId).toBe(boundId);
    expect((p.promote as ReturnType<typeof vi.fn>).mock.calls[0]![0].anchorHeadingIndex).toBe(0);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('retry dopo risposta persa riusa requestId e il doppio click non duplica', async () => {
    const p = ports(imageProposal);
    (p.generateImage as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('response lost'));
    open(p);
    fireEvent.click(await screen.findByText('Genera proposta'));
    fireEvent.click(await screen.findByText('Stima immagine'));
    fireEvent.click(await screen.findByText('Genera immagine'));
    await screen.findByText(/Risposta non ricevuta/);
    const button = screen.getByText('Verifica o riprova lo stesso tentativo');
    fireEvent.click(button);
    fireEvent.click(button);
    await screen.findByText('Anteprima — non ancora applicata');
    expect(p.generateImage).toHaveBeenCalledTimes(2);
    expect((p.generateImage as ReturnType<typeof vi.fn>).mock.calls[0]![0].requestId).toBe(
      (p.generateImage as ReturnType<typeof vi.fn>).mock.calls[1]![0].requestId,
    );
  });

  it('Rigenera abbandona il candidato e usa un requestId nuovo', async () => {
    const p = ports(imageProposal);
    open(p);
    fireEvent.click(await screen.findByText('Genera proposta'));
    fireEvent.click(await screen.findByText('Stima immagine'));
    fireEvent.click(await screen.findByText('Genera immagine'));
    fireEvent.click(await screen.findByText('Rigenera'));
    await waitFor(() => expect(p.previewImage).toHaveBeenCalledTimes(2));
    const firstId = (p.previewImage as ReturnType<typeof vi.fn>).mock.calls[0]![0].requestId;
    const secondId = (p.previewImage as ReturnType<typeof vi.fn>).mock.calls[1]![0].requestId;
    expect(secondId).not.toBe(firstId);
    expect(p.abandon).toHaveBeenCalledWith(firstId);
  });

  it('modificare il subject invalida la stima e richiede bind e preview nuovi', async () => {
    const p = ports(imageProposal);
    open(p);
    fireEvent.click(await screen.findByText('Genera proposta'));
    fireEvent.click(await screen.findByText('Stima immagine'));
    fireEvent.click(await screen.findByText('Modifica soggetto'));
    await waitFor(() => expect(p.abandon).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByLabelText('Cosa deve mostrare l’immagine'), {
      target: { value: 'Una nuova rete ad anello' },
    });
    fireEvent.click(screen.getByText('Stima immagine'));
    await waitFor(() => expect(p.previewImage).toHaveBeenCalledTimes(2));
    expect((p.previewImage as ReturnType<typeof vi.fn>).mock.calls[1]![0].subject).toBe(
      'Una nuova rete ad anello',
    );
    expect((p.bind as ReturnType<typeof vi.fn>).mock.calls[1]![0].requestId).not.toBe(
      (p.bind as ReturnType<typeof vi.fn>).mock.calls[0]![0].requestId,
    );
  });

  it('bind riuscito + preview fallita conserva il tentativo e il retry riusa requestId', async () => {
    const p = ports(imageProposal);
    (p.previewImage as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce({ details: { code: 'budget_unavailable' } })
      .mockResolvedValueOnce({
        requestId: '',
        styleVersion: 'schoolforge-sketch-v1',
        preset: {},
        estimatedInputTokens: 1,
        expectedOutputTokens: 1,
        estimatedCostMicroUsd: 100,
        reservationCostMicroUsd: 200,
      });
    open(p);
    fireEvent.click(await screen.findByText('Genera proposta'));
    fireEvent.click(await screen.findByText('Stima immagine'));
    await screen.findByText('Riprova stima');
    const boundId = (p.bind as ReturnType<typeof vi.fn>).mock.calls[0]![0].requestId;
    fireEvent.click(screen.getByText('Riprova stima'));
    await screen.findByText('Conferma generazione immagine');
    expect(p.bind).toHaveBeenCalledOnce();
    expect((p.previewImage as ReturnType<typeof vi.fn>).mock.calls[1]![0].requestId).toBe(boundId);
  });

  it('dopo preview fallita modifica soggetto solo dopo abandon riuscito', async () => {
    const p = ports(imageProposal);
    (p.previewImage as ReturnType<typeof vi.fn>).mockRejectedValueOnce({
      details: { code: 'budget_unavailable' },
    });
    open(p);
    fireEvent.click(await screen.findByText('Genera proposta'));
    fireEvent.click(await screen.findByText('Stima immagine'));
    fireEvent.click(await screen.findByText('Modifica soggetto'));
    await screen.findByLabelText('Cosa deve mostrare l’immagine');
    const firstId = (p.bind as ReturnType<typeof vi.fn>).mock.calls[0]![0].requestId;
    expect(p.abandon).toHaveBeenCalledWith(firstId);
    fireEvent.change(screen.getByLabelText('Cosa deve mostrare l’immagine'), {
      target: { value: 'Nuovo soggetto' },
    });
    fireEvent.click(screen.getByText('Stima immagine'));
    await waitFor(() => expect(p.bind).toHaveBeenCalledTimes(2));
    expect((p.bind as ReturnType<typeof vi.fn>).mock.calls[1]![0].requestId).not.toBe(firstId);
  });

  it('se abandon fallisce conserva il candidato e non crea un nuovo tentativo', async () => {
    const p = ports(imageProposal);
    (p.abandon as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('cleanup failed'));
    open(p);
    fireEvent.click(await screen.findByText('Genera proposta'));
    fireEvent.click(await screen.findByText('Stima immagine'));
    fireEvent.click(await screen.findByText('Genera immagine'));
    fireEvent.click(await screen.findByText('Rigenera'));
    await screen.findByText(/Risposta non ricevuta/);
    expect(p.bind).toHaveBeenCalledOnce();
    expect(p.previewImage).toHaveBeenCalledOnce();
  });

  it('usa un solo modal: Escape apre la conferma, Escape torna indietro e abandon ripristina il focus', async () => {
    const p = ports(imageProposal);
    function Harness() {
      const [openDialog, setOpenDialog] = useState(false);
      return (
        <>
          <button onClick={() => setOpenDialog(true)}>Apri workflow</button>
          {openDialog && (
            <LessonVisualWorkflowDialog
              proposalRequest={proposalRequest}
              identity={{ programId: 'p', importId: 'i', lessonId: 'l' }}
              headings={[{ text: 'Topologie', index: 0 }]}
              currentManifest={null}
              currentBytes={null}
              ports={p}
              onRefresh={vi.fn()}
              onClose={() => setOpenDialog(false)}
            />
          )}
        </>
      );
    }
    render(<Harness />);
    const trigger = screen.getByText('Apri workflow');
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByText('Genera proposta'));
    fireEvent.click(await screen.findByText('Stima immagine'));
    await screen.findByText('Conferma generazione immagine');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    const confirm = await screen.findByRole('alertdialog');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
    expect(document.activeElement).toBe(screen.getByText('Torna all’anteprima'));
    fireEvent.keyDown(confirm, { key: 'Escape' });
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(p.abandon).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    const abandon = screen.getByText('Abbandona ed elimina');
    fireEvent.click(abandon);
    fireEvent.click(abandon);
    await waitFor(() => expect(p.abandon).toHaveBeenCalledOnce());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('sostituzione conserva la corrente e remove/promote fanno refresh autorevole', async () => {
    const p = ports(imageProposal);
    const refresh = vi.fn().mockResolvedValue(undefined);
    openWithCurrent(p, refresh);
    fireEvent.click(await screen.findByText('Rimuovi immagine'));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByText('Rimuovi immagine'));
    await waitFor(() => expect(p.remove).toHaveBeenCalledOnce());
    expect(refresh).toHaveBeenCalledOnce();
    expect(p.previewProposal).not.toHaveBeenCalled();
    expect(p.generateProposal).not.toHaveBeenCalled();
    expect(p.bind).not.toHaveBeenCalled();
  });

  it('in sostituzione mostra corrente e proposta senza alterare la corrente prima del promote', async () => {
    const p = ports(imageProposal);
    openWithCurrent(p);
    fireEvent.click(await screen.findByText('Proponi una sostituzione'));
    fireEvent.click(await screen.findByText('Genera proposta'));
    fireEvent.click(await screen.findByText('Stima immagine'));
    fireEvent.click(await screen.findByText('Genera immagine'));
    await screen.findByText('Anteprima — non ancora applicata');
    expect(screen.getByText('Immagine attuale')).toBeTruthy();
    expect(screen.getByText('Nuova proposta')).toBeTruthy();
    expect(screen.getByText('Sostituisci l’immagine attuale')).toBeTruthy();
    expect(p.promote).not.toHaveBeenCalled();
  });

  it('modifica editoriale dopo la generazione non richiama provider e promuove indice e testi finali', async () => {
    const p = ports(imageProposal);
    render(
      <LessonVisualWorkflowDialog
        proposalRequest={proposalRequest}
        identity={{ programId: 'p', importId: 'i', lessonId: 'l' }}
        headings={[
          { text: 'Topologie', index: 0 },
          { text: 'Topologie', index: 1 },
        ]}
        currentManifest={null}
        currentBytes={null}
        ports={p}
        onRefresh={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByText('Genera proposta'));
    fireEvent.click(await screen.findByText('Stima immagine'));
    fireEvent.click(await screen.findByText('Genera immagine'));
    await screen.findByText('Anteprima — non ancora applicata');
    expect(screen.getByText('Topologie — prima occorrenza')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Posizione'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Didascalia'), { target: { value: 'Finale' } });
    fireEvent.change(screen.getByLabelText('Testo alternativo'), {
      target: { value: 'Alt finale' },
    });
    fireEvent.click(screen.getByText('Applica alla lezione'));
    await waitFor(() => expect(p.promote).toHaveBeenCalledOnce());
    expect(p.generateImage).toHaveBeenCalledOnce();
    expect(p.promote).toHaveBeenCalledWith(
      expect.objectContaining({
        anchorHeadingIndex: 1,
        anchorHeadingText: 'Topologie',
        caption: 'Finale',
        altText: 'Alt finale',
      }),
    );
  });

  it('blocca sostituzione durante loading o unavailable ma lascia sempre disponibile remove', () => {
    const p = ports(imageProposal);
    const view = render(
      <LessonVisualWorkflowDialog
        proposalRequest={proposalRequest}
        identity={{ programId: 'p', importId: 'i', lessonId: 'l' }}
        headings={[{ text: 'Topologie', index: 0 }]}
        currentManifest={currentManifest}
        currentBytes={{ status: 'loading' }}
        ports={p}
        onRefresh={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Proponi una sostituzione').hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Rimuovi immagine').hasAttribute('disabled')).toBe(false);
    view.rerender(
      <LessonVisualWorkflowDialog
        proposalRequest={proposalRequest}
        identity={{ programId: 'p', importId: 'i', lessonId: 'l' }}
        headings={[{ text: 'Topologie', index: 0 }]}
        currentManifest={currentManifest}
        currentBytes={{ status: 'unavailable' }}
        ports={p}
        onRefresh={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/sostituzione è bloccata/)).toBeTruthy();
    expect(screen.getByText('Proponi una sostituzione').hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Rimuovi immagine').hasAttribute('disabled')).toBe(false);
  });

  it('un errore di generazione conserva proposta, candidato e immagine corrente', async () => {
    const p = ports(imageProposal);
    (p.generateImage as ReturnType<typeof vi.fn>).mockRejectedValueOnce({
      details: { code: 'provider_unavailable' },
    });
    openWithCurrent(p);
    fireEvent.click(await screen.findByText('Proponi una sostituzione'));
    fireEvent.click(await screen.findByText('Genera proposta'));
    fireEvent.click(await screen.findByText('Stima immagine'));
    fireEvent.click(await screen.findByText('Genera immagine'));
    await screen.findByText(/provider immagini/);
    expect(screen.getByText('Abbandona tentativo')).toBeTruthy();
    expect(p.abandon).not.toHaveBeenCalled();
    expect(p.promote).not.toHaveBeenCalled();
    expect(p.remove).not.toHaveBeenCalled();
  });

  it('ignora una preview testuale risolta dopo unmount', async () => {
    let resolve!: (value: Awaited<ReturnType<VisualWorkflowPorts['previewProposal']>>) => void;
    const p = ports(imageProposal);
    (p.previewProposal as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const view = open(p);
    view.unmount();
    resolve({
      kind: 'visual_proposal',
      modelProfile: 'quality',
      estimatedInputTokens: 1,
      maxOutputTokens: 1,
      estimatedCostMicroUsd: 1,
      reservationCostMicroUsd: 1,
      requestedTotal: null,
    });
    await Promise.resolve();
    expect(screen.queryByText('Stima della proposta testuale')).toBeNull();
  });

  it('non contiene secret, SDK OpenAI o dipendenze Functions nel web', () => {
    const root = join(process.cwd(), 'src');
    const source = [
      readFileSync(join(root, 'features/repository/programs/visualGenerationClient.ts'), 'utf8'),
      readFileSync(join(root, 'features/teacher/LessonVisualWorkflowDialog.tsx'), 'utf8'),
    ].join('\n');
    expect(source).not.toMatch(/OPENAI_API_KEY|api\.openai\.com|from ['"]openai/);
    expect(source).not.toContain('functions/src');
  });
});
