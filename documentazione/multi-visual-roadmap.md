# MULTI-VISUAL — Arricchimento visivo multi-immagine (contratto e roadmap)

> **Stato: MULTI-VISUAL-00 — contratto e prototipo. Nessun runtime, nessuna
> dipendenza, nessuna Rule, nessun deploy.** Pilota di
> `AGENT-ORCHESTRATOR` (`agent-orchestrator-roadmap.md` §12), eseguito sul
> task manifest `MULTI-VISUAL-00`. **Gate GMULTI: PENDING.**
>
> **Revisione 2 (25 agosto 2026).** La prima review Codex ha respinto la
> revisione 1 con dieci blocker. Questa versione li corregge tutti: modello
> economico a **autorizzazione unica** (§8, §11, §12), **piano coordinato**
> invece di proposte indipendenti (§8.3), selettore di **quantità** (§8.2),
> cap di upload corretto a **2 MB** (§9), punto di ingresso unico
> **«Arricchisci»** dentro Azioni e integrazione con il flusso di
> generazione della lezione (§11), identità di ancoraggio
> **indice + testo** in ogni fase (§7), rimozione di `source` dal manifest
> pubblico (§5.2, §13), nome file del prototipo corretto, cost model con
> conteggi espliciti (§12). Il §20 elenca, per ciascun blocker, la
> correzione e la prova.
>
> Questo documento **non sostituisce**
> [`visual-enrichment-roadmap.md`](visual-enrichment-roadmap.md) (di seguito
> «VE»): lo **estende**. Ogni principio, invariante o meccanismo di VE non
> esplicitamente modificato qui resta in vigore, con la stessa forza, senza
> rinegoziazione. Dove questo documento non ripete un dettaglio di VE, il
> dettaglio di VE si applica invariato.
>
> **Prototipo:** [`prototipi/lesson-multi-visual.html`](prototipi/lesson-multi-visual.html)
> **Review di fase:** [`evidenze/multi-visual-00-review.md`](evidenze/multi-visual-00-review.md)

**Data:** 25 agosto 2026 (revisione 2).
**Base:** `main` — merge di PR #421 (`agent-orchestrator-01`).
**Dipendenze documentali:** `visual-enrichment-roadmap.md` (VE-00→05A);
`lesson-manual-contract.md` (renderer, sanificazione, slug); `sicurezza.md`
(confine Storage/studente); `agent-orchestrator-roadmap.md` (protocollo e
manifest del pilota).

---

## 1. Perimetro del pilota

Il manifest dell'issue (`agent-orchestrator-roadmap.md` §5, §12) chiede,
testualmente:

- contratto per **massimo tre immagini per lezione**;
- **compatibilità** dell'immagine singola esistente;
- **upload** con normalizzazione server-side e limiti;
- orchestrazione **«Genera lezione con immagini»** a costi separati;
- **prototipo desktop/mobile**;
- **roadmap eseguibile, cost model e rollback**.

`allowedPaths` è `documentazione/**`; `forbiddenOperations` esclude merge,
deploy, chiamate a provider reali e scritture Firebase. Questo documento è
quindi un contratto **da implementare in fasi successive**, non
un'implementazione. Nessun file fuori da `documentazione/**` è toccato.

**Nota su «a costi separati».** La prima revisione di questo documento
aveva letto questa frase come «una popup di costo per ogni immagine». La
review l'ha corretta: il mandato vuole **un'unica autorizzazione economica
iniziale**, a tetto complessivo, con un **consuntivo** che resta separato
per fase e per singolo asset. È il modello descritto in §8, §11 e §12.

### 1.1 Stato di VISUAL-ENRICHMENT — divergenza dichiarata, non risolta qui

Questo documento **non assume** una fotografia unica dello stato di VE.
Due fonti dicono cose diverse e questo documento le riporta entrambe senza
sceglierne una:

