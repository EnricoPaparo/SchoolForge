import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * VDIF-04 — test **strutturali** T26 / T36 / T39.
 *
 * Quello che difendono non è ciò che l'interfaccia mostra, ma ciò che il codice
 * può anche solo produrre: un campo può arrivare al client, restare invisibile,
 * e comunque essere leggibile con gli strumenti del browser. Le asserzioni sono
 * quindi sulle **fonti**, non su un rendering.
 */

const REPO = resolve(process.cwd(), '../..');
const SRC = resolve(process.cwd(), 'src');

function sourcesUnder(root: string, extensions = ['.ts', '.tsx']): Map<string, string> {
  const found = new Map<string, string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'lib' || entry.name === 'dist')
          continue;
        walk(full);
      } else if (extensions.some((extension) => entry.name.endsWith(extension))) {
        found.set(relative(REPO, full).replaceAll('\\', '/'), readFileSync(full, 'utf8'));
      }
    }
  };
  walk(resolve(REPO, root));
  return found;
}

/**
 * Elenco chiuso dei termini vietati negli artefatti studente (roadmap §5.D.5c).
 * `assignmentMode` non ne fa parte, ed è l'unico discriminante pubblico nuovo:
 * dice **come** arrivano le domande, mai perché.
 */
const FORBIDDEN_IN_STUDENT_ARTIFACTS = [
  'differentiated',
  'differentiation',
  'labelId',
  'labelName',
  'nameKey',
  'assignedCount',
  'draftUsageCount',
  'byStudentUid',
];

