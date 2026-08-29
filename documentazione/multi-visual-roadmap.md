# MULTI-VISUAL — Arricchimento visivo multi-immagine (contratto e roadmap)

> **Stato: MULTI-VISUAL-00→04 completati e distribuiti. Gate GMULTI: PASS.**
> Il flusso multi-visuale è operativo in DEV e PROD: fino a tre immagini per
> lezione, generate o caricate dal docente, con gestione, rendering, export e
> cleanup. MULTI-VISUAL-05 resta un'attività opzionale di qualità.
> MULTI-VISUAL-00 (contratto e prototipo) chiuso con PR #423. MULTI-VISUAL-01
> aggiunge, in `functions/src/aiVisualMulti{Core,Manifest,Anchor,Plan}.ts`,
> i tipi chiusi e i validatori fail-closed di `LessonVisualsManifest`,
> `LessonVisualItem`/`PublicLessonVisualItem`, la matrice di lettura legacy
> (§6.1), `adaptSingular`, il risolutore d'ancora indice+testo (§7.2,
> riuso di `resolveAnchorByIndex`/`listAnchorableHeadings` di VE), il
> vincolo di diversità (§7.4) e `VisualPlanRun`/`VisualPlanSlot` (§5.5).
> MULTI-VISUAL-02 aggiunge il percorso IA interno
> `visual_plan_proposal` e le callable owner-only `aiVisualUploadAccept` /
> `aiVisualUploadAbandon`. Restano invariati Rules, UI, proiezioni studente,
> provider reali, segreti e deploy.
> Pilota di `AGENT-ORCHESTRATOR` (`agent-orchestrator-roadmap.md` §12).
> Il gate umano è stato superato dopo smoke DEV desktop/mobile; il rollout PROD
> è stato completato il 29 agosto 2026.
>
> **Revisione 2 (25 agosto 2026).** La prima review Codex ha respinto la
> revisione 1 con dieci blocker UX/workflow. Corretti tutti — modello
> economico a **autorizzazione unica** (§8, §11, §12), **piano coordinato**
> invece di proposte indipendenti (§8.3), selettore di **quantità** (§8.2),
> cap di upload corretto a **2 MB** (§9), punto di ingresso unico
> **«Arricchisci»** dentro Azioni, identità di ancoraggio **indice + testo**
> (§7), rimozione di `source` dal manifest pubblico (§5.3, §13), nome file
> del prototipo corretto, cost model con conteggi espliciti (§12). §20 ne
> elenca la correzione e la prova.
>
> **Revisione 3 (25 agosto 2026).** La seconda review Codex ha approvato
> l'esito UX ma respinto **dieci blocker architetturali**: matrice di
> migrazione fail-closed per la coesistenza `visuals`/`visual` (§6.1),
> forma chiusa completa di `VisualPlanRun` con identità e fonte autorevole
> per campo (§5.5), tetto economico riconciliato con i tentativi di retry
> ammessi — niente più seconda conferma dopo il tetto (§8.5, §12.1),
> fail-closed sulla corsa corpo/ancora **alla promozione**, coda solo
> **dopo** una promozione già avvenuta (§7.2), forma chiusa e Rules
> congelate del documento byte pubblico (§5.4, §5.4.1), export v2 davvero
> multi-asset (§14.2), generalizzazione del cleanup per cancellazione
> lezione/UDA/corso (§8.12), cost model riconciliato con i numeri
> **misurati** di VE-03 invece di stime scritte da zero (§12.0–§12.8), e la
> correzione del vincolo di diversità: un'ancora condivisa fra idee
> distinte resta legittima, solo l'idea duplicata è vietata (§7.4). §21 ne
> elenca la correzione e la prova.
>
> **Revisione 4 (25 agosto 2026).** La terza review Codex ha trovato **sei
> difetti di coerenza/idempotenza** sopravvissuti alla revisione 3:
> `planHash` non includeva davvero tutti i campi che §5.5 promette, e un
> replay dopo la promozione del piano stesso lo avrebbe dichiarato stale —
> corretto separando identità della richiesta (immutabile, verificata
> contro i valori iniziali persistiti) dalle guardie sul mondo mutabile
> (verificate solo alla scrittura, §10.1, §10.1.1); «un solo piano attivo»
> non era garantito da un `opaquePlanId` derivato dal `requestId` client —
> corretto con un lease deterministico `visualPlanLeases/{SHA-256(ownerUid,
> lessonId)}`, acquisito nella stessa transazione della prenotazione, con
> race A/B esplicite (§10.3); l'upload non aveva un contratto di
> idempotenza — nuovo `VisualUploadRun` con `requestId`, replay, conflitto,
> riuso della promozione di §8.6, cap combinato con il piano (§9.6–§9.9);
> le Rules dipendevano da primitive inventate (`lessonIdOf`,
> `assetIdsOf().toSet()`) — sostituite dagli helper reali del runtime
> (`isOwner()`, `isApprovedStudent()`, `isClassmateOf()`,
> `activeImportId`, `examModeAppliesToClass`) e da una funzione a rami
> espliciti per cardinalità 1/2/3 (§5.4.1–§5.4.3); l'export dichiarava
> tutto-o-niente per lezione invece che sull'intero batch — corretto
> (§14.2); test e costi delle nuove guardie aggiunti in §12 e §19. §22 ne
> elenca la correzione e la prova.
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

**Data:** 25 agosto 2026 (revisione 4).
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
| Proposta testuale | 1 chiamata → 1 esito | **1 chiamata coordinata → 0..N esiti**, idee reciprocamente distinte (soggetto e utilità, non l'ancora — condividere un'ancora resta legittimo, §7.4, §8.3) |
| Identità di ancoraggio in pianificazione | non applicabile (1 sola immagine) | `(anchorHeadingIndex, anchorHeadingText)`, mai lo slug (§7) |
| Manifest privato | `LessonDoc.visual` (oggetto singolo) | `LessonDoc.visuals` (contenitore con array `items`, §5) |
| Manifest pubblico | `publicLessons.visual` (con provenienza implicita: sempre generata) | `publicLessons.visuals` — **senza** campo di provenienza (§5.2, §13) |
| Byte studente | `publicLessonVisuals/{id}.data` (stringa) | `publicLessonVisuals/{id}.bytes` (mappa per `assetId`, §5.3) |
| Normalizzazione | solo output del generatore | stesso normalizzatore, **anche** su byte caricati dal docente, cap input **2 MB** (§9) |
| Ancoraggio persistito | 1 punto, split binario del token stream | fino a 3 punti, split N+1-way (§7.5) |
| Idempotenza | `requestId` nel namespace `visual-enrichment/v1` | **piano**: `requestId` + `planHash` nel namespace `visual-plan/v1`; ogni slot ha un `opaqueRunId` derivato deterministicamente dal piano, non un secondo `requestId` client (§10.1) |
| Rules Storage | nessuna regola nuova | **nessuna regola nuova** |
| Rules Firestore | forma su `publicLessons.visual` | forma **nuova** su `publicLessons.visuals` (fase implementativa, fuori da questo documento) |
| Export ZIP | `aiVisualExportBatch` restituisce 1 asset per lezione | **v2**: 1..3 asset per lezione, stesso formato di sidecar `visuals/{assetId}.{json,webp}`, validazione all-or-nothing estesa all'insieme, dedup sull'intero batch (§14.2) |

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

La scelta di una **mappa per `assetId`** resta invariata dalla revisione 1
e non è toccata da alcun blocker. **La forma del documento è invece
corretta rispetto alla revisione 2**, che aveva eliminato per errore
l'identità documentale e le dimensioni per asset di cui le Rules (sotto) e
il resto del contratto hanno bisogno:

```ts
export interface PublicLessonVisualBytesDoc {
  contractVersion: 'lesson-visuals/v1';

  /**
   * Identità del documento, dichiarata nel contenuto e non solo affidata
   * al percorso. «Non fidarsi solo del path»: il percorso Firestore
   * (`publicLessonVisuals/{publicLessonId}`) individua già il documento,
   * ma le Rules devono poter verificare che il CONTENUTO dichiari la
   * stessa identità del documento `publicLessons` a cui dice di
   * appartenere — un controllo di coerenza interna che il solo pattern di
   * `match` sul percorso non offre, perché `programId`/`importId` non
   * fanno parte di questo percorso (che è piatto, un solo segmento
   * variabile).
   */
  publicLessonId: string;
  programId: string;
  importId: string;

  bytes: {
    [assetId: string]: {
      dataUri: string; // 'data:image/webp;base64,...'
      mimeType: 'image/webp';
      /**
       * Duplicate delle stesse dimensioni già presenti nel manifest
       * pubblico piccolo (`PublicLessonVisualItem.width/height`, §5.3).
       * La duplicazione è deliberata: permette alle Rules (sotto) di
       * verificare la coerenza fra manifest e byte confrontando due campi
       * dello stesso tipo di documento senza dover decodificare l'immagine
       * — cosa che le Rules non possono fare — e senza fidarsi ciecamente
       * che chi ha scritto il byte doc abbia anche scritto il manifest
       * correttamente.
       */
      width: number;
      height: number;
    };
  };
}
```

Una mappa per chiave permette a un **singolo aggiornamento di sostituzione
o rimozione di un'immagine di toccare un solo campo del documento**. Una
sottocollezione per asset romperebbe l'invariante «una lettura puntuale,
indipendente dal numero di immagini» (Firestore fattura per documento
letto): resta quindi scartata per lo stesso motivo di VE §3.3.

### 5.4.1 Rules — congelate con le primitive reali del runtime, non inventate

**Correzione rispetto alla revisione 3.** Il pseudocodice precedente usava
`isOwnerOfLesson(publicLessonId)` — una funzione che risale da
`publicLessonId` al `LessonDoc` privato per confrontarne l'owner — e
`assetIdsOf(...).toSet()`/`allAssetDimensionsMatch(...)` come se CEL
avesse iterazione generica su mappe. Nessuna delle due esiste nel runtime
reale, e la seconda non è nemmeno esprimibile in CEL per una mappa di
dimensione arbitraria. La review ha respinto correttamente un contratto
che dipende da primitive impossibili. Questa versione usa **solo** gli
helper Rules già in vigore, citati da `sicurezza.md` §170 e usati altrove
nel repository, e sostituisce l'iterazione generica con una funzione a
rami espliciti — praticabile perché il tetto di tre elementi (§4) rende
«esplicito» sinonimo di «breve».

**`isOwner()` non ha bisogno di alcun parametro, né di risalire da
`publicLessonId`.** SchoolForge è single-owner/single-tenant per scelta di
design (`performance-security-audit.md`): un solo `settings/owner` per
l'intero deployment. `isOwner()` confronta `request.auth.uid` con
`settings/owner.ownerUid` **globalmente** (`hardening-audit-v1.md` §2) — non
esiste un "owner di questa lezione" distinto dall'unico owner
dell'installazione, quindi non esiste nulla da cui risalire. La revisione
3 aveva inventato una risalita che il modello a singolo proprietario non
richiede.

**`publicLessonVisuals/{publicLessonId}`:**

