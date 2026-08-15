import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * VDIF-05 — difese strutturali sui consumatori post-attivazione.
 *
 * I test funzionali dimostrano quale domanda viene mostrata o corretta; questi
 * test impediscono invece che metadati privati della differenziazione entrino
 * anche solo nei contratti o nei moduli che raggiungono lo studente.
 */

const REPO = resolve(process.cwd(), '../..');
const WEB_SRC = resolve(process.cwd(), 'src');

const FORBIDDEN_PRIVATE_TERMS = [
  'labelId',
  'labelName',
  'nameKey',
  'assignedCount',
  'draftUsageCount',
  'byStudentUid',
  'differentiation',
];

function source(path: string): string {
  return readFileSync(resolve(REPO, path), 'utf8');
}

function declaredFields(typeName: string): string {
  const types = readFileSync(resolve(WEB_SRC, 'types/firestore.ts'), 'utf8');
  const body = new RegExp(
    String.raw`export (?:interface|type) ${typeName}(?:\s*=)?\s*\{([\s\S]*?)\n\};?`,
  ).exec(types)?.[1];
  expect(body, `${typeName} non trovato`).toBeTruthy();
  return body!
    .split('\n')
    .filter((line) => /^\s{2}\w+\??:/.test(line))
    .join('\n');
}

describe('VDIF-05 — nessun metadato privato negli artefatti studente', () => {
  it.each([
    'PublishedProjectionDoc',
    'SubmissionDoc',
    'SubmissionReceiptDoc',
    'CorrectionReturnDoc',
  ])('%s non dichiara campi privati', (typeName) => {
    const fields = declaredFields(typeName);
    for (const term of FORBIDDEN_PRIVATE_TERMS) {
      expect(fields, `${typeName} dichiara ${term}`).not.toContain(term);
    }
  });

  it.each([
    'apps/web/src/features/student/OnlineExamView.tsx',
    'apps/web/src/features/student/StudentCorrectionView.tsx',
    'apps/web/src/features/student/studentCorrectionReturnsService.ts',
    'apps/web/src/features/repository/corrections/correctionArchivePdf.ts',
    'apps/web/src/features/repository/corrections/correctionRegisterExport.ts',
    'functions/src/forceSubmitCore.ts',
    'functions/src/forceCloseCore.ts',
  ])('%s non serializza metadati privati', (path) => {
    const contents = source(path);
    for (const term of FORBIDDEN_PRIVATE_TERMS) {
      expect(contents, `${path} nomina ${term}`).not.toContain(term);
    }
  });
});

describe('VDIF-05 — un solo insieme assegnato per tutti i consumatori', () => {
  it.each([
    'apps/web/src/features/repository/corrections/correctionsService.ts',
    'apps/web/src/features/repository/corrections/correctionWorkspaceLoader.ts',
    'apps/web/src/features/repository/corrections/correctionArchiveModel.ts',
  ])('%s passa dal resolver canonico', (path) => {
    expect(source(path)).toContain('resolveAssignedQuestions');
  });

  it('la correzione IA riceve e valida lo snapshot congelato', () => {
    const gateway = source('functions/src/aiCorrectionGateway.ts');
    const engine = source('functions/src/aiCorrectionEngine.ts');
    expect(gateway).toContain('resolvableSnapshot: teacherSnapshot');
    expect(engine).toContain('parseResolvableSnapshot');
    expect(engine).toContain('isValidResolvedAssignment');
  });

  it('i PDF studente server-resolved passano dal resolver personale', () => {
    const view = source('apps/web/src/features/student/StudentVerificationsView.tsx');
    expect(view).toContain('const canDownloadPdf = item.studentPdfEnabled');
    expect(view).toContain('await resolveVexPdfQuestions(item, vexDepsRef.current!)');
    expect(view).not.toContain('item.studentPdfEnabled && !isServerResolvedItem(item)');
  });
});

describe('VDIF-05 — numerazione studente locale e messaggi opachi', () => {
  it.each([
    'apps/web/src/features/student/OnlineExamView.tsx',
    'apps/web/src/features/student/StudentCorrectionView.tsx',
    'apps/web/src/features/teacher/CorrectionWorkspace.tsx',
  ])('%s non espone order + 1 come numero visuale', (path) => {
    expect(source(path)).not.toMatch(/\b(?:question\.)?order\s*\+\s*1\b/);
  });

  it('il caricamento studente usa un solo errore generico', () => {
    const service = source('apps/web/src/features/student/vexExamService.ts');
    expect(service).toContain('Impossibile caricare le domande della verifica. Riprova.');
    expect(service).not.toMatch(/Etichetta|PDP|BES|assegnazione.*incoerente/i);
  });
});
