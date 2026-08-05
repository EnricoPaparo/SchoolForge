import { planLessonMetadataAppend, validateLessonMetadataFile } from '../structureImport/index.js';
import { runStructureAppend } from './structureAppendProtocol.js';
import type { AttemptClassification } from './attemptState.js';
import type {
  ExistingLessonForPlan,
  LessonStructureImportManifest,
  NormalizedLessonMetadata,
  StructureImportBytes,
  StructureImportError,
} from '../structureImport/index.js';

/**
 * STRUCTURE-IMPORT-02B — orchestratore dell'append di lezioni «scheletro»
 * (structure-metadata-import-roadmap.md §4, §7.2).
 *
 * Stessa macchina di 02A: identità, sonda del tentativo, preflight, lease,
 * upload, rinnovo condizionato, commit e cleanup vivono in
 * `structureAppendProtocol`. Qui resta solo ciò che è davvero specifico delle
 * lezioni: la validazione del file, la lettura della UDA di destinazione e la
 * costruzione del manifest puro.
 *
 * Append-only e **senza contenuto**: ogni lezione nasce con corpo Markdown
 * vuoto, `poolStatus: 'absent'`, `questionCount: 0` e nessun pool. Non crea né
 * modifica UDA, non tocca lezioni esistenti, non genera testo e non chiama
 * l'IA.
 *
 * La UDA di destinazione è quella da cui il docente ha aperto il menu, risolta
 * e riletta autorevolmente qui: il file non contiene alcun riferimento alla
 * destinazione, quindi nulla al suo interno può dirottare l'import altrove.
 */

/** Stato della destinazione, letto una sola volta all'inizio del tentativo. */
export interface LessonStructureImportContext {
  ownerUid: string;
  activeImportId: string;
  /** UDA di destinazione, riletta: id, directory e titolo correnti. */
  udaId: string;
  udaDir: string;
  udaTitle: string | null;
  /** Le sole lezioni di questa UDA — per numerazione, order e collisioni. */
  existingLessons: ExistingLessonForPlan[];
}

export interface LessonStructureImportCollision {
  kind: 'lesson' | 'publicLesson' | 'storage';
  id: string;
}

export interface LessonStructureImportDeps {
  /**
   * Legge programma, import attivo, UDA di destinazione e lezioni della sola
   * UDA. `null` quando programma, import o UDA non esistono o non sono più
   * coerenti fra loro.
   */
  loadContext(params: {
    programId: string;
    udaId: string;
  }): Promise<LessonStructureImportContext | null>;
  hashManifest(manifestCanonical: string): Promise<string>;
  probeAttempt(params: {
    programId: string;
    activeImportId: string;
    requestId: string;
    manifestHash: string;
    manifest: LessonStructureImportManifest;
  }): Promise<AttemptClassification>;
  /** Collisioni su `lessonId`, `publicLessonId` e Storage path. Zero scritture. */
  preflight(params: {
    programId: string;
    context: LessonStructureImportContext;
    manifest: LessonStructureImportManifest;
    ownedStoragePaths: readonly string[];
  }): Promise<{ collision: LessonStructureImportCollision | null }>;
  /** Prenotazione: record del tentativo + lease **della sola UDA**. */
  acquireLease(params: {
    programId: string;
    activeImportId: string;
    udaId: string;
    requestId: string;
    manifestHash: string;
    manifest: LessonStructureImportManifest;
  }): Promise<'acquired' | 'busy'>;
  uploadStorage(files: Array<{ path: string; content: string }>): Promise<void>;
  renewLease(params: {
    programId: string;
    activeImportId: string;
    udaId: string;
    requestId: string;
    manifestHash: string;
  }): Promise<'renewed' | 'lost'>;
  /**
   * Unica transazione: tutti i `LessonDoc`, tutte le proiezioni
   * `publicLessons`, l'incremento unico di `lessonCount`, il record del
   * tentativo, l'audit e il rilascio del lease.
   */
  commit(params: {
    programId: string;
    manifest: LessonStructureImportManifest;
    requestId: string;
    manifestHash: string;
  }): Promise<void>;
  cleanup(params: {
    programId: string;
    activeImportId: string;
    manifest: LessonStructureImportManifest;
    requestId: string;
    manifestHash: string;
  }): Promise<'done' | 'pending'>;
}

export interface LessonStructureImportInput {
  programId: string;
  /** UDA da cui il docente ha aperto il menu. */
  udaId: string;
  /**
   * Uid dichiarato dal client. **Non autorevole**: viene solo confrontato,
   * fail-closed, con l'owner letto dal documento programma.
   */
  ownerUid: string;
  requestId: string;
  bytes: StructureImportBytes;
  filename?: string;
}

export type LessonStructureImportNotAppliedReason =
  | 'no_destination'
  | 'owner_mismatch'
  | 'hash_unavailable'
  | 'incoherent_attempt'
  | 'collision'
  | 'busy'
  | 'conflict'
  | 'upload_failed'
  | 'lease_lost'
  | 'commit_failed';

