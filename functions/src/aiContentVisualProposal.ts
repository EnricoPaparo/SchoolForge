/**
 * VISUAL-ENRICHMENT-01 — contratti puri della **fase testuale** dell'arricchimento
 * visuale: l'esito della proposta, il manifest dell'asset e il risolutore
 * d'ancora.
 *
 * Questa fase **non genera immagini** e non conosce byte, formati, Storage o
 * Firestore. Decide soltanto se una lezione beneficia davvero di una piccola
 * illustrazione didattica e, in caso affermativo, produce una proposta che un
 * essere umano legge e approva **prima** che qualcosa costi.
 *
 * **Perché «nessuna immagine utile» è un esito di prima classe.** Se l'unico
 * esito possibile fosse una proposta, il modello ne produrrebbe sempre una: un
 * generatore a cui non è consentito astenersi non è un giudizio, è una macchina
 * che riempie un campo. L'union discriminata rende l'astensione **esprimibile
 * quanto la proposta**, e la roadmap (§17) ricorda che un tasso di astensione
 * vicino a zero è un sintomo sospetto, non un successo.
 *
 * **Perché due rami disgiunti e non un booleano con campi opzionali.** Un
 * `hasImage: false` con `subject` valorizzato è uno stato rappresentabile e
 * quindi, prima o poi, uno stato reale. Qui i due rami non condividono un solo
 * campo: una proposta senza soggetto e un'astensione con didascalia sono
 * entrambe impossibili da costruire.
 *
 * Puro: nessuna rete, nessun I/O, nessuna dipendenza Firebase.
 */

import { AiContentError, AI_CONTENT_RUN_TTL_MS, timestampToMillis } from './aiContentCore.js';
import { canonicalLessonHeadingText } from '@schoolforge/lesson-contract';

// ─── Limiti ───────────────────────────────────────────────────────────────────

/**
 * Tutti i limiti sono in **code point Unicode**, non in unità UTF-16.
 *
 * La differenza non è teorica: un'emoji fuori dal BMP occupa due unità UTF-16,
 * quindi `String.prototype.length` la conterebbe doppia e un testo legittimo
 * verrebbe rifiutato per una ragione che nessuno può vedere leggendolo. Si conta
 * ciò che un essere umano conta.
 */
export const MAX_VISUAL_SUBJECT_CHARS = 400;
export const MAX_VISUAL_REASON_CHARS = 600;
export const MAX_VISUAL_RATIONALE_CHARS = 800;
export const MAX_VISUAL_ANCHOR_HEADING_CHARS = 300;
export const MAX_VISUAL_CAPTION_CHARS = 500;
export const MAX_VISUAL_ALT_TEXT_CHARS = 1_000;
/** Numero massimo di stringhe **distinte** autorizzabili dentro l'immagine. */
export const MAX_VISUAL_AUTHORIZED_LABELS = 8;
/** Lunghezza massima, in code point, di una singola etichetta autorizzata. */
export const MAX_VISUAL_AUTHORIZED_LABEL_CHARS = 40;

/** Peso massimo dei byte canonici dell'immagine (VE-03). */
export const MAX_VISUAL_BYTES = 204_800;
/** Lato lungo massimo in pixel dei byte canonici (VE-03). */
export const MAX_VISUAL_LONG_EDGE = 1200;
/** Versione dello stile con cui un'immagine è stata prodotta. */
export const VISUAL_STYLE_VERSION = 'schoolforge-sketch/v1' as const;

/**
 * TTL dello staging: **riusa** quello dei run IA invece di dichiararne uno
 * proprio. Due costanti con lo stesso significato divergono al primo cambio, e
 * un asset in staging che sopravvive al run che lo ha prodotto è esattamente il
 * genere di orfano che nessuno va a cercare.
 */
export const VISUAL_STAGING_TTL_MS = AI_CONTENT_RUN_TTL_MS;

// ─── Esito della proposta ─────────────────────────────────────────────────────

/** Il modello ha concluso che nessuna illustrazione aiuterebbe. */
export interface VisualProposalNone {
  decision: 'none';
  /** Perché non serve: è la parte che il docente legge per fidarsi. */
  reason: string;
}

/** Il modello propone una illustrazione, che resta da approvare. */
export interface VisualProposalImage {
  decision: 'image';
  /** Soggetto da illustrare. Sarà l'unico testo variabile del prompt immagine. */
  subject: string;
  /** Utilità didattica: che cosa l'immagine fa capire meglio del solo testo. */
  rationale: string;
  /** Testo dell'heading a cui ancorare. Lo slug lo deriva il server (VE-02). */
  anchorHeadingText: string;
  /** Didascalia visibile sotto l'immagine. */
  caption: string;
  /** Testo alternativo, per chi non vede l'immagine. */
  altText: string;
}