```
match /publicLessonVisuals/{publicLessonId} {

  allow read: if isOwner()
              || isStudentAllowedToReadVisualBytes(publicLessonId);

  // Scrittura SEMPRE negata al client, in ogni ruolo — anche l'owner.
  // Il documento è scritto solo da Cloud Functions (Admin SDK, bypassa le
  // Rules) durante la promozione (§8.6/§9.8), la rimozione (§8.9) e il
  // cleanup (§8.12).
  allow write: if false;
}

function isStudentAllowedToReadVisualBytes(publicLessonId) {
  let lesson = get(/databases/$(db)/documents/publicLessons/$(publicLessonId)).data;
  let bytes  = resource.data;

  return request.auth != null

      // 1. Le stesse guardie di scoperta GIÀ IN VIGORE per il testo della
      //    stessa lezione — nessuna guardia nuova, nessuna più permissiva:
      //    isApprovedStudent() (sicurezza.md §41), isClassmateOf() sulle
      //    classIds del programma padre (sicurezza.md §94-96),
      //    l'import realmente attivo (`resource.data.importId ==
      //    get(program).activeImportId`, HARD-02B-1) e l'assenza di
      //    Modalità verifica sulla classe (`examModeAppliesToClass`,
      //    sicurezza.md §106). Questo contratto non re-implementa questi
      //    helper: li richiama così come sono già scritti in
      //    `firestore.rules`.
      && isApprovedStudent()
      && isClassmateOf(get(/databases/$(db)/documents/programs/$(lesson.programId)).data.classIds)
      && lesson.importId == get(/databases/$(db)/documents/programs/$(lesson.programId)).data.activeImportId
      && !examModeAppliesToClass(myStudentClassId())

      // 2. La proiezione visiva esiste, è ben formata, e la lezione è
      //    svolta — senza `completed == true` la proiezione stessa non
      //    dovrebbe esistere (§8.11), ma la Rule non si fida del solo
      //    fatto che il documento sia leggibile per dedurlo.
      && lesson.visuals != null
      && lesson.completed == true

      // 3. Identità del byte doc coerente con la lezione che dice di
      //    servire — "non fidarsi solo del path" (§5.4).
      && bytes.publicLessonId == publicLessonId
      && bytes.programId == lesson.programId
      && bytes.importId  == lesson.importId

      // 4. Chiavi e dimensioni coerenti, a rami espliciti per
      //    cardinalità — mai un'iterazione generica (§5.4.2).
      && bytesKeysAndDimsMatch(lesson.visuals.items, bytes.bytes);
}
```

**`publicLessons/{publicLessonId}` — delta sul campo `visuals`:**

```
match /publicLessons/{publicLessonId} {
  allow read: if isOwner()
              || (isApprovedStudent()
                  && isClassmateOf(get(/databases/$(db)/documents/programs/$(resource.data.programId)).data.classIds)
                  && resource.data.importId == get(/databases/$(db)/documents/programs/$(resource.data.programId)).data.activeImportId
                  && !examModeAppliesToClass(myStudentClassId()));
  allow write: if false; // solo Cloud Functions
}
```

Nessuna condizione nuova rispetto a quelle già in vigore per il resto del
documento `publicLessons` (testo, metadati): il campo `visuals` non
introduce un livello di autorizzazione proprio, eredita quello del
documento che lo contiene — coerente con VE §9.7 («nessuna modifica alle
guardie di scoperta studente»).

**Scrittura client sempre negata, in ogni Rule di questa sezione.** Nessuna
eccezione per il docente: anche l'owner scrive solo attraverso le callable
autenticate (§8.6, §8.9, §8.12), mai con una scrittura diretta al
documento — stessa disciplina già in vigore per `visualRuns` e lo staging
di VE.

### 5.4.2 `bytesKeysAndDimsMatch` — a rami espliciti, perché CEL non itera mappe generiche

**Nuovo in questa revisione.** CEL (il linguaggio delle Firestore Security
Rules) non offre un modo di iterare una mappa di dimensione arbitraria e
confrontarla campo per campo con un array — `toSet()` su una mappa e un
confronto generico tipo `allAssetDimensionsMatch(...)` della revisione 3
non sono primitive che esistono. Il limite di tre elementi (§4) rende
questo non un problema: la funzione si scrive a mano, un ramo per
cardinalità, mai più di tre confronti espliciti:

```
function bytesKeysAndDimsMatch(items, bytesMap) {
  return
    items.size() == 1 ?
         bytesMap.size() == 1
      && (items[0].assetId in bytesMap)
      && bytesMap[items[0].assetId].width  == items[0].width
      && bytesMap[items[0].assetId].height == items[0].height
    :
    items.size() == 2 ?
         bytesMap.size() == 2
      && (items[0].assetId in bytesMap) && (items[1].assetId in bytesMap)
      && bytesMap[items[0].assetId].width  == items[0].width
      && bytesMap[items[0].assetId].height == items[0].height
      && bytesMap[items[1].assetId].width  == items[1].width
      && bytesMap[items[1].assetId].height == items[1].height
    :
    items.size() == 3 ?
         bytesMap.size() == 3
      && (items[0].assetId in bytesMap) && (items[1].assetId in bytesMap) && (items[2].assetId in bytesMap)
      && bytesMap[items[0].assetId].width  == items[0].width
      && bytesMap[items[0].assetId].height == items[0].height
      && bytesMap[items[1].assetId].width  == items[1].width
      && bytesMap[items[1].assetId].height == items[1].height
      && bytesMap[items[2].assetId].width  == items[2].width
      && bytesMap[items[2].assetId].height == items[2].height
    :
    false; // items.size() == 0 non deve mai arrivare qui: senza `visuals`
           // il byte doc non esiste (§3.3 di VE, §5.4), quindi questa
           // funzione non è mai chiamata su un manifest vuoto.
```

**Perché `bytesMap.size() == N` più N chiavi nominate implica corrispondenza
esatta, senza un `toSet()`.** Gli `assetId` sono UUID v4 generati
server-side (§5.1): due elementi distinti dello stesso manifest non
possono mai avere lo stesso `assetId`. Verificare che la mappa abbia
esattamente N chiavi **e** che le N chiavi nominate ci siano tutte esclude
per costruzione qualunque chiave extra — non serve enumerare le chiavi
della mappa per dimostrarlo, basta contarle.

### 5.4.3 Costo dichiarato dei `get()` aggiunti da questa Rule

Ogni `get()` allo stesso percorso, all'interno della stessa valutazione di
una Rule, è **memoizzato** da Firestore — chiamarlo più volte nello stesso
`match` non lo fattura più volte (stesso comportamento già sfruttato da
HARD-02B-1 per `get(program)`, citato in `hard-02b-import-chunking-design.md`
§7: «le due `get` sullo stesso path sono memoizzate entro la stessa
valutazione»). Il delta introdotto da questa sezione, rispetto a ciò che
la lettura di `publicLessons` già costa oggi:

- **owner**: `isOwner()` — 1 `get()` su `settings/owner`, già pagato da
  ogni altra Rule owner-only del repository; nessun `get()` nuovo
  specifico di questa funzione.
- **studente, lettura di `publicLessonVisuals`**: **+1 `get()` nuovo**
  rispetto a una lettura di `publicLessons` da sola — quello su
  `publicLessons/{publicLessonId}` stesso, necessario perché questa Rule
  valuta un documento **diverso** (`publicLessonVisuals`) e deve risalire
  al padre per le condizioni 1–4. Il `get(programs/{programId})` richiesto
  da `isClassmateOf`/`activeImportId` è **lo stesso** già pagato oggi dalla
  lettura di `publicLessons` (HARD-02B-1) — non un secondo `get()`
  indipendente, per la memoizzazione sopra.
- **studente, lettura di `publicLessons.visuals`**: **+0 `get()`
  nuovi** — nessuna condizione di questa sezione introduce un `get()` che
  la Rule esistente su `publicLessons` non pagasse già.

Questo costo è **Rules-time** (fatturato per valutazione di lettura,
indipendentemente dal numero di immagini) — un costo diverso e distinto
dal cost model applicativo di §12, che conta operazioni Firestore lato
Function, non valutazioni di Rules lato lettura diretta client. Nessuna
riga di §12 include questo costo, e nessuna dovrebbe: sono due livelli
diversi di fatturazione Firebase.

### 5.5 Piano visivo — `VisualPlanRun`

Nuovo in questa revisione: la forma che rende **una** l'autorizzazione
economica invece di N (Blocker 1) e **coordinata** la proposta (Blocker 2).

**Correzione rispetto alla revisione 2.** La forma precedente non
dichiarava a quale lezione appartenesse un piano se non implicitamente, non
distingueva la fonte autorevole di ciascun campo identità dal payload non
fidato del client, e la formula del tetto non teneva conto dei tentativi di
retry ammessi per slot (corretto anche in §8.5, §12.1). Questa versione
chiude entrambi i buchi.

**Percorso del documento:** `visualPlanRuns/{opaquePlanId}` — collezione di
primo livello, server-only, sullo stesso modello di `visualRuns` e
`aiVisualCandidates` di VE (non annidato sotto la lezione: l'identità della
lezione è un **campo**, non un segmento di percorso, perché `opaquePlanId`
è già derivato da `(ownerUid, requestId)` — §10.1 — e non c'è motivo di
duplicare l'annidamento). Owner-only nelle Rules, TTL 24 h come lo staging
di VE. Un solo piano ATTIVO per lezione alla volta (§10.3).

```ts
export interface VisualPlanRun {
  contractVersion: 'visual-plan/v1';

  // ── Identità — una riga per campo: fonte autorevole, non il payload nudo ──

  /**
   * UID del docente proprietario. Fonte autorevole: `auth.uid` del
   * contesto di autenticazione della callable che crea il piano — MAI un
   * valore letto dal payload client, per lo stesso motivo per cui VE non
   * accetta mai un `ownerUid` dichiarato (l'owner UID compare solo perché
   * la richiesta è autenticata come lui).
   */
  ownerUid: string;

  /**
   * Fonte autorevole: il payload di autorizzazione lo propone, ma il
   * server lo accetta **solo dopo aver riletto `LessonDoc` a quel percorso
   * e verificato che appartenga a `ownerUid`** — mai il payload da solo.
   * Fail-closed (`lesson_not_found`) se la lettura fallisce.
   */
  programId: string;
  /** Stessa disciplina di `programId`: verificato contro `LessonDoc` riletto. */
  importId: string;
  /** Stessa disciplina di `programId`: verificato contro `LessonDoc` riletto. */
  lessonId: string;

  /**
   * Fonte autorevole: **derivato server-side** dallo stesso helper
   * condiviso di proiezione già usato da VE
   * (`lessonProjectionIdentity`) — mai inviato dal client. Necessario per
   * calcolare i percorsi di `publicLessons`/`publicLessonVisuals` alla
   * promozione (§8.6) senza ricalcolarli lì una seconda volta con un
   * rischio di divergenza.
   */
  publicLessonId: string;

  /**
   * Fonte autorevole: letto da `LessonDoc`/metadati di import, mai dal
   * client. Necessario per il percorso Storage canonico
   * `repository/{ownerUid}/{importId}/{udaDir}/visuals/{assetId}.webp`
   * (VE §4) che la promozione di ciascuno slot userà.
   */
  udaDir: string;

  /** UUID v4, generato dal client. Persistito per audit/debug; l'unica
   *  cosa che ne deriva dal client è `opaquePlanId` (§10.1) — il campo qui
   *  non è mai riletto come autorità su nient'altro. */
  requestId: string;

  /**
   * SHA-256 calcolato **server-side** (§10.1) da destinazione (`ownerUid`,
   * `programId`, `importId`, `lessonId`, `publicLessonId`), quantità e
   * stato iniziale rilevante (`sourceBodyHash`, `existingItemAssetIds`
   * ordinati). Mai inviato dal client: un client che inviasse un
   * `planHash` proprio potrebbe costruirne uno che punta a una
   * destinazione diversa da quella autenticata.
   */
  planHash: string;

  // ── Stato e contenuto del piano ──

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

  /** SHA-256 del corpo lezione al momento dell'autorizzazione. Fonte
   *  autorevole: `LessonDoc.body` riletto al momento della creazione del
   *  piano, non un hash dichiarato dal client. */
  sourceBodyHash: string;

  /**
   * `assetId` delle immagini già approvate al momento dell'autorizzazione,
   * nello stesso ordine di `LessonDoc.visuals.items`. Fonte autorevole:
   * `LessonDoc.visuals`/`visual` riletto (dopo il controllo di co-presenza
   * di §6.1 — un piano non può nascere su una lezione in
   * `visual_legacy_conflict`). Usato per calcolare gli slot liberi e per
   * rilevare, alla promozione, se l'insieme è cambiato sotto al piano
   * (§10.3).
   */
  existingItemAssetIds: string[];

  /**
   * Tetto totale prenotato = 1 proposta + (`quantity.ceiling` × tentativi
   * massimi) generazioni. **Corretto rispetto alla revisione 2**: la
   * formula precedente non copriva i retry ammessi da §8.5, rendendoli
   * contraddittori con l'autorizzazione unica (§8.3, §12.1).
   */
  budgetCeiling: {
    /** Chiave di prenotazione sul ledger mensile di budget, riuso del
     *  meccanismo AIGEN esistente (`ai-content-budget/v1`) — non un
     *  meccanismo nuovo (§10.1, §12.1). */
    reservationKey: string;
    proposalCap: number;
    generationCap: number;
    /** Tentativi massimi per slot coperti da QUESTA prenotazione — deve
     *  coincidere con `VISUAL_PLAN_MAX_ATTEMPTS_PER_SLOT` al momento della
     *  creazione del piano; congelato nel documento perché un cambio
     *  futuro della costante non deve alterare retroattivamente il tetto
     *  di un piano già autorizzato. */
    maxAttemptsPerSlot: number;
    /** proposalCap + generationCap × quantity.ceiling × maxAttemptsPerSlot */
    totalReserved: number;
  };

  /** 0..ceiling elementi, popolati dopo la proposta coordinata. */
  slots: VisualPlanSlot[];

  /** Consuntivo — vedi §12. Popolato progressivamente, mai stimato due
   *  volte. Invariante verificato ad ogni scrittura: la somma dei costi
   *  reali non supera mai `budgetCeiling.totalReserved` (§8.5). */
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
```

**Un record presente ma divergente o malformato è `corrupted_state`, mai
assenza o replay.** Vale per ogni lettura di `visualPlanRuns/{opaquePlanId}`
— sia al primo tentativo di autorizzazione (§8.3) sia a un resume (§8.8).
**Corretto rispetto alla revisione 3**: il giudizio non confronta più nulla
contro una rilettura del mondo attuale (§10.1 lo vieta esplicitamente) —
solo contro la forma e l'identità persistite nel record stesso:

- il documento **non esiste** → percorso normale di creazione di un nuovo
  piano (§8.3);
- il documento esiste, **struttura valida**, i campi identità persistiti
  (`ownerUid`/`programId`/`importId`/`lessonId`/`publicLessonId`/
  `requestId`) coincidono con quelli della richiesta corrente → replay
  legittimo, nessuna nuova scrittura, il record restituito così com'è
  qualunque cosa sia successo alla lezione nel frattempo (§10.1);
- il documento esiste, **struttura valida**, ma i campi identità **non
  coincidono** con quelli della richiesta corrente → **`corrupted_state`**
  — non un'assenza silenziosa che farebbe ripartire la creazione di un
  piano duplicato sotto lo stesso `opaquePlanId` (un conflitto di
  scrittura che il codice deve poter distinguere, non nascondere), e non
  un giudizio basato su una rilettura di `LessonDoc` (che il passo sopra
  esclude per principio, §10.1);
- il documento esiste ma **non supera il validatore strutturale** (chiavi
  mancanti, unione di stato non valida, array `slots` con `slotIndex`
  duplicati) → **`corrupted_state`**, stessa ragione: un tentativo di
  "ripararlo" scrivendo sopra presupporrebbe di sapere quale parte fosse
  quella corrotta, esattamente il presupposto che §6.1 rifiuta per
  `visual_legacy_conflict`.

In ogni caso di `corrupted_state`, l'operazione richiesta si ferma, zero
scritture, e il piano non è né utilizzabile né sovrascrivibile
automaticamente — stessa disciplina fail-closed di §6.1, applicata qui al
piano invece che al manifest.

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
  attempts: number; // ≤ VISUAL_PLAN_MAX_ATTEMPTS_PER_SLOT
  lastError: 'visual_too_large' | 'provider_invalid_output' | 'transient_error' | null;
  /** Presente solo quando state === 'ready'. Stessa forma dei campi normalizzati di VE §7. */
  staged: {
    storageRef: string; // staging/{ownerUid}/{opaquePlanId}/{slotIndex}.webp
    width: number;
    height: number;
    byteLength: number;
    sha256: string;
  } | null;
  /**
   * `assetId` generato al momento della promozione (§8.6 passo 5), non
   * prima — lo staging resta chiavato per `slotIndex`, non per `assetId`,
   * finché lo slot non diventa canonico. `null` in ogni stato diverso da
   * `promoted`. Nuovo in questa revisione: è il campo che rende
   * calcolabile `promotedAssetIdsByThisPlan` (§10.1) senza dover
   * ricostruirlo da `LessonDoc.visuals` a ogni verifica.
   */
  promotedAssetId: string | null;
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
export const VISUAL_PLAN_MAX_ATTEMPTS_PER_SLOT = 2;
```

---

## 6. Compatibilità e migrazione dal manifest singolo

### 6.1 Lettura — matrice di stato completa, fail-closed sulle incoerenze

**Correzione rispetto alla revisione 2.** La versione precedente trattava
la coesistenza di `visuals` e `visual` come un caso ordinario: «`visuals`
presente → è l'unica fonte... il campo legacy, se presente, è ignorato». La
review ha respinto questo comportamento — ignorare silenziosamente un
campo presente è una scelta arbitraria su uno stato che la disciplina di
scrittura di questo contratto (§6.2) non dovrebbe mai produrre, e proprio
per questo, se si verifica comunque (edit manuale in Firestore Console, un
bug di un'implementazione futura, la scrittura di uno strumento esterno),
il contratto non può permettersi di indovinare quale dei due campi sia
quello vero.

**Procedura di lettura, in tre passi, sempre in quest'ordine:**

1. **Controllo di co-presenza, prima di qualunque validazione
   strutturale.** Se **entrambi** i campi `visuals` e `visual` esistono nel
   documento — indipendentemente dal fatto che uno, l'altro o nessuno dei
   due superi il proprio validatore strutturale — l'esito è
   **`visual_legacy_conflict`**. Non si tenta di stabilire quale sia «più
   valido»: la loro stessa coesistenza è il segnale di corruzione, non un
   dettaglio da risolvere euristicamente.
2. Se **un solo** campo è presente, si valida **quello**:
   - `visuals` presente, valido → è l'unica fonte, letta e resa così com'è;
   - `visuals` presente, **malformato** → `visuals_malformed`;
   - `visual` (singolare) presente, valido → modello di lettura compatibile
     invariato: trattato come un array a un elemento
     `{ contractVersion: 'lesson-visuals/v1', items: [adaptSingular(visual)] }`,
     calcolato **a runtime**, mai scritto — `adaptSingular` copia i campi
     1:1 e imposta `source: 'generated'`;
   - `visual` (singolare) presente, **malformato** →
     `visual_legacy_malformed` (nome invariato dalla revisione 2, §6.3).
3. Se **nessuno dei due** è presente → nessuna immagine, nessuna lettura
   aggiuntiva, percorso odierno invariato, esattamente come VE §11.

**Matrice completa** — `visuals` sulle righe, `visual` sulle colonne:

| `visuals` \\ `visual` | assente | valido | malformato |
|---|---|---|---|
| **assente** | nessuna immagine (normale) | lettura compatibile, `adaptSingular` (normale) | `visual_legacy_malformed`, fail-closed |
| **valido** | è l'unica fonte (normale, stato post-adozione) | **`visual_legacy_conflict`**, fail-closed | **`visual_legacy_conflict`**, fail-closed |
| **malformato** | `visuals_malformed`, fail-closed | **`visual_legacy_conflict`**, fail-closed | **`visual_legacy_conflict`**, fail-closed |

Le tre celle di conflitto sono deliberatamente identiche: la validità
individuale dei campi non attenua la co-presenza. Sapere che `visuals` è
strutturalmente valido non dice nulla sul **perché** `visual` esista
ancora — potrebbe essere un residuo di una scrittura fuori dalla
transazione di adozione (§6.2), che non dovrebbe mai poter accadere ma che
un contratto fail-closed non presuppone impossibile.

**Effetto di `visual_legacy_conflict` e delle forme malformate — zero
rendering automatico, zero scritture automatiche, nessuna riparazione:**

- **Lato docente.** Il renderer del manuale (scheda Contenuto) non prova a
  scegliere quale manifest rendere: **non renderizza alcuna figura**; il
  corpo Markdown resta comunque leggibile per intero (il conflitto riguarda
  solo il manifest visivo, mai il testo). La scheda «Arricchisci» (§11.1)
  mostra un banner bloccante con il codice dell'errore. Ogni azione che
  scriverebbe su `visuals`/`visual` — adozione, promozione, rimozione,
  riordino — è rifiutata con lo stesso codice, zero scritture, finché lo
  stato non è risolto.
- **Lato studente — non toccato strutturalmente da questa fase.** Lo
  studente non legge mai `LessonDoc` direttamente (legge solo
  `publicLessons`/`publicLessonVisuals`, §5.3–§5.4): un conflitto nel
  documento privato **non implica automaticamente** che la proiezione
  pubblica, scritta da una promozione precedente valida, sia anch'essa
  corrotta. La proiezione pubblica resta quindi visibile così com'è, fino
  alla successiva scrittura autorizzata su quella lezione — che però, per
  il punto sopra, non può avvenire finché il conflitto lato docente non è
  risolto. È una scelta esplicita: bloccare anche lo studente per un
  conflitto che potrebbe riguardare solo metadati di governo interni
  sarebbe una penalizzazione senza una necessità dimostrata.
- **Nessuna riparazione automatica.** Il contratto delibera di non
  specificare un meccanismo che scelga automaticamente `visuals` o `visual`
  come «quello giusto» e cancelli l'altro. Risolvere un
  `visual_legacy_conflict` richiede un intervento deliberato — lettura
  manuale di entrambi i campi, o un futuro strumento di manutenzione
  dedicato, non progettato in questo documento (§16) — prima che qualunque
  scrittura automatica possa riprendere su quella lezione.

Questo comportamento **non dipende** dal numero di lezioni in ciascuna
cella della matrice quando il codice viene distribuito: che siano zero o
migliaia, il meccanismo è lo stesso, valutato una lezione alla volta
(§1.1).

### 6.2 Scrittura — adozione pigra, atomica, irreversibile in forma

La prima volta che una lezione con manifest singolo riceve **una seconda
immagine**, o comunque la prima scrittura sotto il contratto MULTI-VISUAL,
la transazione di promozione (§8.6) esegue un passo di **adozione**:

0. **applica prima il controllo di co-presenza di §6.1.** Se lo stato è
   `visual_legacy_conflict`, `visuals_malformed` o `visual_legacy_malformed`,
   l'intera operazione — non solo l'adozione — si ferma qui, **zero
   scritture**, con quel codice tipizzato restituito al chiamante. Il resto
   dei passi sotto presuppone che questo controllo sia già passato;
1. rilegge `LessonDoc`. Se `visuals` è già presente (e valido, per il passo
   0), l'adozione è già avvenuta: salta questo passo (idempotenza);
2. se `visual` (singolare) è presente e valido e `visuals` è assente,
   costruisce `items[0] = adaptSingular(visual)`;
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

**L'adozione rifiuta gli stati incoerenti, non li ripara.** Il passo 0 non
è una formalità aggiunta in coda: è la ragione per cui l'adozione non può
mai trasformarsi in uno strumento di risoluzione dei conflitti. Un
`LessonDoc` in stato `visual_legacy_conflict` **non** viene "sistemato"
scegliendo `visuals` o `visual` e scrivendo comunque — l'intera famiglia di
operazioni (adozione compresa) resta bloccata finché il conflitto non è
risolto da un intervento deliberato, esterno a questo flusso (§6.1).

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
- **Fail-closed su forma inattesa — l'intera matrice di §6.1, non solo il
  caso singolare.** Se `LessonDoc.visual` esiste ma non supera il
  validatore strutturale di VE, l'adozione fallisce con
  `visual_legacy_malformed`. Se `LessonDoc.visuals` esiste ma non supera il
  proprio validatore, fallisce con `visuals_malformed`. Se **entrambi**
  esistono, fallisce con `visual_legacy_conflict`, indipendentemente dalla
  validità di ciascuno (§6.1). In ogni caso: **zero scritture**, e
  l'operazione richiesta dal docente (aggiungere un'immagine) resta
  bloccata finché lo stato non è risolto — mai un'adozione che scarta
  silenziosamente campi che non capisce, mai una scelta automatica fra due
  campi presenti.
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

### 7.2 Verifica all'uso — due momenti diversi, due esiti diversi

**Correzione rispetto alla revisione 2.** La versione precedente applicava
la stessa politica di coda (VE §5.3) sia alla promozione sia al rendering
successivo, come se fossero lo stesso rischio. Non lo sono, e la review lo
ha respinto correttamente: **durante la promozione**, un indice fuori
range o un testo divergente significa che il corpo è cambiato *dopo* la
pianificazione e *prima* che l'immagine sia mai entrata nella lezione — non
c'è ancora nulla da salvare in coda, e promuovere comunque scriverebbe
un'ancora scelta su un corpo che non esiste più. **Dopo** una promozione
già avvenuta, invece, un'ancora valida al momento della promozione che
smette di risolvere perché il docente ha poi rinominato l'heading è
esattamente il caso per cui la coda di VE §5.3 esiste — lì l'immagine è già
pagata e già nella lezione, e la coda è ciò che evita di perderla. Sono due
momenti diversi con due esiti diversi, e il contratto ora li tiene distinti
esplicitamente.

#### 7.2.1 Alla promozione (§8.6) e al riancoraggio — fail-closed, zero scritture

Ogni punto che consuma un `VisualAnchorSelector` **per scrivere** (la
promozione di uno slot, §8.6; il riancoraggio, invariato da VE-04A)
esegue, server-side, sul corpo **fresco**:

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
   scelta e il commit), l'esito è **fail-closed**: errore tipizzato
   `visual_promotion_anchor_stale`, **zero scritture**. Lo slot **non**
   viene promosso in coda «per sicurezza»: resta nello stato in cui era
   (`ready` per una promozione, invariato per un riancoraggio), il costo
   già sostenuto per generarlo non è perso, e il docente può scegliere
   un'ancora diversa fra gli heading **attuali** (una nuova selezione,
   stesso `VisualAnchorSelector`, zero rigenerazione, zero nuovo costo) e
   ritentare la promozione.