- **`visual-enrichment-roadmap.md` e le sue evidenze, così come esistono su
  `main` a questa data**, dichiarano testualmente «Gate GVISUAL: PENDING»,
  VE-05 aperto e l'holdout D «non ancora eseguito» — anche nel commit più
  recente che tocca quel file (`fix(functions): VE-05 — confronti ordinati
  e holdout D`, che corregge l'infrastruttura di confronto usata dal
  benchmark, non ne cambia l'esito dichiarato).
- **La guida operativa di questo pilota** afferma che l'arricchimento
  visivo a singola immagine funziona ed è stato validato dal docente.

Questo documento **non riscrive** `visual-enrichment-roadmap.md` o le sue
evidenze per far coincidere le due affermazioni: sarebbe una modifica fuori
dal perimetro di questo pilota, su un contratto che non è suo, basata su
un'informazione che questo documento non può verificare autonomamente. La
divergenza è quindi **dichiarata come tale** e la conseguenza pratica è
strutturale, non narrativa: **ogni meccanismo di questo contratto —
adozione dal manifest singolo (§6), corse (§10), cost model (§12) — è
specificato per funzionare correttamente sia nel caso in cui esistano zero
lezioni reali con un'immagine, sia nel caso in cui ne esistano molte.**
Nessuna parte del meccanismo assume silenziosamente l'uno o l'altro
scenario. Riconciliare le due fonti resta un'azione dovuta, ma è
responsabilità di chi possiede `visual-enrichment-roadmap.md`, non di
questo pilota.

---

## 2. Principi invarianti aggiuntivi

Quelli di VE §1 restano integralmente in vigore (una sola immagine
**approvata per slot**, Markdown mai riscritto, rollback totale per
rimozione, «nessuna immagine utile» di prima classe **anche quando il
docente ha chiesto un numero preciso di immagini**, approvazione esplicita,
abbandono senza tracce, visibilità come confine dati, nessun URL pubblico,
nessun costo passivo, profilo `quality`-only per ogni chiamata a un
provider). A questi si aggiungono, congelati per questa funzione:

- **Il numero massimo di immagini per lezione è tre**, derivato
  matematicamente dal limite di documento di Firestore (§4).
- **Un solo punto di ingresso.** «Arricchisci», nel menu Azioni della
  lezione. Non esiste un secondo pulsante nella scheda Contenuto: la
  duplicazione di un ingresso per la stessa funzione è essa stessa un
  difetto di prodotto, non solo una scelta di layout (§11.1).
- **Un'unica autorizzazione economica per piano.** Il docente conferma un
  tetto complessivo **una sola volta**, prima che qualunque chiamata a un
  provider parta. Dopo quella conferma, proposta coordinata e generazioni
  procedono senza ulteriori popup di costo (§8, §11.4, §12).
- **Le proposte di un piano sono coordinate, non indipendenti.** Un'unica
  chiamata testuale vede tutti gli slot richiesti insieme e non può
  proporre due immagini sulla stessa idea didattica (§7.4, §8.3).
- **La quantità è un tetto, mai un pavimento.** Scegliere «3» non obbliga
  il sistema a produrre tre immagini: obbliga il piano a **tentare** fino a
  tre proposte, restando libero di proporne meno o nessuna per ciascuno
  slot dove l'immagine non sarebbe giustificata (§8.2).
- **L'identità di un'ancora durante la pianificazione è
  `(indice, testo)`, mai lo slug.** Il client non invia mai uno slug
  autorevole: lo slug persistito è sempre ricalcolato server-side dal corpo
  fresco al momento della promozione o del riancoraggio (§7).
- **Il fallimento di una generazione non tocca le altre.** Un piano con tre
  slot in cui uno fallisce lascia gli altri due, se già pronti,
  interamente disponibili per l'approvazione — non silenziosamente
  scartati insieme al fallimento (§8.5).
- **Il testo della lezione e le sue immagini sono transazioni separate nel
  tempo.** Quando le immagini nascono dentro il flusso di generazione della
  lezione, il testo è già salvato canonicamente **prima** che il piano
  visivo parta. Un fallimento visivo non invalida mai il testo già salvato
  (§11.5).
- **Il manifest pubblico non contiene la provenienza.** «Generata» o
  «Caricata» è un dato di governo per il docente, non un dato di rendering
  per lo studente (§5.2, §13).

---

## 3. Relazione con VISUAL-ENRICHMENT — che cosa eredita, che cosa estende

| Livello | VE (singola immagine) | MULTI-VISUAL (questo contratto) |
|---|---|---|
| Stile IA | `schoolforge-sketch/v1`, fisso | invariato per le immagini **generate**; le immagini **caricate** non hanno stile verificato (§9) |
| Provenienza | solo generazione IA | generazione IA **o** upload docente |
| Cardinalità | 0 o 1 per lezione | 0..3 per lezione, ordinate |
| Punto di ingresso | scheda Contenuto | **Azioni → «Arricchisci»**, unico, gestisce anche la galleria (§11.1) |
| Autorizzazione economica | una conferma per generazione | **una conferma per piano** (tetto = somma dei cap di 1 proposta coordinata + N generazioni), §8, §12 |
| Proposta testuale | 1 chiamata → 1 esito | **1 chiamata coordinata → 0..N esiti**, ancore ed idee reciprocamente distinte per costruzione (§7.4, §8.3) |
| Identità di ancoraggio in pianificazione | non applicabile (1 sola immagine) | `(anchorHeadingIndex, anchorHeadingText)`, mai lo slug (§7) |
| Manifest privato | `LessonDoc.visual` (oggetto singolo) | `LessonDoc.visuals` (contenitore con array `items`, §5) |
| Manifest pubblico | `publicLessons.visual` (con provenienza implicita: sempre generata) | `publicLessons.visuals` — **senza** campo di provenienza (§5.2, §13) |
| Byte studente | `publicLessonVisuals/{id}.data` (stringa) | `publicLessonVisuals/{id}.bytes` (mappa per `assetId`, §5.3) |
| Normalizzazione | solo output del generatore | stesso normalizzatore, **anche** su byte caricati dal docente, cap input **2 MB** (§9) |
| Ancoraggio persistito | 1 punto, split binario del token stream | fino a 3 punti, split N+1-way (§7.5) |
| Idempotenza | `requestId` nel namespace `visual-enrichment/v1` | **piano**: `requestId` + `planHash` nel namespace `visual-plan/v1`; ogni slot ha un `opaqueRunId` derivato deterministicamente dal piano, non un secondo `requestId` client (§10.1) |
| Rules Storage | nessuna regola nuova | **nessuna regola nuova** |
| Rules Firestore | forma su `publicLessons.visual` | forma **nuova** su `publicLessons.visuals` (fase implementativa, fuori da questo documento) |
| Export ZIP | sidecar `visuals/{assetId}.{json,webp}` | **invariato** — i sidecar sono già chiavati per `assetId`, non per lezione (§14) |

**Che cosa non cambia mai.** Il corpo Markdown della lezione. Il divieto di
`innerHTML`/`dangerouslySetInnerHTML` su contenuto post-sanificazione. Il
divieto per lo studente di accedere a Storage. Il gateway testuale
`repositoryGateway`. Il profilo `quality`-only per ogni chiamata a un
provider di testo o immagine. Il principio che un'assenza di manifest costa
zero letture.

---

## 4. Perché tre — il vincolo dei byte, con i numeri

Il limite non è un numero scelto per sembrare ragionevole: è il numero più
grande per cui l'invariante di costo di VE §3.3 — **una lettura puntuale,
all'apertura, per l'intero manifest** — resta possibile con un solo
documento Firestore.

```
MAX_VISUAL_BYTES        = 204_800     byte canonici per immagine (invariato da VE)
base64(n) = ceil(n / 3) × 4
base64(204_800)          = ceil(68_266.67) × 4 = 68_267 × 4 = 273_068 byte

3 immagini al cap rigido: 273_068 × 3 = 819_204 byte
limite documento Firestore:            1_048_576 byte (1 MiB)

margine con 3 immagini al cap rigido:  1_048_576 − 819_204 = 229_372 byte (≈ 21,9 %)
4 immagini al cap rigido:              273_068 × 4 = 1_092_272 byte
                                        supera il limite di   43_696 byte
```

**Con quattro immagini, anche una sola lezione con tutti e quattro gli asset
al peso massimo supererebbe il documento Firestore.** Non è un margine
stretto da monitorare: è un'operazione che fallirebbe sempre, per
costruzione. Tre è quindi il massimo strutturale a normalizzazione
invariata (§9: cap 200 KB canonici, obiettivo 50–150 KB).

Nel caso ordinario (immagini nell'obiettivo 50–150 KB, non al cap) il
margine è molto più ampio: tre immagini da 150 KB pesano
`200_000 × 3 = 600_000` byte in base64, margine ≈ 448 KB (≈ 43 %). Il
calcolo al cap rigido è quello che conta per la decisione, perché un
contratto non può assumere che i docenti restino sotto l'obiettivo.

---

## 5. Forme dati — chiuse e versionate

Tutte le forme sotto sono validate fail-closed come ogni artefatto
SchoolForge: chiavi esatte, nessuna proprietà extra, nessuna correzione
silenziosa. Un valore fuori forma è **rifiutato**, non aggiustato.

### 5.1 Manifest privato — `LessonDoc.visuals`

```ts
/** MULTI-VISUAL — contenitore delle immagini approvate di una lezione. */
export interface LessonVisualsManifest {
  contractVersion: 'lesson-visuals/v1';

  /**
   * 1..3 elementi, mai vuoto e mai assente-ma-vuoto: se l'ultima immagine
   * viene rimossa, il campo `visuals` è rimosso dal documento (§6.4).
   */
  items: LessonVisualItem[];
}

/** Un'immagine approvata, generata o caricata. Vista SOLO del docente. */
export interface LessonVisualItem {
  /** Identificatore opaco. UUID v4 generato server-side. */
  assetId: string;

  /** Percorso Storage canonico, owner-only. Identico per forma a VE §4. */
  storageRef: string;

  /**
   * Ancora **risolta**: lo slug persistito, deterministico, calcolato
   * server-side al momento della promozione o del riancoraggio (§7.3). Non
   * è mai scritto dal client: il client sceglie un'ancora tramite indice
   * (§7.1), il server la risolve in questo slug.
   */
  anchor: LessonVisualAnchor;

  /** Didascalia visibile. Obbligatoria, non vuota, modificabile. */
  caption: string;

  /** Testo alternativo. Obbligatorio, non vuoto, modificabile. */
  altText: string;

  /** Larghezza reale in pixel, letta dai byte. Lato lungo ≤ 1200. */
  width: number;

  /** Altezza reale in pixel, letta dai byte. Lato lungo ≤ 1200. */
  height: number;

  /** Dimensione reale in byte dei byte canonici. ≤ 204_800. */
  byteLength: number;

  /** SHA-256 esadecimale minuscolo dei byte canonici. 64 caratteri. */
  sha256: string;

  /** Sempre e solo `'image/webp'`. Verificato per magic bytes. */
  mimeType: 'image/webp';

  /**
   * Provenienza. **Solo nel manifest privato** — vedi §5.2 per la
   * motivazione della sua assenza dal manifest pubblico. Governa i badge
   * della galleria docente e l'audit; non ha alcun ruolo nel rendering.
   */
  source: 'generated' | 'uploaded';

  /**
   * `schoolforge-sketch/v1` per `source: 'generated'`.
   * `uploaded/v1` per `source: 'uploaded'` — nessuna verifica di stile si
   * applica a un file caricato (§9).
   */
  styleVersion: 'schoolforge-sketch/v1' | 'uploaded/v1';

  /**
   * SHA-256 del corpo lezione al momento della richiesta (proposta
   * coordinata o conferma di upload). Protegge dalla corsa di §10.2.
   */
  sourceBodyHash: string;

  /** Istante di approvazione del docente. */
  approvedAt: Timestamp;
}

/** Ancora RISOLTA, persistita. Identica per forma a VE §5.1. */
export interface LessonVisualAnchor {
  headingSlug: string;
  headingText: string;
  placement: 'after-heading';
}
```

### 5.2 Selettore d'ancora — identità transiente, mai persistita così com'è

Distinto dall'ancora risolta di §5.1. È la forma che il **client** invia e
che il **modello** produce durante la pianificazione — mai uno slug:

```ts
/**
 * Identità di un'ancora PRIMA della risoluzione server-side. Usata nella
 * proposta coordinata (§8.3), nella promozione (§8.6) e nel riancoraggio
 * (§7.3). `anchorHeadingIndex` è la posizione (0-based) nell'elenco degli
 * heading H2/H3 realmente presenti nel corpo al momento in cui l'elenco è
 * stato mostrato; `anchorHeadingText` è il testo visibile esatto a
 * quell'indice, usato per confermare che il corpo non sia cambiato in modo
 * da spostare gli indici fra la scelta e il commit (§7.2).
 */
export interface VisualAnchorSelector {
  anchorHeadingIndex: number;
  anchorHeadingText: string;
}
```

### 5.3 Manifest pubblico — `publicLessons.visuals`

Sottoinsieme, non lo stesso oggetto — stessa regola di VE §4. **Non**
`storageRef`, `sourceBodyHash`, `sha256`, `byteLength`, `approvedAt`
(metadati di governo). **Non `source`** — vedi §13 per la motivazione di
minimizzazione: la provenienza serve alla gestione owner-only, non al
renderer studente, e includerla violerebbe lo stesso principio per cui
`storageRef` non compare.

```ts
export interface PublicLessonVisualsManifest {
  contractVersion: 'lesson-visuals/v1';
  items: PublicLessonVisualItem[]; // stesso ordine del manifest privato
}

export interface PublicLessonVisualItem {
  assetId: string;
  anchor: LessonVisualAnchor;
  caption: string;
  altText: string;
  width: number;
  height: number;
}
```

### 5.4 Byte studente — `publicLessonVisuals/{publicLessonId}`

Invariato dalla revisione 1 — la scelta di una **mappa per `assetId`**
resta valida e non è toccata da alcun blocker:

```ts
export interface PublicLessonVisualBytesDoc {
  contractVersion: 'lesson-visuals/v1';
  bytes: {
    [assetId: string]: {
      dataUri: string; // 'data:image/webp;base64,...'
      mimeType: 'image/webp';
    };
  };
}
```

Una mappa per chiave permette a un **singolo aggiornamento di sostituzione
o rimozione di un'immagine di toccare un solo campo del documento**. Una
sottocollezione per asset romperebbe l'invariante «una lettura puntuale,
indipendente dal numero di immagini» (Firestore fattura per documento
letto): resta quindi scartata per lo stesso motivo di VE §3.3.

### 5.5 Piano visivo — `VisualPlanRun`

Nuovo in questa revisione: la forma che rende **una** l'autorizzazione
economica invece di N (Blocker 1) e **coordinata** la proposta (Blocker 2).

```ts
/**
 * Documento server-only, owner-only nelle Rules, TTL 24 h come lo staging
 * di VE. Un solo piano ATTIVO per lezione alla volta (§10.3).
 */
export interface VisualPlanRun {
  contractVersion: 'visual-plan/v1';

  /** Stato del piano nel suo complesso. Vedi §8.7. */
  status:
    | 'authorized'
    | 'proposing'
    | 'proposed'
    | 'generating'
    | 'awaiting_review'
    | 'completed'
    | 'partially_completed'
    | 'abandoned'
    | 'expired';

  /** Selezione di quantità del docente. Mai un pavimento — vedi §8.2. */
  quantity: VisualPlanQuantitySelection;

  /** SHA-256 del corpo lezione al momento dell'autorizzazione. */
  sourceBodyHash: string;

  /**
   * `assetId` delle immagini già approvate al momento dell'autorizzazione.
   * Usato per calcolare gli slot liberi e per rilevare, alla promozione,
   * se l'insieme è cambiato sotto al piano (§10.3).
   */
  existingItemAssetIds: string[];

  /** Tetto totale prenotato = 1 proposta + `quantity` generazioni. */
  budgetCeiling: {
    reservationKey: string;
    proposalCap: number;
    perSlotGenerationCap: number;
    totalReserved: number; // proposalCap + perSlotGenerationCap × ceiling
  };

  /** 0..ceiling elementi, popolati dopo la proposta coordinata. */
  slots: VisualPlanSlot[];

  /** Consuntivo — vedi §12. Popolato progressivamente, mai stimato due volte. */
  settlement: {
    proposalActualCost: number | null;
    slots: Array<{
      slotIndex: number;
      attempts: number;
      actualCost: number | null;
    }>;
  };

  createdAt: Timestamp;
  updatedAt: Timestamp;
  expireAt: Timestamp;
}

export type VisualPlanQuantitySelection =
  | { mode: 'auto'; ceiling: 1 | 2 | 3 }
  | { mode: 'exact'; ceiling: 1 | 2 | 3 };

/**
 * Un elemento del piano. `pending` finché non generato; il docente può
 * modificare `subject`/`caption`/`altText`/ancora mentre è `pending` senza
 * alcun costo. Vedi §8.4-§8.5.
 */
export interface VisualPlanSlot {
  slotIndex: number; // 0-based, stabile per tutta la vita del piano
  state: 'pending' | 'generating' | 'ready' | 'failed' | 'promoted' | 'abandoned';
  decision: 'image' | 'none'; // esito della proposta coordinata per questo slot
  subject: string | null; // null se decision === 'none'
  rationale: string | null; // «utilità didattica», solo UI, mai persistito nel manifest finale
  anchor: VisualAnchorSelector | null;
  caption: string | null;
  altText: string | null;
  attempts: number; // ≤ VISUAL_PLAN_MAX_GENERATION_ATTEMPTS_PER_SLOT
  lastError: 'visual_too_large' | 'provider_invalid_output' | 'transient_error' | null;
  /** Presente solo quando state === 'ready'. Stessa forma dei campi normalizzati di VE §7. */
  staged: {
    storageRef: string; // staging/{ownerUid}/{opaquePlanId}/{slotIndex}.webp
    width: number;
    height: number;
    byteLength: number;
    sha256: string;
  } | null;
}
```

### 5.6 Costanti

```ts
export const MAX_VISUALS_PER_LESSON = 3;

/**
 * Cap grezzo di un file caricato, PRIMA della decodifica. 2 MB decimali —
 * valore dato dal mandato del task, non derivato in questo documento.
 */
export const MAX_VISUAL_UPLOAD_INPUT_BYTES = 2_000_000;

/** Formati di input accettati per l'upload. L'output è sempre WebP (§9). */
export const ACCEPTED_VISUAL_UPLOAD_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

/** Tentativi di generazione coperti dalla prenotazione di un singolo slot. */
export const VISUAL_PLAN_MAX_GENERATION_ATTEMPTS_PER_SLOT = 2;
```

---

## 6. Compatibilità e migrazione dal manifest singolo

### 6.1 Lettura — nessuna migrazione richiesta per leggere

Il renderer e la vista studente leggono in quest'ordine, per ogni lezione:

1. `visuals` presente → è l'unica fonte, letta e resa così com'è. Il campo
   legacy `visual` (singolare), se presente, è **ignorato**.
2. `visuals` assente, `visual` (singolare) presente → **modello di lettura
   compatibile**: trattato come un array a un elemento
   `{ contractVersion: 'lesson-visuals/v1', items: [adaptSingular(visual)] }`,
   calcolato **a runtime**, mai scritto. `adaptSingular` copia i campi 1:1
   e imposta `source: 'generated'`.
3. Nessuno dei due presente → nessuna lettura aggiuntiva, percorso odierno
   invariato, esattamente come VE §11.

Questo comportamento **non dipende** dal numero di lezioni che si trovano
nel caso 2 quando il codice viene distribuito: che siano zero o migliaia,
il meccanismo è lo stesso, letto una lezione alla volta (§1.1).

### 6.2 Scrittura — adozione pigra, atomica, irreversibile in forma

La prima volta che una lezione con manifest singolo riceve **una seconda
immagine**, o comunque la prima scrittura sotto il contratto MULTI-VISUAL,
la transazione di promozione (§8.6) esegue un passo di **adozione**:

1. rilegge `LessonDoc`. Se `visuals` è già presente, l'adozione è già
   avvenuta: salta questo passo (idempotenza);
2. se `visual` (singolare) è presente e `visuals` è assente, costruisce
   `items[0] = adaptSingular(visual)`;
3. applica la mutazione richiesta (aggiungi/sostituisci, §8.6) all'array
   così ottenuto;
4. scrive `LessonDoc.visuals` con l'array risultante **e cancella il campo
   `visual`** nella stessa transazione;
5. esegue la stessa adozione, nello stesso commit, su `publicLessons` se e
   solo se la lezione è svolta;
6. il documento byte studente non richiede adozione: viene scritto per la
   prima volta con la chiave del nuovo `assetId` e, se l'adozione ha
   copiato un'immagine preesistente, anche con la chiave dell'`assetId`
   ereditato, letta dal vecchio `publicLessonVisuals/{id}.data` **prima**
   di sovrascrivere il documento.

**Idempotenza.** Un retry dopo un commit riuscito rileva `visuals` già
presente al passo 1 e non ricostruisce `items[0]` una seconda volta.

**Perché «irreversibile in forma».** Una volta adottato, il contenitore
non torna mai alla forma singolare, nemmeno se tutte le immagini tranne una
vengono rimosse: il lettore di §6.1 tratta `visuals` a un elemento
esattamente come tratterebbe `visual` singolare, quindi non c'è motivo di
mantenere due percorsi di scrittura per lo stesso caso.

### 6.3 Migrazione fail-closed — garanzie indipendenti dal volume di dati reali

Poiché §1.1 lascia esplicitamente aperta la domanda «quante lezioni hanno
già un'immagine singola oggi», l'adozione è progettata per essere corretta
**indipendentemente dalla risposta**:

- **Isolamento per lezione.** L'adozione di una lezione non legge né scrive
  alcun'altra lezione. Non esiste un job che itera sul repository: ogni
  adozione è innescata solo dall'azione del docente su **quella** lezione
  (§1.1, nessun backfill).
- **Fail-closed su forma inattesa.** Se `LessonDoc.visual` esiste ma non
  supera il validatore strutturale di VE (un manifest scritto da un
  contratto futuro incompatibile, o corrotto), l'adozione **non tenta una
  conversione parziale**: fallisce con un errore tipizzato
  `visual_legacy_malformed`, zero scritture, e l'operazione richiesta dal
  docente (aggiungere un'immagine) è bloccata finché il campo legacy non è
  in una forma valida o rimosso — mai un'adozione che scarta silenziosamente
  campi che non capisce.
- **Nessuna assunzione sul numero di record.** Il codice di adozione non
  contiene alcun ramo condizionato su «se questa è la prima lezione mai
  adottata» o simili: ogni chiamata è indistinguibile dalle altre, che sia
  la prima in assoluto o la millesima.
- **Test dedicato con dataset legacy popolato** (§19): un batch di lezioni
  con `LessonDoc.visual` reale e variegato (immagini approvate in momenti
  diversi, con `styleVersion` sempre `schoolforge-sketch/v1` perché VE non
  ammette altro) deve adottare ciascuna correttamente, senza interferenza
  reciproca e senza ordine di esecuzione rilevante.

### 6.4 Rimozione totale — rollback allo stato «mai avuto immagini»

Quando l'ultima immagine di `items` viene rimossa (§8.9), il campo
`visuals` è **rimosso** dal documento, non lasciato come `{ items: [] }`.
Poiché l'adozione ha già cancellato `visual` singolare al suo primo
utilizzo e non viene mai riscritto, una lezione che ha avuto ed è tornata a
zero immagini **non ha né `visual` né `visuals`**: indistinguibile, byte
per byte, da una lezione che non ha mai avuto un'immagine.

---

## 7. Ancoraggio — identità indice+testo in ogni fase

### 7.1 Perché lo slug non può essere l'identità durante la pianificazione

Lo slug (`headingSlug()` di `lesson-manual-contract.md`) è deterministico
**una volta risolto**, e la sua stessa numerazione dei duplicati (`reti`,
`reti-2`) lo rende univoco **dopo** la risoluzione. Il problema è prima:
quando la proposta coordinata (§8.3) deve scegliere fra gli heading di una
lezione con due sezioni intitolate «Reti», un elenco di soli **testi**
(anche non deduplicati) non permette al modello di dire *quale* «Reti»
intende senza indovinare. La soluzione, per ogni punto in cui un'ancora è
**scelta** (non ancora risolta) — proposta coordinata, promozione,
riancoraggio — è la stessa identità a due componenti:

```ts
export interface VisualAnchorSelector {
  anchorHeadingIndex: number; // posizione 0-based nell'elenco enumerato
  anchorHeadingText: string;  // testo esatto a quell'indice, per conferma
}
```

**L'elenco mostrato al modello e al docente è enumerato per indice, mai
deduplicato per testo.** Due heading «Reti» compaiono come due voci
distinte, `{index: 4, text: 'Reti'}` e `{index: 7, text: 'Reti'}`: il
modello — o il docente, nel riancoraggio manuale — sceglie l'indice, non il
testo. È un raffinamento rispetto al meccanismo di enumerazione di VE-01
(che deduplica i testi nell'`enum` dello schema, adeguato quando esiste una
sola immagine da ancorare ma insufficiente quando il piano deve
disambiguare fra più scelte contemporaneamente); non modifica il codice di
VE-01, che resta di sua competenza.

### 7.2 Verifica all'uso — indice e testo devono concordare

Ogni punto che consuma un `VisualAnchorSelector` (promozione, §8.6;
riancoraggio, invariato da VE-04A) esegue, server-side, sul corpo
**fresco**:

1. ricalcola l'elenco enumerato degli heading H2/H3 realmente presenti nel
   corpo attuale (stessa estrazione ATX/Setext con blocchi recintati
   ignorati di VE-01 §15.1);
2. verifica che `anchorHeadingIndex` sia un indice valido in
   quell'elenco **fresco**;
3. verifica che il testo a quell'indice sia **esattamente**
   `anchorHeadingText` — nessun trim aggiuntivo, nessun case folding,
   nessuno slug, nessun fuzzy matching, identica disciplina di VE §15.1;
4. **se una delle due verifiche fallisce** (indice fuori range, o testo
   cambiato — il docente ha riscritto o riordinato gli heading fra la
   scelta e il commit), l'ancora non è **inventata altrove**: si applica la
   stessa politica di coda di VE §5.3 (l'immagine promuove comunque, ma
   `anchorResolved: 'fallback'` a runtime, mai persistito).
5. **solo se** le verifiche passano, lo slug viene calcolato dall'helper
   condiviso (`@schoolforge/lesson-contract`, riusato sia dal web sia dalle
   Functions, come da VE-04A) e **quello** — non l'indice, non il testo
   grezzo — è ciò che finisce in `LessonVisualAnchor.headingSlug` (§5.1).

### 7.3 Collisioni — che cosa succede con due heading letteralmente identici

Caso concreto, testato esplicitamente (§19): una lezione con due heading
`## Reti`. L'elenco enumerato li espone come indice 4 e indice 7 (per
esempio); il modello (o il docente in riancoraggio) sceglie uno dei due
indici. Alla risoluzione, l'helper condiviso di slug applica la stessa
numerazione progressiva di `lesson-manual-contract.md` §4.1 su **tutto**
il documento, non solo sull'heading scelto: il primo `Reti` nel documento
risolve sempre a `reti`, il secondo sempre a `reti-2`, indipendentemente da
quale dei due il docente abbia scelto per questa immagine. Il manifest
persistito (§5.1) contiene quindi lo slug **già disambiguato** — è per
questo che il manifest persistito non ha bisogno di conservare l'indice: lo
slug, una volta risolto, è già univoco per costruzione.

### 7.4 Diversità didattica del piano — vincolo strutturale, non semantico

Blocco esplicito richiesto dalla review: la proposta coordinata (§8.3) non
può restituire due slot che illustrano la stessa idea. Questo documento
**non** introduce un rilevatore di similarità semantica (embedding,
seconda chiamata a un modello di confronto): sarebbe un meccanismo nuovo,
probabilistico, e un punto di fallimento silenzioso in più. Usa invece un
vincolo **strutturale**, deterministico e verificabile senza alcuna
chiamata aggiuntiva:

- **`anchorHeadingIndex` deve essere a due a due distinto fra tutti gli
  slot con `decision: 'image'` della stessa proposta coordinata.** Due
  immagini sullo stesso heading non possono nascere dalla stessa proposta:
  se il modello lo tenta, l'output è strutturalmente non rappresentabile
  (lo schema Structured Output impone l'unicità) e la validazione lo
  rifiuta con `provider_invalid_output`, prima di qualunque persistenza.
- **`subject` deve essere a due a due distinto**, dopo normalizzazione
  (trim, minuscolo, spazi collassati) — un secondo controllo indipendente
  dal primo, perché due `subject` quasi identici su ancore diverse
  sarebbero comunque la stessa idea duplicata altrove nella pagina.

**Limite dichiarato di questo vincolo** (§17): impedisce i duplicati
*strutturali* (stesso punto, stesso soggetto), non ogni possibile
sovrapposizione semantica più sottile (due soggetti diversi che illustrano
comunque lo stesso concetto con parole diverse). È un compromesso
esplicito fra rigore e semplicità del meccanismo, non un rilevamento
di duplicati risolto in generale.

**Fuori dal perimetro della proposta coordinata**, questo vincolo **non
si applica**: un'immagine caricata dal docente può condividere l'ancora con
un'immagine generata (§7.5 di `multi-visual-roadmap.md` — ereditato
invariato dalla revisione 1), perché in quel caso la scelta è
dichiaratamente del docente, non un artefatto di una singola chiamata
automatica.

### 7.5 Ordine di inserimento nella pagina — invariato dalla revisione 1

Due ordini diversi governano due cose diverse:

- **l'ordine dei *gruppi* di ancoraggio segue l'ordine fisico degli heading
  nel documento**;
- **l'ordine *dentro* un gruppo** (più immagini sullo stesso heading,
  oppure il gruppo di coda) **segue l'ordine dell'array `items`**.

Riordinare la galleria non sposta un'immagine da una sezione all'altra.

### 7.6 Lo split del token stream — generalizzazione a N+1, invariato

```
Markdown sorgente
  → parser isolato (istanza Marked dedicata)
  → token stream
  → per ogni heading slug realmente presente nel documento, in ordine fisico:
      se uno o più item risolvono su quello slug, marca un punto di split
  → split in (G + 1) sottoinsiemi, G = numero di slug distinti risolti (G ≤ 3)
  → HTML(A₀) … HTML(A_G), ciascuno sanificato con DOMPurify indipendentemente
  → React: A₀ + [figure...] + A₁ + [figure...] + … + A_G + [figure di coda...]
```

Una lezione **senza** `visuals` produce esattamente il percorso di oggi.

### 7.7 Ancora persa — generalizzazione di VE §5.3, invariato

Slug assente ⇒ l'immagine va nel gruppo di coda, mai indovinata altrove,
mai eliminata automaticamente. Con più immagini, il docente vede un avviso
per **ciascuna** immagine con ancora persa, separatamente. Il riancoraggio
usa lo stesso `VisualAnchorSelector` di §7.1 — anche qui il docente sceglie
un **indice** fra gli heading realmente presenti, mai testo libero.

---

## 8. Ciclo di vita — piano coordinato ad autorizzazione unica

### 8.1 Vista d'insieme

```
Azioni → «Arricchisci» (unico ingresso, §11.1)
   │
   ▼
┌───────────────┐  scelta quantità: Automatico(1–3) · 1 · 2 · 3 (§8.2)
│ QUANTITÀ      │  bloccato se 0 slot liberi (già 3/3)
└──────┬────────┘
       │ UNA sola conferma: tetto = 1 proposta + N generazioni (§8.3, §12)
       ▼
┌───────────────┐  VisualPlanRun creato, status: authorized → proposing
│ AUTORIZZATO   │  budget prenotato in un solo passo (somma dei cap)
└──────┬────────┘
       │ 1 chiamata coordinata, automatica, nessuna nuova popup di costo
       ▼
┌───────────────┐  0..N slot, ciascuno: decision image|none, subject,
│ PROPOSTO      │  utilità, ancora (indice+testo), caption, altText
└──────┬────────┘  status: proposed — il docente rivede/modifica, GRATIS
       │
       │ generazione per slot — automatica in sequenza, o su richiesta
       │ del docente slot per slot; MAI una nuova conferma di costo
       ▼
┌───────────────┐  per ciascuno slot, indipendentemente:
│ GENERAZIONE   │  pending → generating → ready | failed
└──────┬────────┘  un fallimento non tocca gli altri slot (§8.5)
       │
       │ retry di un singolo slot fallito: stessa prenotazione,
       │ fino a VISUAL_PLAN_MAX_GENERATION_ATTEMPTS_PER_SLOT tentativi
       ▼
┌───────────────┐  il docente approva slot per slot, o «Applica tutte»
│ APPROVAZIONE  │  (N transazioni indipendenti in sequenza, §8.6)
└──────┬────────┘
       ▼
  canonico: Storage owner + LessonDoc.visuals.items[k]
       │
       ├── lezione svolta ──▶ proiezione pubblica (manifest + mappa byte)
       └── lezione non svolta ──▶ nessuna proiezione

  piano → completed (tutti gli slot terminali: promoted/abandoned/failed
          dopo il tetto di tentativi) | partially_completed | abandoned
          | expired (TTL 24h, come lo staging)
```

### 8.2 Quantità — tetto, mai pavimento

```ts
export type VisualPlanQuantitySelection =
  | { mode: 'auto'; ceiling: 1 | 2 | 3 }
  | { mode: 'exact'; ceiling: 1 | 2 | 3 };
```

Le opzioni mostrate al docente dipendono dagli slot liberi
(`3 - LessonDoc.visuals.items.length`, o `3` se `visuals` è assente):

| Slot liberi | Opzioni mostrate |
|---|---|
| 3 | Automatico (1–3) · 1 · 2 · 3 |
| 2 | Automatico (1–2) · 1 · 2 |
| 1 | 1 (nessuna variante «Automatico» ha senso su un solo slot) |
| 0 | Il controllo «Arricchisci» → generazione IA è disabilitato con motivo visibile: «Questa lezione ha già tre immagini» (upload e gestione restano raggiunibili, §11.1) |

**`auto` contro `exact` — differenza di intento, non di garanzia.** In
nessun caso — nemmeno con `{ mode: 'exact', ceiling: 3 }` — il sistema è
autorizzato a riempire uno slot con un'immagine non giustificata solo per
raggiungere il numero: l'invariante «nessuna immagine utile è un esito
legittimo» (VE §1) resta sovrano. La differenza è nel prompt della proposta
coordinata (§8.3): `exact` comunica al modello che il docente ha
espresso una preferenza per un numero vicino a `ceiling` e lo istruisce a
cercare con più impegno idee didatticamente valide fino a quel numero;
`auto` comunica che il docente lascia la decisione interamente al giudizio
del modello. Entrambe restano libere di restituire meno slot con
`decision: 'image'`, incluso zero.

`ceiling` determina anche il tetto economico prenotato (§8.3, §12): che il
piano ne usi 3, 1 o 0, la prenotazione iniziale copre sempre `ceiling`
generazioni, e la parte non usata è **rilasciata, non addebitata** (§12).

### 8.3 Autorizzazione e proposta coordinata

Confermata la quantità, **un'unica schermata** mostra il tetto e chiede
**una sola** conferma:

> «Genereremo una proposta e fino a `ceiling` immagini. Costo massimo:
> [proposta] + `ceiling` × [generazione]. Il costo reale sarà pari o
> inferiore, e ogni immagine non generata non viene addebitata.»

Alla conferma, in un solo passo server-side:

1. si crea `VisualPlanRun` con `status: 'authorized'`,
   `sourceBodyHash` del corpo salvato corrente, `existingItemAssetIds`
   dell'array live, `quantity` scelta;
2. si prenota il budget per l'intero tetto (`budgetCeiling.totalReserved`)
   in una **singola** transazione — non `ceiling` prenotazioni separate che
   il client dovrebbe orchestrare;
3. **subito dopo**, senza attendere un'altra azione del docente, parte
   **una sola** chiamata `AiContentRequest{kind: 'visual_plan_proposal'}`,
   che vede **tutti** gli heading enumerati (§7.1) e il numero `ceiling`,
   e restituisce in un'unica risposta Structured Output un array di 0..
   `ceiling` esiti, ciascuno `{ decision: 'none', reason }` oppure
   `{ decision: 'image', subject, rationale, anchor: VisualAnchorSelector,
   caption, altText }`, con gli stessi limiti di campo di VE §15.1
   (subject ≤ 400 code point, ecc.) applicati a ciascun elemento
   dell'array, e il vincolo di diversità di §7.4 applicato **fra** gli
   elementi dell'array.

`VisualPlanRun.status` passa a `proposing` al passo 3 e a `proposed` alla
risposta. **Nessuna seconda popup di costo separa questi passi**: sono
conseguenza diretta e automatica dell'unica autorizzazione del passo 1.

### 8.4 Revisione del piano — gratuita

Con il piano in stato `proposed`, il docente vede ogni slot proposto e può,
**senza alcun costo aggiuntivo**: modificare `subject`, `caption`,
`altText`; scegliere un'ancora diversa fra gli heading enumerati (nuovo
`VisualAnchorSelector`, non una nuova chiamata); segnare uno slot come da
non generare (transizione diretta a `abandoned`, libera capacità di
prenotazione che **non** viene riassegnata automaticamente a un nuovo
slot — il tetto era fissato alla quantità originale, non ricalcolato a
runtime, per evitare che una riduzione su uno slot inneschi silenziosamente
un'espansione su un altro).

### 8.5 Generazione per slot — indipendente, con retry che non perde nulla

Ogni slot con `decision: 'image'` e non abbandonato genera
indipendentemente dagli altri: `pending → generating → ready | failed`.

- **`ready`**: byte normalizzati (§9), verificati, in staging
  (`staging/{ownerUid}/{opaquePlanId}/{slotIndex}.webp`), pronti per
  l'approvazione. Gli altri slot del piano restano nel proprio stato,
  qualunque esso sia.
- **`failed`**: errore tipizzato (`visual_too_large`,
  `provider_invalid_output`, `transient_error`). Gli slot già `ready` **non
  sono toccati**: sono ancora lì, ancora approvabili, indipendentemente da
  che cosa succede agli altri. Il retry di uno slot fallito rigenera **solo
  quello slot**, riusa la prenotazione già fatta per quello slot specifico
  (fino a `VISUAL_PLAN_MAX_GENERATION_ATTEMPTS_PER_SLOT = 2` tentativi
  totali), e non tocca né il canonico esistente della lezione (se
  quell'immagine sta sostituendo un'immagine già approvata) né gli altri
  slot del piano.
- **Oltre il tetto di tentativi**, lo slot resta `failed` in modo terminale
  per questo piano: il docente può modificare il `subject` e riprovare, ma
  quel nuovo tentativo è trattato come un nuovo slot con una **propria,
  singola** conferma di costo aggiuntiva limitata a quel solo slot — mai
  una riautorizzazione dell'intero piano.

### 8.6 Approvazione e promozione — per slot, mai un'unica transazione multi-immagine

Un'immagine `ready` si approva **individualmente** (transazione descritta
sotto) o in blocco con **«Applica tutte»**, che esegue la stessa
transazione **in sequenza** per ciascuno slot `ready` — mai un'unica
transazione Firestore multi-immagine: un fallimento sul secondo slot non
deve annullare la promozione già avvenuta del primo.

