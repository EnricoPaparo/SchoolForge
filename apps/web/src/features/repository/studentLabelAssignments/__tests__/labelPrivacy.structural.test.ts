import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * VDIF-02 — test **strutturali** della privacy dell'etichetta.
 *
 * L'invariante da difendere non è «l'interfaccia non mostra l'etichetta allo
 * studente»: è che l'etichetta non **esista** su nessuna superficie che uno
 * studente possa leggere. Un test di interfaccia non lo dimostrerebbe — un
 * campo può arrivare al client, restare invisibile, e comunque essere leggibile
 * con gli strumenti del browser o con una query diretta.
 *
 * Per questo si asserisce sulle **fonti**: sui tipi dei documenti che uno
 * studente legge, sui moduli del portale studente, sui payload verso l'AI e
 * sulle Functions. Sono asserzioni che una regressione non può aggirare
 * nascondendo qualcosa: dovrebbe scrivere il campo dove il test guarda.
 */

const SRC = resolve(process.cwd(), 'src');
const REPO = resolve(process.cwd(), '../..');

function read(path: string): string {
  return readFileSync(resolve(REPO, path), 'utf8');
}

/**
 * Sorgenti sotto una radice, con il percorso **relativo al repository**: le
 * asserzioni parlano di `apps/web/src/features/student/...`, non di una catena
 * di `../..` che nessuno saprebbe leggere in un fallimento.
 */
function sourcesUnder(root: string, extensions = ['.ts', '.tsx']): Map<string, string> {
  const absoluteRoot = resolve(REPO, root);
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
  walk(absoluteRoot);
  return found;
}

const firestoreTypes = readFileSync(resolve(SRC, 'types/firestore.ts'), 'utf8');

/** Corpo di una singola dichiarazione `export interface X {…}` / `export type X = {…}`. */
function declarationBody(name: string): string {
  const pattern = new RegExp(
    String.raw`export (?:interface|type) ${name}(?:\s*=)?\s*\{([\s\S]*?)\n\};?\n`,
  );
  const match = pattern.exec(firestoreTypes);
  expect(match, `dichiarazione ${name} non trovata in types/firestore.ts`).toBeTruthy();
  return match![1];
}

/**
 * Ogni documento che uno studente può leggere. `students/{uid}` è il caso
 * decisivo: lo studente legge il **proprio** documento, e le Rules autorizzano
 * un documento intero, non un singolo campo. Un `labelId` scritto qui sarebbe
 * leggibile dallo studente per costruzione — è la ragione per cui esiste una
 * collezione separata.
 */
const STUDENT_READABLE_DOCS = [
  'StudentDoc',
  'PublicLessonDoc',
  'PublishedProjectionDoc',
  'PublicVerificationQuestion',
  'SubmissionDoc',
  'SubmissionReceiptDoc',
  'CorrectionReturnDoc',
  'CorrectionReturnQuestionView',
  'StudentLessonNoteDoc',
  'StudentAccessSettings',
  'ClassDoc',
];

describe('VDIF-02 — nessuna etichetta sulle superfici leggibili dallo studente', () => {
  it.each(STUDENT_READABLE_DOCS)('%s non porta alcun campo di etichetta', (name) => {
    const body = declarationBody(name);
    expect(body).not.toMatch(/labelId/);
    expect(body).not.toMatch(/differentiationLabel/i);
    // `label` da solo: nessuna variante (labelName, labels, labelKey…).
    expect(body).not.toMatch(/label/i);
  });

  it('l’assegnazione vive in una collezione a sé, con id = studentUid', () => {
    const body = declarationBody('StudentLabelAssignmentDoc');
    expect(body).toMatch(/studentUid: string/);
    expect(body).toMatch(/ownerUid: string/);
    expect(body).toMatch(/labelId: string/);
  });
});