describe('T39 — la proiezione pubblica aggiunge solo assignmentMode', () => {
  const types = readFileSync(resolve(SRC, 'types/firestore.ts'), 'utf8');
  const projection = /export type PublishedProjectionDoc = \{([\s\S]*?)\n\};/.exec(types)![1]!;

  it('dichiara assignmentMode con i due soli valori ammessi', () => {
    expect(projection).toMatch(/assignmentMode\?: VerificationAssignmentMode;/);
    const enumDecl = /export type VerificationAssignmentMode =([\s\S]*?);/.exec(types)![1]!;
    expect(enumDecl).toContain("'same_questions'");
    expect(enumDecl).toContain("'server_resolved'");
    // Nessun terzo valore, nessun booleano semanticamente esplicito.
    expect(enumDecl.match(/'/g)).toHaveLength(4);
  });

  it.each(FORBIDDEN_IN_STUDENT_ARTIFACTS)(
    'il contratto della proiezione non contiene «%s» come campo',
    (term) => {
      // Il termine può comparire in un commento esplicativo, mai come chiave.
      const fields = projection
        .split('\n')
        .filter((line) => /^\s{2}\w+\??:/.test(line))
        .join('\n');
      expect(fields).not.toContain(term);
    },
  );

  it('nessun campo `differentiated` esiste in alcun contratto studente', () => {
    for (const declaration of [
      'PublishedProjectionDoc',
      'PublicVerificationQuestion',
      'SubmissionDoc',
      'SubmissionReceiptDoc',
      'CorrectionReturnDoc',
    ]) {
      const body = new RegExp(
        String.raw`export (?:interface|type) ${declaration}(?:\s*=)?\s*\{([\s\S]*?)\n\};?`,
      ).exec(types)![1]!;
      const fields = body
        .split('\n')
        .filter((line) => /^\s{2}\w+\??:/.test(line))
        .join('\n');
      expect(fields, declaration).not.toMatch(/differentiated/);
    }
  });
});

describe('T26 — il portale studente non nomina mai la differenziazione', () => {
  const studentModules = sourcesUnder('apps/web/src/features/student');

  it('esistono moduli studente da controllare', () => {
    expect(studentModules.size).toBeGreaterThan(0);
  });

  it.each([...studentModules.keys()])('%s non nomina alcun termine vietato', (path) => {
    const source = studentModules.get(path)!;
    for (const term of FORBIDDEN_IN_STUDENT_ARTIFACTS) {
      expect(source, `${path} nomina «${term}»`).not.toContain(term);
    }
  });

  it('il client della callable non conosce nulla oltre a assignmentMode', () => {
    const client = studentModules.get(
      'apps/web/src/features/student/verificationVariantClient.ts',
    )!;
    expect(client).toContain("assignmentMode: 'server_resolved'");
    expect(client).not.toMatch(/labelId|labelName|differentiat/i);
  });
});

describe('T36 — autosufficienza dello snapshot dopo l’attivazione', () => {
  const verificationModules = sourcesUnder('apps/web/src/features/repository/verifications');

  /**
   * I moduli che servono una verifica **non più in bozza** non devono importare
   * i service delle etichette o delle assegnazioni: dopo l'attivazione tutto ciò
   * che serve vive nello snapshot, e una dipendenza dalla collezione live
   * significherebbe che una rinomina o un'eliminazione può ancora cambiare una
   * verifica già congelata.
   *
   * L'unica eccezione è `verificationsService.ts`, che le legge **solo** nel
   * preflight di attivazione, cioè finché la verifica è ancora una bozza.
   */
  const POST_DRAFT_MODULES = [
    'assignedVariant.ts',
    'differentiationResolution.ts',
    'studentVerificationsService.ts',
    'verificationPdf.ts',
    'verificationSnapshotMappers.ts',
    'submissionsMonitorService.ts',
  ];

  it.each(POST_DRAFT_MODULES)('%s non importa i service di etichette o assegnazioni', (name) => {
    const path = `apps/web/src/features/repository/verifications/${name}`;
    const source = verificationModules.get(path);
    expect(source, `${path} non trovato`).toBeTruthy();
    expect(source!).not.toMatch(/from '.*differentiationLabelsService/);
    expect(source!).not.toMatch(/from '.*studentLabelAssignmentsService/);
  });

  it('il risolutore opera sullo snapshot congelato, non sulla collezione live', () => {
    const resolver = verificationModules.get(
      'apps/web/src/features/repository/verifications/differentiationResolution.ts',
    )!;
    expect(resolver).not.toMatch(/getDoc|getDocs|firebase\/firestore/);
  });

  it('le Functions risolvono da teacherSnapshot e non leggono etichette o assegnazioni', () => {
    const functionsSources = sourcesUnder('functions/src');
    for (const [path, source] of functionsSources) {
      expect(source, path).not.toMatch(/differentiationLabels/);
      expect(source, path).not.toMatch(/studentLabelAssignments/);
    }
  });
});

describe('T39 — la risposta della callable non dichiara la natura della verifica', () => {
  const gateway = readFileSync(
    resolve(REPO, 'functions/src/verificationVariantGatewayCore.ts'),
    'utf8',
  );

  it('AssignResponse porta assignmentMode e nient’altro di semantico', () => {
    const body = /export interface AssignResponse \{([\s\S]*?)\n\}/.exec(gateway)![1]!;
    expect(body).toContain("assignmentMode: 'server_resolved'");
    for (const term of ['labelId', 'labelName', 'differentiated', 'labels']) {
      expect(body).not.toContain(term);
    }
  });
});

describe('T41e — le transizioni di stato non toccano i contatori', () => {
  const service = readFileSync(
    resolve(SRC, 'features/repository/verifications/verificationsService.ts'),
    'utf8',
  );

  function bodyOf(name: string): string {
    const start = service.indexOf(`export async function ${name}(`);
    expect(start, `${name} non trovata`).toBeGreaterThan(-1);
    const next = service.indexOf('\nexport ', start + 1);
    return service.slice(start, next === -1 ? undefined : next);
  }

  it.each(['closeVerification', 'reopenVerification'])(
    '%s non nomina draftUsageCount né la collezione delle etichette',
    (name) => {
      const body = bodyOf(name);
      expect(body).not.toContain('draftUsageCount');
      expect(body).not.toContain('LABELS_COLLECTION');
    },
  );

  it('nessun servizio riporta una verifica active o closed allo stato draft', () => {
    // Un ritorno a `draft` dovrebbe **incrementare** i contatori di ogni
    // etichetta ripristinata: finché quel percorso non esiste, il contratto
    // regge. Questo test è ciò che impedisce di introdurlo per distrazione.
    //
    // `createVerification` è escluso: una verifica *nasce* in bozza, e nascere
    // non è una transizione.
    const afterCreate = service.slice(
      service.indexOf('\nexport ', service.indexOf('export async function createVerification(')),
    );
    expect(afterCreate).not.toMatch(/status:\s*'draft'/);
  });

  it('l’attivazione decrementa con un valore esplicito, mai increment né max(0, n - 1)', () => {
    const body = bodyOf('commitVerificationActivation');
    expect(body).toContain('draftUsageCount: next');
    expect(body).not.toMatch(/increment\(/);
    expect(body).not.toMatch(/Math\.max\(0/);
  });
});