**Modalità**, unione chiusa a due rami (invariata dalla revisione 1):

```ts
type VisualPromotionMode =
  | { mode: 'add' }
  | { mode: 'replace'; replaceAssetId: string };
```

**Ordine della promozione**, per un singolo slot:

1. rilegge `LessonDoc`, verifica `VisualPlanRun.sourceBodyHash` contro il
   corpo salvato corrente. Disallineamento ⇒ **stop**, zero scritture, lo
   slot resta `ready` (non perso: il docente può riprovare dopo aver
   verificato le modifiche recenti);
2. verifica che i byte staged corrispondano a `sha256`/`byteLength`
   dichiarati per quello slot;
3. risolve l'ancora dal `VisualAnchorSelector` dello slot contro il corpo
   **fresco** (§7.2) — mai lo slug, mai l'indice da solo;
4. rilegge (o adotta, §6.2) `LessonDoc.visuals`, applica la modalità
   all'array fresco — fail-closed `visual_slot_full` se non c'è più spazio,
   `visual_replace_target_missing` se l'`assetId` da sostituire non esiste
   più;
5. copia i byte dallo staging al percorso canonico `storageRef` del nuovo
   `assetId`;
6. scrive `LessonDoc.visuals` con l'array risultante;
7. **se e solo se** `completed === true`: scrive `publicLessons.visuals` e
   aggiorna `publicLessonVisuals/{id}.bytes[assetId]` — in `replace`, la
   stessa scrittura rimuove anche la chiave del vecchio `assetId`;