5. **solo se entrambe le verifiche passano**, lo slug viene calcolato
   dall'helper condiviso (`@schoolforge/lesson-contract`, riusato sia dal
   web sia dalle Functions, come da VE-04A) e **quello** — non l'indice,
   non il testo grezzo — è ciò che finisce in
   `LessonVisualAnchor.headingSlug` (§5.1).

**Perché due verifiche indipendenti quando il passo 1 di §8.6 ha già
confrontato `sourceBodyHash`.** Se `sourceBodyHash` coincide, l'elenco
enumerato è per costruzione identico a quello visto in pianificazione, e
indice+testo *devono* concordare — la verifica di questo paragrafo non
troverebbe mai una divergenza in quel caso. Il controllo resta comunque
**non ridondante quanto sembra**: le due verifiche sono due implementazioni
indipendenti dello stesso fatto («il corpo è lo stesso»), e se mai
disaccordassero nonostante `sourceBodyHash` invariato, quel disaccordo
sarebbe la prova di un bug (per esempio un hash calcolato sul campo
sbagliato) che merita di fallire rumorosamente qui, non di essere mascherato
da un secondo controllo che si limita a confermare il primo.

#### 7.2.2 Dopo una promozione valida — la coda resta l'unica politica corretta

Un'ancora **già persistita** come `LessonVisualAnchor.headingSlug` (§5.1) —
cioè un'immagine già promossa, già nella lezione — che smette di risolvere
perché un heading successivo è stato rinominato o rimosso **non** rientra
in §7.2.1: nessuna scrittura è in corso in quel momento, è un fatto del
rendering. Questo caso resta la coda di VE §5.3, generalizzata per elemento
in §7.7, invariata da questa revisione: l'immagine va in fondo alla
lezione, `anchorResolved: 'fallback'` a runtime, mai persistito, mai
eliminata automaticamente.

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

### 7.4 Diversità didattica del piano — vieta l'idea duplicata, non l'ancora condivisa

**Correzione rispetto alla revisione 2.** La versione precedente vietava
strutturalmente due slot con lo stesso `anchorHeadingIndex`, trattando
«stesso heading» come sinonimo di «stessa idea». La review lo ha respinto
con una prova concreta: il prototipo stesso (galleria a due immagini,
`page-teacher-2`) mostra legittimamente due figure ancorate a «Il bilancio
idrico» — una che illustra la precipitazione sul rilievo, l'altra una
fotografia del ruscellamento reale, due idee distinte che condividono la
stessa sezione perché è lì che entrambe sono utili al lettore. Vietare
questo caso per costruzione avrebbe reso il contratto in contraddizione
con il proprio prototipo. Il mandato vieta **due immagini sulla stessa
idea**, non due immagini sullo stesso heading: la correzione allinea il
vincolo a quello che dice davvero.

Questo documento **non** introduce un rilevatore di similarità semantica
(embedding, seconda chiamata a un modello di confronto): resterebbe un
meccanismo nuovo, probabilistico, e un punto di fallimento silenzioso in
più — quel limite, dichiarato nella revisione precedente, resta valido e
non è ciò che questa correzione cambia. Cambia **su che cosa** il vincolo
strutturale disponibile agisce:

- **`anchorHeadingIndex` NON è più, da solo, un blocco.** Due o tre slot
  possono legittimamente condividere la stessa ancora nella stessa
  proposta coordinata — è il caso normale di due idee distinte sulla
  stessa sezione, non un'eccezione da aggirare.
- **`subject` deve essere a due a due distinto**, dopo normalizzazione
  (trim, minuscolo, spazi collassati), **indipendentemente dall'ancora**:
  due soggetti quasi identici sono la stessa idea duplicata, che condividano
  l'ancora o meno.
- **`rationale` (l'utilità didattica dichiarata) deve essere a due a due
  distinto**, con la stessa normalizzazione — nuovo controllo di questa
  revisione, indipendente da `subject`: due soggetti descritti con parole
  diverse ma la stessa utilità dichiarata («mostra il ciclo dell'acqua»
  ripetuto identico su due slot) sono comunque il segnale di un'idea
  duplicata che il solo confronto su `subject` potrebbe non cogliere.
  Qualunque violazione di questi due controlli lessicali produce
  `provider_invalid_output`, prima di qualunque persistenza — la stessa
  disciplina della revisione precedente, solo senza il terzo controllo,
  ormai rimosso, sull'ancora.
- **Istruzione di prompt, non vincolo strutturale**: la proposta coordinata
  istruisce esplicitamente il modello a proporre più immagini sulla stessa
  ancora **solo** quando illustrano idee genuinamente distinte, e a non
  usare uno heading condiviso come scorciatoia per riempire slot con
  variazioni minime della stessa immagine. È un'istruzione, non un vincolo
  verificabile automaticamente — il limite dichiarato sotto.

**Limite dichiarato di questo vincolo** (§17): i controlli lessicali su
`subject` e `rationale` impediscono i duplicati *strutturali* (stesso
punto, stesso soggetto o la stessa utilità dichiarata con le stesse
parole), non ogni possibile sovrapposizione semantica più sottile (due
soggetti descritti con parole del tutto diverse che illustrano comunque lo
stesso concetto). È un compromesso esplicito fra rigore e semplicità del
meccanismo, non un rilevamento di duplicati risolto in generale.

**La revisione del piano (§8.4) resta il backstop reale, e non costa
nulla.** Prima che una sola immagine venga generata, il docente vede tutti
gli slot proposti insieme, side by side, comprese le rispettive ancore e
utilità dichiarate: un duplicato che i controlli lessicali non hanno colto
è visibile a occhio in quel momento, e abbandonare uno slot lì è gratuito
(§8.4) — a differenza di scoprire il duplicato dopo aver già speso la
generazione.

**Fuori dal perimetro della proposta coordinata**, questi controlli **non
si applicano**: un'immagine caricata dal docente può condividere l'ancora
(e persino il soggetto dichiarato) con un'immagine generata, perché in quel
caso la scelta è dichiaratamente del docente, non un artefatto di una
singola chiamata automatica (§7.5, invariato).

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
       │ fino a VISUAL_PLAN_MAX_ATTEMPTS_PER_SLOT tentativi
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

#### 8.4.1 Realizzazione server MULTI-VISUAL-04

`aiVisualPlanEditSlot` è la sola porta di scrittura per questa revisione. Il
payload è una unione chiusa:

```ts
type VisualPlanEditSlotInput =
  | { requestId; editRequestId; programId; importId; lessonId; slotIndex;
      abandon: false; subject; caption; altText;
      anchorHeadingIndex; anchorHeadingText }
  | { requestId; editRequestId; programId; importId; lessonId; slotIndex;
      abandon: true };
```

La transazione rilegge `settings/owner`, piano, lease, `LessonDoc` e
`publicLessons` e confronta il corpo fresco con `sourceBodyHash`; l'ancora è
risolta contro gli heading freschi indice+testo. È modificabile soltanto uno
slot `decision:'image'` ancora `pending` di un piano `proposed`: nessuno stato
`generating|ready|failed|promoted|abandoned` può essere resuscitato o
riscritto. Subject/caption/altText riusano i limiti VE e la modifica deve
preservare la diversità fra slot; `rationale`, attempts, staged, promozione e
settlement restano immutati.

`editRequestId` ha un record opaco server-only in `visualPlanSlotEdits`.
Replay identico restituisce il piano corrente con zero scritture; riuso dello
stesso id con identità o contenuto diversi fallisce chiuso. L'abbandono
riconcilia soltanto la prenotazione master già esistente alla capacità residua
e chiude il lease se era l'ultimo slot pending: non crea prenotazioni di fase,
non invoca provider e non genera alcun costo IA.

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
  (fino a `VISUAL_PLAN_MAX_ATTEMPTS_PER_SLOT = 2` tentativi
  totali, **già inclusi nel tetto autorizzato una sola volta all'inizio**,
  §5.5, §12.1 — nessuna nuova conferma di costo, nemmeno al secondo
  tentativo), e non tocca né il canonico esistente della lezione (se
  quell'immagine sta sostituendo un'immagine già approvata) né gli altri
  slot del piano.
- **Oltre il tetto di tentativi, lo slot è terminale per questo piano —
  correzione esplicita rispetto alla revisione 2.** La versione precedente
  proponeva, a questo punto, «una propria, singola conferma di costo
  aggiuntiva limitata a quel solo slot»: la review l'ha respinta
  correttamente, perché è una seconda autorizzazione economica dentro lo
  stesso piano, esattamente ciò che il principio di autorizzazione unica
  (§2, §8.3) vieta. La regola corretta, congelata: **un ulteriore
  tentativo su quello slot non è possibile all'interno di questo piano, in
  nessuna forma.** Lo slot resta `failed`, contribuisce alla derivazione
  dello stato del piano (§8.7) come se fosse stato abbandonato, e l'unico
  modo per riprovare quell'immagine è chiudere questo piano (che sia
  `completed`, `partially_completed` o esplicitamente abbandonato, §8.7) e
  avviarne uno **nuovo** dallo stesso selettore di quantità di §8.2 — con
  la propria, singola, piena autorizzazione iniziale (§8.3), non una
  conferma parziale. Non è un'eccezione al principio di autorizzazione
  unica: è la sua applicazione più stretta possibile.

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
4. rilegge (o adotta, §6.2) `LessonDoc.visuals`; verifica che l'insieme di
   `assetId` presenti coincida esattamente con `expectedLiveAssetIds` del
   piano (§10.1.1) — disallineamento ⇒ **`visual_plan_external_mutation`**,
   zero scritture, slot ancora `ready`; applica poi la modalità all'array
   fresco — fail-closed `visual_slot_full` se non c'è più spazio,
   `visual_replace_target_missing` se l'`assetId` da sostituire non esiste
   più;
5. copia i byte dallo staging al percorso canonico `storageRef` del nuovo
   `assetId`;
6. scrive `LessonDoc.visuals` con l'array risultante;
7. **se e solo se** `completed === true`: scrive `publicLessons.visuals` e
   aggiorna `publicLessonVisuals/{id}` — imposta/conferma
   `publicLessonId`/`programId`/`importId` (§5.4, invariati se il
   documento esiste già) e scrive `bytes[assetId]` con `dataUri`,
   `mimeType` **e** `width`/`height` copiati dallo stesso manifest appena
   scritto, mai ricalcolati una seconda volta — in `replace`, la stessa
   scrittura rimuove anche la chiave del vecchio `assetId`;
8. elimina lo staging di quello slot e, in `replace`, pianifica (dopo il
   commit) la cancellazione del vecchio oggetto Storage canonico;
9. aggiorna `VisualPlanRun.slots[slotIndex].state = 'promoted'`,
   `slots[slotIndex].promotedAssetId = assetId` (§10.1.1 — è questo campo
   che rende calcolabile `promotedAssetIdsByThisPlan` senza rileggere
   `LessonDoc`) e `settlement.slots[slotIndex]` con il costo reale
   registrato;
10. registra l'audit `lesson.visualApproved` con `mode`, `assetId`,
    posizione e conteggio totale.

I passi 6–7 restano nella stessa transazione (stessa disciplina di
`setLessonCompleted`, riusata da VE §6.2). I passi 5 e 8 toccano Storage e
non sono transazionali con Firestore: un fallimento lascia al più un blob
canonico orfano.

### 8.7 Stato del piano — derivato, mai scritto direttamente da un'azione singola

`VisualPlanRun.status` è ricalcolato a ogni transizione di slot. Uno slot è
**terminale** quando è `promoted`, `abandoned`, oppure `failed` avendo
esaurito `VISUAL_PLAN_MAX_ATTEMPTS_PER_SLOT` tentativi (§8.5) — questi tre
casi sono equivalenti ai fini della derivazione dello stato del piano,
anche se restano distinguibili nel consuntivo (§12) e nell'audit.

- `completed`: **ogni** slot con `decision: 'image'` è `promoted` — nessuno
  scartato, nessuno esaurito;
- `partially_completed`: **almeno uno** slot è `promoted` e **almeno uno**
  slot terminale non è `promoted` (abbandonato o esaurito) — il piano ha
  prodotto *qualcosa*, ma non tutto ciò che aveva proposto;
- `abandoned`: **nessuno** slot è `promoted` e tutti gli slot sono
  terminali — sia perché il docente ha chiuso esplicitamente il piano
  prima di promuovere alcunché (gli slot `ready` non ancora approvati
  vengono scartati **con una conferma esplicita**, stessa disciplina di
  abbandono di VE §6.4: «Le immagini generate in questo piano verranno
  eliminate. Nessuna è stata applicata alla lezione.»), sia perché **tutti
  gli slot hanno esaurito i tentativi senza che il docente ne abbia
  promosso alcuno** — nessuna immagine è entrata nella lezione in entrambi
  i casi, ed è questo che conta per lo stato del piano, non la ragione
  specifica per cui ciascuno slot non è arrivato a `promoted`;
- `expired`: TTL 24 h raggiunto senza che il piano abbia raggiunto uno
  stato terminale — stessa politica di cleanup dello staging di VE.