export type VisualProposalOutput = VisualProposalNone | VisualProposalImage;

const NONE_KEYS = ['decision', 'reason'] as const;
const IMAGE_KEYS = [
  'decision',
  'subject',
  'rationale',
  'anchorHeadingText',
  'caption',
  'altText',
] as const;

// ─── Vincoli comuni ai campi testuali ─────────────────────────────────────────

/**
 * Caratteri di controllo C0 e C1, **ritorno a capo incluso**: i campi della
 * proposta sono testo su una riga logica, e una newline dentro una didascalia è
 * già un segno che il modello sta producendo altro.
 *
 * È una scansione per code point e non una regex: una regex con caratteri di
 * controllo letterali è illeggibile e indistinguibile da un errore di battitura,
 * ed è il motivo per cui il linter la segnala.
 */
function hasControlChars(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0)!;
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/**
 * Tag HTML **reale**: `<` seguito da lettera o `/`, un nome e una chiusura.
 * Volutamente non generico su `<`, altrimenti «a < b» diventerebbe markup: il
 * vincolo ferma il markup, non l'aritmetica. Stessa scelta di
 * `aiContentConceptMap`, per non avere due definizioni di «HTML».
 */
const HTML_TAG_RE = /<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>/;
/** Commenti, doctype e CDATA: non sono tag ma sono comunque markup. */
const HTML_META_RE = /<!--|<!\[CDATA\[|<!\s*doctype/i;
/** Fence Markdown: tre backtick o tre tilde, ovunque nel campo. */
const FENCE_RE = /```|~~~/;

function invalidOutput(message: string): never {
  throw new AiContentError('provider_invalid_output', message);
}

/** Lunghezza in **code point**, non in unità UTF-16. */
export function codePointLength(value: string): number {
  return [...value].length;
}

export type VisualAuthorizedLabelsInspection =
  | { readonly ok: true; readonly labels: readonly string[] }
  | { readonly ok: false; readonly reason: 'invalid_form' | 'too_many' };

/**
 * Contratto puro condiviso dalle due fasi: una proposta accettata deve essere
 * consumabile dal generatore di immagini senza incontrare un secondo insieme
 * di regole. Le ripetizioni esatte sono un set e non ampliano l'allowlist.
 */
export function inspectVisualAuthorizedLabels(subject: string): VisualAuthorizedLabelsInspection {
  const labels: string[] = [];
  const seen = new Set<string>();
  const re = /«([^«»]+)»/gu;
  for (const match of subject.matchAll(re)) {
    const label = match[1]!;
    if (label !== label.trim() || codePointLength(label) > MAX_VISUAL_AUTHORIZED_LABEL_CHARS) {
      return { ok: false, reason: 'invalid_form' };
    }
    if (seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  const residual = subject.replace(/«[^«»]+»/gu, '');
  if (residual.includes('«') || residual.includes('»')) {
    return { ok: false, reason: 'invalid_form' };
  }
  if (labels.length > MAX_VISUAL_AUTHORIZED_LABELS) {
    return { ok: false, reason: 'too_many' };
  }
  return { ok: true, labels };
}

/**
 * Valida un campo testuale della proposta, **senza modificarlo**.
 *
 * L'ordine è deliberato: tipo → non vuoto → spazi esterni → limite → markup.
 * Lo spazio esterno è controllato **prima** del limite perché un valore con
 * spazi in testa è già non canonico, e rifiutarlo per lunghezza direbbe al
 * chiamante la cosa sbagliata.
 *
 * Nessun `trim()`, nessun troncamento, nessuna normalizzazione: un valore non
 * canonico viene rifiutato, non aggiustato. Un campo corretto in silenzio non
 * è più né ciò che il modello ha prodotto né ciò che il docente approverà.
 */
function assertProposalField(value: unknown, label: string, maxChars: number): string {
  if (typeof value !== 'string') {
    invalidOutput(`${label}: valore mancante o non testuale.`);
  }
  if (value.length === 0) {
    invalidOutput(`${label}: non può essere vuoto.`);
  }
  if (value !== value.trim()) {
    // Copre anche il campo di soli spazi, che dopo il trim diventa vuoto.
    invalidOutput(`${label}: non deve avere spazi esterni.`);
  }
  if (codePointLength(value) > maxChars) {
    invalidOutput(`${label}: supera ${maxChars} caratteri.`);
  }
  if (hasControlChars(value)) {
    invalidOutput(`${label}: contiene caratteri di controllo.`);
  }
  if (HTML_TAG_RE.test(value) || HTML_META_RE.test(value)) {
    invalidOutput(`${label}: l'HTML non è ammesso.`);
  }
  if (FENCE_RE.test(value)) {
    invalidOutput(`${label}: i blocchi di codice non sono ammessi.`);
  }
  return value;
}