8. elimina lo staging di quello slot e, in `replace`, pianifica (dopo il
   commit) la cancellazione del vecchio oggetto Storage canonico;
9. aggiorna `VisualPlanRun.slots[slotIndex].state = 'promoted'` e
   `settlement.slots[slotIndex]` con il costo reale registrato;
10. registra l'audit `lesson.visualApproved` con `mode`, `assetId`,
    posizione e conteggio totale.

I passi 6–7 restano nella stessa transazione (stessa disciplina di
`setLessonCompleted`, riusata da VE §6.2). I passi 5 e 8 toccano Storage e
non sono transazionali con Firestore: un fallimento lascia al più un blob
canonico orfano.

### 8.7 Stato del piano — derivato, mai scritto direttamente da un'azione singola

`VisualPlanRun.status` è ricalcolato a ogni transizione di slot:

- `completed`: tutti gli slot sono `promoted` o `abandoned`, e nessuno è
  `pending`/`generating`/`ready`/`failed`-entro-i-tentativi;
- `partially_completed`: almeno uno slot è `promoted`, e nessuno slot
  richiede più un'azione (i rimanenti sono `abandoned` o `failed` oltre il
  tetto di tentativi);
- `abandoned`: il docente ha chiuso il piano prima che alcuno slot fosse
  promosso — gli slot `ready` non ancora approvati vengono scartati **con
  una conferma esplicita** (stessa disciplina di abbandono di VE §6.4,
  generalizzata: «Le immagini generate in questo piano verranno eliminate.
  Nessuna è stata applicata alla lezione.»);