Un piano il cui ultimo slot diventa terminale senza un'azione esplicita del
docente (per esempio, l'ultimo tentativo di generazione fallisce da solo)
transita automaticamente allo stato derivato corrispondente (`completed`,
`partially_completed` o `abandoned` secondo le regole sopra) — non resta
mai bloccato in uno stato intermedio in attesa di un'azione che nessuno
slot richiede più.

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

#### 8.8.1 Realizzazione MULTI-VISUAL-03B

L'esecuzione usa un record server-only deterministico per `(opaquePlanId,
slotIndex)`. Un run `pending` o `uncertain` non autorizza mai una nuova
chiamata provider; soltanto un run `failed`, identico per piano, subject e
numero di tentativi, può usare il secondo tentativo già compreso nel tetto
master. Lo staging è sempre
`staging/{ownerUid}/{opaquePlanId}/{slotIndex}.webp`: il retry sostituisce
solo i byte dello stesso slot e non tocca gli altri.

Due fallimenti sono terminali anche prima del secondo tentativo:
`uncertain_outcome` (provider o save potenzialmente avvenuti senza una prova
autorevole dell'esito) e `staging_conflict` (percorso create-only occupato da
byte divergenti). Entrambi rimuovono dal master i cap non più spendibili; il
primo riconcilia conservativamente il solo cap corrente, il secondo resta
fail-closed. Soltanto l'esito provider **esplicito** `pre_invocation` è
ritentabile a costo zero; un'eccezione inattesa non dimostra che la rete non
sia stata raggiunta e viene classificata `invocation_unknown`.

La reservation master non passa mai a `pending` durante una chiamata
immagine. Prima del provider il server separa unicamente il cap del
tentativo in una reservation di fase deterministica e lascia il resto
`reserved`; soltanto la fase diventa `pending`. Il clock viene ricampionato
dopo provider e Storage. Un `invocation_unknown`, una finalizzazione persa o
una scadenza possono quindi riconciliare al massimo **quel singolo cap**,
mai tutti i cap residui del piano, e il relativo slot non può spendere di
nuovo.

La promozione usa un record server-only di recovery a forma chiusa che lega
`promotionRequestId`, modalità, eventuale target sostituito, `assetId` e
percorso canonico. Il preflight è read-only; soltanto dopo corpo, ancora,
manifest live ed `expectedLiveAssetIds` coerenti il record passa a
`prepared` e avviene la copia create-only. Un replay riusa lo stesso
`assetId`; una collisione è recuperabile soltanto se i byte coincidono per
lunghezza e SHA-256. Il commit rilegge recovery, piano, lease, lezione,
proiezione, byte pubblici e promozioni precedenti prima di ogni scrittura.
Il massimo danno delle finestre Storage/Firestore resta un blob canonico
orfano descritto dal recovery, mai una proiezione pubblica incoerente.
I registri di promozione persistono inoltre una `sequence` contigua: è
quell'ordine di commit, non `slotIndex`, a ricostruire correttamente
`expectedLiveAssetIds` quando sostituzioni dipendenti avvengono fuori ordine.
Il replay della promozione non si fida del solo registro: rilegge LessonDoc,
proiezione, byte pubblici, tutti i registri promossi e gli oggetti Storage
canonici; verifica identità, ordine, manifest privato/pubblico e byte contro
lo slot promosso. Una rimozione o mutazione successiva è conflitto/corruzione,
mai un falso replay riuscito e mai una riparazione silenziosa.

**Confine di fase:** riordino, rimozione, cleanup TTL/bulk e lifecycle
editoriale restano MULTI-VISUAL-03C; nessuna UI è introdotta da 03B.

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

### 8.12 Cleanup per cancellazione lezione/UDA/corso — generalizzazione di `aiVisualCleanupForDelete`

**Nuovo in questa revisione.** VE-03B stabilisce un cleanup bulk per la
cancellazione di lezione/UDA/corso, con un record di recovery
`{ ownerUid, programId, importId, lessonId, publicLessonId, udaDir,
assetId, storageRef, createdAt }` per **un** asset. Questo paragrafo lo
generalizza a L lezioni, ciascuna con 0..3 asset, mantenendo intatta la
disciplina di VE-03B (letture prima delle scritture, record di recovery
persistito prima della delete Storage, record malformato fail-closed) e
correggendo solo la cardinalità.

#### 8.12.1 Record di recovery — un record per lezione, non per asset

```ts
export interface VisualCleanupRecoveryRecord {
  ownerUid: string;
  programId: string;
  importId: string;
  lessonId: string;
  publicLessonId: string;
  udaDir: string;
  /** 1..3, stesso ordine di `LessonDoc.visuals.items` al momento della
   *  lettura che ha preceduto la cancellazione. */
  assetIds: string[];
  /** Stessa lunghezza e stesso ordine di `assetIds` — un percorso
   *  canonico per asset, mai un prefisso. */
  storageRefs: string[];
  createdAt: Timestamp;
}
```

**Perché un record per lezione e non uno per asset.** Un record per asset
moltiplicherebbe le scritture Firestore per N senza alcun beneficio: tutti
gli asset di una stessa lezione condividono lo stesso destino (la lezione
sta per sparire) e lo stesso momento di lettura. Un array dentro un unico
record mantiene il conteggio delle scritture Firestore **indipendente da
N** (§12.6) — solo il numero di cancellazioni Storage cresce con N, non il
numero di record.

#### 8.12.2 Letture prima delle scritture, per ciascuna lezione del gruppo

Per ogni lezione coinvolta in una cancellazione lezione/UDA/corso:

1. **rilettura** di `LessonDoc.visuals`/`visual` con lo stesso controllo di
   co-presenza di §6.1. Se lo stato è `visual_legacy_conflict`,
   `visuals_malformed` o `visual_legacy_malformed`, **quella lezione**
   fallisce con lo stesso codice, **zero rimozioni di riferimenti e zero
   cancellazioni Storage per quella lezione** — il resto del gruppo
   procede indipendentemente (un conflitto di dati corrotti non deve
   bloccare la cancellazione delle altre lezioni, né essere ignorato
   silenziosamente per quella incriminata);
2. se la lezione ha 0 asset (nessun `visuals`/`visual`), nessuna riga di
   questa procedura la riguarda: il resto della cancellazione (testo,
   metadati) procede per la sua strada già stabilita, fuori da questo
   contratto;
3. se la lezione ha 1..3 asset validi, si costruisce il
   `VisualCleanupRecoveryRecord` di §8.12.1 dai dati appena letti;
4. **nella stessa transazione**: si scrive il record di recovery, si
   rimuovono i riferimenti Firestore (chiavi da
   `publicLessonVisuals.bytes`, elemento da `publicLessons.visuals.items`,
   elemento da `LessonDoc.visuals.items` — o l'intero campo se era l'unico
   asset, §6.4) — **prima** di toccare Storage;
5. **dopo** il commit, si cancellano **solo** gli `storageRefs` dimostrati
   dal record appena scritto — mai un'enumerazione, mai un prefisso, un
   `delete` esplicito per ciascun percorso.

#### 8.12.3 Perché mai un delete per prefisso, a livello di lezione o di UDA

Il percorso Storage canonico è
`repository/{ownerUid}/{importId}/{udaDir}/visuals/{assetId}.webp` (VE
§4): **tutte le lezioni della stessa UDA condividono la stessa cartella
`visuals/`**, distinte solo dal nome file (`assetId`). Questo rende un
delete per prefisso a livello di UDA **tecnicamente possibile** ma
**contrattualmente vietato** in questo documento, con un'unica eccezione:

- **cancellazione lezione** (la UDA sopravvive): mai un prefisso —
  cancellerebbe anche gli asset delle lezioni sorelle nella stessa cartella
  `visuals/`. Solo gli `storageRefs` dimostrati per **quella** lezione
  (§8.12.2).
- **cancellazione UDA** (L lezioni, la UDA sparisce): **ancora nessun
  prefisso**, per lo stesso principio di dimostrazione esplicita — anche
  se l'intera cartella `visuals/` sta per sparire, ogni lezione della UDA
  attraversa comunque §8.12.2 individualmente, in blocchi (§8.12.4). La
  ragione non è tecnica ma di auditabilità: un prefix-delete non produce
  un record verificabile di *quali* asset sono stati cancellati, mentre
  l'enumerazione esplicita sì — e un bug che allargasse per errore il
  prefisso (per esempio un `importId` calcolato male) a UDA sarebbe un
  incidente silenzioso, mentre lo stesso bug su un'enumerazione esplicita
  fallirebbe rumorosamente (percorsi non trovati, non un prefisso troppo
  ampio cancellato per intero).
- **cancellazione corso/import**: **qui, e solo qui**, resta autorevole
  `deleteImportPrefix` (SGW-02A), già stabilito da VE e non toccato da
  questo contratto — l'intero prefisso dell'import, comprese tutte le
  cartelle `visuals/` di tutte le sue UDA, viene rimosso come blob Storage
  senza richiedere un'enumerazione preventiva dei riferimenti Firestore
  (che sono comunque cancellati a parte, dalla cancellazione del corso
  stessa). Nessuna cancellazione aggiuntiva da progettare a questo livello
  — invariato da VE §1.

#### 8.12.4 Chunking, replay, record malformato

- **Chunking**: stesso limite di VE-03B, ≤ 100 lezioni per gruppo di
  esecuzione. Una cancellazione UDA/corso con più di 100 lezioni procede a
  blocchi, ciascuno con la propria transazione per lezione (§8.12.2) — non
  una transazione unica per l'intero gruppo.
- **Replay**: un retry dopo un commit Firestore riuscito ma prima che la
  delete Storage sia confermata trova il record di recovery già scritto e
  ripete **solo** la cancellazione Storage sugli `storageRefs` già lì
  dichiarati — mai una seconda lettura di `LessonDoc`, che a quel punto
  potrebbe già riflettere la cancellazione della lezione stessa.
- **Record malformato**: un `VisualCleanupRecoveryRecord` che non supera il
  validatore strutturale (lunghezze di `assetIds`/`storageRefs` diverse,
  percorso fuori forma) è `corrupted_state` — stessa disciplina di §5.5:
  non si tenta la cancellazione sulla base di un record di cui non ci si
  può fidare. Lo stato tollerato è un blob Storage orfano (recuperabile in
  futuro), mai un delete costruito su dati non verificati.

#### 8.12.5 Costo — formule, non un numero fisso

```
cancellazione lezione, N asset (N = 0..3):
  Firestore: 7R + 5W   — INVARIATO rispetto al baseline misurato di VE-03
                          (§12.8), indipendente da N: un solo LessonDoc,
                          un solo publicLessons, un solo byte doc, un solo
                          record di recovery, qualunque sia N
  Storage:   N delete  — 0 se N=0, fino a 3

cancellazione UDA, L lezioni, N_i asset ciascuna (i = 1..L):
  Firestore: L × (7R + 5W)     — lineare, coerente col baseline misurato
                                  VE-03 di 3 lezioni monoimmagine
                                  (21R/15W, cioè 7R/5W per lezione)
  Storage:   Σ(i=1..L) N_i delete

cancellazione corso/import:
  fuori da questo conteggio — `deleteImportPrefix` (SGW-02A) resta
  autorevole e non enumera asset per asset (§8.12.3)
```

**Etichettatura esplicita, per §12.8**: la parte Firestore di queste
formule è **misurata** (eredita byte per byte il baseline di VE-03 per
N=1, mai riverificato per N=2,3 in questo documento). La parte Storage è
aritmetica diretta (un delete per asset dimostrato), non una stima nel
senso di un'incognita — ma **nessuna** di queste righe è stata eseguita
contro un Emulator in questa fase: sono derivazioni, non misure (§12.8,
§19).

#### 8.12.6 Test obbligatori — lezione, UDA, corso, legacy, array, stato corrotto

Elencati per esteso in §19; qui il loro scopo: verificare che il
conteggio Firestore resti costante al variare di N (non che sia
"probabilmente" costante), che una lezione in stato incoerente (§6.1)
fermi **solo se stessa** dentro una cancellazione UDA più ampia, che una
lezione ancora in forma singolare (non adottata) sia cancellata
correttamente attraverso lo stesso percorso di `adaptSingular` usato dalla
lettura (§6.1) senza richiedere un'adozione preventiva, e che nessun delete
per prefisso compaia mai nei log di una cancellazione lezione/UDA.

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
sun campo di testo libero. La forma completa del run che porta questi
campi, il suo ciclo di vita e la sua idempotenza sono specificati in
§9.6–§9.9 — **nuovi in questa revisione**, perché la revisione 3 descriveva
byte e normalizzazione senza mai definire un contratto di replay per
l'upload, a differenza del piano.

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

### 9.6 `VisualUploadRun` — ciclo di vita indipendente dal piano

**Nuovo in questa revisione.** L'upload **non** è uno slot di
`VisualPlanRun`: ha un'autorizzazione economica diversa (zero, §9.5) e un
ciclo di vita più semplice, e mescolarlo dentro il piano avrebbe costretto
il piano — che *ha* un tetto da rispettare — a contabilizzare operazioni
che non costano nulla. Resta però un documento server-only con lo stesso
rigore di idempotenza del piano, non una scrittura diretta:

```ts
export interface VisualUploadRun {
  contractVersion: 'visual-upload/v1';

  // ── Identità — stessa disciplina di VisualPlanRun (§5.5): fonte
  //    autorevole, mai il payload nudo ──
  ownerUid: string;
  programId: string;
  importId: string;
  lessonId: string;
  publicLessonId: string;
  udaDir: string;

  /** UUID v4, client, stabile fra i retry. */
  requestId: string;

  status: 'accepted' | 'ready' | 'promoted' | 'abandoned' | 'expired' | 'failed';

  /** SHA-256 del corpo lezione al momento dell'upload. Stessa funzione di
   *  VE §8.2/§7.2.1: protegge l'integrità dell'ancora scelta, non la
   *  fedeltà del contenuto — un file caricato non deriva dal testo
   *  (§5.1, nota su `sourceBodyHash` per `source: 'uploaded'`). */
  sourceBodyHash: string;

  /** Ancora scelta dal docente, stessa forma del piano (§7.1). */
  anchor: VisualAnchorSelector;

  /** Hash e dimensione dei byte GREZZI, prima di qualunque decodifica —
   *  usati esclusivamente per il controllo di conflitto (§9.7), mai per
   *  l'identità finale dell'asset (quella è `normalized.sha256`, dei byte
   *  canonici, coerente con VE §4). */
  rawBytesSha256: string;
  rawByteLength: number;

  /** Popolato dopo la normalizzazione (§9.2), `null` prima. */
  normalized: {
    storageRef: string; // staging/{ownerUid}/{opaqueUploadRunId}.webp
    width: number;
    height: number;
    byteLength: number;
    sha256: string; // dei byte CANONICI
  } | null;

  caption: string | null;
  altText: string | null;

  lastError:
    | 'visual_upload_too_large'
    | 'visual_upload_unsupported_format'
    | 'visual_upload_conflict'
    | null;