// ─── Validazione del subject ──────────────────────────────────────────────────

/**
 * Il `subject` è l'**unico** testo variabile che raggiungerà il provider di
 * immagini (roadmap §9.2): il corpo della lezione non lo raggiunge mai. È quindi
 * il solo punto in cui una prompt injection annidata nel corpo potrebbe
 * propagarsi, e per questo ha un contratto proprio oltre a quello comune.
 *
 * La difesa vera resta strutturale — il prompt immagine è composto dal server e
 * un essere umano approva il soggetto prima della spesa — ma un filtro esplicito
 * ferma i casi conclamati senza dipendere dall'attenzione del docente.
 *
 * **Fail-closed e volutamente conservativo:** un soggetto legittimo rifiutato
 * costa una riformulazione; uno malevolo accettato costa un'immagine che
 * SchoolForge non avrebbe dovuto produrre.
 */
const SUBJECT_FORBIDDEN_PATTERNS: readonly { readonly re: RegExp; readonly why: string }[] = [
  {
    // Imitazione di autori e stili proprietari: «nello stile di …», «alla
    // maniera di …», «in the style of …».
    re: /\b(?:nello\s+stile\s+di|in\s+the\s+style\s+of|alla\s+maniera\s+di|stile\s+di\s+[A-Z])/i,
    why: 'imitazione di uno stile attribuito',
  },
  {
    // Studi, marchi e franchise citati come riferimento visivo.
    re: /\b(?:disney|pixar|ghibli|marvel|dc\s+comics|nintendo|lego|warner|netflix)\b/i,
    why: 'riferimento a marchi o studi',
  },
  {
    // Persone reali, riconoscibili o identificabili.
    re: /\b(?:volto|viso|ritratto|sembianze|somigli\w*|riconoscibil\w*|identificabil\w*|celebrit\w*|personaggio\s+reale|persona\s+reale)\b/i,
    why: 'persone riconoscibili o identificabili',
  },
  {
    // Tentativi di scavalcare le istruzioni precedenti.
    re: /\b(?:ignor\w*\s+(?:le\s+)?(?:istruzion\w*|regol\w*|indicazion\w*)|ignore\s+(?:all\s+)?previous|disregard\s+(?:all\s+)?previous|dimentic\w*\s+(?:le\s+)?istruzion\w*)/i,
    why: 'tentativo di ignorare le istruzioni',
  },
  {
    // Tentativi di sostituire il preambolo di stile SchoolForge.
    re: /\b(?:sostitu\w*|ignor\w*|sovrascriv\w*|override|replace)\b[^.]{0,40}\b(?:preambol\w*|system\s+prompt|stile\s+schoolforge|schoolforge\s+sketch)\b/i,
    why: 'tentativo di sostituire il preambolo di stile',
  },
  {
    // Testo esteso, marchi grafici e firme dentro l'immagine.
    re: /\b(?:logo|loghi|watermark|filigrana|firma\s+dell\w*\s+autor\w*|marchio\s+registrato|paragraf\w*\s+di\s+testo|testo\s+lungo)\b/i,
    why: 'testo esteso, loghi, firme o watermark',
  },
  {
    // Concetti dichiaratamente assenti dalla lezione.
    re: /\b(?:anche\s+se\s+non\s+(?:è|e)\s+nella\s+lezione|non\s+present\w*\s+nella\s+lezione|aggiungi\s+(?:un\s+)?concett\w*\s+nuov\w*)\b/i,
    why: 'introduzione di concetti assenti dalla lezione',
  },
];

/**
 * Valida il `subject` **oltre** i vincoli comuni. Restituisce il valore
 * identico o lancia.
 *
 * **Il messaggio d'errore non contiene mai il soggetto integrale**: finirebbe
 * nei log, e i log di un tentativo di injection sono esattamente il posto in cui
 * quel testo non deve essere replicato. Viene riportata soltanto la categoria.
 */
export function assertValidVisualSubject(value: unknown): string {
  const subject = assertProposalField(value, 'Soggetto', MAX_VISUAL_SUBJECT_CHARS);
  for (const { re, why } of SUBJECT_FORBIDDEN_PATTERNS) {
    if (re.test(subject)) {
      invalidOutput(`Soggetto non ammesso (${why}).`);
    }
  }
  const labels = inspectVisualAuthorizedLabels(subject);
  if (!labels.ok) {
    invalidOutput(
      labels.reason === 'too_many'
        ? `Soggetto: massimo ${MAX_VISUAL_AUTHORIZED_LABELS} etichette distinte.`
        : 'Soggetto: etichette fra caporali non valide.',
    );
  }
  return subject;
}

/** Predicato senza eccezioni, per i percorsi che devono decidere e non fallire. */
export function isValidVisualSubject(value: unknown): boolean {
  try {
    assertValidVisualSubject(value);
    return true;
  } catch {
    return false;
  }
}