- `expired`: TTL 24 h raggiunto senza completamento — stessa politica di
  cleanup dello staging di VE.

### 8.8 Recovery — riprendere un piano interrotto

Un piano `VisualPlanRun` **persiste** attraverso ricariche di pagina,
connessioni cadute, chiusure del browser. Riaprendo «Arricchisci» su una
lezione con un piano non terminale, il docente vede **esattamente** lo
stato in cui l'ha lasciato — slot `ready` ancora approvabili, slot
`failed` ancora ritentabili, slot `pending` ancora modificabili — **senza
una nuova autorizzazione economica**: quella del piano resta valida fino a
`expireAt`. Non è possibile avviare un secondo piano sulla stessa lezione
finché quello attivo non è terminale (§10.3): «Arricchisci» su una lezione
con un piano attivo apre direttamente quel piano, non un nuovo selettore di
quantità.

### 8.9 Rimozione di un singolo elemento — invariata dalla revisione 1

1. rimuove la chiave `assetId` da `publicLessonVisuals/{id}.bytes`; mappa
   vuota ⇒ elimina l'intero documento;
2. rimuove l'elemento da `publicLessons.visuals.items`; array vuoto ⇒
   rimuove il campo `visuals`;
3. rimuove l'elemento da `LessonDoc.visuals.items`; array vuoto ⇒ rimuove
   il campo (§6.4);
   — 1, 2, 3 nella stessa transazione;
4. elimina l'oggetto Storage canonico di quell'`assetId`.

### 8.10 Riordino — invariato dalla revisione 1

Callable dedicata, sola metadata, mai Storage, mai provider — stessa forma
e stessa disciplina di corsa (§10.4) della revisione 1.

### 8.11 Passaggio svolta ⇄ non svolta — invariato dalla revisione 1

Stessa struttura di VE §6.6, sull'intero array.

---

## 9. Upload — normalizzazione server-side e limiti (cap corretto: 2 MB)

### 9.1 Perché è la stessa pipeline di normalizzazione, non una nuova

VE §7 descrive una pipeline di sette passi pensata per **non fidarsi** di
ciò che il chiamante dichiara. L'upload riusa integralmente questa
pipeline: cambia solo il passo 0.

### 9.2 Passo 0 — accettazione dell'input grezzo, prima della pipeline

Fail-closed, nell'ordine:

1. **cap di dimensione grezza**: `byteLength ≤ MAX_VISUAL_UPLOAD_INPUT_BYTES`
   (**2.000.000 byte = 2 MB**, §5.6) verificato **prima** di qualunque
   decodifica. Un file più grande produce `visual_upload_too_large` senza
   toccare un decoder;
2. **sniffing dei magic byte reali**, allowlist di tre soli formati
   (§5.6): PNG (`89 50 4E 47 0D 0A 1A 0A`), JPEG (`FF D8 FF`), WebP
   (`RIFF…WEBP`). Qualunque altra firma ⇒ `visual_upload_unsupported_format`
   — **inclusi SVG e GIF**, mai in allowlist: SVG è testuale/vettoriale e
   può veicolare script; GIF e WebP animati sono esclusi perché il
   contratto produce sempre un'immagine statica. Il `Content-Type`
   dichiarato dal client non è mai autorevole;
3. **rifiuto dell'animazione**: per un WebP di input, lo stesso controllo
   di VE §15.2 sul flag `ANIM` del chunk `VP8X` si applica anche qui —
   `visual_upload_unsupported_format` se il file è animato, anche se
   supera lo sniffing come «WebP»;
4. da qui la pipeline di VE §7 riprende identica: decodifica reale,
   resize al lato lungo ≤ 1200 senza upscaling, conversione WebP,
   **`background=opaque`** — un canale alfa eventualmente presente nel PNG
   di origine è appiattito su sfondo `#f7f5f0` (lo stesso sfondo chiaro
   dello stile a schizzo), mai preservato come trasparenza — strip
   metadati, cap 204.800 byte canonici, hash sui byte finali. **L'output è
   sempre WebP opaco**, indipendentemente dal formato di input.

### 9.3 Che cosa l'upload NON ha, e come si compensa

Nessuna fase di proposta testuale: il docente scrive `caption`/`altText`
esplicitamente prima di poter confermare — stessi vincoli di VE §9.6. Il
punto di ancoraggio è scelto dal docente fra gli heading realmente
presenti, con lo stesso `VisualAnchorSelector` a indice+testo di §7.1: nes-
sun campo di testo libero.

### 9.4 Perché nessuna verifica di stile — compromesso invariato dalla revisione 1

VE §16 elenca «upload di immagini proprie» come fuori scope, con la
motivazione «è una funzione diversa, con problemi diversi (licenze,
moderazione, formati, provenienza)». Il mandato di questo pilota riapre
quel punto deliberatamente, e questo documento lo delimita, non lo nasconde
(§17.1):

- **Nessuna moderazione automatica.** SchoolForge è uno strumento a
  singolo docente (`brief.md`): il modello di fiducia è lo stesso già
  accettato per ogni altro contenuto che il docente scrive o importa.
- **Nessuna garanzia di licenza o provenienza.** Resta responsabilità del
  docente.
- **Lo strip dei metadati è la principale mitigazione di privacy.** Una
  foto scattata da un docente porta tipicamente GPS, modello del
  dispositivo, timestamp: rimossi sempre, indipendentemente dalla
  provenienza.
- **Nessuna persona riconoscibile** resta un divieto contrattuale ed
  editoriale, non strutturale, per lo stesso motivo di VE §9.4.

### 9.5 Nessun dato raggiunge un provider

L'upload non chiama alcun provider: zero payload esce verso l'esterno.

---

## 10. Idempotenza e corse

### 10.1 Il piano come unità di idempotenza

Un solo `requestId` (UUID v4, client, stabile fra i retry) per **l'intero
piano**, non uno per immagine:

```
opaquePlanId = SHA-256(canonical(['visual-plan/v1', ownerUid, requestId]))
```

Ogni slot deriva il proprio identificatore di run **deterministicamente**
dal piano, senza un secondo `requestId` dal client:

```
opaqueSlotRunId = SHA-256(canonical(['visual-plan-slot/v1', ownerUid, opaquePlanId, slotIndex]))
```

`planHash` protegge dalla corsa fra autorizzazione e stato della lezione:

```
planHash = SHA-256(canonical([
  'visual-plan/v1', ownerUid, lessonId, sourceBodyHash,
  existingItemAssetIds (ordinati), quantity
]))
```

**Risposta persa sull'autorizzazione.** Il client ripete con la stessa
`requestId`. Il server trova il `VisualPlanRun`, verifica che `planHash`
coincida con quello ricalcolato dallo stato **attuale** — se la lezione è
cambiata nel frattempo in un modo che invaliderebbe il piano (corpo
riscritto, slot liberi cambiati), la risposta è `visual_plan_stale`: il
docente deve avviarne uno nuovo, con una nuova, singola autorizzazione. Se
`planHash` coincide, il piano esistente viene restituito così com'è —
**nessuna seconda prenotazione, nessuna seconda proposta**.