describe('VDIF-02 — il portale studente non nomina mai le etichette', () => {
  const studentModules = sourcesUnder('apps/web/src/features/student');

  it('esistono moduli studente da controllare (il test non è vacuo)', () => {
    expect(studentModules.size).toBeGreaterThan(0);
  });

  it.each([...studentModules.keys()])('%s non legge né nomina etichette', (path) => {
    const source = studentModules.get(path)!;
    expect(source).not.toMatch(/studentLabelAssignments/);
    expect(source).not.toMatch(/differentiationLabel/i);
    expect(source).not.toMatch(/labelId/);
  });
});

describe('VDIF-02 — Rules: la collezione è owner-only e l’assegnazione non è mutabile a piacere', () => {
  const rules = read('firestore.rules');

  it('esiste un blocco dedicato a studentLabelAssignments', () => {
    expect(rules).toMatch(/match \/studentLabelAssignments\/\{studentUid\} \{/);
  });

  it('ogni permesso della collezione passa da isOwner()', () => {
    const block = /match \/studentLabelAssignments\/\{studentUid\} \{([\s\S]*?)\n {4}\}/.exec(
      rules,
    )![1];
    const allows = block.match(/allow [^;]*;/g)!;
    expect(allows.length).toBeGreaterThanOrEqual(5);
    for (const allow of allows) expect(allow).toMatch(/isOwner\(\)/);
    // Nessuna condizione sullo studente autenticato: non è previsto che legga.
    expect(block).not.toMatch(/request\.auth\.uid == studentUid/);
    expect(block).not.toMatch(/isApprovedStudent/);
  });
});

describe('VDIF-02 — nessuna etichetta nei payload AI né nelle Functions', () => {
  it('le Functions non conoscono le etichette', () => {
    const functionsSources = sourcesUnder('functions/src');
    expect(functionsSources.size).toBeGreaterThan(0);
    for (const [path, source] of functionsSources) {
      expect(source, path).not.toMatch(/studentLabelAssignments/);
      expect(source, path).not.toMatch(/differentiationLabel/i);
    }
  });

  /**
   * Lista chiusa dei moduli autorizzati a nominare le due collezioni. È
   * volutamente scomoda da allargare: un modulo nuovo che tocchi l'etichetta fa
   * fallire questo test, e allargare la lista è una decisione consapevole
   * (documentata) invece di una diffusione silenziosa.
   */
  it('solo i moduli autorizzati nominano le collezioni delle etichette', () => {
    const allowed = [
      'apps/web/src/features/repository/studentLabelAssignments/',
      'apps/web/src/features/repository/differentiation/',
      'apps/web/src/features/repository/documentShape.ts',
      'apps/web/src/features/repository/students/studentsService.ts',
      // VDIF-03 — le sole superfici owner-only autorizzate a costruire e
      // persistere la configurazione differenziata. Il portale studente resta
      // escluso e le Functions continuano a non conoscere le etichette.
      'apps/web/src/features/repository/verifications/verificationsService.ts',
      // VDIF-04 — l'impronta G20 nomina la collezione delle assegnazioni solo
      // per spiegare che cosa serializza: non la legge, non la scrive, e non
      // conosce alcun nome di etichetta.
      'apps/web/src/features/repository/verifications/assignmentsFingerprint.ts',
      'apps/web/src/features/teacher/StudentsView.tsx',
      'apps/web/src/features/teacher/LabelsTab.tsx',
      'apps/web/src/features/teacher/DifferentiationVariantsDialog.tsx',
      'apps/web/src/features/teacher/VerificationsView.tsx',
      'apps/web/src/types/firestore.ts',
      'apps/web/src/rules/',
    ];
    const offenders = [...sourcesUnder('apps/web/src')]
      // I test possono nominare qualunque cosa: quello che conta è il codice
      // che va in produzione.
      .filter(([path]) => !/\.test\.tsx?$/.test(path))
      .filter(([path]) => !allowed.some((prefix) => path.startsWith(prefix)))
      .filter(([, source]) => /studentLabelAssignments|differentiationLabels/.test(source))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});