// ─── Validazione dell'output ──────────────────────────────────────────────────

function asObject(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalidOutput(message);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(root: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(root)) {
    if (!allowed.includes(key)) {
      // Il messaggio non nomina la chiave: potrebbe essere testo del modello.
      invalidOutput('La proposta visuale contiene campi non ammessi.');
    }
  }
}

/**
 * Valida l'output del provider, fail-closed e **senza coercizioni**.
 *
 * I due rami sono chiusi in entrambe le direzioni: un `decision: 'none'` che
 * porti con sé un `subject` è rifiutato tanto quanto un `decision: 'image'`
 * privo di didascalia. È ciò che rende l'union una vera union e non due forme
 * che si sovrappongono.
 */
export function validateVisualProposalOutput(output: unknown): VisualProposalOutput {
  const root = asObject(output, 'Struttura della proposta visuale non valida.');
  const decision = root.decision;

  if (decision === 'none') {
    assertExactKeys(root, NONE_KEYS);
    return {
      decision: 'none',
      reason: assertProposalField(root.reason, 'Motivazione', MAX_VISUAL_REASON_CHARS),
    };
  }

  if (decision === 'image') {
    assertExactKeys(root, IMAGE_KEYS);
    return {
      decision: 'image',
      subject: assertValidVisualSubject(root.subject),
      rationale: assertProposalField(
        root.rationale,
        'Utilità didattica',
        MAX_VISUAL_RATIONALE_CHARS,
      ),
      anchorHeadingText: assertProposalField(
        root.anchorHeadingText,
        'Heading di ancoraggio',
        MAX_VISUAL_ANCHOR_HEADING_CHARS,
      ),
      caption: assertProposalField(root.caption, 'Didascalia', MAX_VISUAL_CAPTION_CHARS),
      altText: assertProposalField(root.altText, 'Testo alternativo', MAX_VISUAL_ALT_TEXT_CHARS),
    };
  }

  invalidOutput('Esito della proposta visuale non riconosciuto.');
}

/** Chiave dell'envelope richiesto dallo Structured Output strict. */
export const VISUAL_PROPOSAL_ENVELOPE_KEY = 'proposal' as const;

/**
 * Valida la risposta **grezza del provider** ed estrae l'esito canonico.
 *
 * Lo schema strict impone una radice `object` con una proprietà obbligatoria
 * (`proposal`), perché un'unione alla radice non è accettata. Quell'envelope è
 * però una necessità del **trasporto**, non del dominio: viene tolto qui, prima
 * di qualunque persistenza, così il valore salvato nel run e restituito dal
 * replay resta l'unione pura. Se filtrasse fino al documento persistito, il
 * contratto pubblico diventerebbe ostaggio della forma che un provider richiede
 * oggi.
 */
export function validateVisualProposalEnvelope(output: unknown): VisualProposalOutput {
  const root = asObject(output, 'Struttura della proposta visuale non valida.');
  const keys = Object.keys(root);
  if (keys.length !== 1 || keys[0] !== VISUAL_PROPOSAL_ENVELOPE_KEY) {
    invalidOutput('La proposta visuale non rispetta la forma attesa.');
  }
  return validateVisualProposalOutput(root[VISUAL_PROPOSAL_ENVELOPE_KEY]);
}

/**
 * Forma dell'`output` di un run `visual_proposal` completato. Il run persiste
 * **l'esito validato senza envelope**, che è già il documento finale di questa
 * fase: non c'è nulla da comporre, a differenza della mappa concettuale.
 */
export function validateStoredVisualProposalOutput(output: unknown): VisualProposalOutput {
  return validateVisualProposalOutput(output);
}

/** Predicato senza eccezioni, per i parser fail-closed che restituiscono `null`. */
export function isValidStoredVisualProposalOutput(output: unknown): boolean {
  try {
    validateStoredVisualProposalOutput(output);
    return true;
  } catch {
    return false;
  }
}

// ─── Manifest e ancoraggio ────────────────────────────────────────────────────

/**
 * Istante di approvazione, descritto **strutturalmente**.
 *
 * La roadmap (§4) lo dichiara `Timestamp` di Firestore, ma questo modulo deve
 * restare puro e senza dipendenze Firebase: si vincola quindi la sola forma che
 * serve a validarlo. Il `Timestamp` reale la soddisfa, e VE-03 lo legherà al
 * tipo concreto nel punto in cui la persistenza esiste davvero.
 */
export interface VisualTimestampLike {
  toMillis(): number;
}

/** Ancora dell'immagine dentro la lezione renderizzata (roadmap §5.1). */
export interface LessonVisualAnchor {
  /** Slug deterministico dell'heading, con le regole di LESSON-MANUAL-01. */
  headingSlug: string;
  /** Testo dell'heading all'approvazione. **Diagnostico, mai chiave.** */
  headingText: string;
  /** Posizione rispetto all'heading. */
  placement: 'after-heading';
}