**Risposta persa su un singolo slot.** Stesso principio di VE §8.1: il
client ripete l'azione (genera/promuovi) sullo stesso `(opaquePlanId,
slotIndex)`; il server riconosce lo stato già raggiunto e lo restituisce
senza ripetere provider, upload o promozione.

### 10.2 La corsa fra modifica della lezione e conferma

Identica a VE §8.2, applicata al piano nel suo complesso (autorizzazione,
§10.1) e a ciascuno slot alla promozione (§8.6 passo 1): il corpo fresco è
sempre riletto, mai assunto invariato.

### 10.3 Un solo piano attivo per lezione

**Regola**: mentre `VisualPlanRun.status` non è terminale
(`completed | partially_completed | abandoned | expired`), un tentativo di
avviare un secondo piano sulla stessa lezione è rifiutato con
`visual_plan_already_active`, e la risposta include l'identificativo del
piano esistente perché il client possa aprirlo (§8.8) invece di crearne un
altro. Questo è ciò che rende «piano persistito e riprendibile» (Blocker 2)
anche una difesa di concorrenza, non solo una comodità: due schede dello
stesso docente non possono mai prenotare due tetti economici sovrapposti
per la stessa lezione.

### 10.4 Corse sull'elenco — invariate dalla revisione 1

| Scenario | Difesa |
|---|---|
| Due tab approvano ciascuna una quarta immagine quando ce ne sono già 2 | la transazione di promozione (§8.6) rilegge `items.length` dentro il commit; la seconda a committare riceve `visual_slot_full` |
| Un riordino con un insieme di `assetId` non corrispondente a quello live | `visual_order_stale`, zero scritture |
| Approvazione e rimozione sullo stesso `assetId` in corse ravvicinate | entrambe le transazioni rileggono `LessonDoc.visuals` fresco; Firestore serializza le transazioni in conflitto sullo stesso documento |

Nessuna operazione sull'elenco scrive mai un aggiornamento posizionale:
ogni operazione legge l'array intero dentro la transazione e lo riscrive
intero.

---

## 11. Punto di ingresso e orchestrazione

### 11.1 Un solo ingresso: «Arricchisci», in Azioni

**Correzione esplicita rispetto alla revisione 1**, che proponeva un
controllo nella scheda Contenuto **e** un'orchestrazione separata: il
mandato vuole un ingresso solo. `Azioni → Arricchisci` è l'unico punto da
cui si raggiunge:

- il selettore di quantità e il piano coordinato (§8), se la lezione ha
  slot liberi;
- l'upload di un file proprio (§9), sempre raggiungibile se ci sono slot
  liberi;
- la galleria «Gestisci immagini» (badge di provenienza, sostituzione,
  rimozione, riordino), sempre raggiungibile se `items.length > 0`,
  **indipendentemente** dal fatto che ci siano slot liberi o meno.

Non esiste una seconda entrata nella scheda Contenuto. Il controllo
«Arricchisci» in Azioni è disabilitato con motivo visibile solo quando il
corpo della lezione è assente, vuoto o non salvato (stessa precondizione di
VE §14 punto 1) — **mai** solo perché la lezione ha già tre immagini: in
quel caso il controllo resta attivo e apre direttamente la galleria (la
generazione di nuove immagini è ciò che risulta disabilitato all'interno,
con motivo visibile, §8.2).

### 11.2 «Genera lezione con immagini» — passo del flusso di generazione della lezione, non un secondo ingresso

**Correzione esplicita**: non è un'orchestrazione a sé con un proprio
ingresso, come nella revisione 1. È un passo **opzionale** offerto
**dentro** il flusso esistente di generazione/rigenerazione del testo della
lezione (`AiContentRequest{kind: 'lesson'}`), dopo che quel testo è stato
salvato.

### 11.3 Ordine — perché il testo si salva prima, sempre

```
Genera/rigenera testo lezione (flusso esistente, invariato)
  │
  ▼
Il testo generato è mostrato, il docente lo rivede e conferma
  │
  ▼
SALVATAGGIO CANONICO del testo — LessonDoc.body scritto, punto di non ritorno
  │
  ▼
«Vuoi generare anche le immagini?» — passo opzionale, offerto SOLO ORA
  │
  ├─ Sì → apre lo stesso selettore di quantità di §8.2, sulla lezione
  │        appena salvata (sourceBodyHash del piano = hash del testo
  │        appena scritto, non di una bozza)
  │
  └─ No / chiude → la lezione resta esattamente come appena salvata,
           testo compreso; «Arricchisci» resta disponibile in Azioni in
           qualunque momento successivo, senza differenze rispetto ad
           averlo avviato da lì direttamente
```

**Perché questo ordine è vincolante e non un dettaglio d'implementazione.**
Se il piano visivo partisse su un testo non ancora salvato, un fallimento
del piano (o anche solo un abbandono) lascerebbe ambigua la domanda «è
salvato il testo?». Salvando prima, la domanda non si pone mai: **un
fallimento del piano visivo, qualunque esso sia, non tocca in alcun modo
`LessonDoc.body`, già scritto e committato prima che il piano esista.** Il
retry di uno slot fallito (§8.5) non rigenera il testo: rigenera
esclusivamente quell'immagine, perché il testo non fa più parte di ciò che
il retry tocca — è già fuori dal piano.

### 11.4 Nessuno sconto, un'unica autorizzazione — dettaglio del testo mostrato

```
┌─────────────────────────────────────────────────────────────┐
│  Genereremo una proposta coordinata e fino a 3 immagini.     │
│  Costo massimo di questa sessione:                           │
│    proposta coordinata .......... € stimato_proposta         │
│    fino a 3 generazioni ......... € stimato_generazione × 3  │
│    ───────────────────────────────────────────────────────  │
│    tetto totale ................. € somma                   │
│                                                                │
│  Non è uno sconto: è la somma dei costi massimi di ciascuna  │
│  fase. Il costo reale sarà pari o inferiore — ogni immagine  │
│  non generata non viene addebitata.                          │
│                                                                │
│              [Annulla]      [Autorizza e continua]           │
└─────────────────────────────────────────────────────────────┘
```

Dopo «Autorizza e continua», **nessun'altra finestra di costo compare** per
tutta la vita di quel piano — non alla proposta, non a ciascuna
generazione, non al retry entro il tetto di tentativi (§8.5). Il consuntivo
(«quanto è stato speso davvero, fase per fase e asset per asset») è
visibile in ogni momento nel pannello del piano, ma non richiede alcuna
azione di conferma: è **informazione**, non un nuovo costo da approvare.

### 11.5 Interazione con l'upload nella stessa sessione

L'upload resta raggiungibile dallo stesso ingresso (§11.1) e non richiede
alcuna autorizzazione economica (zero costo di provider, §9.5): può
popolare uno slot libero indipendentemente da un piano IA in corso o
concluso.

---

## 12. Cost model

Ogni riga distingue esplicitamente **fase** (pianificazione coordinata,
generazione, upload, promozione, lettura, retry, cleanup) e **conteggio
per immagine**, con formule chiuse per 0/1/2/3 immagini — non un numero
vago.

### 12.1 Autorizzazione e piano (fase unica, indipendente dal numero di slot generati davvero)

| Momento | Provider | Firestore | Storage | Function |
|---|---|---|---|---|
| **Autorizzazione del piano** (1 per sessione, qualunque `ceiling`) | 0 | 1 scrittura `VisualPlanRun` + 1 prenotazione budget (`totalReserved`) | 0 | 1 |
| **Proposta coordinata** (1 per piano, mai N) | 1 chiamata testo, `quality`, indipendente da `ceiling` nel numero di chiamate (una sola, con `ceiling` nel prompt) | 1 aggiornamento `VisualPlanRun.slots` + `settlement.proposalActualCost` | 0 | 1 |
| **Rilascio della quota non usata** (`ceiling − slot con decision:'image'`) | 0 | incluso nell'aggiornamento sopra — nessuna scrittura aggiuntiva | 0 | 0 |

**Formula del tetto iniziale**, esplicita:

```
totalReserved(ceiling) = proposalCap + perSlotGenerationCap × ceiling