export type LessonStructureImportResult =
  | {
      status: 'committed';
      lessonIds: string[];
      lessonCount: number;
      titles: string[];
      /** Il manifest applicato: la UI aggiorna l'albero locale da qui. */
      manifest: LessonStructureImportManifest;
    }
  | { status: 'validation_failed'; error: StructureImportError }
  | { status: 'not_applied'; message: string; reason: LessonStructureImportNotAppliedReason }
  | { status: 'cleanup_pending'; message: string };

const COPY = {
  noDestination:
    'La UDA di destinazione non è più disponibile in questo corso. Ricarica la pagina e riprova.',
  ownerMismatch:
    'Questo corso non risulta più tuo in questa sessione. Ricarica la pagina e riprova.',
  busy: "Un'altra operazione è in corso su questa UDA. Attendi il completamento e riprova.",
  conflict:
    'Esiste già un tentativo di importazione con contenuti diversi. Ricarica la pagina e riprova.',
  incoherentAttempt:
    'Un tentativo precedente su questa UDA è rimasto in uno stato incoerente. Ricarica la pagina e riprova con una nuova importazione.',
  leaseLost:
    "L'importazione ha impiegato troppo tempo e la prenotazione è scaduta: nulla è stato applicato. Riprova.",
  collision:
    'Una delle lezioni del file coincide con contenuti già presenti in questa UDA. Nessuna modifica è stata applicata: cambia i titoli nel file e riprova.',
  preCommit: 'Importazione non applicata: la UDA è rimasta invariata. Puoi riprovare.',
  cleanupPending:
    'Importazione non applicata. Alcuni dati tecnici del tentativo devono ancora essere rimossi: riprova fra poco.',
  hashUnavailable: "Impossibile calcolare l'impronta dell'importazione.",
} as const;

export async function importLessonStructure(
  input: LessonStructureImportInput,
  deps: LessonStructureImportDeps,
): Promise<LessonStructureImportResult> {
  // 1. Validazione locale byte-first. Zero operazioni Firebase finora.
  const validation = validateLessonMetadataFile(input.bytes, {
    ...(input.filename === undefined ? {} : { filename: input.filename }),
  });
  if (!validation.ok) return { status: 'validation_failed', error: validation.error };

  // 2. Lettura autorevole: programma, import attivo, UDA di destinazione e le
  // sole lezioni di quella UDA.
  const context = await deps.loadContext({ programId: input.programId, udaId: input.udaId });
  if (!context) {
    return { status: 'not_applied', message: COPY.noDestination, reason: 'no_destination' };
  }

  // 3. L'owner viene dal documento programma, mai dal client.
  if (input.ownerUid !== context.ownerUid) {
    return { status: 'not_applied', message: COPY.ownerMismatch, reason: 'owner_mismatch' };
  }

  // 4. Manifest puro. I titoli già presenti nella UDA sono ricontrollati contro
  // lo stato appena letto, non contro quello che il dialog mostrava prima.
  const plan = planLessonMetadataAppend({
    ownerUid: context.ownerUid,
    programId: input.programId,
    importId: context.activeImportId,
    udaId: context.udaId,
    udaDir: context.udaDir,
    lessons: validation.value,
    existingLessons: context.existingLessons,
  });
  if (!plan.ok) return { status: 'validation_failed', error: plan.error };
  const manifest = plan.value;

  // 5–12. Protocollo condiviso con 02A.
  const outcome = await runStructureAppend(
    { manifest, requestId: input.requestId, copy: COPY },
    {
      hashManifest: (canonical) => deps.hashManifest(canonical),
      probeAttempt: ({ requestId, manifestHash }) =>
        deps.probeAttempt({
          programId: input.programId,
          activeImportId: context.activeImportId,
          requestId,
          manifestHash,
          manifest,
        }),
      preflight: ({ ownedStoragePaths }) =>
        deps.preflight({ programId: input.programId, context, manifest, ownedStoragePaths }),
      acquireLease: ({ requestId, manifestHash }) =>
        deps.acquireLease({
          programId: input.programId,
          activeImportId: context.activeImportId,
          udaId: context.udaId,
          requestId,
          manifestHash,
          manifest,
        }),
      uploadStorage: (files) => deps.uploadStorage(files),
      renewLease: ({ requestId, manifestHash }) =>
        deps.renewLease({
          programId: input.programId,
          activeImportId: context.activeImportId,
          udaId: context.udaId,
          requestId,
          manifestHash,
        }),
      commit: ({ requestId, manifestHash }) =>
        deps.commit({ programId: input.programId, manifest, requestId, manifestHash }),
      cleanup: ({ requestId, manifestHash }) =>
        deps.cleanup({
          programId: input.programId,
          activeImportId: context.activeImportId,
          manifest,
          requestId,
          manifestHash,
        }),
      filesOf: (m) =>
        m.lessons.map((lesson) => ({ path: lesson.storageRef, content: lesson.content })),
    },
  );

  if (outcome.status === 'committed') {
    return {
      status: 'committed',
      lessonIds: manifest.lessonIds,
      lessonCount: manifest.lessons.length,
      titles: manifest.lessons.map((lesson) => lesson.metadata.titolo),
      manifest,
    };
  }
  return outcome;
}

export type { NormalizedLessonMetadata, LessonStructureImportManifest };