/** Manifest dell'unica immagine approvata di una lezione (roadmap §4). */
export interface LessonVisualManifest {
  assetId: string;
  storageRef: string;
  anchor: LessonVisualAnchor;
  caption: string;
  altText: string;
  width: number;
  height: number;
  byteLength: number;
  sha256: string;
  mimeType: 'image/webp';
  styleVersion: typeof VISUAL_STYLE_VERSION;
  sourceBodyHash: string;
  approvedAt: VisualTimestampLike;
}

const ANCHOR_KEYS = ['headingSlug', 'headingText', 'placement'] as const;
const MANIFEST_KEYS = [
  'assetId',
  'storageRef',
  'anchor',
  'caption',
  'altText',
  'width',
  'height',
  'byteLength',
  'sha256',
  'mimeType',
  'styleVersion',
  'sourceBodyHash',
  'approvedAt',
] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
/** Slug come li produce LESSON-MANUAL-01: minuscole, cifre, trattini. */
const HEADING_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function invalidManifest(message: string): never {
  throw new AiContentError('invalid_input', message);
}

function assertPositiveInt(value: unknown, label: string, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    invalidManifest(`${label}: deve essere un intero positivo.`);
  }
  if (value > max) {
    invalidManifest(`${label}: supera il massimo consentito (${max}).`);
  }
  return value;
}

export function validateLessonVisualAnchor(value: unknown): LessonVisualAnchor {
  const root = asObjectOrThrow(value, "Ancora dell'immagine non valida.");
  for (const key of Object.keys(root)) {
    if (!ANCHOR_KEYS.includes(key as (typeof ANCHOR_KEYS)[number])) {
      invalidManifest("L'ancora contiene campi non ammessi.");
    }
  }
  const headingSlug = root.headingSlug;
  if (typeof headingSlug !== 'string' || !HEADING_SLUG_RE.test(headingSlug)) {
    invalidManifest('Slug di ancoraggio non valido.');
  }
  const headingText = root.headingText;
  if (
    typeof headingText !== 'string' ||
    headingText.length === 0 ||
    headingText !== headingText.trim() ||
    codePointLength(headingText) > MAX_VISUAL_ANCHOR_HEADING_CHARS
  ) {
    invalidManifest("Testo dell'heading di ancoraggio non valido.");
  }
  if (root.placement !== 'after-heading') {
    invalidManifest('Posizionamento non valido.');
  }
  return { headingSlug, headingText, placement: 'after-heading' };
}

function asObjectOrThrow(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalidManifest(message);
  }
  return value as Record<string, unknown>;
}

/**
 * Valida il manifest, fail-closed e senza correzioni.
 *
 * `width`/`height` sono vincolati sul **lato lungo**, non su entrambi: il
 * contratto della roadmap parla di lato lungo ≤ 1200, e un'immagine larga e
 * bassa è legittima quanto una quadrata.
 */
export function validateLessonVisualManifest(value: unknown): LessonVisualManifest {
  const root = asObjectOrThrow(value, 'Manifest visuale non valido.');
  for (const key of Object.keys(root)) {
    if (!MANIFEST_KEYS.includes(key as (typeof MANIFEST_KEYS)[number])) {
      invalidManifest('Il manifest visuale contiene campi non ammessi.');
    }
  }
  for (const key of MANIFEST_KEYS) {
    if (!(key in root)) {
      invalidManifest(`Manifest visuale incompleto: manca ${key}.`);
    }
  }

  const assetId = root.assetId;
  if (typeof assetId !== 'string' || !UUID_RE.test(assetId)) {
    invalidManifest('assetId non valido.');
  }
  const storageRef = assertCanonicalStorageRef(root.storageRef, assetId);
  const anchor = validateLessonVisualAnchor(root.anchor);
  const caption = assertManifestText(root.caption, 'Didascalia', MAX_VISUAL_CAPTION_CHARS);
  const altText = assertManifestText(root.altText, 'Testo alternativo', MAX_VISUAL_ALT_TEXT_CHARS);
  const width = assertPositiveInt(root.width, 'Larghezza', MAX_VISUAL_LONG_EDGE);
  const height = assertPositiveInt(root.height, 'Altezza', MAX_VISUAL_LONG_EDGE);
  if (Math.max(width, height) > MAX_VISUAL_LONG_EDGE) {
    invalidManifest(`Il lato lungo supera ${MAX_VISUAL_LONG_EDGE} pixel.`);
  }
  const byteLength = assertPositiveInt(root.byteLength, 'Dimensione', MAX_VISUAL_BYTES);
  const sha256 = root.sha256;
  if (typeof sha256 !== 'string' || !SHA256_HEX_RE.test(sha256)) {
    invalidManifest('sha256 non valido.');
  }
  if (root.mimeType !== 'image/webp') {
    invalidManifest('mimeType non ammesso.');
  }
  if (root.styleVersion !== VISUAL_STYLE_VERSION) {
    invalidManifest('styleVersion non ammessa.');
  }
  const sourceBodyHash = root.sourceBodyHash;
  if (typeof sourceBodyHash !== 'string' || !SHA256_HEX_RE.test(sourceBodyHash)) {
    invalidManifest('sourceBodyHash non valido.');
  }
  /*
   * `approvedAt` non è validato dalla sola presenza di `toMillis`: un oggetto
   * che ha il metodo e restituisce `NaN`, `Infinity` o una stringa — o che lo fa
   * esplodere — supererebbe quel controllo e romperebbe tutto ciò che viene
   * dopo. L'helper condiviso lo invoca in modo protetto e pretende un `number`
   * finito; il valore **non viene normalizzato**, si conserva l'oggetto ricevuto.
   */
  const approvedAt = root.approvedAt;
  if (timestampToMillis(approvedAt) === null) {
    invalidManifest('approvedAt non valido.');
  }

  return {
    assetId,
    storageRef,
    anchor,
    caption,
    altText,
    width,
    height,
    byteLength,
    sha256,
    mimeType: 'image/webp',
    styleVersion: VISUAL_STYLE_VERSION,
    sourceBodyHash,
    approvedAt: approvedAt as VisualTimestampLike,
  };
}