ceiling = 0 (nessuno slot libero)  →  «Arricchisci»→generazione disabilitato, nessuna riga
ceiling = 1                        →  totalReserved = proposalCap + 1 × perSlotGenerationCap
ceiling = 2                        →  totalReserved = proposalCap + 2 × perSlotGenerationCap
ceiling = 3                        →  totalReserved = proposalCap + 3 × perSlotGenerationCap
```

Il tetto **non dipende** da quante proposte risulteranno `decision:
'image'`: è calcolato sul massimo possibile (`ceiling`) e la parte non
usata è rilasciata al termine della proposta coordinata (riga sopra), mai
addebitata (§8.2).

### 12.2 Generazione, per slot (0..3 righe per sessione, secondo quanti slot hanno `decision: 'image'`)

| Momento | Provider | Firestore | Storage | Function |
|---|---|---|---|---|
| **Generazione di uno slot** (per slot con `decision: 'image'`) | 1 chiamata immagine, `quality` | 1 aggiornamento `slots[i]` | 1 scrittura staging | 1 |
| **Retry di uno slot fallito** (entro il tetto di 2 tentativi) | 1 chiamata immagine | 1 aggiornamento `slots[i].attempts` | 1 riscrittura staging (stesso `opaqueSlotRunId`) | 1 |
| **Replay** (risposta persa, stesso `opaquePlanId`+`slotIndex`) | **0** | 1 lettura | 0 | 1 |

**Conteggio per lezione**, esplicito:

```
0 immagini generate → 0 righe di questa tabella (piano con soli slot 'none' o abbandonati)
1 immagine generata → 1 riga «Generazione», 0..1 righe «Retry»
2 immagini generate → 2 righe «Generazione», 0..2 righe «Retry» (indipendenti)
3 immagini generate → 3 righe «Generazione», 0..3 righe «Retry» (indipendenti)
```

### 12.3 Upload (per immagine, zero provider in ogni caso)

| Momento | Provider | Firestore | Storage | Function |
|---|---|---|---|---|
| **Accettazione file** (per immagine caricata) | **0** | 1 scrittura ticket | 1 scrittura staging | 1 (normalizzazione, cap input 2 MB) |
| **Rifiuto pre-decodifica** (formato/peso non validi) | 0 | 0 | 0 | 1 (termina al passo 0 di §9.2, nessuna scrittura) |

### 12.4 Promozione — individuale o in blocco, mai una transazione multi-immagine

| Momento | Provider | Firestore | Storage | Function |
|---|---|---|---|---|
| **Promozione — modalità `add`** (per immagine) | 0 | 2 letture transazionali, 1 scrittura privata, +1 pubblica e +1 aggiornamento mappa byte solo se svolta, 1 audit | 1 copia + 1 delete staging | 1 |
| **Promozione — modalità `replace`** (per immagine) | 0 | come `add`, + 1 rimozione chiave mappa byte se svolta | 1 copia + 1 delete staging + 1 delete canonico precedente (dopo commit) | 1 |
| **«Applica tutte»** (N slot `ready`) | 0 | **N ×** le righe sopra, eseguite in sequenza — mai un'unica transazione | **N ×** le righe sopra | **N** |
| **Adozione da manifest singolo** (una tantum per lezione) | 0 | inclusa nella transazione di promozione che la innesca — nessuna scrittura aggiuntiva | 0 | 0 |

**Perché «Applica tutte» costa esattamente N volte, non meno.** Non esiste
uno sconto di batch sulla scrittura, per lo stesso motivo per cui non ne
esiste uno sulla generazione (§12.1): ogni immagine ha il proprio commit,
la propria copia Storage, il proprio audit. «Applica tutte» è una comodità
di interazione, non un'ottimizzazione di costo.

### 12.5 Lettura studente e liste — invariato dalla revisione 1

| Momento | Firestore |
|---|---|
| **Lezione senza `visuals`** | **0** |
| **Lezione con 1, 2 o 3 immagini** | **1 lettura puntuale** (indipendente dal conteggio, §5.4), all'apertura |
| **Elenchi / card, qualunque conteggio** | **0** |

### 12.6 Riordino, rimozione, cleanup — invariato dalla revisione 1

| Momento | Firestore | Storage |
|---|---|---|
| **Riordino** | 2 letture transazionali, ≤ 2 scritture | **0** |
| **Rimozione** (per immagine) | 3 eliminazioni/aggiornamenti transazionali, 1 audit | 1 delete |
| **Cleanup piano scaduto (TTL 24h)** | 1 delete `VisualPlanRun` | 1 delete per slot con staging residuo |

### 12.7 Invarianti di costo, riverificate

- **zero** listener, **zero** polling, **zero** indici nuovi;
- **zero** letture per card, indipendentemente dal numero di immagini;
- **zero** costo su ogni lezione priva di immagini;
- **il costo di lettura studente non cresce con il numero di immagini**
  (1 lettura per 1, 2 o 3);
- **un'unica autorizzazione economica per piano**, mai una per immagine;
- l'upload **non** ha mai un costo di provider;
- il consuntivo (`VisualPlanRun.settlement`) è sempre disponibile per fase
  e per asset, anche quando l'autorizzazione a monte è stata unica.

---

## 13. Sicurezza e privacy — delta rispetto a VE

Tutto VE §9 si applica invariato a ogni immagine `source: 'generated'`.

- **Minimizzazione: `source` non lascia mai il manifest privato.** Il
  manifest pubblico (§5.3) non contiene la provenienza. Il renderer
  studente non ha bisogno di sapere se un'immagine è stata generata o
  caricata per mostrarla correttamente — è un dato che serve **solo** alla
  gestione owner-only (badge nella galleria docente, filtro nell'audit) e
  darlo allo studente violerebbe lo stesso principio per cui `storageRef`
  non compare nel manifest pubblico di VE §4: ciò che non serve al
  rendering non viene proiettato.
- **§9.1–9.3 di VE** (corpo non attendibile, prompt composto dal server,
  nessun dato studente al provider) si applicano al percorso di
  generazione **e** alla proposta coordinata: il prompt della proposta
  coordinata riceve `ceiling` come unico parametro aggiuntivo oltre a
  quanto già previsto da VE §15.1, mai dati studente.
- **§9.4 di VE** (contenuto dell'immagine) resta il criterio editoriale per
  entrambe le provenienze.
- **§9.6 di VE** (didascalia e testo alternativo) invariato.
- **§9.7 di VE** (nessuna modifica a CSP/DOMPurify/Storage Rules/guardie di
  scoperta) invariato. Le Rules Firestore su
  `publicLessons.visuals`/`publicLessonVisuals` **devono** cambiare forma
  in una fase implementativa futura — non in questo documento.

---

## 14. Rendering, accessibilità, export

**Rendering.** Invariato dalla revisione 1: `<figcaption>` testo visibile,
`alt` sempre presente e sostanziale, `loading="lazy"`, `decoding="async"`,
`width`/`height` dichiarati dal manifest, `max-width: 100%`, nessuna
animazione con `prefers-reduced-motion: reduce` rispettato, nessuna
lightbox/zoom/carosello.

**Galleria docente.** Raggiunta da «Arricchisci» (§11.1), non da un
secondo ingresso. Mostra le 0–3 immagini in ordine, badge di provenienza
(**solo qui, mai proiettato allo studente**, §13), posizione di
ancoraggio o avviso di ancora persa, azioni sostituisci/rimuovi/riancora
per elemento, controllo di riordino.

**Export ZIP — nessuna modifica al formato.** I sidecar di VE-03C
(`visuals/{assetId}.json`, `visuals/{assetId}.webp`) sono già chiavati per
`assetId`: un archivio con 0, 1, 2 o 3 file per lezione è già
rappresentabile senza modifiche.

**`aiVisualExportBatch` — criterio di dimensionamento dinamico.** Invariato
dalla revisione 1: il client accumula lezioni nel batch corrente sommando
`min(itemCount, 3) × 204_800` byte worst-case; prima di superare
`8_000_000`, chiude il batch. Caso peggiore assoluto: 13 lezioni a 3
immagini ciascuna al cap rigido (`8_000_000 ÷ 614_400 = 13,02`).

---

## 15. Rollout e rollback

### 15.1 Sequenza — nessuna assunzione sullo stato di VE

**Correzione rispetto alla revisione 1**: non si assume più che «nessuna
lezione reale abbia mai avuto un'immagine» come premessa di
pianificazione (§1.1). La raccomandazione di sequenza resta comunque
valida per ragioni indipendenti da quella premessa:

1. **Prodotto:** se il giudizio sul valore dell'arricchimento visivo a una
   immagine fosse negativo, estendere la stessa funzione a tre immagini
   prima di quel giudizio sarebbe investire su un'ipotesi già respinta.
   Se il giudizio è invece positivo (come indica la guida di questo pilota,
   §1.1), questo argomento non si applica e MULTI-VISUAL-01 può procedere
   senza attendere alcuna ulteriore conferma di prodotto.
2. **Tecnico, e questo non dipende dal giudizio di prodotto:** §6
   specifica l'adozione dal manifest singolo assumendo che quel manifest,
   quando incontrato, sia conforme al contratto VE **così come esiste al
   momento dell'adozione**. Se VE cambia forma, l'adattatore
   `adaptSingular` (§6.1) va aggiornato di conseguenza prima di incontrare
   dati reali in quella forma nuova — indipendentemente da quanti siano.

### 15.2 Due percorsi possibili — invariato nella struttura, non nella premessa

| Opzione | Descrizione | Compromesso |
|---|---|---|
| **A — sequenziale** | Attendere una decisione di prodotto esplicita su VE, **poi** costruire MULTI-VISUAL sopra un contratto singolo il cui stato reale è confermato | L'adozione (§6.3) viene esercitata su dati reali con maggiore certezza sulla loro forma |
| **B — diretto** | MULTI-VISUAL assorbe da subito il ruolo di V1 dell'intera funzione | Più veloce; richiede che l'adattatore `adaptSingular` sia verificato contro la forma **reale** dei dati esistenti, qualunque essa sia, prima di distribuire la scrittura (§15.4) |

La scelta fra le due resta del docente al gate umano di questo pilota, non
di questo documento. In entrambi i casi, il meccanismo di §6.3 è progettato
per essere corretto senza fare assunzioni sul volume di dati.

### 15.3 Flag di distribuzione — invariato dalla revisione 1

`AI_VISUAL_MULTI_WRITE` (`disabled | enabled`, default `disabled`) e
`AI_VISUAL_MULTI_READ` (`disabled | enabled`), **distinti**, sul modello di
`AI_VISUAL_MODE`.

### 15.4 Il rischio di rollback che riguarda i dati, non il codice — invariato

Una volta adottata (§6.2), una lezione ha `visuals` e non più `visual`. Un
rollback che disattiva solo `AI_VISUAL_MULTI_WRITE` impedisce nuove
adozioni ma lascia il renderer (`AI_VISUAL_MULTI_READ`, distribuito e
attivato **prima**, indipendentemente) capace di leggere quelle già
avvenute: nessuna lezione diventa illeggibile. Solo un rollback che riporta
indietro anche il codice del renderer riesporrebbe questo rischio.

### 15.5 Rollback di questa fase (MULTI-VISUAL-00)

Invariato: essendo questa fase esclusivamente documentazione e prototipo,
il rollback è completo e gratuito.

---

## 16. Fuori scope

Ereditati da VE §16: diagrammi tecnici precisi, KaTeX/Mermaid, profilo
`economy`, import di immagini da ZIP, modifica dell'immagine dopo la
generazione, stili alternativi configurabili, persone riconoscibili.

Confermati dalla revisione 1: più di tre immagini per lezione (§4);
immagini per pool/verifiche/UDA/mappe concettuali; moderazione automatica
del contenuto caricato (§9.4); riordino via drag-and-drop nel prototipo
(solo frecce da tastiera); bulk «rimuovi tutte le immagini»; retrocessione
automatica da array a manifest singolo (§6.2).

Nuovi in questa revisione:

- **rilevamento di duplicati semantici tramite un modello dedicato o
  embedding** (§7.4) — il vincolo di diversità del piano è strutturale
  (ancore e subject distinti), non un secondo sistema di IA che giudica la
  somiglianza di significato;
- **riscrittura di `visual-enrichment-roadmap.md` o delle sue evidenze**
  per risolvere la divergenza di §1.1 — dichiarata, non risolta qui;
- **una seconda entrata nella scheda Contenuto** per l'arricchimento
  visivo — resta un solo ingresso, in Azioni (§11.1);
- **sconti o prezzi combinati** per un piano rispetto alla somma dei costi
  delle sue fasi (§12.1, §12.4).

---

## 17. Rischi residui

1. **Il vincolo di diversità del piano (§7.4) è strutturale, non
   semantico.** Impedisce duplicati sulla stessa ancora con lo stesso
   soggetto testuale, non ogni sovrapposizione concettuale più sottile fra
   soggetti diversi. È un compromesso dichiarato fra rigore e semplicità
   del meccanismo.
2. **Il cap di upload a 2 MB (§9.2) è più stretto della dimensione tipica
   di una foto scattata da un telefono moderno**, che spesso supera questo
   valore. È un valore dato dal mandato, non derivato in questo documento:
   il rischio pratico è che il docente debba ridimensionare un file prima
   di caricarlo, un passo di attrito reale che il contratto non elimina.
3. **La divergenza fra lo stato dichiarato di VE su `main` e la guida
   operativa di questo pilota (§1.1) non è risolta.** È dichiarata, e ogni
   meccanismo di migrazione è progettato per restare corretto in entrambi
   gli scenari — ma la domanda di fondo, «quante lezioni reali hanno già
   un'immagine oggi», resta senza una risposta certa fino a una verifica
   diretta su dati di produzione, fuori dal perimetro di questo documento.
4. **L'upload di immagini proprie riapre un punto che VE aveva chiuso come
   fuori scope** (§9.4), delimitato dal perimetro a singolo docente ma non
   risolto nel merito (licenze, moderazione, provenienza).
5. **Il duplicato dei byte resta**, fino a tre WebP canonici in Storage e
   fino a tre copie base64 nella mappa Firestore per lezione svolta.
6. **Il margine di 229 KB su tre immagini al cap rigido (§4) resta il
   21,9% del limite di documento** — da ricalcolare esplicitamente se
   Firestore cambiasse il proprio limite o se un campo aggiuntivo venisse
   introdotto nella mappa byte.
7. **Il riordino a tastiera (frecce) resta meno immediato di un
   drag-and-drop** per un docente abituato ad altre interfacce — scelta
   deliberata di accessibilità (§16).
8. **«Applica tutte» (§12.4) non riduce il numero di operazioni**: è
   comodità di interazione, non ottimizzazione di costo. Un docente che si
   aspettasse un risparmio da un'azione in blocco ne resterebbe deluso; il
   testo dell'interfaccia deve dirlo esplicitamente.
9. **Un piano abbandonato con slot già `ready` scarta immagini già
   pagate** (§8.7), esattamente come l'abbandono di VE §6.4: è un costo
   reale già sostenuto, non recuperabile una volta scartato, mitigato solo
   dalla conferma esplicita richiesta prima dello scarto.

---

## 18. Fasi

| Pacchetto | Sintesi | Dipendenze | Stato |
|---|---|---|---|
| **MULTI-VISUAL-00** | **Contratto e prototipo**, revisione 2: piano coordinato ad autorizzazione unica, selettore di quantità, identità di ancoraggio indice+testo, cap upload 2 MB, ingresso unico «Arricchisci», integrazione col flusso di generazione della lezione, manifest pubblico minimizzato, cost model per fase e asset. | VE-00→05A (documentali), `agent-orchestrator-roadmap.md` §12 | **Questo documento.** Nessun runtime. Gate GMULTI: PENDING. |
| **MULTI-VISUAL-01** | **Tipi e validatori puri.** `LessonVisualsManifest`, `LessonVisualItem` (con `source` privato), `PublicLessonVisualItem` (senza `source`), `VisualAnchorSelector`, `VisualPlanRun`/`VisualPlanSlot`, validatore del vincolo di diversità (§7.4), risolutore d'ancora a indice+testo (§7.2) con test di collisione (§7.3), `adaptSingular` puro, costanti incluso `MAX_VISUAL_UPLOAD_INPUT_BYTES = 2_000_000`. Nessuna Function, nessuna UI, nessun provider. | MULTI-VISUAL-00 | Aperto. |
| **MULTI-VISUAL-02** | **Catena binaria dell'upload** (cap 2 MB, allowlist PNG/JPEG/WebP non animati, `background=opaque`) e **proposta coordinata** (`kind: 'visual_plan_proposal'`, Structured Output ad array, vincolo di diversità applicato server-side). Nessuna UI, nessuna proiezione studente. | MULTI-VISUAL-01 | Aperto. |
| **MULTI-VISUAL-03** | **Persistenza e lifecycle del piano.** `VisualPlanRun` con autorizzazione unica e prenotazione a somma di cap, transazione di adozione, promozione `add`/`replace` per slot, riordino, rimozione, Rules Firestore su `publicLessons.visuals`/`publicLessonVisuals`, criterio di batching dell'export. | MULTI-VISUAL-02 | Aperto. |
| **MULTI-VISUAL-04** | **UI.** «Arricchisci» in Azioni (unico ingresso), selettore di quantità, autorizzazione unica, revisione del piano, generazione con progresso e retry per asset, upload, galleria con riordino da tastiera, integrazione col flusso «Genera lezione» (testo salvato prima del piano visivo), rendering N-way, responsive desktop/mobile con semantica modale reale (focus trap, Escape, ripristino del focus). | MULTI-VISUAL-03 | Aperto. |
| **MULTI-VISUAL-05** | **Qualità e rollout controllato.** Benchmark su lezioni con più immagini, verifica del margine di §4 su documenti reali, smoke DEV con flag in sequenza, verifica del percorso di rollback, verifica diretta su dati di produzione della domanda aperta di §17.3. | MULTI-VISUAL-04 | Aperto. |
| **Gate GMULTI** | **Approvazione umana.** | MULTI-VISUAL-05 | **PENDING.** |

---

## 19. Test obbligatori

- **Non-regressione byte-identica** degli `inputHash`/costanti congelate di
  VE-01 (pool, lezione, mappa, `visual_proposal` singolo).
- **Validatore strutturale dell'array e del piano**: chiavi esatte,
  `items.length` in `1..3`, `contractVersion` letterale, unione chiusa di
  `styleVersion` coerente con `source`; `VisualPlanRun`/`VisualPlanSlot` a
  chiavi chiuse, `quantity.ceiling` in `1..3`.
- **Vincolo di diversità del piano (§7.4)**: caso negativo con due slot
  sullo stesso `anchorHeadingIndex` ⇒ `provider_invalid_output`; caso
  negativo con due `subject` normalizzati identici ⇒ stesso esito; caso
  positivo con ancore e subject distinti ⇒ accettato.
- **Risoluzione dell'ancora a indice+testo (§7.2, §7.3)**: caso con due
  heading testualmente identici, verifica che i due indici
  risolvano a slug distinti (`reti`, `reti-2`) indipendentemente da quale
  dei due sia stato scelto; caso di indice fuori range dopo modifica del
  corpo ⇒ fallback di coda, non un'invenzione; caso di testo non
  corrispondente all'indice dopo riordino degli heading ⇒ stesso fallback.
- **`adaptSingular`** — equivalenza campo per campo fra la lettura
  compatibile e un `LessonVisualsManifest` a un elemento scritto a mano.
- **Adozione transazionale su dataset legacy popolato (§6.3)**: batch di
  lezioni con `LessonDoc.visual` reale e variegato, adottate
  indipendentemente, senza interferenza reciproca; caso di retry
  idempotente; caso di `visual_legacy_malformed` fail-closed.
- **Idempotenza del piano (§10.1)**: replay dell'autorizzazione con
  `planHash` invariato restituisce lo stesso piano senza nuova
  prenotazione; `planHash` cambiato dopo modifica del corpo ⇒
  `visual_plan_stale`; un secondo tentativo di piano su una lezione con
  piano attivo ⇒ `visual_plan_already_active` con riferimento al piano
  esistente.
- **Retry per slot che non perde asset riusciti (§8.5)**: piano a 3 slot
  con uno fallito, verifica che gli altri due restino `ready` e
  approvabili indipendentemente dal retry del terzo, fino al tetto di 2
  tentativi.
- **Formula del tetto (§12.1)**: `totalReserved` calcolato correttamente
  per `ceiling` 1/2/3 e rilascio della quota non usata dopo la proposta
  coordinata, verificato contro un ledger di budget reale (Emulator).
- **Upload — cap e formati (§9.2)**: file oltre 2.000.000 byte rifiutato
  prima della decodifica; SVG e GIF rifiutati dall'allowlist; WebP animato
  rifiutato nonostante lo sniffing positivo; PNG con canale alfa
  normalizzato su sfondo opaco `#f7f5f0`.