  createdAt: Timestamp;
  updatedAt: Timestamp;
  /** TTL 24 h, stesso di VE — invariato indipendentemente dal fatto che
   *  l'upload non abbia un costo provider da proteggere: lo staging
   *  occupa comunque Storage e va ripulito. */
  expireAt: Timestamp;
}
```

**Percorso**: `visualUploadRuns/{opaqueUploadRunId}`,
`opaqueUploadRunId = SHA-256(canonical(['visual-upload/v1', ownerUid, requestId]))`
— namespace distinto da `visual-plan/v1`, `visual-plan-slot/v1` e da
`visual-enrichment/v1` di VE, per la stessa ragione di VE §8.1: un
`requestId` non deve poter collidere fra domini diversi.

### 9.7 Idempotenza, replay, conflitto

**Risposta persa, stesso file.** Il client ripete con lo stesso
`requestId` **e** lo stesso file (`rawBytesSha256` identico). Il server
trova `VisualUploadRun`, riconosce lo stesso hash grezzo, e restituisce lo
stato già raggiunto — **senza ripetere la normalizzazione**: se
`normalized` è già popolato, quei byte sono quelli restituiti, non
ricalcolati una seconda volta. È lo stesso principio di replay del piano
(§10.1), applicato qui per evitare di spendere due volte CPU di
normalizzazione, non budget economico (che l'upload non ha).

**Conflitto — stesso `requestId`, file o ancora diversi.** Se un retry
arriva con lo stesso `requestId` ma `rawBytesSha256` **diverso** (il
docente ha scelto un file diverso senza che il client generasse un nuovo
`requestId`), oppure con lo stesso `requestId` ma un `VisualAnchorSelector`
diverso da quello già registrato, l'esito è **`visual_upload_conflict`**,
fail-closed, zero scritture sopra il run esistente. Un `requestId` è un
identificatore di **tentativo**, non un contenitore riusabile per intenti
diversi: sovrascrivere silenziosamente violerebbe la stessa disciplina che
protegge il piano da una doppia spesa, qui applicata a evitare uno stato
ambiguo («a quale file si riferisce davvero questo `requestId`?»). Il
client che vuole davvero cambiare file genera un nuovo `requestId`.

**Un record presente ma malformato o con identità divergente è
`corrupted_state`**, stessa disciplina di §5.5 e §10.1: mai trattato come
assenza (rifarebbe la normalizzazione) né come replay di un contenuto che
non è mai stato verificato.

### 9.8 Promozione — riuso diretto di §8.6, non una seconda procedura

Un `VisualUploadRun` in stato `ready` si promuove **con la stessa
procedura di §8.6**, passo per passo, senza duplicarla: la promozione non
distingue "slot di piano" da "run di upload" se non nella provenienza dei
dati che legge (da `VisualPlanRun.slots[i]` o da `VisualUploadRun`) — tutto
il resto (rilettura di `LessonDoc`, verifica `sourceBodyHash`, risoluzione
dell'ancora fresca §7.2.1, verifica dei byte staged, copia su Storage
canonico, scrittura transazionale, proiezione pubblica se svolta) è
**identico**. Il manifest privato risultante (`LessonVisualItem`, §5.1)
porta `source: 'uploaded'` e `styleVersion: 'uploaded/v1'` — gli unici due
campi che distinguono un'immagine caricata da una generata, coerente con
§5.1 e §13.

**Il cap combinato di tre resta un solo contatore, indipendente dalla
provenienza.** La verifica `items.length < 3` (o `visual_slot_full`) di
§8.6 passo 4 legge sempre l'array **fresco** di `LessonDoc.visuals`, non un
contatore separato per «slot di piano» e «upload»: se un piano ha già due
immagini pronte per la promozione e il docente carica un file mentre il
piano è ancora in corso, **chi promuove per primo** occupa il terzo slot —
Firestore serializza le due transazioni sullo stesso documento, e la
seconda a committare, qualunque sia la sua provenienza, vede l'array
aggiornato e riceve `visual_slot_full` se non c'è più spazio. Nessuna
riserva di slot per provenienza, nessuna priorità: primo a scrivere,
primo servito.

**L'upload non partecipa al lease del piano (§10.3).** Il lease
serializza i **piani**, perché solo un piano ha un'autorizzazione
economica da proteggere da una doppia prenotazione. Un upload può
procedere in parallelo a un piano attivo sulla stessa lezione, esattamente
come già dichiarato in §11.5 — la sicurezza della scrittura finale non
dipende dal lease ma dalla rilettura transazionale di §8.6, che si applica
a entrambe le provenienze allo stesso modo.

### 9.9 Abbandono e cleanup

**Abbandono.** Un `VisualUploadRun` non ancora promosso può essere
scartato: elimina lo staging, marca `status: 'abandoned'`. A differenza
dell'abbandono di un piano (§8.7), **non richiede la stessa conferma
esplicita bloccante**: non c'è una spesa reale da proteggere (§9.5), solo
il tempo di normalizzazione server-side già speso, che viene comunque
scartato pulendo lo staging. L'interfaccia può comunque avvisare
(«il file caricato verrà scartato»), ma non è un invariante di prodotto
allo stesso livello di VE §6.4.

**Cleanup TTL.** Un `VisualUploadRun` mai promosso che raggiunge
`expireAt` (24 h) segue la stessa politica di cleanup dello staging
scaduto del piano (§8.7, §12.7): `status: 'expired'`, delete dello
staging.

**Zero Storage diretto lato client, in ogni fase.** Il client non scrive
mai direttamente su un bucket Storage: i byte grezzi viaggiano nel payload
della callable di upload (§9.2), che li normalizza e li scrive lato
server. Non esiste un URL di upload firmato, non esiste un percorso
Storage scrivibile dal client — stessa disciplina già in vigore per ogni
altra scrittura Storage di questo contratto (§8.6, §8.12).

---

## 10. Idempotenza e corse

### 10.1 Il piano come unità di idempotenza — identità della richiesta separata dalle guardie sul mondo mutabile

**Correzione rispetto alla revisione 3.** La versione precedente
ricalcolava `planHash` dallo stato **attuale** della lezione a ogni
replay dell'autorizzazione — inclusi `existingItemAssetIds` letti di
nuovo, ora. Questo rompe il caso più comune di tutti: dopo che lo stesso
piano ha promosso il suo primo slot (§8.6), l'elenco `LessonDoc.visuals`
**cambia legittimamente**, perché la promozione è esattamente l'effetto
voluto del piano. Un refresh di pagina o una risposta persa a quel punto
avrebbe ricalcolato un `planHash` diverso da quello memorizzato e
dichiarato stale **il piano stesso**, come se la propria promozione fosse
un'interferenza esterna. La correzione separa due cose che la revisione 3
confondeva in un solo numero:

- **l'identità della richiesta** — «questo replay è davvero un retry della
  stessa autorizzazione, o un tentativo diverso sotto lo stesso
  `requestId`?» — verificata contro i valori **iniziali persistiti**, mai
  ricalcolata sul mondo attuale;
- **le guardie sul mondo mutabile** — «il corpo o l'elenco sono cambiati in
  un modo che rende un'azione specifica non più valida?» — verificate
  **solo quando quell'azione scrive** (§7.2.1, e il nuovo controllo di
  coerenza dell'array sotto), mai alla sola lettura di un piano esistente.

**Namespace di `requestId` — invariato:**

```
opaquePlanId = SHA-256(canonical(['visual-plan/v1', ownerUid, requestId]))
opaqueSlotRunId = SHA-256(canonical(['visual-plan-slot/v1', ownerUid, opaquePlanId, slotIndex]))
```

**`planHash` — corretto: include davvero tutti i campi che §5.5 già
promette**, calcolato **una sola volta**, alla creazione, dai valori
**iniziali**:

```
planHash = SHA-256(canonical([
  'visual-plan/v1',
  ownerUid, programId, importId, lessonId, publicLessonId,
  sourceBodyHash,                    // del corpo al momento della creazione
  existingItemAssetIds (ordinati),   // dell'array al momento della creazione
  quantity
]))
```

La revisione 3 dichiarava questi campi nel commento di `VisualPlanRun.
planHash` (§5.5) ma la formula effettiva ne ometteva tre
(`programId`, `importId`, `publicLessonId`); questa è la correzione. Una
volta scritto, `planHash` è **immutabile per la vita del piano** — non
viene mai ricalcolato dopo la creazione, nemmeno a scopo di verifica: è un
fingerprint di ciò che il piano *era* all'origine, non un sensore di ciò
che la lezione *è ora*.

**Risposta persa sull'autorizzazione — procedura di replay, in ordine:**

1. il client ripete la chiamata di autorizzazione con lo stesso
   `requestId`; il server calcola lo stesso `opaquePlanId` e legge
   `visualPlanRuns/{opaquePlanId}`;
2. **il documento non esiste** → non è un replay, è una richiesta nuova:
   procede alla creazione normale (§8.3, §10.3 per il lease);
3. **il documento esiste ma non supera il validatore strutturale** →
   `corrupted_state` (§5.5, invariato);
4. **il documento esiste, è valido, ma i campi identità persistiti
   (`ownerUid`, `programId`, `importId`, `lessonId`, `publicLessonId`,
   `requestId`) non coincidono** con quelli della richiesta corrente →
   `corrupted_state` — non dovrebbe mai accadere con un `requestId`
   generato correttamente (UUID v4), ma un contratto fail-closed non lo
   presuppone impossibile (stessa disciplina di §5.5);
5. **il documento esiste, è valido, i campi identità coincidono** →
   **è un replay legittimo**. Il server **non** rilegge `LessonDoc`, non
   ricalcola `sourceBodyHash`, non ricalcola `existingItemAssetIds`, non
   confronta nulla contro il mondo attuale: restituisce il record così
   com'è, qualunque cosa sia successo alla lezione nel frattempo —
   **nessuna seconda prenotazione, nessuna seconda proposta**. Il fatto
   che il piano abbia già promosso uno o più slot (§8.6) non ha alcun
   effetto su questo passo: la promozione ha scritto su `LessonDoc`, non
   su `visualPlanRuns/{opaquePlanId}` in un modo che invaliderebbe la sua
   stessa identità.

**`planHash` non viene mai usato per decidere se un replay è valido** —
quel giudizio è interamente nel passo 4 (identità) e nel passo 3
(struttura). Il suo ruolo è più stretto e più semplice: un controllo di
integrità interna, verificabile offline, che il record non sia stato
alterato in un campo senza alterare coerentemente gli altri — se mai
`SHA-256` dei campi persistiti non coincidesse col `planHash` persistito
nello stesso record, sarebbe la prova di una scrittura fuori disciplina
(un bug, non uno scenario di business), e produce anch'esso
`corrupted_state`.

**Risposta persa su un singolo slot.** Stesso principio di VE §8.1: il
client ripete l'azione (genera/promuovi) sullo stesso `(opaquePlanId,
slotIndex)`; il server riconosce lo stato già raggiunto e lo restituisce
senza ripetere provider, upload o promozione — invariato.

### 10.1.1 La guardia sul mondo mutabile — coerenza dell'array alla scrittura

**Nuovo in questa revisione.** Non basta che la promozione (§7.2.1, §8.6)
verifichi solo `sourceBodyHash` (il corpo). Va verificato **anche** che
l'array live di `LessonDoc.visuals.items` sia esattamente quello che
questo piano si aspetta — non un valore arbitrario, ma **esattamente**:

```
expectedLiveAssetIds =
  VisualPlanRun.existingItemAssetIds       // ciò che c'era all'origine
  ∪ promotedAssetIdsByThisPlan             // ciò che QUESTO piano ha già promosso
  (con le sostituzioni `replace` già dichiarate: l'assetId sostituito esce
   dall'insieme, il nuovo vi entra, nello stesso passo)

promotedAssetIdsByThisPlan =
  { slot.promotedAssetId | slot in VisualPlanRun.slots, slot.state === 'promoted' }
```

Prima di ogni scrittura che tocca `LessonDoc.visuals` (una nuova
promozione, §8.6 passo 4), il server confronta l'insieme di `assetId`
**effettivamente presente** nell'array rifresco con `expectedLiveAssetIds`:

- **coincidono** → l'array è nello stato che questo piano si aspetta;
  procede;
- **non coincidono** → qualcosa **fuori da questo piano** ha modificato
  l'elenco — un upload dalla galleria mentre il piano è in corso, una
  rimozione manuale, un'altra sessione che ha agito sulla stessa lezione
  senza passare dal lease (§10.3, che dovrebbe impedirlo — questo controllo
  è la seconda linea di difesa, non la prima). Esito:
  **`visual_plan_external_mutation`**, fail-closed, **zero scritture**. Lo
  slot in corso di promozione resta `ready`, non perso: il docente vede
  l'esito, può rivedere la galleria aggiornata e ripetere l'azione — a
  quel punto `existingItemAssetIds` del piano resta quello che era (non si
  aggiorna mai a metà vita), ma il confronto userà comunque l'insieme
  fresco al momento del nuovo tentativo, quindi un secondo tentativo dopo
  che il docente ha preso atto della mutazione esterna procede
  normalmente se nel frattempo non ne avvengono altre.

Questo controllo è **strutturale** (confronto di insiemi), non un secondo
controllo sul corpo: è indipendente da §7.2.1 e si applica **in aggiunta**,
non in sostituzione.

### 10.2 La corsa fra modifica della lezione e conferma

Identica a VE §8.2, applicata al piano nel suo complesso (autorizzazione,
§10.1) e a ciascuno slot alla promozione (§8.6 passo 1): il corpo fresco è
sempre riletto, mai assunto invariato.

### 10.3 Un solo piano attivo per lezione — lease deterministico, non una query

**Correzione rispetto alla revisione 3.** La regola precedente («mentre
`VisualPlanRun.status` non è terminale, un secondo tentativo è rifiutato»)
non diceva **come** il server trova il piano esistente per rifiutare il
secondo. `opaquePlanId` è derivato dal `requestId`, generato dal
**client**: due schede con due UUID diversi calcolano due `opaquePlanId`
diversi e scriverebbero **due documenti `visualPlanRuns` distinti**,
nessuno dei due in conflitto diretto con l'altro. Trovare «l'altro piano»
richiederebbe una query (`where lessonId == ... and status not in
[...]`), e una query non è un'unità di serializzazione: due transazioni
che leggono lo stesso risultato di query possono comunque scrivere
entrambe senza che Firestore le faccia contendere sullo stesso documento.
La review ha respinto correttamente questa lacuna.

**Correzione: un lease deterministico, non derivato dal `requestId`.**

```ts
/**
 * Documento server-only. Percorso deterministico —
 * `visualPlanLeases/{leaseId}`,
 * `leaseId = SHA-256(canonical(['visual-plan-lease/v1', ownerUid, lessonId]))`
 * — calcolato da `(ownerUid, lessonId)`, MAI dal `requestId`: è così che
 * due richieste con due `requestId` diversi per la stessa lezione
 * calcolano lo **stesso** percorso e contendono sullo **stesso**
 * documento, dove la transazione Firestore fornisce la serializzazione
 * che una query non può dare.
 */
export interface VisualPlanLease {
  contractVersion: 'visual-plan-lease/v1';
  ownerUid: string;
  programId: string;
  importId: string;
  lessonId: string;
  /** Il piano che detiene attualmente il lease. */
  opaquePlanId: string;
  requestId: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  /** Rinnovato a ogni transizione di stato del piano (§8.7). Un piano
   *  attivo non lascia mai scadere il proprio lease; solo un piano
   *  abbandonato a metà (crash, chiusura del browser senza resume) può
   *  raggiungere questo istante senza essere stato rinnovato. */
  expireAt: Timestamp;
}
```

**Acquisizione — nella stessa transazione della prenotazione di budget e
della creazione di `VisualPlanRun` (§8.3), mai una transazione a parte:**

1. calcola `leaseId` da `(ownerUid, lessonId)`;
2. **dentro la stessa transazione**, legge `visualPlanLeases/{leaseId}`:
   - **assente** → scrive il lease con `opaquePlanId`/`requestId` di questo
     piano, `expireAt` allineato al TTL del piano (24 h); procede alla
     prenotazione e alla creazione di `VisualPlanRun` nella stessa
     transazione — acquisizione e creazione sono atomiche insieme, non due
     passi separati che potrebbero disallinearsi a un crash;
   - **presente, non valido strutturalmente** → **`corrupted_state`**,
     l'intera autorizzazione si ferma, zero scritture — stessa disciplina
     di §5.5;
   - **presente, valido, `opaquePlanId` coincide con quello di questo
     piano** → è un replay della stessa autorizzazione (§10.1): il lease è
     già suo, nessuna riscrittura necessaria, procede come nel caso di
     replay;
   - **presente, valido, non scaduto (`expireAt` nel futuro), `opaquePlanId`
     diverso** → **`visual_plan_already_active`**, zero scritture; la
     risposta include `opaquePlanId`/`requestId` del piano che detiene il
     lease, perché il client possa aprirlo (§8.8) invece di crearne un
     altro;
   - **presente, valido, ma `expireAt` nel passato** → **riacquisizione
     condizionata**: la stessa transazione che ha appena *letto* la
     scadenza è quella che *riscrive* il lease per il nuovo piano — mai un
     passo di pulizia separato che lascerebbe una finestra fra «lease
     eliminato» e «lease riassegnato» in cui un terzo tentativo potrebbe
     intrufolarsi. La condizione (verificare `expireAt` nel passato prima
     di sovrascrivere) è ciò che rende la riacquisizione «condizionata» e
     non un overwrite incondizionato.

**Rinnovo.** Ogni transizione di stato del piano (§8.7 — proposta
completata, uno slot promosso, ecc.) rinnova `expireAt`/`updatedAt` del
lease **nella stessa transazione** della transizione stessa. Un piano
usato attivamente non lascia mai scadere il proprio lease.

**Rilascio.** Quando `VisualPlanRun.status` raggiunge uno stato terminale
(§8.7), la stessa transazione che lo scrive **elimina** il lease — non lo
lascia scadere per TTL: un piano concluso libera immediatamente la
lezione per un piano successivo, senza attendere 24 ore.

**Le due corse, esplicite:**

- **Race A — due tab, nessun piano esistente, autorizzazione quasi
  simultanea.** Entrambe le transazioni leggono `visualPlanLeases/{leaseId}`
  assente e tentano di scriverlo. Firestore serializza: la prima a
  raggiungere il commit vince: il proprio piano si crea. La transazione
  della seconda **fallisce per conflitto di scrittura sullo stesso
  documento** e Firestore la ripete automaticamente (comportamento
  standard delle transazioni) — al secondo tentativo, la lettura del lease
  trova ora un `opaquePlanId` diverso dal proprio ⇒
  `visual_plan_already_active`. In nessun momento esistono due lease
  scritti per la stessa lezione.
- **Race B — un piano già attivo, un secondo tentativo (stessa scheda dopo
  un refresh con un nuovo `requestId` per errore, o una seconda scheda).**
  La transazione del secondo tentativo legge il lease già presente, valido,
  non scaduto, con `opaquePlanId` diverso dal proprio ⇒
  `visual_plan_already_active`, deterministico, indipendentemente da
  quanti tentativi concorrenti si presentino: contendono tutti sullo
  stesso documento.

**Perché questo, e non un campo su `LessonDoc`.** Un campo diretto su
`LessonDoc` (per esempio `LessonDoc.activeVisualPlanId`) avrebbe lo stesso
effetto di serializzazione ma allargherebbe la superficie di scrittura di
un documento che molte altre transazioni toccano per altre ragioni (testo,
metadati, altre funzionalità), aumentando le probabilità di conflitti di
transazione non correlati al piano visivo. Un documento dedicato
(`visualPlanLeases/{leaseId}`) isola questa contesa alla sola funzione che
la riguarda.

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
│  Genereremo una proposta coordinata e fino a 3 immagini,     │
│  ciascuna con fino a 2 tentativi in caso di errore.          │
│  Costo massimo di questa sessione:                           │
│    proposta coordinata .......... € stimato_proposta         │
│    fino a 3 immagini × 2 tentativi € stimato_generazione×3×2 │
│    ───────────────────────────────────────────────────────  │
│    tetto totale ................. € somma                   │
│                                                                │
│  Non è uno sconto: è la somma dei costi massimi di ciascuna  │
│  fase e di ogni tentativo. Il costo reale sarà pari o        │
│  inferiore — ogni tentativo non necessario non viene         │
│  addebitato. Un ulteriore tentativo oltre i 2 per immagine    │
│  richiede di chiudere questo piano e avviarne uno nuovo,      │
│  con una propria autorizzazione.                              │
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

**Correzione rispetto alla revisione 2.** I conteggi Firestore della
revisione precedente (per esempio «2 letture transazionali, 1 scrittura
privata» per una promozione) erano stime scritte da zero, e contraddicevano
i numeri **misurati** che `visual-enrichment-roadmap.md` §15.5 (VE-03C) già
registra per la stessa classe di operazione a singola immagine, contro
Firestore/Storage Emulator reali. La review ha correttamente respinto
questa discrepanza. Questa sezione riparte dai numeri misurati di VE-03
come **baseline**, citati testualmente in §12.0, e descrive ogni operazione
di MULTI-VISUAL come **delta esplicito** su quel baseline — mai un numero
nuovo inventato dove il baseline già misura il caso N=1. Ogni riga dichiara
se è **misurata** (eredita byte per byte un numero di VE-03, Emulator
reale) o **stimata** (derivazione di questo documento, non ancora
verificata contro un Emulator per il caso multi — §17, §19).

### 12.0 Baseline misurato — VE-03, immagine singola, Firestore/Storage Emulator

Riportato testualmente da `visual-enrichment-roadmap.md` §15.5, colonna per
colonna (Letture FS, Scritture FS, Read/Write/Delete Storage). Provider:
mock deterministico, costo zero — questi numeri riguardano **solo**
Firestore/Storage, non il costo del provider IA.

| Operazione (VE-03, N=1 immagine) | Letture FS | Scritture FS | Read Storage | Write Storage | Delete Storage |
|---|---|---|---|---|---|
| bind (ticket `aiVisualCandidates`) | 4 | 1 | 0 | 0 | 0 |
| **promozione** | **9** | **3** | 1 | 1 | 1 |
| promozione (replay) | 1 | 0 | 0 | 0 | 0 |
| completed `true` senza visual | 5 | 4 | 0 | 0 | 0 |
| completed `true` con visual | 5 | 4 | 1 | 0 | 0 |
| completed `false` | 5 | 4 | 0 | 0 | 0 |
| **rimozione** | **7** | **6** | 0 | 0 | 1 |
| abbandono | 4 | 2 | 0 | 0 | 1 |
| **delete lezione** | **7** | **5** | 0 | 0 | 1 |
| **delete UDA, 3 lezioni** | **21** | **15** | 0 | 0 | 3 |

Questi dieci numeri sono la base di riferimento di ogni tabella sotto:
dove un'operazione MULTI-VISUAL è strutturalmente la stessa classe di
operazione di VE-03 applicata a **uno** slot alla volta (promozione,
rimozione, delete lezione/UDA — §8.6, §8.9, §8.12), il numero Firestore
resta **quello misurato**, perché l'architettura di questo contratto
promuove/rimuove sempre un asset alla volta (§8.6: «mai un'unica
transazione Firestore multi-immagine»). Dove MULTI-VISUAL introduce
un'operazione che VE-03 non ha (il piano coordinato, §8.3–§8.5), il
conteggio è **nuovo e dichiarato stimato**.

### 12.1 Autorizzazione e piano (fase unica, indipendente dal numero di slot generati davvero) — STIMATO

Nessuna riga di questa sottosezione esiste in VE-03 (che non ha un piano
coordinato): ogni numero è una stima di questo documento, non ancora
verificata in Emulator (§17, §19).

| Momento | Provider | Firestore | Storage | Function |
|---|---|---|---|---|
| **Autorizzazione del piano** (1 per sessione, qualunque `ceiling`) | 0 | **1R + 3W**: 1 lettura + 1 scrittura del lease (`visualPlanLeases/{leaseId}`, §10.3 — nella stessa transazione), 1 scrittura `VisualPlanRun`, 1 scrittura sul ledger mensile di budget (riuso AIGEN, `ai-content-budget/v1`) | 0 | 1 |
| **Replay dell'autorizzazione** (stesso `requestId`, §10.1) | 0 | 1 lettura (`visualPlanRuns`) — **nessuna scrittura**, lease invariato | 0 | 1 |
| **Tentativo respinto da `visual_plan_already_active`** (§10.3, Race A/B) | 0 | 1 lettura del lease, **zero scritture** | 0 | 1 |
| **Proposta coordinata** (1 per piano, mai N) | 1 chiamata testo, `quality`, indipendente da `ceiling` nel numero di chiamate | **2W**: 1 aggiornamento `VisualPlanRun.slots`+`settlement.proposalActualCost`, 1 settlement sul ledger mensile (stessa disciplina già in vigore per `lesson`/`pool`/`concept_map`/`visual_proposal`) | 0 | 1 |
| **Rilascio della quota non usata** (`ceiling − slot con decision:'image'`) | 0 | incluso nell'aggiornamento sopra — nessuna scrittura aggiuntiva | 0 | 0 |
| **Revisione gratuita di uno slot pending** (`aiVisualPlanEditSlot`) | 0 | **7R + 4W** nel percorso callable: owner (preflight + rilettura transazionale), piano, lezione, proiezione, lease, chiave idempotente; scritture piano + chiave + audit + rinnovo lease | 0 | 1 |
| **Abbandono gratuito di uno slot pending** | 0 | **8R + 5W**: come la revisione, più lettura/scrittura del ledger per ridurre la prenotazione master; sull'ultimo slot il write del lease è un delete | 0 | 1 |
| **Replay identico della revisione** | 0 | **7R, 0W**: fonti fresche e chiave idempotente rilette, nessun timestamp/audit/lease riscritto | 0 | 1 |
| **Rinnovo del lease** (a ogni transizione di stato del piano, §10.3) | 0 | incluso nella stessa transazione della transizione — nessuna scrittura aggiuntiva rispetto a quanto quella transizione già conta | 0 | 0 |
| **Rilascio del lease** (piano terminale, §8.7) | 0 | incluso nella stessa transazione della transizione a stato terminale — 1 delete, nessuna scrittura aggiuntiva oltre a quella già contata dalla transizione stessa | 0 | 0 |

**Perché prenotazione e run sono scritture distinte.** La revisione 2
contava «1 scrittura» per l'autorizzazione, collassando `VisualPlanRun` e
la prenotazione di budget come se fossero la stessa cosa. Non lo sono: il
ledger mensile (`ai-content-budget/v1`) è un documento **separato**,
condiviso fra tutte le richieste IA della stessa finestra mensile — riusato
qui, non duplicato — mentre `VisualPlanRun` è il documento **di questo
piano**. Sono due scritture perché sono due documenti, esattamente come lo
sono già oggi per una singola richiesta `AiContentRequest` esistente
(VE-02 §8.1: «il run è scritto prima della chiamata al provider, con
prenotazione di budget»). **Nuovo in questa revisione**: il lease (§10.3)
aggiunge una terza scrittura e una lettura, nella stessa transazione — la
garanzia di piano unico per lezione non è gratuita, ed è dichiarata come
tale invece di essere assorbita silenziosamente nel conteggio del piano.

**Formula del tetto iniziale**, corretta rispetto alla revisione 2 —
include i tentativi:

```
totalReserved(ceiling) = proposalCap + generationCap × ceiling × maxAttemptsPerSlot

maxAttemptsPerSlot = VISUAL_PLAN_MAX_ATTEMPTS_PER_SLOT = 2 (§5.6)

ceiling = 0 (nessuno slot libero)  →  «Arricchisci»→generazione disabilitato, nessuna riga
ceiling = 1  →  totalReserved = proposalCap + generationCap × 1 × 2 = proposalCap + 2 × generationCap
ceiling = 2  →  totalReserved = proposalCap + generationCap × 2 × 2 = proposalCap + 4 × generationCap
ceiling = 3  →  totalReserved = proposalCap + generationCap × 3 × 2 = proposalCap + 6 × generationCap
```

Il tetto **non dipende** da quante proposte risulteranno `decision:
'image'` né da quanti tentativi saranno davvero necessari: è calcolato sul
massimo possibile (`ceiling` slot, `maxAttemptsPerSlot` tentativi ciascuno)
e la parte non usata è rilasciata al termine della proposta coordinata e a
ogni slot che va a buon fine al primo tentativo, mai addebitata (§8.2,
§8.5). Il settlement reale (§5.5, invariante verificato) non supera mai
`totalReserved` — è una somma di costi effettivamente sostenuti, ciascuno
≤ del proprio cap, su un numero di eventi ≤ `ceiling × maxAttemptsPerSlot`.

### 12.2 Generazione, per slot (0..3 righe per sessione, secondo quanti slot hanno `decision: 'image'`) — STIMATO

| Momento | Provider | Firestore | Storage | Function |
|---|---|---|---|---|
| **Generazione di uno slot** (per slot con `decision: 'image'`, primo tentativo) | 1 chiamata immagine, `quality` | **2W**: 1 aggiornamento `slots[i]`, 1 settlement sul ledger mensile | 1 scrittura staging | 1 |
| **Retry di uno slot fallito** (2° tentativo, entro `maxAttemptsPerSlot`) | 1 chiamata immagine | **2W**: 1 aggiornamento `slots[i].attempts`, 1 settlement | 1 riscrittura staging (stesso `opaqueSlotRunId`) | 1 |
| **Replay** (risposta persa, stesso `opaquePlanId`+`slotIndex`) | **0** | 1 lettura | 0 | 1 |

**Realizzazione 03B — conteggio nominale effettivo.** Le due transazioni
separate (prenotazione del tentativo e settlement) aggiungono le letture e
le scritture necessarie a lease, slot run e ledger: un tentativo completo
usa **9 letture / 8 scritture Firestore**, una scrittura Storage staging e
una chiamata provider. Il replay `ready`/`promoted` resta **1 lettura,
zero scritture, zero Storage, zero provider**. Il secondo tentativo ha lo
stesso costo del primo ma non crea una nuova prenotazione economica: usa il
cap residuo del master già autorizzato.

**Conteggio per lezione**, esplicito — aggiornato per riflettere fino a 2
tentativi per slot, non più un numero indefinito:

```
0 immagini generate → 0 righe di questa tabella (piano con soli slot 'none' o abbandonati)
1 immagine generata → 1..2 righe «Generazione/Retry» (mai più di maxAttemptsPerSlot per slot)
2 immagini generate → 2..4 righe, indipendenti per slot
3 immagini generate → 3..6 righe, indipendenti per slot
```

### 12.3 Upload — `VisualUploadRun` (per immagine, zero provider in ogni caso) — STIMATO, nessun equivalente in VE-03

**Corretto rispetto alla revisione 3**, che contava «1 scrittura ticket»
senza un contratto di idempotenza dietro (§9.6–§9.9 sono nuovi in questa
revisione). Nessuna riga qui coinvolge il lease del piano (§10.3): l'upload
non lo usa (§9.8).

| Momento | Provider | Firestore | Storage | Function |
|---|---|---|---|---|
| **Accettazione file** (per immagine caricata, 1° tentativo) | **0** | 4 letture puntuali / 2 scritture (`accepted`, poi `ready`) | 1 scrittura staging create-only | 1 (normalizzazione, cap input 2 MB) |
| **Rifiuto pre-decodifica** (formato/peso non validi, §9.2) | 0 | 0 | 0 | 1 (termina al passo 0, nessuna scrittura) |
| **Replay `ready`** (stesso `requestId`, stesso `rawBytesSha256`, §9.7) | 0 | 3 letture puntuali / 0 scritture — **nessuna seconda normalizzazione** | 0 | 1 |
| **Recovery `accepted`** (crash prima/dopo lo staging) | 0 | 4 letture puntuali / 1 scrittura finale | 1 tentativo create-only; su 412, 1 lettura e confronto byte-per-byte | 1 |
| **Conflitto** (stesso `requestId`, byte o ancora diversi, §9.7) | 0 | fino a 3 letture puntuali, **zero scritture** | 0 | 1 |
| **Promozione di un upload** | 0 | **identica alla riga «Promozione» di §12.4** — l'upload riusa §8.6 senza una seconda procedura (§9.8) | identico a §12.4 | 1 |
| **Abbandono** (non promosso) | 0 | 1 lettura / 1 scrittura (`status: 'abandoned'`); se esiste un recovery di promozione `prepared`, +4 letture iniziali e fino a 4 letture / 1 delete nel commit che lo consuma | 1 metadata read + 1 delete staging; con recovery `prepared`, +1 metadata read + 1 download di verifica + 1 delete canonico, entrambi i delete condizionati alla generation e a prove owner/run/asset/hash | 1 |
| **Cleanup TTL scaduto** | 0 | 1 lettura / 1 scrittura (`status: 'expired'`); stesso delta del recovery `prepared` della riga precedente | stesso cleanup staging/canonico fail-closed della riga precedente | porta puntuale; nessuno scheduler o costo passivo introdotto |

La copia canonica precede necessariamente la transazione Firestore di
promozione. Se quest'ultima rifiuta body/ancora stale, cap pieno o target di
sostituzione sparito, resta quindi una finestra deliberata con recovery
`prepared` e blob canonico privato. `abandon` e la porta TTL chiudono quella
finestra: contendono il run con la promozione, verificano che nessun registro
di promozione esista e che l'asset non sia live, cancellano soltanto il path
canonico provato da owner + run + asset + SHA-256 con precondizione sulla
generation, quindi consumano il recovery. Un cambio di generation o una
prova incompleta lascia il recovery persistito e non cancella byte: il danno
residuo massimo è un blob privato orfano recuperabile, mai la rimozione di un
asset sostitutivo. Senza invocazione di `abandon` o della porta TTL il blob
può restare fino al successivo cleanup esplicito; non esiste polling passivo.

### 12.4 Promozione — individuale o in blocco, mai una transazione multi-immagine

**Il numero Firestore per una singola promozione è quello misurato di
VE-03 (§12.0): 9R/3W, + Storage 1R/1W/1D.** L'architettura di §8.6 promuove
sempre un asset alla volta — la stessa classe di operazione che VE-03 ha
già misurato, non una nuova. Il delta di MULTI-VISUAL è **dichiarato ed
esplicito**, non nascosto dentro il numero:

| Momento | Provider | Firestore (VE-03 misurato + delta) | Storage | Function |
|---|---|---|---|---|
| **Promozione — modalità `add`** (1 asset) | 0 | **9R/3W** (misurato, VE-03) **+ 1R/1W stimato** (rilettura `VisualPlanRun` per verifica `sourceBodyHash`/anchor, §8.6 passi 1 e 3; aggiornamento `slots[i].state`/`settlement`, §8.6 passo 9) | 1 copia + 1 delete staging (misurato) | 1 |
| **Promozione — modalità `replace`** (1 asset) | 0 | come `add` **+ 1W stimato** (rimozione chiave mappa byte del vecchio `assetId`, se svolta) | 1 copia + 1 delete staging + 1 delete canonico precedente dopo commit (misurato) | 1 |
| **«Applica tutte»** (N slot `ready`, N = 1..3) | 0 | **N ×** (9R/3W misurato + 1-2R/1-2W stimato), eseguite in sequenza — mai un'unica transazione | **N ×** le righe sopra | **N** |
| **Adozione da manifest singolo** (una tantum per lezione) | 0 | inclusa nella transazione di promozione che la innesca (§6.2) — nessuna scrittura aggiuntiva oltre a quella già contata sopra | 0 | 0 |

**Realizzazione 03B — delta del recovery fail-closed.** Con `N` slot già
promossi dallo stesso piano, la prima promozione riuscita esegue
`12 + 2N` letture Firestore; **7 scritture** se la lezione non è svolta o
**9** se aggiorna anche proiezione e byte pubblici. Storage esegue una
lettura staging, una copia create-only e una delete staging; `replace`
aggiunge la delete post-commit del canonico sostituito. Il replay dal
registro di promozione è **5 + N letture Firestore**, con `N` registri degli
slot promossi, e **N letture Storage** dei byte canonici; zero scritture e
zero provider. I numeri
includono il record recovery `prepared → committed`, prezzo deliberato per
rendere recuperabile la finestra fra copia Storage e commit Firestore.

**Perché «Applica tutte» costa esattamente N volte, non meno.** Non esiste
uno sconto di batch sulla scrittura, per lo stesso motivo per cui non ne
esiste uno sulla generazione (§12.1): ogni immagine ha il proprio commit,
la propria copia Storage, il proprio audit. «Applica tutte» è una comodità
di interazione, non un'ottimizzazione di costo.

### 12.5 Lettura studente e liste — invariato dalla revisione 1, indipendente da VE-03 (nessuna lettura, nessun equivalente da misurare)

| Momento | Firestore |
|---|---|
| **Lezione senza `visuals`** | **0** |
| **Lezione con 1, 2 o 3 immagini** | **1 lettura puntuale** (indipendente dal conteggio, §5.4), all'apertura |
| **Elenchi / card, qualunque conteggio** | **0** |

### 12.6 Riordino, rimozione — rimozione ancorata al baseline misurato

| Momento | Firestore | Storage |
|---|---|---|
| **Riordino** (STIMATO — nessun equivalente in VE-03, VE non ha un ordine da riordinare) | 2 letture transazionali, ≤ 2 scritture | **0** |
| **Rimozione** (1 asset) | **7R/6W** — **misurato**, VE-03 (§12.0); MULTI-VISUAL rimuove un elemento dell'array con la stessa transazione, stesso conteggio | 1 delete — misurato |

### 12.7 Cleanup — piano scaduto (stimato) e cancellazione lezione/UDA/corso (§8.12, misurato+delta)

| Momento | Firestore | Storage |
|---|---|---|
| **Cleanup piano scaduto** (TTL 24h, STIMATO — nessun equivalente in VE-03) | 1 delete `VisualPlanRun` + 1 delete lease (§10.3, se non già rilasciato) | 1 delete per slot con staging residuo |
| **Cleanup upload scaduto** (TTL 24h, STIMATO, §9.9) | 1 scrittura `VisualUploadRun` (`status: 'expired'`) | 1 delete staging |
| **Delete lezione**, N=0..3 asset | **7R/5W** — **misurato**, VE-03 (§12.0), **costante al variare di N** (§8.12.5) | N delete |
| **Delete UDA**, L lezioni, N_i asset ciascuna | **L × (7R/5W)** — **misurato per L=3** (VE-03: 21R/15W), lineare per costruzione | Σ N_i delete |
| **Delete corso/import** | fuori da questo conteggio — `deleteImportPrefix` (SGW-02A), autorevole e invariato (§8.12.3) | prefisso, non enumerato |

### 12.8 Invarianti di costo, riverificate

- **zero** listener, **zero** polling, **zero** indici nuovi;
- **zero** letture per card, indipendentemente dal numero di immagini;
- **zero** costo su ogni lezione priva di immagini;
- **il costo di lettura studente non cresce con il numero di immagini**
  (1 lettura per 1, 2 o 3);
- **il costo Firestore di promozione/rimozione/delete-lezione non cresce
  con il numero di immagini già presenti nella lezione** — cresce solo
  con il numero di asset **toccati** dall'operazione (1 per promozione/
  rimozione individuale, N per delete-lezione/UDA, mai l'intero array per
  un'operazione che ne riguarda una parte);
- **un'unica autorizzazione economica per piano**, mai una per immagine,
  e il tetto copre esplicitamente i tentativi di retry (§12.1);
- **un solo piano attivo per lezione, garantito da un documento dedicato
  (il lease, §10.3) su cui Firestore serializza — non da una query**, al
  costo dichiarato di 1R+1W aggiuntivi per autorizzazione (§12.1);
- l'upload **non** ha mai un costo di provider e non condivide il lease
  del piano (§9.8);
- il consuntivo (`VisualPlanRun.settlement`) è sempre disponibile per fase
  e per asset, e non supera mai il tetto prenotato;
- **nessuna riga di questa sezione riguardante il piano, la generazione o
  il cleanup è stata eseguita contro un Emulator reale in questa fase** —
  sono derivazioni dal baseline misurato di VE-03, dichiarate come stime,
  non misure (§17, §19).

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

### 14.1 Export — formato ZIP dei sidecar, invariato

I sidecar di VE-03C (`visuals/{assetId}.json`, `visuals/{assetId}.webp`)
sono già chiavati per `assetId`, non per lezione: un archivio con 0, 1, 2 o
3 file per lezione resta rappresentabile senza modifiche al **formato**
dello ZIP. Quello che deve cambiare — ed è la correzione di questa
revisione — è il **contratto della callable e del composer** che
riempiono quel formato: dire «il formato non cambia» non basta se la
callable restituisce un solo asset per `lessonId` e il composer web scrive
un solo sidecar, perché in quel caso il secondo e il terzo asset di una
lezione multi-immagine non arrivano mai nello ZIP, indipendentemente da
quanto il formato dei file sarebbe capace di rappresentare.

### 14.2 `aiVisualExportBatch` — contratto v2, chiuso, davvero multi-asset

**Correzione rispetto alla revisione 2.** Il runtime reale descritto da
`visual-enrichment-roadmap.md` §15.5 (VE-03C) restituisce un solo asset per
`lessonId`, perché VE è a singola immagine: `aiVisualExportBatch` non ha
mai avuto bisogno di restituirne di più. Questo paragrafo specifica la
forma v2 che lo generalizza, mantenendo intatto tutto ciò che VE-03C ha già
stabilito (owner-only, nessun percorso libero, fail-closed sull'archivio,
Storage chiuso anche al proprietario) e correggendo solo la cardinalità.

**Input — invariato nella forma, il significato di `lessonIds` non
cambia:**

```ts
export interface AiVisualExportBatchInput {
  programId: string;
  importId: string;
  lessonIds: string[]; // dimensionamento dinamico del batch, §14.3
}
```

**Output v2 — chiuso, per `lessonId`, 1..3 asset nell'ordine del
manifest:**

```ts
export type AiVisualExportBatchResult = {
  [lessonId: string]: AiVisualExportLessonResult;
};

export type AiVisualExportLessonResult =
  | { status: 'absent' } // nessun manifest — caso normale, la maggioranza
  | { status: 'present'; assets: AiVisualExportAsset[] }; // 1..3, ordine di LessonDoc.visuals.items

export interface AiVisualExportAsset {
  assetId: string;
  /** JSON serializzato di `LessonVisualItem` (§5.1) — un file per asset,
   *  mai un manifest cumulativo per lezione: coerente con VE-03C, dove i
   *  sidecar sono già chiavati per assetId. */
  manifestJson: string;
  /** Byte canonici WebP, base64. */
  base64: string;
  /** Byte length dei byte canonici PRIMA della codifica base64 —
   *  verificato contro `sha256`/`byteLength` del manifest prima di essere
   *  incluso: un asset che non supera la verifica non entra nella
   *  risposta (vedi «all-or-nothing» sotto). */
  byteLength: number;
}
```

**Validazione all-or-nothing sull'INTERO batch, non lezione per lezione —
corretto rispetto alla revisione 3.** La versione precedente faceva
fallire «l'intera lezione» lasciando intendere che le **altre** lezioni
del batch restassero comunque nella risposta. La review ha respinto questo
comportamento: **un solo asset dichiarato ma non recuperabile o non
verificabile, in una qualunque lezione del batch, aborte l'intera chiamata
prima che qualunque output venga prodotto** — non «zero asset per quella
lezione, le altre intatte». Un risultato parziale è ambiguo esattamente
allo stesso modo che VE-03C ha già escluso per lezione singola: se la
callable restituisse le lezioni valide e marcasse solo quella incriminata
come fallita, il chiamante dovrebbe comunque decidere se un archivio
parzialmente valido è accettabile — una decisione che questo contratto
non delega al composer, la prende qui.

**Procedura, in due fasi separate, mai interfogliate:**

1. **Fase di verifica — nessun output prodotto.** Per ogni `lessonId` del
   batch, si legge il manifest (`visuals`, o `visual` singolare via
   `adaptSingular`) e si verificano tutti i suoi asset dichiarati (esistenza
   Storage, hash, conteggio contro il manifest). Questa fase non scrive,
   non compone `base64`, non alloca la risposta: **osserva soltanto**.
2. **Decisione, sull'insieme, non sulla singola lezione.** Se **anche un
   solo asset di una sola lezione** fallisce la verifica, la callable
   **lancia un errore tipizzato e restituisce zero output** — nessun
   `AiVisualExportBatchResult`, nemmeno parziale, nemmeno per le lezioni
   che avevano superato la verifica. Solo se **tutte** le lezioni del
   batch superano la verifica, la callable procede alla seconda fase e
   **allora** assembla e restituisce `AiVisualExportBatchResult` per
   l'intero batch, incluse le lezioni legittimamente `{ status: 'absent'
   }` (che non sono un fallimento, mai lo sono state).

**Collisioni e dedup — stessa disciplina, sull'intero batch.** VE-03C
stabilisce che due lezioni con lo stesso `assetId` producono un errore
invece di un archivio con una figura in meno (`JSZip.file()` sovrascrive
senza dire niente). Con più asset per lezione, il controllo di unicità
copre **tutti** gli `assetId` dell'intero batch — fino a 3 per lezione,
fino a 13 lezioni nel caso peggiore (§14.3) — verificato nella **stessa**
fase di verifica sopra: una collisione rilevata in qualunque punto del
batch aborte l'intera chiamata con la stessa disciplina all-or-nothing,
mai un errore isolato a una coppia di lezioni con le altre restituite.

**Test esplicito** (§19): tre lezioni nel batch, un asset non
recuperabile nella **seconda** — verifica che la risposta sia un errore
tipizzato, **zero** `AiVisualExportBatchResult`, e che né la prima né la
terza lezione (entrambe valide) compaiano in un output parziale.

**Composer web — attende e valida l'intero export prima di scrivere
qualunque file, non solo `assets` di una singola risposta.** Poiché il
dimensionamento del batch è dinamico (§14.3), un export che copre più di
~13 lezioni richiede **più chiamate sequenziali** a
`aiVisualExportBatch`. Il composer deve trattare l'intero export come
un'unità: **non inizia a scrivere lo ZIP dopo la prima chiamata riuscita**
se altre chiamate del medesimo export sono ancora in corso o falliscono
successivamente — attende **tutte** le risposte dei batch dell'export
corrente, e solo se **tutte** sono riuscite comincia a comporre lo ZIP.
Una chiamata di batch fallita a metà di un export multi-batch invalida
l'intero export lato composer, non solo il batch che ha fallito, per la
stessa ragione per cui una callable non restituisce mai un output
parziale al proprio interno.

**Ordine — nuovo requisito esplicito, assente in VE-03C perché lì
irrilevante con un solo asset.** `assets` è nello **stesso ordine**
dell'array `LessonDoc.visuals.items` (o dell'array a un elemento prodotto
da `adaptSingular` per una lezione non ancora adottata, sotto) al momento
dell'export — l'ordine scelto dal docente nella galleria (§7.5) si
riflette nell'ordine dei file nello ZIP, non un ordine arbitrario di
scrittura o di lettura da Storage.

**Compatibilità con la forma singolare — nessun secondo formato.** Una
lezione non ancora adottata (`LessonDoc.visual` singolare, §6.1) produce
`{ status: 'present', assets: [unAsset] }` — **lo stesso identico formato
v2**, con un array a un elemento ottenuto applicando `adaptSingular` in
lettura, esattamente come fa il renderer (§6.1). L'export **non forza
un'adozione**: leggere per esportare non è una scrittura, e la lezione
resta nella sua forma originale dopo l'export quanto lo era prima.

**Composer web — deve iterare `assets` per intero.** Il composer che
costruisce lo ZIP deve scrivere, per **ciascun** elemento di `assets` (non
solo il primo): `visuals/{assetId}.json` (da `manifestJson`) e
`visuals/{assetId}.webp` (da `base64`, decodificato). Un composer che si
fermasse al primo elemento produrrebbe uno ZIP strutturalmente valido ma
silenziosamente incompleto — esattamente il tipo di difetto che la
validazione all-or-nothing lato callable esiste per impedire lato server, e
che il composer deve non reintrodurre lato client.

### 14.3 Batching — dimensionamento dinamico, invariato dalla revisione 2

Il client accumula lezioni nel batch corrente sommando
`min(itemCount, 3) × 204_800` byte worst-case; prima di superare
`8_000_000`, chiude il batch. Caso peggiore assoluto: 13 lezioni a 3
immagini ciascuna al cap rigido (`8_000_000 ÷ 614_400 = 13,02`). Questo
criterio non cambia con la forma v2 dell'output: il dimensionamento
riguarda quanti byte la **risposta** può contenere, non la forma con cui
sono organizzati al suo interno.

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

1. **Il vincolo di diversità del piano (§7.4) è lessicale, non
   semantico.** Impedisce duplicati con lo stesso soggetto o la stessa
   utilità dichiarata (testualmente, dopo normalizzazione), indipendente
   dall'ancora — non ogni sovrapposizione concettuale più sottile fra
   soggetti descritti con parole diverse. Il backstop reale contro questo
   limite è la revisione gratuita del piano (§8.4), dove il docente vede
   tutti gli slot insieme prima di spendere qualunque generazione. È un
   compromesso dichiarato fra rigore e semplicità del meccanismo.
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
| **MULTI-VISUAL-01** | **Tipi e validatori puri.** `LessonVisualsManifest`, `LessonVisualItem` (con `source` privato), `PublicLessonVisualItem` (senza `source`), `VisualAnchorSelector`, `VisualPlanRun`/`VisualPlanSlot`, validatore del vincolo di diversità (§7.4), risolutore d'ancora a indice+testo (§7.2) con test di collisione (§7.3), `adaptSingular` puro, costanti incluso `MAX_VISUAL_UPLOAD_INPUT_BYTES = 2_000_000`. Nessuna Function, nessuna UI, nessun provider. | MULTI-VISUAL-00 | **Implementato** — `functions/src/aiVisualMultiCore.ts`, `aiVisualMultiManifest.ts`, `aiVisualMultiAnchor.ts`, `aiVisualMultiPlan.ts` (92 test, PR draft verso `main`). Il risolutore d'ancora riusa `resolveAnchorByIndex`/`listAnchorableHeadings` di VE (`aiVisualPromotion.ts`), nessun parser Markdown parallelo. Upload binario, proposta coordinata, persistenza/lifecycle e UI restano fuori scope (MULTI-VISUAL-02→04). |
| **MULTI-VISUAL-02** | **Catena binaria dell'upload** (cap 2 MB, allowlist PNG/JPEG/WebP non animati, `background=opaque`) e **proposta coordinata** (`kind: 'visual_plan_proposal'`, Structured Output ad array, vincolo di diversità applicato server-side). Nessuna UI, nessuna proiezione studente. | MULTI-VISUAL-01 | **Implementato.** Il nuovo kind è disponibile soltanto al motore interno: le callable IA generiche lo rifiutano prima di configurazione, budget, provider e scritture; MULTI-VISUAL-03 gli darà la porta autorizzata dal piano. L'upload persiste `VisualUploadRun`, normalizza con la pipeline Sharp condivisa, usa staging create-only e prova di proprietà nei metadati con delete condizionata alla generation. Cleanup TTL esposto come porta puntuale, senza scheduler o indice in questa fase. **MULTI-VISUAL-UPLOAD-01A:** la promozione marca il run `promoted` e ripulisce lo staging in modo idempotente; un recovery `prepared` lasciato da una transazione fallita viene consumato da `abandon` o dalla porta TTL soltanto dopo delete canonica con prove owner/run/asset/hash e generation. Non viene introdotto uno scheduler periodico: il richiamo della porta TTL resta un'operazione esplicita di rollout. |
| **MULTI-VISUAL-03** | **Persistenza e lifecycle del piano.** Epic contenitore dei tre slice 03A/03B/03C. | MULTI-VISUAL-02 | **Chiuso.** PR #429, #430 e #431. |
| **MULTI-VISUAL-03A** | **Autorizzazione e proposta coordinata.** `VisualPlanRun`, lease un-piano-per-lezione, prenotazione master a somma di cap, replay owner-only, adozione singolare atomica privata/pubblica e Rules server-only delle collezioni tecniche. Nessuna generazione/promozione per slot. | MULTI-VISUAL-02 | **Implementato.** |
| **MULTI-VISUAL-03B** | **Esecuzione e promozione per slot.** Generazione/retry, staging e promozione atomica `add`/`replace`, settlement per slot e recovery. | MULTI-VISUAL-03A | **Chiuso.** PR #430; callable `aiVisualPlanGenerateSlot` e `aiVisualPlanPromoteSlot`, test puri ed Emulator; non distribuito. |
| **MULTI-VISUAL-03C** | **Lifecycle editoriale e proiezioni.** Riordino, rimozione, cleanup, Rules su `publicLessons.visuals`/`publicLessonVisuals` e batching export. | MULTI-VISUAL-03B | **Chiuso.** PR #431; non distribuito. |
| **MULTI-VISUAL-04** | **UI.** «Arricchisci» in Azioni (unico ingresso), selettore di quantità, autorizzazione unica, revisione del piano, generazione con progresso e retry per asset, galleria con riordino, rendering N-way e responsive desktop/mobile con semantica modale reale. | MULTI-VISUAL-03 | **Chiuso e distribuito in DEV e PROD; Gate UI superato.** Upload manuale e integrazione automatica con «Genera lezione» restano fuori da questa PR. |
| **MULTI-VISUAL-05** | **Qualità e rollout controllato.** Benchmark su lezioni con più immagini, verifica del margine di §4 su documenti reali, smoke DEV con flag in sequenza, verifica del percorso di rollback, verifica diretta su dati di produzione della domanda aperta di §17.3. | MULTI-VISUAL-04 | Aperto. |
| **Gate GMULTI** | **Approvazione umana.** | MULTI-VISUAL-05 | **PASS (29 agosto 2026).** Smoke DEV confermato dal docente; rollout PROD completato. |

---

## 19. Test obbligatori

- **Non-regressione byte-identica** degli `inputHash`/costanti congelate di
  VE-01 (pool, lezione, mappa, `visual_proposal` singolo).
- **Validatore strutturale dell'array e del piano**: chiavi esatte,
  `items.length` in `1..3`, `contractVersion` letterale, unione chiusa di
  `styleVersion` coerente con `source`; `VisualPlanRun`/`VisualPlanSlot` a
  chiavi chiuse, `quantity.ceiling` in `1..3`.
- **Vincolo di diversità del piano (§7.4)** — corretto rispetto alla
  revisione 2: caso **positivo** con due slot sullo **stesso**
  `anchorHeadingIndex` ma `subject`/`rationale` genuinamente distinti ⇒
  **accettato** (il caso che il prototipo già mostra, `page-teacher-2`);
  caso negativo con due `subject` normalizzati identici, ancora uguale o
  diversa ⇒ `provider_invalid_output`; caso negativo con due `rationale`
  normalizzati identici anche a `subject` diversi ⇒ stesso esito; verifica
  esplicita che l'uguaglianza di `anchorHeadingIndex` **da sola**, con
  `subject`/`rationale` distinti, non produca mai un rifiuto.
- **Risoluzione dell'ancora a indice+testo (§7.2, §7.3)** — corretto
  rispetto alla revisione 2, due gruppi di casi distinti:
  - **alla promozione/riancoraggio (§7.2.1)**: caso con due heading
    testualmente identici, verifica che i due indici risolvano a slug
    distinti (`reti`, `reti-2`) indipendentemente da quale dei due sia
    stato scelto, quando indice e testo concordano col corpo fresco; caso
    di indice fuori range dopo modifica del corpo ⇒
    `visual_promotion_anchor_stale`, **zero scritture**, slot non
    promosso, non un'invenzione né un fallback in coda; caso di testo non
    corrispondente all'indice dopo riordino degli heading ⇒ stesso esito
    fail-closed; caso positivo di retry dopo che il docente ha scelto
    un'ancora aggiornata ⇒ promozione riuscita, zero rigenerazione;
  - **al rendering, dopo una promozione già avvenuta (§7.2.2)**: un
    `headingSlug` persistito che smette di risolvere per una modifica
    *successiva* del corpo ⇒ fallback di coda, `anchorResolved:
    'fallback'` a runtime, mai persistito — questo è l'unico caso in cui il
    test deve aspettarsi un fallback, non una promozione.
- **`adaptSingular`** — equivalenza campo per campo fra la lettura
  compatibile e un `LessonVisualsManifest` a un elemento scritto a mano.
- **Adozione transazionale su dataset legacy popolato (§6.3)**: batch di
  lezioni con `LessonDoc.visual` reale e variegato, adottate
  indipendentemente, senza interferenza reciproca; caso di retry
  idempotente; caso di `visual_legacy_malformed` fail-closed.
- **Idempotenza del piano (§10.1), corretto rispetto alla revisione 3**:
  replay dell'autorizzazione con identità invariata restituisce lo stesso
  piano senza nuova prenotazione **anche dopo che il piano ha già promosso
  uno o più slot** (il caso che la revisione 3 gestiva male); identità
  persistita divergente dalla richiesta corrente ⇒ `corrupted_state`, mai
  `visual_plan_stale` (esito ritirato: nessun confronto contro il mondo
  attuale avviene più a questo livello, §10.1).
- **Risposta persa dopo la promozione dello slot 1, nuovo in questa
  revisione**: piano a 3 slot, slot 1 promosso con successo, la risposta
  della callable di promozione va persa lato client; il client ripete
  l'autorizzazione (o riapre il piano, §8.8) con lo stesso `requestId` ⇒
  stesso `VisualPlanRun` restituito, **nessuna nuova prenotazione, nessuna
  nuova proposta coordinata**, slot 1 ancora `promoted`, slot 2 e 3 nel
  proprio stato — verificato che il replay non fallisca né declassi il
  piano a stale nonostante `LessonDoc.visuals` sia legittimamente cambiato
  dalla promozione stessa (§10.1.1).
- **Mutazione esterna dell'array, nuovo in questa revisione**: piano
  attivo con `existingItemAssetIds` iniziale registrato; un'azione **fuori
  dal piano** (upload dalla galleria, rimozione manuale) modifica
  `LessonDoc.visuals.items` mentre il piano è in corso; il tentativo
  successivo di promuovere uno slot del piano ⇒
  `visual_plan_external_mutation`, zero scritture, slot ancora `ready`
  (§10.1.1) — distinto dal caso «risposta persa dopo promozione» sopra,
  dove la mutazione **è** del piano stesso e non deve produrre questo
  esito.
- **Lease — due `requestId` concorrenti sulla stessa lezione, nuovo in
  questa revisione, contro Emulator (simulazione di transazioni
  concorrenti)**: due autorizzazioni quasi simultanee con due `requestId`
  diversi per la stessa lezione (§10.3, Race A) ⇒ **una sola** acquisisce
  il lease e crea il proprio `VisualPlanRun`, l'altra riceve
  `visual_plan_already_active` con riferimento al piano vincitore, **mai
  due `VisualPlanRun` attivi contemporaneamente per la stessa lezione**;
  un terzo tentativo mentre il primo piano è ancora attivo (Race B) ⇒
  stesso esito, deterministico.
- **Lease scaduto e malformato, nuovo in questa revisione**: un lease con
  `expireAt` nel passato ⇒ riacquisizione condizionata riuscita per un
  nuovo piano, nella stessa transazione che lo rileva scaduto (§10.3); un
  lease presente ma che non supera il validatore strutturale ⇒
  `corrupted_state`, l'intera autorizzazione si ferma, zero scritture; un
  piano che raggiunge uno stato terminale (§8.7) rilascia il proprio lease
  nella stessa transazione — verificato che un piano successivo possa
  acquisire il lease **immediatamente**, senza attendere il TTL.
- **Upload — replay, conflitto, abbandono, cleanup, nuovo in questa
  revisione (§9.6–§9.9)**: stesso `requestId` e stesso `rawBytesSha256` ⇒
  replay, nessuna seconda normalizzazione, stessi byte restituiti; stesso
  `requestId` con `rawBytesSha256` **diverso** ⇒ `visual_upload_conflict`,
  zero scritture sul run esistente; stesso `requestId` con
  `VisualAnchorSelector` diverso ⇒ stesso esito; promozione di un
  `VisualUploadRun` riusa `§8.6` e produce `LessonVisualItem.source ===
  'uploaded'` e `styleVersion === 'uploaded/v1'`; cap combinato di tre
  rispettato indipendentemente dalla provenienza quando un piano e un
  upload sono in corso sulla stessa lezione contemporaneamente — chi
  promuove per primo occupa lo slot, il secondo riceve `visual_slot_full`
  se non c'è più spazio, qualunque sia la sua provenienza; abbandono di un
  upload non promosso ⇒ staging eliminato, nessuna conferma bloccante
  richiesta (§9.9); `VisualUploadRun` mai promosso oltre il TTL ⇒
  `expired`, cleanup dello staging.
- **Retry per slot che non perde asset riusciti (§8.5)**: piano a 3 slot
  con uno fallito, verifica che gli altri due restino `ready` e
  approvabili indipendentemente dal retry del terzo, fino al tetto di 2
  tentativi.
- **Formula del tetto (§12.1)**: `totalReserved` calcolato correttamente
  per `ceiling` 1/2/3 **includendo il fattore `maxAttemptsPerSlot`**
  (`proposalCap + generationCap × ceiling × maxAttemptsPerSlot`, non più
  `× ceiling` da solo); rilascio della quota non usata dopo la proposta
  coordinata e a ogni slot riuscito al primo tentativo; verificato contro
  un ledger di budget reale (Emulator); caso negativo esplicito: un
  settlement che tentasse di superare `totalReserved` (per esempio un
  terzo tentativo oltre `maxAttemptsPerSlot`) è strutturalmente impossibile
  da rappresentare, non solo respinto a runtime.
- **Upload — cap e formati (§9.2)**: file oltre 2.000.000 byte rifiutato
  prima della decodifica; SVG e GIF rifiutati dall'allowlist; WebP animato
  rifiutato nonostante lo sniffing positivo; PNG con canale alfa
  normalizzato su sfondo opaco `#f7f5f0`.
- **Rules su `publicLessonVisuals`/`publicLessons.visuals` (§5.4.1–§5.4.2),
  contro Firestore Emulator**:
  - **aggiunta**: dopo una promozione `add` su lezione svolta, lo studente
    autorizzato legge il byte doc e il nuovo `assetId` è fra le chiavi;
  - **rimozione**: dopo `§8.9`, il byte doc non contiene più la chiave
    rimossa (o il documento non esiste più se era l'ultima);
  - **sostituzione**: dopo `replace` (§8.6), la vecchia chiave è assente e
    la nuova presente nello stesso aggiornamento — mai un istante in cui
    coesistono entrambe o nessuna delle due;
  - **chiave extra**: un byte doc con un `assetId` nella mappa `bytes` che
    non compare in `publicLessons.visuals.items` ⇒ lettura studente
    **negata** (`bytesKeysAndDimsMatch`, condizione 4 di §5.4.1);
  - **chiave mancante**: un `assetId` nel manifest pubblico assente dalla
    mappa `bytes` ⇒ lettura studente **negata**, stessa condizione;
  - **asset estraneo**: un byte doc il cui contenuto dichiara
    `programId`/`importId` diversi da quelli del `publicLessons`
    corrispondente ⇒ lettura studente **negata** (condizione 3);
  - **`completed: false`**: byte doc e manifest esistono ma la lezione non
    è svolta ⇒ lettura studente **negata** (condizione 2) — indipendente
    dal fatto che il docente veda comunque i propri dati;
  - **import inattivo**: le stesse guardie di scoperta di `publicLessons`
    negano l'accesso quando l'import non è quello attivo (condizione 1),
    verificato che il byte doc non sia un'eccezione a quella regola;
  - **identità divergente**: dimensioni dichiarate nel manifest pubblico
    diverse da quelle nel byte doc per lo stesso `assetId` ⇒ lettura
    studente **negata** (condizione 4, stesso ramo di `bytesKeysAndDimsMatch`
    delle chiavi) — anche se le altre condizioni passerebbero;
  - **`bytesKeysAndDimsMatch` a rami espliciti (§5.4.2), nuovo in questa
    revisione**: eseguito **tre volte**, una per cardinalità — manifest a 1
    elemento con chiave/dimensioni corrette ⇒ concesso, con una divergenza
    ⇒ negato; manifest a 2 elementi, stessa coppia di casi per **ciascuno**
    dei due asset indipendentemente; manifest a 3 elementi, stessa coppia
    di casi per **ciascuno** dei tre — verifica che ogni ramo `size() == N`
    sia effettivamente raggiunto e che nessun ramo confonda l'ordine degli
    `items[i]` con quello delle chiavi della mappa;
  - **`isOwner()` senza risalita da `publicLessonId`, nuovo in questa
    revisione**: verificato che la lettura owner non esegua alcun `get()`
    su un ipotetico `lessonIdOf(publicLessonId)` (che non esiste) e che
    `isOwner()` da solo, globale, sia sufficiente indipendentemente da
    quale lezione il documento riguarda;
  - **scrittura client, in ogni caso sopra**: sempre negata, anche per
    l'owner autenticato.
- **Test del limite matematico di §4**, invariato dalla revisione 1.
- **Test del criterio di batching dinamico dell'export**, invariato.
- **Export v2 — davvero multi-asset (§14.2)**: lezione con 0/1/2/3 asset ⇒
  `assets` della lunghezza corrispondente, nello **stesso ordine** di
  `LessonDoc.visuals.items`; lezione non adottata (manifest singolare) ⇒
  `assets` a un elemento via `adaptSingular`, stesso formato v2; **composer
  web**: dato un risultato v2 con 3 asset per una lezione, verifica che il
  composer scriva tutti e tre i sidecar `visuals/{assetId}.json`/`.webp`,
  non solo il primo.
- **Export v2 — tutto-o-niente sull'intero batch, corretto rispetto alla
  revisione 3, nuovo in questa revisione, end-to-end contro Emulator**:
  batch di **tre lezioni**, un asset non recuperabile (hash non
  corrispondente) nella **seconda** ⇒ la callable restituisce un errore
  tipizzato e **zero** `AiVisualExportBatchResult` — verificato
  esplicitamente che **né la prima né la terza lezione** (entrambe valide)
  compaiano in un output parziale, non solo che la seconda fallisca;
  **collisione di `assetId`** fra due lezioni diverse dello stesso batch ⇒
  stesso esito, zero output per l'intero batch; **composer multi-batch**:
  un export che richiede due chiamate sequenziali (>13 lezioni, §14.3) con
  la seconda chiamata fallita ⇒ il composer non ha scritto alcun file
  dalla prima chiamata riuscita, zero ZIP prodotto per l'intero export.
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
- **Cleanup per cancellazione (§8.12), nuovo in questa revisione, contro
  Emulator**:
  - **lezione**, N=0/1/2/3 asset: conteggio Firestore 7R/5W costante al
    variare di N, delete Storage esattamente N;
  - **UDA**, L lezioni con N_i asset ciascuna: conteggio Firestore lineare
    in L (`L × (7R+5W)`), delete Storage pari a `Σ N_i`, mai un delete per
    prefisso nei log;
  - **corso/import**: verificato che il conteggio non passi dal percorso
    di §8.12 — resta `deleteImportPrefix`, invariato da VE;
  - **legacy singolare**: una lezione con `LessonDoc.visual` non ancora
    adottato, dentro una cancellazione UDA, è ripulita correttamente
    tramite `adaptSingular` in lettura, senza adozione preventiva né
    scrittura su `visuals`;
  - **forma array**: una lezione con 2-3 asset già promossi è ripulita con
    un solo record di recovery contenente l'intero array, non N record;
  - **stato corrotto**: una lezione in `visual_legacy_conflict` dentro un
    gruppo di cancellazione UDA da 5 lezioni ferma **solo quella lezione**
    (zero riferimenti rimossi, zero Storage cancellato per lei), mentre le
    altre 4 procedono; un `VisualCleanupRecoveryRecord` malformato prodotto
    da un'esecuzione precedente ⇒ `corrupted_state`, nessun tentativo di
    cancellazione basato su quel record.
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

---

## 21. Correzioni rispetto alla revisione 2 — blocker per blocker

La seconda review Codex ha approvato l'esito UX della revisione 2 ma
respinto dieci blocker architetturali. Sintesi puntuale, senza dover
ricostruire il diff:

1. **Migrazione fail-closed** — §6.1: la coesistenza di `visuals` e
   `visual` non è più ignorata in silenzio. Nuovo esito
   `visual_legacy_conflict`, zero rendering/scritture automatiche, mai una
   scelta silenziosa fra i due. Matrice completa 3×3 (assente/valido/
   malformato per ciascun campo) esplicitata in una tabella; l'adozione
   (§6.2) applica lo stesso controllo come passo 0, prima di ogni altra
   cosa, e non ripara — rifiuta.
2. **Forma chiusa del piano** — §5.5: `VisualPlanRun` ora dichiara
   `ownerUid`, `programId`, `importId`, `lessonId`, `publicLessonId`,
   `udaDir`, `requestId`, `planHash`, oltre ai campi già presenti, ciascuno
   con la propria fonte autorevole documentata (mai il payload client
   nudo). Percorso del documento dichiarato
   (`visualPlanRuns/{opaquePlanId}`). Un record presente ma divergente o
   malformato è `corrupted_state`, mai trattato come assenza (che
   duplicherebbe il piano) né come replay (che restituirebbe dati non
   verificati). `planHash` esteso a coprire esplicitamente destinazione
   (owner+programma+import+lezione+publicLessonId), quantità e stato
   iniziale.
3. **Budget e retry riconciliati** — §5.5, §8.5, §8.7, §12.1: il tetto
   iniziale ora è `proposalCap + generationCap × ceiling ×
   maxAttemptsPerSlot`, coprendo esplicitamente i due tentativi ammessi per
   slot. Rimossa la «conferma singola aggiuntiva dopo il tetto» della
   revisione 2, che violava l'autorizzazione unica: oltre il tetto di
   tentativi lo slot è terminale **per questo piano**, e un ulteriore
   tentativo richiede chiudere il piano e avviarne uno nuovo con la propria
   autorizzazione. Derivazione dello stato del piano corretta per il caso
   «tutti gli slot esauriti, zero promossi» (confluisce in `abandoned`).
   Invariante esplicito: il settlement non supera mai la prenotazione.
4. **Race body/ancora** — §7.2, riorganizzato in 7.2.1 (promozione/
   riancoraggio: fail-closed, `visual_promotion_anchor_stale`, zero
   scritture, nessun fallback) e 7.2.2 (dopo una promozione già avvenuta:
   la coda di VE §5.3 resta l'unica politica corretta). I test di §19
   corretti di conseguenza: il fallback non è più atteso alla promozione.
5. **Documento byte pubblico e Rules** — §5.4: `PublicLessonVisualBytesDoc`
   ora porta `publicLessonId`/`programId`/`importId` e, per asset,
   `width`/`height` oltre a `dataUri`/`mimeType`. Nuovo §5.4.1: Rules
   congelate in pseudocodice per `publicLessonVisuals` e
   `publicLessons.visuals` — owner-only per il docente, per lo studente
   solo con guardie di scoperta + `completed:true` + manifest valido +
   **corrispondenza esatta dell'insieme di chiavi** `bytes` con gli
   `assetId` pubblici + identità e dimensioni coerenti; scrittura client
   sempre negata. Elenco di test Emulator dedicato in §19.
6. **Export davvero multi** — nuovo §14.2: contratto v2 chiuso di
   `aiVisualExportBatch`, `assets: AiVisualExportAsset[]` (1..3, ordine del
   manifest) invece di un solo asset per lezione; validazione all-or-
   nothing estesa all'insieme, dedup sull'intero batch, percorso
   compatibile per la forma singolare senza forzare un'adozione; il
   composer deve iterare `assets` per intero, non fermarsi al primo.
7. **Cleanup lezione/UDA/corso** — nuovo §8.12: `VisualCleanupRecoveryRecord`
   chiuso (un record per lezione, array di asset), letture prima delle
   scritture, cancellazione Storage limitata agli `storageRefs` dimostrati
   (mai un prefisso a livello di lezione o UDA — solo corso/import restano
   autorevoli su `deleteImportPrefix`), chunking ≤100 lezioni, replay,
   record malformato ⇒ `corrupted_state`. Formule di costo per lesson/UDA
   con delta esplicito sul baseline misurato di VE-03.
8. **Cost model riconciliato con VE-03** — nuovo §12.0: baseline misurato
   riportato testualmente (promozione 9R/3W+1R/1W/1D Storage; rimozione
   7R/6W+1D; delete lezione 7R/5W+1D; delete UDA 3 lezioni 21R/15W+3D).
   Ogni riga successiva dichiara se è misurata (eredita il baseline) o
   stimata (piano, generazione, cleanup — nessun equivalente in VE-03).
   Prenotazione e run del piano contati come 2 scritture distinte
   (`VisualPlanRun` + ledger mensile di budget), non più collassati in 1.
9. **Diversità didattica** — §7.4: `anchorHeadingIndex` uguale **non è più**
   da solo un blocco strutturale — due immagini sulla stessa ancora restano
   legittime quando `subject` e `rationale` sono genuinamente distinti,
   esattamente il caso che il prototipo (`page-teacher-2`) già mostrava.
   Il controllo lessicale si sposta interamente su `subject` **e**
   `rationale` (nuovo), indipendenti dall'ancora; la revisione gratuita del
   piano (§8.4) resta il backstop reale contro i duplicati che i controlli
   lessicali non colgono.
10. **Evidenza e smoke** — `evidenze/multi-visual-00-review.md` §3 (nuova
    sezione per la revisione 3): filename/link riverificati, `format:check`
    e `git diff --check` rieseguiti, prototipo confermato bit-per-bit
    invariato rispetto al commit precedente (nessuna modifica di UI
    richiesta da questa revisione, quindi nessun nuovo smoke necessario —
    verificato con un diff, non assunto); costi runtime multi e Rules
    future marcati esplicitamente come non misurati finché non esistono
    test Emulator (§12, §17 di questo contratto).

---

## 22. Correzioni rispetto alla revisione 3 — punto per punto

La terza review Codex ha trovato sei difetti di coerenza/idempotenza
sopravvissuti alla revisione 3. Sintesi puntuale:

1. **Replay del piano dopo le sue stesse promozioni** — §10.1 riscritto:
   `planHash` calcolato **una sola volta**, alla creazione, da destinazione
   completa (`ownerUid`, `programId`, `importId`, `lessonId`,
   `publicLessonId`), `sourceBodyHash` e `existingItemAssetIds`
   **iniziali**, `quantity` — la formula ora include davvero i campi che
   §5.5 già promette. Un replay valida **identità persistita contro
   richiesta corrente**, mai il mondo attuale. Nuovo §10.1.1: la guardia
   sul mondo mutabile (coerenza dell'array) si applica **solo** al momento
   della scrittura, con `expectedLiveAssetIds = existingItemAssetIds ∪
   promotedAssetIdsByThisPlan` — nuovo campo `VisualPlanSlot.
   promotedAssetId` per calcolarlo senza rileggere `LessonDoc`.
   `visual_plan_stale` ritirato; nuovo `visual_plan_external_mutation` per
   la mutazione esterna.
2. **Un solo piano attivo, garantito** — nuovo §10.3: lease deterministico
   `visualPlanLeases/{SHA-256(ownerUid, lessonId)}`, **non** derivato dal
   `requestId` — è così che due `requestId` diversi per la stessa lezione
   contendono sullo stesso documento invece di crearne due. Acquisizione
   nella stessa transazione della prenotazione; rinnovo a ogni transizione
   di stato; rilascio al termine; riacquisizione condizionata per un lease
   scaduto; `corrupted_state` per un lease malformato. Race A (due tab,
   nessun piano) e Race B (piano già attivo) esplicite, risolte dalla
   serializzazione Firestore sullo stesso documento — mai una query.
3. **Contratto di idempotenza per l'upload** — nuovi §9.6–§9.9:
   `VisualUploadRun` indipendente dal piano (autorizzazione economica
   diversa, §9.6), `requestId` stabile, replay senza seconda
   normalizzazione, conflitto su byte/ancora diversi sotto lo stesso
   `requestId` (§9.7), promozione che riusa direttamente §8.6 producendo
   `source: 'uploaded'`/`styleVersion: 'uploaded/v1'` (§9.8), cap combinato
   di tre rispettato dalla rilettura transazionale indipendente dalla
   provenienza, nessuna partecipazione al lease del piano, abbandono senza
   conferma bloccante e cleanup TTL (§9.9).
4. **Rules con primitive reali** — §5.4.1 riscritto: `isOwnerOfLesson`
   (inventata) sostituita da `isOwner()` (globale, single-tenant, già in
   vigore — `hardening-audit-v1.md`); `passesLessonDiscoveryGuards`
   espansa negli helper reali citati da `sicurezza.md` §170
   (`isApprovedStudent`, `isClassmateOf`, `activeImportId`,
   `examModeAppliesToClass`). Nuovo §5.4.2: `bytesKeysAndDimsMatch` a rami
   espliciti per cardinalità 1/2/3, perché CEL non itera mappe generiche —
   sostituisce `assetIdsOf(...).toSet()`/`allAssetDimensionsMatch`, mai
   esprimibili. Nuovo §5.4.3: costo dichiarato dei `get()` aggiunti
   (+1 `get(publicLessons)` per la lettura studente del byte doc, il resto
   memoizzato con quanto già pagato oggi).
5. **Export tutto-o-niente sull'intero batch** — §14.2 corretto: un asset
   non recuperabile in **una qualunque** lezione del batch aborte l'intera
   callable **prima** di produrre output — non più «zero asset per quella
   lezione, le altre intatte». Procedura a due fasi (verifica pura, poi
   decisione sull'insieme). Composer corretto per attendere **tutte** le
   chiamate di un export multi-batch prima di scrivere qualunque file.
6. **Test e costi delle nuove guardie** — §19 esteso con: risposta persa
   dopo promozione slot 1 (resume senza nuova prenotazione), mutazione
   esterna dell'array, due `requestId` concorrenti (lease Race A/B), lease
   scaduto/malformato, upload replay/conflitto/abbandono/cleanup, Rules a
   rami 1/2/3, export tutto-o-niente sul batch. §12 esteso con le righe di
   costo del lease (+1R+1W per autorizzazione, §12.1) e di
   `VisualUploadRun` (§12.3), tutte marcate STIMATO. Evidenza aggiornata
   in `evidenze/multi-visual-00-review.md` §12.

---

## 23. Realizzazione MULTI-VISUAL-04

La UI usa un solo ingresso «Arricchisci». Una lezione nuova apre il piano
multi con quantità automatica o esatta entro tre; una lezione con il solo
manifest singolare conserva la gestione legacy finché il server non la adotta
nel primo piano multi. La galleria non mantiene una copia ottimistica del
manifest: promote, reorder e remove terminano con **una lettura puntuale** del
solo `LessonDoc`, validazione chiusa e patch della sola lezione nel tree.

### 23.1 Semplificazione UX successiva al gate DEV

Il primo smoke umano ha mostrato che la traduzione letterale delle operazioni
server in pulsanti produceva un flusso troppo frammentato. La superficie
definitiva mantiene gli stessi contratti e costi, ma li orchestra così:

- `Stima immagini` parte al click, senza un secondo dialog di conferma;
- le proposte sono elencate verticalmente e consentono di modificare soggetto,
  didascalia, testo alternativo e posizione prima della spesa immagine;
- un solo comando `Genera e applica N immagini` esegue in sequenza generate e
  promote degli slot confermati, senza retry onerosi automatici;
- ogni promozione riusa un `promotionRequestId` stabile anche dopo una risposta
  persa; un errore interrompe la sequenza e conserva quanto già applicato;
- al termine compare un riepilogo e non esistono più i comandi intermedi
  `Genera immagine`, `Applica immagine` o `Applica tutte`;
- l'ordine editoriale è quello autorevole di applicazione. I comandi `Su` e
  `Giù` sono rimossi dalla UI; sostituzione e rimozione restano disponibili e
  la rimozione conserva la conferma distruttiva;
- durante stima, generazione, promozione, refresh e rimozione la UI espone uno
  stato di avanzamento live e blocca i doppi click.

La callable di reorder resta nel backend per compatibilità del contratto, ma
non è esposta dalla UI. La dicitura storica «Applica tutte» nelle sezioni di
progetto e nel cost model descrive quindi N promozioni sequenziali: nella UI
finale la stessa operazione è inclusa in `Genera e applica N immagini`.

Il renderer N-way risolve tutte le ancore sul Markdown originale prima di
dividere il documento. L'ordine editoriale inverso, due immagini sulla stessa
ancora e un'ancora mancante non possono quindi far scomparire sezioni o figure.
Ogni frammento HTML attraversa la stessa sanificazione del renderer singolare.

Costi passivi invariati: zero callable all'apertura della scheda e zero letture
per lezioni senza manifest. Ogni mutazione riuscita aggiunge al percorso server
già misurato **1 lettura Firestore puntuale client** per il refresh; nessuna
query, listener, polling o rilettura globale. La lettura studente dei byte resta
una sola per le 1..3 immagini annunciate dal manifest.

Stato: codice e test implementati; il secondo rollout DEV e lo smoke umano
della semplificazione restano PENDING. Upload manuale e integrazione automatica
con «Genera lezione» non vengono dichiarati completati da questa fase.
