import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { StrictMode } from 'react';
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
      currentDataUri={null}
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
      currentDataUri="data:image/webp;base64,UklGRg=="
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
          currentDataUri={null}
          ports={p}
          onRefresh={vi.fn()}
          onClose={vi.fn()}
        />
      </StrictMode>,
    );
    await screen.findByText('Stima della proposta testuale');
    expect(p.previewProposal).toHaveBeenCalledOnce();
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
        currentDataUri={null}
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
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('retry dopo risposta persa riusa requestId e il doppio click non duplica', async () => {
    const p = ports(imageProposal);
    (p.generateImage as ReturnType<typeof vi.fn>).mockRejectedValueOnce({
      details: { code: 'provider_unavailable' },
    });
    open(p);
    fireEvent.click(await screen.findByText('Genera proposta'));
    fireEvent.click(await screen.findByText('Stima immagine'));
    fireEvent.click(await screen.findByText('Genera immagine'));
    await screen.findByText(/servizio immagini/);
    const button = screen.getByText('Genera immagine');
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
    fireEvent.click(await screen.findByText('Modifica richiesta'));
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

  it('Escape dopo il bind apre alertdialog e abbandona una sola volta', async () => {
    const p = ports(imageProposal);
    open(p);
    fireEvent.click(await screen.findByText('Genera proposta'));
    fireEvent.click(await screen.findByText('Stima immagine'));
    await screen.findByText('Conferma generazione immagine');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    const confirm = await screen.findByRole('alertdialog');
    expect(confirm).toBeTruthy();
    const abandon = screen.getByText('Abbandona ed elimina');
    fireEvent.click(abandon);
    fireEvent.click(abandon);
    await waitFor(() => expect(p.abandon).toHaveBeenCalledOnce());
  });

  it('sostituzione conserva la corrente e remove/promote fanno refresh autorevole', async () => {
    const p = ports(imageProposal);
    const refresh = vi.fn().mockResolvedValue(undefined);
    openWithCurrent(p, refresh);
    fireEvent.click(await screen.findByText('Genera proposta'));
    fireEvent.click(await screen.findByText('Rimuovi immagine'));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByText('Rimuovi immagine'));
    await waitFor(() => expect(p.remove).toHaveBeenCalledOnce());
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('in sostituzione mostra corrente e proposta senza alterare la corrente prima del promote', async () => {
    const p = ports(imageProposal);
    openWithCurrent(p);
    fireEvent.click(await screen.findByText('Genera proposta'));
    fireEvent.click(await screen.findByText('Stima immagine'));
    fireEvent.click(await screen.findByText('Genera immagine'));
    await screen.findByText('Anteprima — non ancora applicata');
    expect(screen.getByText('Immagine attuale')).toBeTruthy();
    expect(screen.getByText('Nuova proposta')).toBeTruthy();
    expect(screen.getByText('Sostituisci l’immagine attuale')).toBeTruthy();
    expect(p.promote).not.toHaveBeenCalled();
  });

  it('un errore di generazione conserva proposta, candidato e immagine corrente', async () => {
    const p = ports(imageProposal);
    (p.generateImage as ReturnType<typeof vi.fn>).mockRejectedValueOnce({
      details: { code: 'provider_unavailable' },
    });
    openWithCurrent(p);
    fireEvent.click(await screen.findByText('Genera proposta'));
    fireEvent.click(await screen.findByText('Stima immagine'));
    fireEvent.click(await screen.findByText('Genera immagine'));
    await screen.findByText(/servizio immagini/);
    expect(screen.getByText('Genera immagine')).toBeTruthy();
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