- **Test del limite matematico di §4**, invariato dalla revisione 1.
- **Test del criterio di batching dinamico dell'export**, invariato.
- **Test del renderer N-way**, invariato.
- **Sequenza testo-poi-immagini (§11.3)**: simulazione di un fallimento del
  piano visivo dopo un salvataggio di testo riuscito, verifica che
  `LessonDoc.body` non sia toccato dal fallimento e che il retry del piano
  non inneschi una nuova generazione di testo.
- **Smoke responsive e di accessibilità reale**, Chromium via CDP,
  1440/1024/390/320 px, con le metriche esplicite richieste dalla review:
  overflow orizzontale, rettangolo dialog/viewport con scroll interno e
  footer raggiungibile, target interattivi ≥ 44 px su emulazione
  coarse/mobile, stabilità del frame dell'immagine fra stato "in
  generazione" e stato "pronta" (nessun layout shift), focus trap/Escape/
  ripristino del focus verificati con eventi da tastiera reali — mai
  dichiarato PASS su una metrica non raccolta (`evidenze/multi-visual-00-
  review.md` §4).
- **Test di rollback (§15.4)**, invariato.

---

## 20. Correzioni rispetto alla revisione 1 — blocker per blocker

Sintesi puntuale per la review, senza dover ricostruire il diff:

1. **Autorizzazione economica** — §8.3, §11.4, §12.1: un'unica conferma a
   tetto (somma dei cap), nessuna popup successiva; consuntivo per fase e
   asset in §12.
2. **Piano coordinato** — §8.3: una sola chiamata `visual_plan_proposal`
   restituisce 0..N slot; diversità imposta strutturalmente in §7.4; stati
   `pending/generating/ready/failed/promoted/abandoned` persistiti e
   riprendibili in §5.5, §8.8.
3. **Quantità** — §8.2: Automatico(1–3)/1/2/3, bounded dagli slot liberi e
   dal cap assoluto 3, mai un pavimento.
4. **Upload** — §5.6, §9.2: `MAX_VISUAL_UPLOAD_INPUT_BYTES = 2_000_000`;
   PNG/JPEG/WebP non animati, `background=opaque`.
5. **Ingresso e workflow** — §11.1: unico ingresso «Arricchisci» in Azioni,
   nessuna seconda entrata in Contenuto; §11.2–§11.3: «Genera lezione con
   immagini» è un passo del flusso di generazione testo, dopo il
   salvataggio canonico; fallimento visivo isolato dal testo.
6. **Ancoraggio omonimi** — §7.1–§7.3: `VisualAnchorSelector`
   (indice+testo) in pianificazione/promozione/riancoraggio, slug
   ricalcolato server-side, collisioni testate.
7. **Stati prototipo** — §7 di `evidenze/multi-visual-00-review.md`:
   galleria a 1/2/3, piano modificabile, generazione con progresso per
   asset, fallimento/retry che preserva i successi, upload, sostituzione/
   rimozione individuale, lezione+immagini con testo salvato, studente,
   recovery — tutti realmente interattivi nel prototipo rinominato.
8. **Responsive/accessibilità** — §8 di `evidenze/multi-visual-00-review.md`:
   target ≥ 44 px ovunque, dialog reale con focus trap/Escape/ripristino,
   smoke che misura dialog-vs-viewport, scroll interno, footer
   raggiungibile, target coarse/mobile, stabilità del frame immagine.
9. **Stato prodotto e minimizzazione** — §1.1: divergenza dichiarata senza
   riscrivere VE; migrazione fail-closed indipendente dal volume di dati
   (§6.3); `source` rimosso dal manifest pubblico (§5.3, §13).
10. **Deliverable e cost model** — file rinominato
    `documentazione/prototipi/lesson-multi-visual.html`, tutti i link
    aggiornati; §12 con formule e conteggi espliciti per 0/1/2/3 immagini.