/**
 * Esportata per MULTI-VISUAL-01: `LessonVisualItem.caption`/`altText` seguono
 * esattamente questa stessa disciplina (nessuna correzione, nessuna seconda
 * definizione delle regole su spazi/controllo/HTML/fence). Comportamento
 * invariato: solo la visibilità del simbolo cambia.
 */
export function assertManifestText(value: unknown, label: string, maxChars: number): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value !== value.trim() ||
    codePointLength(value) > maxChars ||
    hasControlChars(value) ||
    HTML_TAG_RE.test(value) ||
    HTML_META_RE.test(value)
  ) {
    invalidManifest(`${label} non valida.`);
  }
  return value;
}

/**
 * Verifica che `storageRef` sia **esattamente** il percorso canonico:
 *
 * `repository/{ownerUid}/{importId}/{udaDir}/visuals/{assetId}.webp`
 *
 * Un percorso è un'autorizzazione implicita: le Rules di Storage sono owner-only
 * e ancorate al prefisso `repository/{ownerUid}/…`, quindi uno `storageRef` fuori
 * forma non è un dettaglio estetico ma un riferimento che punta dove non
 * dovrebbe. Il controllo è strutturale e **senza correzioni**: nessun fallback,
 * nessun suffisso aggiunto, nessuna normalizzazione.
 *
 * L'`assetId` finale deve coincidere con quello del manifest: due identificatori
 * divergenti descriverebbero due asset diversi nello stesso documento, e la
 * verifica dei byte in fase di promozione (§4.1) controllerebbe l'uno mentre la
 * proiezione userebbe l'altro.
 */
/**
 * Esportata per MULTI-VISUAL-01: `LessonVisualItem.storageRef` (roadmap §5.1)
 * ha la stessa forma canonica di `LessonVisualManifest.storageRef` — «Identico
 * per forma a VE §4» — e la verifica non può avere una seconda definizione.
 * Comportamento invariato: solo la visibilità del simbolo cambia.
 */
export function assertCanonicalStorageRef(value: unknown, assetId: string): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    invalidManifest('storageRef non valido.');
  }
  if (hasControlChars(value)) {
    invalidManifest('storageRef contiene caratteri di controllo.');
  }
  const segments = value.split('/');
  if (segments.length !== 6) {
    invalidManifest('storageRef non ha la forma canonica.');
  }
  for (const segment of segments) {
    // Uno slash doppio produce un segmento vuoto; «.» e «..» sono traversal.
    if (segment.length === 0 || segment === '.' || segment === '..') {
      invalidManifest('storageRef non ha la forma canonica.');
    }
  }
  if (segments[0] !== 'repository') {
    invalidManifest('storageRef non parte dal prefisso del repository.');
  }
  if (segments[4] !== 'visuals') {
    invalidManifest('storageRef non punta alla cartella degli asset visuali.');
  }
  if (segments[5] !== `${assetId}.webp`) {
    invalidManifest('storageRef non corrisponde all’assetId del manifest.');
  }
  return value;
}

// ─── Heading realmente presenti nella lezione ─────────────────────────────────

/**
 * Riga di fence: fino a tre spazi di indentazione, poi una sequenza di almeno
 * tre backtick o tre tilde, poi il resto della riga.
 *
 * I tre gruppi servono tutti: il **carattere** e la **lunghezza** della sequenza
 * decidono se una riga chiude il blocco, e la coda decide se è una chiusura o
 * solo l'apertura con un info string.
 */
