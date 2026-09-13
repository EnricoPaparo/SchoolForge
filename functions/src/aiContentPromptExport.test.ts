import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  exportCurrentContentPrompt,
  RESPONSE_FORMAT_HEADING,
  POOL_FORMAT_EXAMPLE,
} from './aiContentPromptExport.js';
import * as promptBuilders from './aiContentPrompt.js';
import { buildLessonPrompt, buildPoolPrompt } from './aiContentPrompt.js';
import { parsePool } from '@schoolforge/lesson-contract';
import { validateAiContentRequest } from './aiContentCore.js';
import { AI_VISUAL_SERVER_CONFIG, AI_VISUAL_LEGACY_SERVER_CONFIG } from './aiVisualCore.js';
import { isExactAiVisualServerConfig } from './aiVisualRunDoc.js';
import { resumeCoordinatedProposal } from './aiVisualPlanGateway.js';
import { assertCurrentVisualProposalProfile, type VisualPlanRun } from './aiVisualMultiPlan.js';

describe('current prompt export and immutable visual presets', () => {
  it.each(['lesson', 'pool'] as const)(
    'exports current %s instructions, context and strict schema',
    (kind) => {
      const base = {
        kind,
        requestId: '11111111-1111-4111-8111-111111111111',
        modelProfile: 'economy',
        teacherGuidance: 'Spiega i passaggi con esempi originali àè.',
      };
      const body = '## Reti\n\nIl contenuto corrente.';
      const input =
        kind === 'pool'
          ? {
              ...base,
              level: 'balanced',
              counts: { aperta: 3, chiusa_singola: 3, chiusa_multipla: 0 },
              lessonSource: body,
              existingPoolQuestionCount: 0,
            }
          : {
              ...base,
              depth: 'complete',
              titolo: 'Reti',
              difficolta: 'intermedia',
              concettiChiave: ['TCP'],
              obiettivi: ['Capire le reti'],
              udaTitle: 'UDA',
              udaContext: {
                title: 'UDA',
                descrizione: 'Il contesto corrente.',
                competenze: ['Progettare reti'],
                obiettivi: ['Capire le reti'],
                currentLessonPosition: 1,
                lessons: [{ position: 1, titolo: 'Reti', sottotitolo: null }],
              },
              currentBody: body,
              hasCurrentContent: true,
            };
      const request = validateAiContentRequest(input);
      const built =
        request.kind === 'lesson'
          ? buildLessonPrompt(request)
          : buildPoolPrompt(request as Parameters<typeof buildPoolPrompt>[0]);
      const exported = exportCurrentContentPrompt(input).prompt;
      const [task, format] = exported.split(RESPONSE_FORMAT_HEADING);
      expect(task).toContain(built.user.slice(built.user.indexOf('<<<')));
      expect(task).toContain('Spiega i passaggi con esempi originali àè.');
      expect(task).toContain('Il contenuto corrente.');
      expect(task).toContain('Sei un assistente didattico esperto');
      expect(format).toBeTruthy();
      expect(task).not.toMatch(
        /Restituisci soltanto|ZERO-BASED|Struttura editoriale e compatibilità/,
      );
      expect(exported).not.toMatch(/max_output_tokens|"store"|"model"|"input"/);
    },
  );
  it('stops a legacy active proposal before any I/O or provider invocation', async () => {
    const plan = { status: 'authorized' } as VisualPlanRun;
    await expect(
      resumeCoordinatedProposal({ plan } as Parameters<typeof resumeCoordinatedProposal>[0]),
    ).rejects.toMatchObject({ code: 'visual_plan_expired' });
    expect(() =>
      assertCurrentVisualProposalProfile({ status: 'planned' } as VisualPlanRun),
    ).not.toThrow();
    expect(() =>
      assertCurrentVisualProposalProfile({ status: 'completed' } as VisualPlanRun),
    ).not.toThrow();
  });
  it.each(['economy', 'quality'])(
    'exports an executable map prompt for %s, preserving current text',
    (modelProfile) => {
      const request = validateAiContentRequest({
        kind: 'concept_map',
        requestId: '11111111-1111-4111-8111-111111111111',
        modelProfile,
        lessonBody: '## Corrente\n\nContesto aggiornato àè\n',
      });
      const [task, format] =
        exportCurrentContentPrompt(request).prompt.split(RESPONSE_FORMAT_HEADING);
      expect(task).toContain('Contesto aggiornato àè');
      expect(task).not.toMatch(/due campi|summaryMarkdown|Vincoli tecnici|nessun backtick/);
      expect(format).toContain('## Sintesi');
      expect(format).toContain('## Diagramma');
      expect(format).toContain('non sostituisce lo studio della lezione');
      expect(exportCurrentContentPrompt(request).prompt).toContain('Contesto aggiornato');
    },
  );
  it('provides an importer-compatible pool example', () => {
    expect(parsePool(POOL_FORMAT_EXAMPLE).ok).toBe(true);
  });
  it('fails closed when the trusted material boundary is missing', () => {
    const builder = vi.spyOn(promptBuilders, 'buildConceptMapPrompt').mockReturnValueOnce({
      system: 'Istruzioni',
      user: 'Un nuovo builder senza delimitatori riconosciuti.',
    });
    try {
      expect(() =>
        exportCurrentContentPrompt({
          kind: 'concept_map',
          requestId: '11111111-1111-4111-8111-111111111111',
          modelProfile: 'economy',
          lessonBody: 'Una lezione corrente.',
        }),
      ).toThrow('Prompt export material boundary changed');
    } finally {
      builder.mockRestore();
    }
  });
  it('rejects unsupported/invalid payloads without a provider', () => {
    expect(() => exportCurrentContentPrompt({ kind: 'other' })).toThrow();
  });
  it('binds no secret and runs only owner validation plus the pure exporter', () => {
    const source = readFileSync(new URL('./aiContentGateway.ts', import.meta.url), 'utf8');
    const callable = source.slice(source.indexOf('export const aiContentPromptExport'));
    expect(callable).toContain('await requireOwner(request, database)');
    expect(callable).toContain('exportCurrentContentPrompt(request.data)');
    expect(callable).not.toMatch(
      /secrets:|createPorts|loadRuntimeConfig|generateContent|\.value\(|\.set\(/,
    );
  });
  it('accepts both published image configs without relabeling history', () => {
    expect(isExactAiVisualServerConfig(AI_VISUAL_SERVER_CONFIG)).toBe(true);
    expect(isExactAiVisualServerConfig(AI_VISUAL_LEGACY_SERVER_CONFIG)).toBe(true);
    expect(AI_VISUAL_SERVER_CONFIG.model).toBe('gpt-image-2.5-sunburst-2026-09-08');
    expect(AI_VISUAL_LEGACY_SERVER_CONFIG.model).toBe('gpt-image-2-2026-04-21');
    expect(
      isExactAiVisualServerConfig({
        ...AI_VISUAL_SERVER_CONFIG,
        priceListVersion: AI_VISUAL_LEGACY_SERVER_CONFIG.priceListVersion,
      }),
    ).toBe(false);
  });
});