const FENCE_LINE_RE = /^ {0,3}((`{3,})|(~{3,}))([^]*)$/;
/** Dopo una sequenza di chiusura può esserci solo spazio bianco. */
const ONLY_WHITESPACE_RE = /^[ \t]*$/;

/** Fence aperta: carattere **e** lunghezza della sequenza di apertura. */
interface OpenFence {
  char: '`' | '~';
  length: number;
}

/**
 * Legge una riga come possibile fence, restituendo carattere, lunghezza e coda.
 * `null` se la riga non è una fence.
 */
function readFenceLine(line: string): { char: '`' | '~'; length: number; rest: string } | null {
  const m = FENCE_LINE_RE.exec(line);
  if (!m) return null;
  const run = m[1]!;
  return { char: run[0] as '`' | '~', length: run.length, rest: m[4] ?? '' };
}

/**
 * Una riga chiude il blocco **solo** se rispetta tutte le condizioni di
 * CommonMark: stesso carattere, sequenza **lunga almeno quanto** quella di
 * apertura, e nient'altro che spazi o tabulazioni dopo di essa.
 *
 * Conservare solo il carattere non basta, ed è il difetto che questo controllo
 * corregge: una fence aperta con quattro backtick veniva chiusa da una riga di
 * tre backtick, che per Markdown è ancora **contenuto** del blocco. Il testo
 * successivo tornava così a essere interpretato, e un `# Titolo` dentro un
 * esempio di codice diventava un heading ancorabile che nella pagina non
 * esiste.
 */
function closesFence(line: string, open: OpenFence): boolean {
  const fence = readFenceLine(line);
  if (!fence) return false;
  return (
    fence.char === open.char && fence.length >= open.length && ONLY_WHITESPACE_RE.test(fence.rest)
  );
}
/** Heading ATX: da uno a sei `#`, con l'indentazione tollerata da CommonMark. */
const ATX_LINE_RE = /^ {0,3}(#{1,6})(?:\s+(.*?))?\s*$/;
/** Sottolineatura Setext: `===` (H1) o `---` (H2). */
const SETEXT_UNDERLINE_LINE_RE = /^ {0,3}(=+|-+)\s*$/;

/**
 * Estrae il **testo** degli heading realmente presenti nel corpo della lezione.
 *
 * Riconosce le due sintassi che il renderer delle lezioni interpreta davvero —
 * ATX (`## Titolo`) e Setext (titolo sottolineato da `===` o `---`) — e ignora
 * tutto ciò che sta dentro un blocco recintato: un `# Titolo` dentro un esempio
 * di codice **non è** un heading, e trattarlo come tale permetterebbe di ancorare
 * un'immagine a una sezione che nella pagina non esiste.
 *
 * Il testo è estratto come lo interpreta CommonMark: marcatori rimossi, eventuale
 * sequenza di chiusura `###` scartata, contenuto ripulito dagli spazi di bordo.
 * È l'estrazione a normalizzare la **sintassi**; il confronto con la proposta
 * resta poi rigorosamente esatto.
 */
export function extractLessonHeadings(markdown: string): string[] {
  return extractLessonHeadingsDetailed(markdown).map((heading) => heading.text);
}

/** Un heading del corpo, con il livello che il renderer userà davvero. */
export interface LessonHeadingOccurrence {
  text: string;
  /** 1–6 per ATX; 1 per Setext `===`, 2 per Setext `---`. */
  level: number;
}

/**
 * Stessa estrazione, con il **livello**.
 *
 * Serve all'ancoraggio e non alla proposta: il renderer di LESSON-MANUAL-01
 * assegna un `id` soltanto agli heading di livello 2 e 3, quindi ancorare a un
 * `#` o a un `####` significherebbe puntare a un elemento che nella pagina non
 * ha alcun identificatore. `extractLessonHeadings` resta la vista testuale di
 * questa funzione, byte per byte come prima.
 */
export function extractLessonHeadingsDetailed(markdown: string): LessonHeadingOccurrence[] {
  const lines = markdown.split('\n');
  const headings: LessonHeadingOccurrence[] = [];
  let open: OpenFence | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';

    if (open !== null) {
      // Dentro un blocco: l'unica cosa che conta è se questa riga lo chiude
      // davvero. Qualunque altra riga — comprese sequenze più corte, di un
      // carattere diverso, o seguite da testo — resta contenuto.
      if (closesFence(line, open)) open = null;
      continue;
    }

    const fence = readFenceLine(line);
    if (fence) {
      open = { char: fence.char, length: fence.length };
      continue;
    }

    const atx = ATX_LINE_RE.exec(line);
    if (atx) {
      // Sequenza di chiusura opzionale: «## Titolo ##» ha per testo «Titolo».
      const text = (atx[2] ?? '').replace(/\s+#+\s*$/, '').trim();
      if (text.length > 0) headings.push({ text, level: atx[1]!.length });
      continue;
    }

    // Setext: la riga corrente è il testo, la successiva la sottolineatura.
    const next = lines[i + 1];
    if (next !== undefined && line.trim().length > 0 && SETEXT_UNDERLINE_LINE_RE.test(next)) {
      headings.push({ text: line.trim(), level: next.trim().startsWith('=') ? 1 : 2 });
      i += 1;
    }
  }

  return headings;
}

/**
 * Heading che il renderer può davvero usare come ancora visuale.
 *
 * La proposta vede il testo sorgente esatto (compresi eventuali marcatori
 * inline), perché il prompt chiede al provider di copiarlo alla lettera. La
 * selezione è però la stessa del renderer: soltanto H2/H3 e mai un titolo che,
 * tolta la sintassi, non contiene alcun testo visibile.
 *
 * Tenere questo filtro accanto all'estrattore evita la divergenza precedente:
 * una proposta poteva scegliere H1/H4 e superare il controllo relazionale, per
 * poi essere rifiutata soltanto durante la promozione.
 */
export function extractAnchorableLessonHeadings(markdown: string): LessonHeadingOccurrence[] {
  return extractLessonHeadingsDetailed(markdown).filter(
    (heading) =>
      (heading.level === 2 || heading.level === 3) &&
      canonicalLessonHeadingText(heading.text).length > 0,
  );
}

/**
 * Controllo **relazionale** fra la risposta del provider e la richiesta.
 *
 * È deliberatamente separato dalla validazione strutturale: quella dice se
 * l'esito ha la forma giusta, questo dice se l'esito parla **della lezione che è
 * stata mandata**. Un `anchorHeadingText` inventato o parafrasato produrrebbe
 * un'ancora inesistente nella pagina, e l'immagine finirebbe silenziosamente in
 * coda al corpo per un difetto della proposta e non per una modifica del docente
 * — cioè il fallback di §5.3 verrebbe imboccato dalla porta sbagliata.
 *
 * Il confronto è **esatto sul testo sorgente**: nessun trim aggiuntivo, nessun
 * case folding, nessuno slug, nessun fuzzy matching. Se il titolo è
 * `## **Reti**`, il provider deve restituire `**Reti**`, come gli chiede il
 * prompt. La canonicalizzazione avviene più tardi, al confine della promozione,
 * quando il manifest deve conservare il testo realmente visibile (`Reti`).
 *
 * **Confine dichiarato:** vive prima della prima persistenza, non nel replay. Il
 * replay valida la sola struttura, perché la richiesta originale non è più
 * disponibile e il corpo della lezione potrebbe essere cambiato nel frattempo:
 * rieseguire qui il controllo relazionale renderebbe irreplayabile un run
 * legittimo a causa di una modifica successiva del testo.
 */
export function assertVisualProposalMatchesRequest(
  output: VisualProposalOutput,
  lessonBody: string,
): VisualProposalOutput {
  if (output.decision !== 'image') return output;
  if (
    !extractAnchorableLessonHeadings(lessonBody).some(
      (heading) => heading.text === output.anchorHeadingText,
    )
  ) {
    invalidOutput('L’heading di ancoraggio non esiste nel corpo della lezione.');
  }
  return output;
}

// ─── Risolutore d'ancora ──────────────────────────────────────────────────────

export type LessonVisualAnchorResolution =
  | { status: 'resolved'; headingSlug: string }
  | { status: 'fallback' };

/**
 * Decide dove va l'immagine, **per confronto esatto e nient'altro**.
 *
 * Slug presente ⇒ l'immagine sta dopo quell'heading. Slug assente ⇒ `fallback`,
 * e la resa la metterà in coda al corpo (roadmap §5.3).
 *
 * **Nessun fuzzy match, nessun prefisso, nessuna similarità.** Un'illustrazione
 * sulla fotosintesi che riappare sotto «La respirazione cellulare» perché i due
 * heading si somigliano è peggio di un'illustrazione in fondo alla pagina: la
 * prima insegna una cosa falsa, la seconda è solo mal impaginata. E l'immagine
 * non viene **mai** eliminata: rinominare un titolo è una modifica testuale, e
 * non deve distruggere un asset approvato e pagato.
 */
export function resolveLessonVisualAnchor(
  headingSlug: string,
  presentHeadingSlugs: readonly string[],
): LessonVisualAnchorResolution {
  for (const candidate of presentHeadingSlugs) {
    if (candidate === headingSlug) {
      return { status: 'resolved', headingSlug };
    }
  }
  return { status: 'fallback' };
}
