# MULTI-VISUAL — Arricchimento visivo multi-immagine (contratto e roadmap)

> **Stato: MULTI-VISUAL-00 — contratto e prototipo. Nessun runtime, nessuna
> dipendenza, nessuna Rule, nessun deploy.** Pilota di
> `AGENT-ORCHESTRATOR` (`agent-orchestrator-roadmap.md` §12), eseguito sul
> task manifest `MULTI-VISUAL-00`. **Gate GMULTI: PENDING.**
>
> Questo documento **non sostituisce**
> [`visual-enrichment-roadmap.md`](visual-enrichment-roadmap.md) (di seguito
> «VE»): lo **estende**. Ogni principio, invariante o meccanismo di VE non
> esplicitamente modificato qui resta in vigore, con la stessa forza, senza
> rinegoziazione. Dove questo documento non ripete un dettaglio di VE, il
> dettaglio di VE si applica invariato.
>
> **Prototipo:** [`prototipi/lesson-visual-enrichment-multi.html`](prototipi/lesson-visual-enrichment-multi.html)
> **Review di fase:** [`evidenze/multi-visual-00-review.md`](evidenze/multi-visual-00-review.md)

**Data:** 25 agosto 2026.
**Base:** `main` — merge di PR #421 (`agent-orchestrator-01`).
**Dipendenze documentali:** `visual-enrichment-roadmap.md` (VE-00→05A, **tutte
implementate nel codice, nessuna distribuita**; Gate GVISUAL PENDING);
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

**Un fatto che guida ogni decisione qui sotto:** alla data di questo
documento, **nessuna lezione reale ha mai avuto un'immagine**. VE-01→05A sono
implementate nel codice ma **mai distribuite**; Gate GVISUAL è PENDING. La
«compatibilità con l'immagine singola esistente» richiesta dal mandato si
riferisce quindi al **contratto e al codice già scritti** (`LessonDoc.visual`,
`publicLessons.visual`, `LessonVisualManifest`), non a dati di produzione da
migrare oggi. La migrazione descritta in §6 resta comunque **specificata con
piena rigidità**, perché deve restare corretta per il giorno — possibilmente
prima che MULTI-VISUAL-01 inizi — in cui GVISUAL passa e le prime immagini
singole reali vengono approvate.

---

## 2. Principi invarianti aggiuntivi

Quelli di VE §1 restano integralmente in vigore (una sola immagine **approvata
per slot**, Markdown mai riscritto, rollback totale per rimozione, «nessuna
immagine utile» di prima classe, approvazione esplicita, abbandono senza
tracce, visibilità come confine dati, nessun URL pubblico, nessun costo
passivo, profilo `quality`-only **per la sola generazione IA**). A questi si
aggiungono, congelati per questa funzione:

- **Il numero massimo di immagini per lezione è tre, non «più immagini».**
  Non è un limite arbitrario: è derivato matematicamente dal limite di
  documento di Firestore (§4). Non si negozia cambiando un parametro; cambiare
  il massimo richiede cambiare l'architettura di persistenza dei byte.
- **Le immagini di una lezione sono una lista ordinata, non un insieme.**
  L'ordine è visibile al docente e allo studente (galleria, sequenza nella
  pagina a parità di ancora) ed è **sempre** l'ordine dell'array persistito:
  non esiste un campo `order` ridondante da tenere sincronizzato.
- **L'origine di un'immagine (generata o caricata) è un dettaglio di
  provenienza, non un secondo contratto.** Un'immagine caricata dal docente
  attraversa la stessa macchina a stati (staging → anteprima → approvazione →
  promozione → rimozione) di una generata; cambia solo **come lo staging viene
  popolato** (§8).
- **Caricare un'immagine propria non eredita alcuna garanzia di stile o di
  contenuto.** «SchoolForge Sketch v1» è un vincolo che il server impone al
  *generatore*; un file caricato dal docente non passa da un generatore e
  quindi non può essere verificato contro quello stile. Questo è un
  **compromesso esplicito**, discusso in §9 e §17.
- **Ogni operazione sull'elenco (aggiungi, sostituisci, riordina, rimuovi) è
  una riscrittura atomica dell'intero array**, mai un aggiornamento
  posizionale. È la difesa strutturale contro le corse fra tab concorrenti
  (§10).

---

## 3. Relazione con VISUAL-ENRICHMENT — che cosa eredita, che cosa estende

| Livello | VE (singola immagine) | MULTI-VISUAL (questo contratto) |
|---|---|---|
| Stile IA | `schoolforge-sketch/v1`, fisso | invariato per le immagini **generate**; le immagini **caricate** non hanno stile verificato (§9) |
| Provenienza | solo generazione IA | generazione IA **o** upload docente |
| Cardinalità | 0 o 1 per lezione | 0..3 per lezione, ordinate |
| Manifest privato | `LessonDoc.visual` (oggetto singolo) | `LessonDoc.visuals` (contenitore con array `items`, §5) |
| Manifest pubblico | `publicLessons.visual` | `publicLessons.visuals` |
| Byte studente | `publicLessonVisuals/{id}.data` (stringa) | `publicLessonVisuals/{id}.bytes` (mappa per `assetId`, §5.3) |
| Normalizzazione | solo output del generatore | stesso normalizzatore, **anche** su byte caricati dal docente (§9) |
| Ancoraggio | 1 punto, split binario del token stream | fino a 3 punti, split N+1-way (§7) |
| Idempotenza | `requestId` nel namespace `visual-enrichment/v1` | stesso meccanismo; namespace distinto `visual-upload/v1` per gli upload (§10.1) |
| Rules Storage | nessuna regola nuova | **nessuna regola nuova** — il prefisso `repository/{ownerUid}/**` copre già un numero qualunque di file sotto `visuals/` |
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
all'apertura, per l'intero manifest** — resta possibile con un solo documento
Firestore.

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
stretto da monitorare: è un'operazione che fallirebbe sempre, per costruzione.
Tre è quindi il massimo strutturale a normalizzazione invariata (§7 di VE:
cap 200 KB, obiettivo 50–150 KB); alzarlo richiederebbe o abbassare
`MAX_VISUAL_BYTES` per immagine, o cambiare la forma di persistenza dei byte
(tornando alle alternative già scartate in VE §3.2, o introducendo un
documento per asset — che romperebbe l'invariante «una lettura» diventando
«N letture», discusso e respinto in §5.3).

Nel caso ordinario (immagini nell'obiettivo 50–150 KB, non al cap) il margine
è molto più ampio: tre immagini da 150 KB pesano `200_000 × 3 = 600_000` byte
in base64, margine ≈ 448 KB (≈ 43 %). Il calcolo al cap rigido è quello che
conta per la decisione, perché un contratto non può assumere che i docenti
restino sotto l'obiettivo.

---

## 5. Forme dati — chiuse e versionate

Tutte le forme sotto sono validate fail-closed come ogni artefatto
SchoolForge: chiavi esatte, nessuna proprietà extra, nessuna correzione
silenziosa. Un valore fuori forma è **rifiutato**, non aggiustato.

### 5.1 Manifest privato — `LessonDoc.visuals`

```ts
/** MULTI-VISUAL — contenitore delle immagini approvate di una lezione. */
export interface LessonVisualsManifest {
  /** Versione della forma del contenitore. */
  contractVersion: 'lesson-visuals/v1';

  /**
   * 1..3 elementi, mai vuoto e mai assente-ma-vuoto: se l'ultima immagine
   * viene rimossa, il campo `visuals` è rimosso dal documento (§6.4), non
   * lasciato come contenitore con `items: []`. Un array vuoto persistito
   * sarebbe uno stato indistinguibile da un bug di scrittura parziale.
   */
  items: LessonVisualItem[];
}

/** Un'immagine approvata, generata o caricata. */
export interface LessonVisualItem {
  /** Identificatore opaco. UUID v4 generato server-side. */
  assetId: string;

  /** Percorso Storage canonico, owner-only. Identico per forma a VE §4. */
  storageRef: string;

  /** Punto di inserimento. Vedi §7. */
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
   * Provenienza. Non cambia la validazione degli altri campi: cambia solo
   * quale campo di `styleVersion` è ammesso e se l'audit registra un
   * generatore o un caricamento (§8, §9).
   */
  source: 'generated' | 'uploaded';

  /**
   * `schoolforge-sketch/v1` per ogni immagine `source: 'generated'`.
   * `uploaded/v1` per ogni immagine `source: 'uploaded'` — letterale
   * distinto perché nessuna verifica di stile si applica a un file
   * caricato (§9). Non è un valore libero: l'unione è chiusa a questi due.
   */
  styleVersion: 'schoolforge-sketch/v1' | 'uploaded/v1';

  /**
   * SHA-256 del corpo lezione al momento della richiesta (proposta IA o
   * conferma di upload). Per `source: 'generated'` protegge dalla corsa
   * di contenuto di VE §8.2. Per `source: 'uploaded'` protegge dalla corsa
   * sull'**ancora**: un upload non deriva dal testo, ma la sua posizione sì,
   * e un'ancora scelta su un corpo che nel frattempo perde quell'heading
   * deve essere rilevata allo stesso modo (§10.2).
   */
  sourceBodyHash: string;

  /** Istante di approvazione del docente. */
  approvedAt: Timestamp;
}

export interface LessonVisualAnchor {
  headingSlug: string;
  headingText: string;
  placement: 'after-heading';
}
```

Costanti nuove, accanto a quelle già congelate in VE §15.1:

```ts
export const MAX_VISUALS_PER_LESSON = 3;
export const MAX_VISUAL_UPLOAD_INPUT_BYTES = 8_388_608; // 8 MiB, pre-normalizzazione
```

### 5.2 Manifest pubblico — `publicLessons.visuals`

Sottoinsieme, non lo stesso oggetto — stessa regola di VE §4: **non**
`storageRef`, `sourceBodyHash`, `sha256`, `byteLength`, `approvedAt` (metadati
di governo, mai dati allo studente).

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
  /** Serve al renderer per non chiedere i byte di un'immagine non caricata
   *  dal docente con provenienza rilevante all'accessibilità del testo
   *  circostante (nessun impatto sul rendering, solo diagnostico/audit). */
  source: 'generated' | 'uploaded';
}
```

### 5.3 Byte studente — `publicLessonVisuals/{publicLessonId}`

**Decisione, e perché non un array.** I byte sono una **mappa per
`assetId`**, non un array parallelo al manifest:

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

Una mappa per chiave permette a un **singolo aggiornamento di sostituzione o
rimozione di un'immagine di toccare un solo campo del documento**, invece di
riscrivere l'intero payload di tutte le immagini della lezione. Un array
avrebbe reso ogni sostituzione un'operazione O(N) sui byte esistenti per
nessun beneficio: l'ordine di visualizzazione vive nel manifest, che è
piccolo, non nel documento dei byte, che è grande. Il documento dei byte non
ha e non deve avere una nozione di ordine.

**Perché un solo documento e non un documento (o una sottocollezione) per
asset.** Una sottocollezione `publicLessonVisuals/{id}/items/{assetId}`
sembrerebbe più pulita, ma **rompe l'invariante di costo**: Firestore fattura
per documento letto, quindi tre immagini lette da tre documenti sono **tre**
letture, non una. L'intero contratto di VE §3.3 — «una lettura puntuale,
all'apertura» — dipende dal fatto che il numero di immagini non cambi il
numero di operazioni di lettura. Un solo documento con una mappa preserva
questo invariante esattamente: **1, 2 o 3 immagini costano sempre una sola
lettura Firestore**, fino al limite di documento calcolato in §4.

---

## 6. Compatibilità e migrazione dal manifest singolo

### 6.1 Lettura — nessuna migrazione richiesta per leggere

Il renderer e la vista studente leggono in quest'ordine, per ogni lezione:

1. `visuals` presente → è l'unica fonte, letta e resa così com'è. Il campo
   legacy `visual` (singolare), se presente, è **ignorato**: non può
   coesistere con `visuals` dopo l'adozione (§6.2).
2. `visuals` assente, `visual` (singolare) presente → **modello di lettura
   compatibile**: trattato come un array a un elemento
   `{ contractVersion: 'lesson-visuals/v1', items: [adaptSingular(visual)] }`,
   calcolato **a runtime**, mai scritto. `adaptSingular` copia i campi
   1:1 e imposta `source: 'generated'` (ogni immagine scritta sotto il
   contratto VE è per definizione generata) e riusa lo stesso `styleVersion`
   già presente (`schoolforge-sketch/v1`).
3. Nessuno dei due presente → nessuna lettura aggiuntiva, percorso odierno
   invariato, esattamente come VE §11.

**Conseguenza:** una lezione scritta sotto VE, mai toccata da MULTI-VISUAL,
si comporta **byte per byte come oggi** anche dopo che il codice
MULTI-VISUAL è distribuito. Non serve alcun backfill.

### 6.2 Scrittura — adozione pigra, atomica, irreversibile in forma

La prima volta che una lezione con manifest singolo riceve **una seconda
immagine**, o comunque la prima scrittura sotto il contratto MULTI-VISUAL, la
transazione di promozione (§8.4) esegue un passo di **adozione**:

1. rilegge `LessonDoc`. Se `visuals` è già presente, l'adozione è già
   avvenuta: salta questo passo (idempotenza, vedi sotto);
2. se `visual` (singolare) è presente e `visuals` è assente, costruisce
   `items[0] = adaptSingular(visual)` (stessa funzione di §6.1, ora
   eseguita **una volta, server-side, dentro la transazione** invece che a
   ogni lettura);
3. applica la mutazione richiesta (aggiungi/sostituisci, §8.4) all'array così
   ottenuto;
4. scrive `LessonDoc.visuals` con l'array risultante **e cancella il campo
   `visual`** nella stessa transazione — mai in due passi, perché uno stato
   intermedio con entrambi i campi presenti sarebbe ambiguo per il passo 1
   di una richiesta concorrente;
5. esegue la stessa adozione, nello stesso commit, su `publicLessons` se e
   solo se la lezione è svolta (stessa condizione di VE §6.2 passo 5);
6. il documento byte studente **non** richiede adozione: la sua forma
   (§5.3) non esisteva prima, quindi non c'è nulla da convertire — viene
   semplicemente scritto per la prima volta con la chiave del nuovo
   `assetId` (e, se l'adozione ha copiato un'immagine preesistente,
   anche con la chiave dell'`assetId` ereditato, letta dal vecchio
   `publicLessonVisuals/{id}.data` **prima** di sovrascrivere il documento).

**Idempotenza.** Se il passo di adozione viene ripetuto (retry di rete dopo
un commit riuscito ma una risposta persa), il passo 1 lo rileva:
`visuals` esiste già, quindi non si ricostruisce da `visual` una seconda
volta — si procede direttamente alla mutazione richiesta sull'array già
migrato. Un'adozione non può quindi duplicare `items[0]`.

**Perché «irreversibile in forma».** Una volta adottato, il contenitore non
torna mai alla forma singolare, nemmeno se tutte le immagini tranne una
vengono rimosse: un array a un elemento **non** viene "retrocesso" a
`visual` singolare. Il motivo è lo stesso del punto 4: reintrodurre un ramo
di scrittura che riporta alla forma vecchia raddoppierebbe permanentemente i
percorsi di scrittura da mantenere, per un beneficio nullo — il lettore in
§6.1 tratta `visuals` a un elemento esattamente come tratterebbe `visual`
singolare.

### 6.3 Cosa NON fa questa fase

Nessun job di backfill, nessuna scansione delle lezioni esistenti, nessuna
riscrittura pianificata. L'adozione è **lazy** (avviene solo quando il
docente agisce su quella lezione specifica) ed **esplicita** (mai in
background, mai per un'azione diversa da un'approvazione di immagine su
quella lezione).

### 6.4 Rimozione totale — rollback allo stato «mai avuto immagini»

Quando l'ultima immagine di `items` viene rimossa (§8.5), il campo `visuals`
è **rimosso** dal documento, non lasciato come `{ items: [] }`. Poiché
l'adozione ha già cancellato `visual` singolare al suo primo utilizzo (§6.2
passo 4) e non viene mai riscritto, una lezione che ha avuto ed è tornata a
zero immagini **non ha né `visual` né `visuals`**: è indistinguibile, byte
per byte nel documento, da una lezione che non ha mai avuto un'immagine. È
lo stesso rollback totale richiesto da VE §1, esteso a N immagini.

---

## 7. Ancoraggio con più immagini

### 7.1 Regola di indipendenza

Ogni elemento di `items` porta la propria `LessonVisualAnchor` (§5.1),
risolta con lo stesso risolutore puro di VE §15.1
(`resolveLessonVisualAnchor`, confronto esatto sullo slug, nessuna euristica).
**Non esiste alcun vincolo di unicità fra le ancore**: due o tre immagini
possono legittimamente ancorarsi allo stesso heading. Un docente che vuole
due illustrazioni sotto la stessa sezione non commette un errore che il
sistema deve impedire.

### 7.2 Ordine di inserimento nella pagina

Due ordini diversi governano due cose diverse, ed è il punto più facile da
confondere:

- **l'ordine dei *gruppi* di ancoraggio segue l'ordine fisico degli heading
  nel documento** — un'immagine ancorata a un heading che compare prima nel
  testo appare sempre prima, indipendentemente dalla posizione dell'elemento
  nell'array `items`;
- **l'ordine *dentro* un gruppo** (più immagini sullo stesso heading, oppure
  il gruppo di coda delle ancore perse) **segue l'ordine dell'array
  `items`** — è l'unico punto in cui l'ordine scelto dal docente nella
  galleria ha effetto visivo diretto.

Riordinare la galleria quindi **non** sposta un'immagine da una sezione
all'altra: sposta solo la sua posizione relativa fra immagini che
condividono la stessa sezione, o fra le immagini in coda.

### 7.3 Lo split del token stream — generalizzazione a N+1

Estensione diretta di VE §5.2 / §15.6, stesso principio: lo split avviene
**sul flusso di token**, mai su HTML sanificato, perché
`lesson-manual-contract.md` §5.1 vieta ogni iniezione dopo
`DOMPurify.sanitize()`.

```
Markdown sorgente
  → parser isolato (istanza Marked dedicata)
  → token stream
  → per ogni heading slug realmente presente nel documento, in ordine fisico:
      se uno o più item risolvono su quello slug, marca un punto di split
  → split in (G + 1) sottoinsiemi, dove G = numero di slug distinti risolti
    (G ≤ 3, poiché items.length ≤ 3)
  → HTML(A₀) … HTML(A_G)   — A_G è il frammento di coda
  → DOMPurify.sanitize() su ciascun frammento, indipendentemente
  → React: A₀ + [figure...] + A₁ + [figure...] + … + A_G + [figure di coda...]
```

Caso peggiore: 3 item su 3 heading distinti → 4 frammenti sanificati
indipendentemente. Caso 3 item sullo stesso heading → 2 frammenti. Zero item
risolti (tutte le ancore in fallback, incluso il caso di 0 immagini) → il
gruppo di coda contiene tutte le immagini fallback, o nessun frammento oltre
al corpo intero se non c'è alcun manifest. Una lezione **senza** `visuals`
produce esattamente il percorso di oggi: un solo frammento, un solo
`dangerouslySetInnerHTML`, verificato byte per byte contro il renderer legacy
— invariato da VE §15.6.

Ogni `<figure>` resta un nodo React costruito dal codice a partire dai campi
del manifest; `caption` e `altText` restano testo, mai markup, esattamente
come in VE §5.2.

### 7.4 Ancora persa — generalizzazione di VE §5.3

Politica identica, per ciascun item indipendentemente: slug assente ⇒
l'immagine va nel gruppo di coda, **mai indovinata altrove**, mai eliminata
automaticamente. Con più immagini, il docente può trovarsi con alcune
ancorate correttamente e altre in coda: l'avviso in scheda Contenuto elenca
**ciascuna** immagine con ancora persa separatamente («L'immagine 2 di 3 non
è più ancorata a…»), e il riancoraggio (VE §15.6) opera su un `assetId`
specifico, non sull'intero manifest.

---

## 8. Ciclo di vita — generazione e upload nella stessa macchina a stati

```
        ┌──────────┐  (solo generazione) proposta testuale IA
        │ PROPOSTA │  subject · anchor suggerita · caption · altText
        └────┬─────┘  oppure: NESSUNA IMMAGINE UTILE → fine, nulla creato
             │
             │  (upload: nessuna proposta — si entra qui direttamente
             │   dopo aver scelto un file, §9)
             ▼
        ┌──────────┐  normalizzazione server-side — STESSO normalizzatore
        │ STAGING  │  per entrambe le provenienze (VE §7, esteso in §9)
        └────┬─────┘  Storage: staging/{ownerUid}/{opaqueRunId}.webp
             │         Firestore: aiVisualCandidates/{opaqueRunId} (ticket)
     ┌───────┼───────────────┬──────────────────────┐
     │       │               │                      │
  rigenera  approva      abbandona              TTL scaduto
  /ricarica  │               │                      │
     │       ▼               ▼                      ▼
     │  ┌──────────┐    staging eliminato     staging eliminato
     │  │APPROVATO │    lezione INTATTA       lezione INTATTA
     │  └────┬─────┘
     │       │ promozione atomica (§8.4) — modalità `add` o `replace`
     │       ▼
     │  canonico: Storage owner + LessonDoc.visuals.items[k]
     │       │
     │       ├── lezione svolta ──▶ proiezione pubblica (manifest + mappa byte)
     │       └── lezione non svolta ──▶ nessuna proiezione
     │
     └─ nuovo staging; il canonico esistente NON è toccato finché
        il docente non conferma
```

### 8.1 Che cosa condividono generazione e upload

Staging, TTL 24 h (`AI_CONTENT_RUN_TTL_MS`, riusato), ticket
`aiVisualCandidates/{opaqueRunId}` che lega il run a una lezione **prima**
della generazione/dell'upload (stessa ragione di VE §15.3: senza legame, un
`sourceBodyHash` calcolato all'approvazione non protegge nulla), replay su
`requestId` ripetuto, abbandono, promozione, sostituzione, rimozione.

### 8.2 Che cosa NON condividono

| | Generazione | Upload |
|---|---|---|
| Chiamata a un provider | sì, immagine, `quality` | **mai** |
| Costo provider | sì (§11) | **zero** |
| Proposta testuale IA | sì, produce subject/anchor/caption/altText di partenza | **no** — il docente scrive caption/altText da zero (§9.3) |
| Verifica di stile | preambolo server-side costante | **nessuna** (§9.4) |
| Input | `subject` validato, ≤ 400 caratteri | file binario, ≤ 8 MiB grezzi |
| `styleVersion` scritto | `schoolforge-sketch/v1` | `uploaded/v1` |

### 8.3 Modalità della promozione — `add` o `replace`

Il payload di approvazione è un'unione chiusa a due rami, non un campo
opzionale (stesso idioma di `decision: 'none' | 'image'` in VE §15.1):

```ts
type VisualPromotionMode =
  | { mode: 'add' }
  | { mode: 'replace'; replaceAssetId: string };
```

- `add`: la nuova immagine si aggiunge in coda all'array. Fail-closed se,
  alla rilettura fresca dentro la transazione, `items.length` è già 3 →
  errore tipizzato `visual_slot_full`, **zero scritture**. Il controllo
  lato client (bottone disabilitato a 3/3) è UX, non autorità: solo la
  rilettura server-side dentro la transazione decide.
- `replace`: sostituisce l'elemento con `assetId === replaceAssetId`,
  **mantenendo la sua posizione nell'array**. Fail-closed se quell'`assetId`
  non esiste nell'array fresco → `visual_replace_target_missing`. I byte
  canonici del vecchio asset sono cancellati da Storage **dopo** che la
  transazione è andata a buon fine — stessa regola di ordine di VE §6.2/§6.3.

### 8.4 Ordine della promozione, passo per passo

Estensione diretta di VE §6.2, con il passo di adozione (§6.2) inserito
prima del passo 3:

1. rilegge `LessonDoc`, verifica `sourceBodyHash` del ticket contro il corpo
   salvato corrente. Disallineamento ⇒ **stop**, zero scritture;
2. verifica che i byte staged corrispondano a `sha256`/`byteLength`
   dichiarati nel ticket;
3. rilegge (o adotta, §6.2) `LessonDoc.visuals`, applica la regola di
   modalità (§8.3) all'array fresco;
4. copia i byte dallo staging al percorso canonico `storageRef` del nuovo
   `assetId`;
5. scrive `LessonDoc.visuals` con l'array risultante;
6. **se e solo se** `completed === true`: scrive `publicLessons.visuals`
   (stesso array pubblico) e aggiorna la mappa
   `publicLessonVisuals/{id}.bytes[assetId]` — in `replace`, la stessa
   scrittura rimuove anche la chiave del vecchio `assetId`
   (`FieldValue.delete()`), nello stesso aggiornamento di documento;
7. elimina lo staging e, in `replace`, pianifica la cancellazione del vecchio
   oggetto Storage canonico (eseguita dopo il commit, mai prima);
8. registra l'audit `lesson.visualApproved` con `mode`, `assetId`, posizione
   nell'array e conteggio totale immagini dopo l'operazione.

I passi 5–6 restano nella **stessa transazione** (stessa disciplina di
`setLessonCompleted`, riusata da VE §6.2). I passi 4 e 7 toccano Storage e
non sono transazionali con Firestore: un fallimento lascia al più un blob
canonico orfano — mai un manifest che punta a byte inesistenti.

### 8.5 Rimozione di un singolo elemento

Generalizzazione diretta di VE §6.5, per un `assetId` specifico invece che
per l'unico manifest:

1. rimuove la chiave `assetId` da `publicLessonVisuals/{id}.bytes`; se la
   mappa risultante è vuota, elimina l'intero documento (§5.3);
2. rimuove l'elemento da `publicLessons.visuals.items`; se l'array
   risultante è vuoto, rimuove il campo `visuals` dal documento
   `publicLessons`;
3. rimuove l'elemento da `LessonDoc.visuals.items`; se l'array risultante è
   vuoto, rimuove il campo `visuals` dal documento (§6.4);
   — 1, 2, 3 nella **stessa transazione**;
4. elimina l'oggetto Storage canonico di quell'`assetId`.

**Stato intermedio tollerato:** un blob Storage orfano (recuperabile dalla
stessa pulizia di VE §6.5). **Stato intollerabile, escluso dall'ordine:** una
proiezione pubblica che elenca un `assetId` i cui byte non esistono più.

Il prodotto V1 offre solo rimozione di un elemento alla volta. Nessuna azione
di bulk «rimuovi tutte» — meno superfici distruttive, e con al più tre
elementi il costo di ripetere l'azione è trascurabile.

### 8.6 Riordino — operazione a costo quasi zero

Callable dedicata, sola metadata, **mai** Storage, **mai** provider:

```ts
interface ReorderLessonVisualsInput {
  programId: string;
  importId: string;
  lessonId: string;
  /** Permutazione completa degli assetId correnti nell'ordine desiderato. */
  order: string[];
}
```

La transazione rilegge l'array live, verifica che `order` sia **esattamente**
una permutazione dell'insieme di `assetId` correnti (stessa cardinalità,
stessi elementi, nessuno stato staging incluso) — altrimenti
`visual_order_stale`, zero scritture (§10.3) — poi riscrive
`LessonDoc.visuals.items` nel nuovo ordine e, se la lezione è svolta,
`publicLessons.visuals.items` nello stesso ordine. **Il documento dei byte
non viene toccato**: è una mappa per `assetId`, indifferente all'ordine
(conseguenza diretta della scelta di §5.3). Costo: 1 callable, 1 transazione
Firestore a 2 letture + al più 2 scritture, zero Storage, zero provider.

### 8.7 Passaggio svolta ⇄ non svolta

Stessa struttura di VE §6.6, sull'intero array invece che su un singolo
manifest: **→ svolta** proietta `visuals` pubblico e la mappa byte se e solo
se `LessonDoc.visuals` è valido (manifest malformato ⇒ fail-closed, zero
scritture — copiarlo violerebbe il contratto). **→ non svolta** rimuove
sempre entrambe le proiezioni pubbliche, anche se già assenti (idempotente);
il canonico privato non è mai toccato.

---

## 9. Upload — normalizzazione server-side e limiti

### 9.1 Perché è la stessa pipeline di normalizzazione, non una nuova

VE §7 descrive una pipeline di sette passi (sniffing dei magic byte,
decodifica reale delle dimensioni, resize senza upscaling, conversione WebP,
strip dei metadati, cap rigido, hash sui byte finali) pensata esplicitamente
per **non fidarsi** di ciò che il chiamante dichiara — che sia un provider
IA o il file di un docente non cambia questa premessa. L'upload **riusa
integralmente** questa pipeline: cambia solo il passo 0, quello che oggi non
esiste in VE perché il provider restituisce sempre WebP.

### 9.2 Passo 0 — accettazione dell'input grezzo, prima della pipeline

Fail-closed, nell'ordine:

1. **cap di dimensione grezza**: `byteLength ≤ MAX_VISUAL_UPLOAD_INPUT_BYTES`
   (8 MiB, §5.1) verificato **prima** di qualunque decodifica. Un file più
   grande produce `visual_upload_too_large` senza toccare un decoder — è la
   stessa logica difensiva di VE §15.2 contro gli input-bomb: non si spende
   CPU di decodifica su un input che si può scartare guardando solo la sua
   lunghezza dichiarata dal trasporto;
2. **sniffing dei magic byte reali**, allowlist allargata rispetto a VE (che
   verifica solo l'output WebP del provider): PNG (`89 50 4E 47 0D 0A 1A
   0A`), JPEG (`FF D8 FF`), WebP (`RIFF…WEBP`). Qualunque altra firma ⇒
   `visual_upload_unsupported_format`. Il `Content-Type` dichiarato dal
   client **non è mai autorevole** — stessa regola di VE §7 passo 1;
3. da qui la pipeline di VE §7 riprende **identica**: decodifica reale,
   resize, conversione WebP, strip metadati, cap 204 800 byte, hash.
   **L'output è sempre WebP**, indipendentemente dal formato di input — non
   esiste alcun percorso che salvi PNG o JPEG come canonico.

### 9.3 Che cosa l'upload NON ha, e come si compensa

Non esiste una fase di proposta testuale: nessun modello suggerisce
`caption`/`altText`/ancora per un file caricato. Il docente li scrive
esplicitamente prima di poter confermare — gli stessi vincoli di VE §9.6 si
applicano identici (obbligatori, non vuoti, validati anche server-side,
devono dire *che cosa* l'immagine fa capire, non solo *che cosa* mostra). Il
punto di ancoraggio è scelto dal docente fra gli heading realmente presenti
nella lezione (stessa interfaccia del riancoraggio VE §15.6: nessun campo di
testo libero).

### 9.4 Perché nessuna verifica di stile — e il compromesso che questo apre

**Decisione esplicita.** VE §16 elenca «upload di immagini proprie» come
esplicitamente fuori scope, con la motivazione «è una funzione diversa, con
problemi diversi (licenze, moderazione, formati, provenienza)». Il mandato
di questo pilota **riapre** quel punto deliberatamente. Questo documento non
finge che il problema sia scomparso: lo delimita.

- **Nessuna moderazione automatica del contenuto caricato.** SchoolForge è
  uno strumento a **singolo docente** (`brief.md`): non esiste un canale
  multi-tenant attraverso cui un utente arbitrario possa caricare materiale.
  Il modello di fiducia è lo stesso già accettato per ogni altro contenuto
  che il docente scrive o importa nel repository — nessuna funzione
  esistente di SchoolForge modera il Markdown che il docente scrive, e
  un'immagine caricata non riceve un trattamento diverso.
- **Nessuna garanzia di licenza o provenienza.** Il sistema non verifica se
  il docente ha diritto di usare il file caricato. Resta, esplicitamente,
  responsabilità del docente — stessa formulazione di VE §9.5, estesa dal
  giudizio di approvazione al contenuto stesso del file.
- **Lo strip dei metadati (EXIF/ICC/XMP) è più rilevante qui che per le
  immagini generate.** Una foto scattata da un docente è precisamente il
  tipo di file che porta GPS, modello del dispositivo, timestamp: la
  pipeline di VE §7 passo 5 li rimuove **sempre**, indipendentemente dalla
  provenienza. Per l'upload questo passo non è un dettaglio ereditato per
  coerenza: è la principale mitigazione di privacy della funzione.
- **Nessuna persona riconoscibile — stesso divieto di VE §9.4 — non è
  verificabile automaticamente per un upload.** Per le immagini generate il
  divieto è imposto a monte, nel prompt del generatore. Per un upload non
  esiste un prompt da vincolare: il divieto resta **contrattuale e
  editoriale** (il docente non deve caricare foto di persone riconoscibili),
  non **strutturale**. È un rischio residuo dichiarato in §17, non un buco
  scoperto dopo.

### 9.5 Nessun dato raggiunge un provider

L'upload non chiama alcun provider di testo o immagine: zero payload esce
verso l'esterno. È strutturalmente più privato della generazione, non meno —
vale la pena dirlo esplicitamente perché è l'unico punto in cui questo
contratto è **più stretto** di VE, non più permissivo.

---

## 10. Idempotenza e corse

### 10.1 Namespace distinto per gli upload

Riuso integrale dell'impianto di VE §8.1, con un namespace proprio:

```
opaqueRunId = SHA-256(canonical(['visual-upload/v1', ownerUid, requestId]))
```

distinto da `visual-enrichment/v1` (generazione, VE) e da `ai-content/v1` /
`ai-content-budget/v1`: una `requestId` non può collidere fra domini. Il
`requestId` è generato dal client, stabile fra i retry, come in VE.

**Perché il replay conta anche senza costo provider.** Per la generazione, il
replay evita una seconda spesa. Per l'upload non c'è spesa da evitare, ma
c'è comunque un'invocazione di Function e un ricalcolo di normalizzazione da
non ripetere inutilmente a ogni retry di rete: stesso meccanismo, motivazione
di efficienza invece che di costo monetario.

### 10.2 La corsa fra modifica della lezione e conferma — upload incluso

Identica a VE §8.2, applicata anche agli upload nonostante non derivino dal
testo: il `sourceBodyHash` in un ticket di upload protegge **l'integrità
dell'ancora**, non la fedeltà del contenuto (§5.1). Se il docente riscrive la
lezione fra la scelta del file e la conferma, la promozione rilegge il corpo
fresco e, se l'heading scelto non esiste più, applica la stessa politica di
VE §5.3 (coda, mai indovinato altrove) — non un rifiuto totale
dell'operazione: l'upload resta approvabile, solo con posizione ricalcolata.

### 10.3 Corse sull'elenco — perché ogni scrittura rilegge l'intero array

Tre scenari concreti, e la difesa per ciascuno:

| Scenario | Rischio se non gestito | Difesa |
|---|---|---|
| Due tab approvano ciascuna una quarta immagine quando ce ne sono già 2 | entrambe potrebbero passare un controllo lato client «meno di 3» basato su uno stato stantio, superando il tetto | la transazione rilegge `items.length` **dentro** il commit; la seconda a committare vede già 3 elementi e riceve `visual_slot_full`, zero scritture |
| Un riordino viene inviato con un array `order` calcolato prima che un'altra tab rimuovesse un'immagine | il riordino potrebbe "resuscitare" un `assetId` appena rimosso, riscrivendolo nell'array | la transazione verifica che `order` sia **esattamente** una permutazione dell'insieme live; un disallineamento (elemento mancante o in più) produce `visual_order_stale`, zero scritture — mai un merge parziale |
| Approvazione e rimozione sullo stesso `assetId` in corse ravvicinate | una rimozione potrebbe cancellare byte che la promozione sta ancora scrivendo, o viceversa | entrambe le transazioni rileggono `LessonDoc.visuals` fresco prima di scrivere; Firestore stessa serializza le transazioni in conflitto sullo stesso documento, quindi una delle due vede lo stato post-commit dell'altra e fallisce con un errore tipizzato coerente (`visual_replace_target_missing` se il target di un `replace` è appena stato rimosso) invece di produrre uno stato incoerente |

**Regola generale, che riassume la tabella:** nessuna operazione sull'elenco
scrive mai un aggiornamento posizionale (`items[2] = …`). Ogni operazione
legge l'array intero dentro la transazione, lo trasforma in memoria, e
riscrive l'array intero. È più caro di un aggiornamento di campo puntuale,
ma con al più tre elementi il costo è trascurabile, e ed è l'unico modo per
cui una transazione concorrente non possa mai produrre un array
strutturalmente invalido (duplicati, buchi, permutazioni parziali).

---

## 11. Orchestrazione «Genera lezione con immagini» — a costi separati

### 11.1 Che cos'è, e che cosa non è

Un punto di ingresso guidato che propone, genera e fa approvare **fino a
tre** immagini per la lezione in un'unica sessione del docente. **Non è**
una nuova chiamata batch a un provider, e non introduce alcuno sconto o
prezzo combinato: sotto il cofano è **N flussi indipendenti** dei §8/§10,
ciascuno con il proprio `requestId`, il proprio ticket, la propria
prenotazione di budget e il proprio `opaqueRunId`. L'orchestrazione è
interamente un'organizzazione dell'interfaccia sopra un meccanismo già
specificato — nessun nuovo contratto di costo.

**«A costi separati» significa, testualmente:** ogni immagine mostra e
richiede conferma della propria stima **prima** di essere generata, e ogni
riga del cost model (§12) è per immagine, mai per lezione. Un docente che
avvia l'orchestrazione e poi conferma solo 1 delle 3 proposte paga
esattamente il costo di 1 proposta + 1 generazione, non un pacchetto da tre.

### 11.2 Flusso

1. Il docente apre «Genera lezione con immagini» dalla scheda Contenuto.
   Disabilitato con motivo visibile alle stesse condizioni di VE §14 punto 1
   (corpo assente, vuoto o non salvato) **e** quando la lezione ha già 3
   immagini approvate (nessuno slot libero da proporre).
2. SchoolForge esegue **fino a `3 − items.length` proposte testuali
   indipendenti** (una lezione con 0 immagini propone fino a 3; con 1 già
   approvata, fino a 2), ciascuna un `AiContentRequest{kind:
   'visual_proposal'}` **distinto**, con il proprio costo e il proprio
   `requestId`. Ogni proposta può concludersi con `decision: 'image'` o
   `decision: 'none'` **indipendentemente dalle altre**: non è previsto un
   esito unico per l'intera sessione.
3. Il docente vede un pannello per proposta (stessi campi di VE §14 punto 3:
   soggetto, utilità didattica, ancora suggerita, caption, altText, o
   «nessuna immagine utile» con motivazione). Ogni pannello è modificabile e
   **confermabile indipendentemente**: il docente può generare l'immagine 1
   e lasciare la 2 e la 3 in sola lettura, o abbandonarle, senza che questo
   influisca sulle altre.
4. Ogni «Genera immagine» confermata è una chiamata `aiVisualGenerate`
   distinta, a costo dichiarato e confermato singolarmente — stesso stato
   `STAGING` di §8, un ticket per immagine.
5. «Applica alla lezione» promuove **le sole immagini approvate dal
   docente** in quella sessione, nell'ordine in cui sono state confermate
   (append sequenziale, modalità `add`, §8.3) — mai un'unica transazione
   multi-immagine: ogni promozione è la transazione descritta in §8.4,
   eseguita in sequenza, cosicché un fallimento sulla seconda immagine non
   annulla la prima già promossa (coerente con «nessuna scrittura
   canonica senza un atto esplicito» di VE §1: ogni atto è la conferma di
   *quella* immagine, non della sessione).

### 11.3 Interazione con l'upload nella stessa sessione

Il punto di ingresso guidato include anche l'opzione «Carica un file» per
ciascuno slot libero, come alternativa alla proposta IA — stesso principio
di §8: uno slot può essere popolato generando o caricando, mai una terza
via. Uno slot con un file caricato salta i passi 2–4 (nessuna proposta,
nessuna generazione) ed entra direttamente nello stato di anteprima di §9.3.

---

## 12. Cost model

Estende la tabella di VE §13; ogni riga è **per immagine**, come richiesto
esplicitamente dal mandato («a costi separati»). Le righe già presenti in VE
per operazioni non toccate da questo contratto (riancoraggio di
un'immagine singola, cambio svolta/non svolta) restano valide e non sono
ripetute qui se identiche; sono riportate solo dove il numero cambia con la
cardinalità.

| Momento | Provider | Firestore | Storage | Function |
|---|---|---|---|---|
| **Proposta (per immagine)** | 1 chiamata testo, `quality` | 1 scrittura run + prenotazione | — | 1 |
| **Generazione (per immagine)** | 1 chiamata immagine, `quality` | 1 aggiornamento run | 1 scrittura staging | 1 |
| **Upload — accettazione file (per immagine)** | **0** | 1 scrittura run (ticket) | 1 scrittura staging | 1 (normalizzazione) |
| **Replay (risposta persa, qualunque provenienza)** | **0** | 1 lettura run | 0 | 1 |
| **Approvazione — modalità `add` (per immagine)** | 0 | 2 letture transazionali (lezione + array), 1 scrittura privata, +1 scrittura pubblica e +1 aggiornamento mappa byte solo se svolta, 1 audit | 1 copia + 1 delete staging | 1 |
| **Approvazione — modalità `replace` (per immagine)** | 0 | come `add`, + 1 rimozione chiave mappa byte se svolta | 1 copia + 1 delete staging + 1 delete canonico precedente (dopo commit) | 1 |
| **Adozione da manifest singolo (una tantum per lezione)** | 0 | inclusa nella transazione di approvazione che la innesca — nessuna scrittura aggiuntiva | 0 | 0 |
| **Riordino** | 0 | 2 letture transazionali, ≤ 2 scritture (privata + pubblica se svolta) | **0** | 0 (client) |
| **Rimozione (per immagine)** | 0 | 3 eliminazioni/aggiornamenti transazionali, 1 audit | 1 delete | 1 |
| **Visualizzazione studente — lezione senza `visuals`** | 0 | **0** | 0 | 0 |
| **Visualizzazione studente — lezione con 1..3 immagini** | 0 | **1 lettura puntuale** (indipendente dal numero di immagini, §5.3), all'apertura | 0 | 0 |
| **Elenchi / card** | 0 | **0** | 0 | 0 |
| **Orchestrazione «Genera lezione con immagini» completa (3 immagini generate)** | 3 chiamate testo + 3 chiamate immagine, ciascuna a costo dichiarato e confermato singolarmente | somma delle righe Proposta+Generazione+Approvazione ×3 | somma ×3 | somma ×3 |

Invarianti di costo, invariati nella sostanza da VE §13, riverificati per N
immagini:

- **zero** listener, **zero** polling, **zero** indici nuovi;
- **zero** letture per card, in ogni superficie, indipendentemente dal
  numero di immagini;
- **zero** costo su ogni lezione priva di immagini — il caso maggioritario,
  oggi il 100 % delle lezioni esistenti;
- **il costo di lettura studente non cresce con il numero di immagini**
  (1 lettura per 1, 2 o 3 — conseguenza diretta di §5.3, ed è l'argomento
  economico a favore della mappa invece dell'array/sottocollezione);
- il costo del provider è pagato **solo** su azione esplicita del docente,
  **per immagine**, mai in blocco;
- l'upload **non** ha mai un costo di provider, in nessun momento del suo
  ciclo di vita.

---

## 13. Sicurezza e privacy — delta rispetto a VE

Tutto VE §9 si applica invariato a ogni immagine `source: 'generated'`. Il
delta:

- **§9.1–9.3 di VE (corpo non attendibile, prompt composto dal server, nessun
  dato studente al provider)** si applicano **solo** al percorso di
  generazione: l'upload non ha un prompt e non chiama un provider, quindi
  quelle difese sono strutturalmente inapplicabili — non aggirate, assenti
  per assenza del bersaglio (§9.5).
- **§9.4 di VE (contenuto dell'immagine)** resta il criterio editoriale per
  *entrambe* le provenienze, ma cambia la sua natura per l'upload: da
  vincolo imposto al modello a responsabilità dichiarata del docente (§9.4
  di questo documento).
- **§9.6 di VE (didascalia e testo alternativo)** si applica identico,
  indipendentemente dalla provenienza: nessuna eccezione.
- **§9.7 di VE (nessuna modifica a CSP/DOMPurify/Storage Rules/guardie di
  scoperta)** resta vero anche qui: la Storage Rule esistente
  (`repository/{ownerUid}/**`, owner-only) copre un numero qualunque di
  oggetti sotto `visuals/` senza modifiche (§3, riga Rules Storage). Le
  Rules Firestore su `publicLessons.visuals`/`publicLessonVisuals` **devono**
  cambiare forma in una fase implementativa futura (array/mappa invece di
  oggetto singolo) — non in questo documento, che non scrive Firebase.

---

## 14. Rendering, accessibilità, export — delta

**Rendering.** Ogni `<figure>` mantiene gli stessi requisiti di VE §10:
`<figcaption>` testo visibile, `alt` sempre presente e sostanziale,
`loading="lazy"`, `decoding="async"`, `width`/`height` dichiarati dal
manifest per riservare spazio, `max-width: 100%`, nessuna animazione con
`prefers-reduced-motion: reduce` rispettato, nessuna lightbox/zoom/carosello.
Con più immagini nello stesso gruppo di ancoraggio (§7.2), le figure si
impilano verticalmente nell'ordine dell'array — nessuna griglia, nessun
carosello: resta testo scorribile, coerente con `lesson-manual-contract.md`.

**Galleria docente.** La scheda «Gestisci immagini» mostra le 0–3 immagini
in ordine, ciascuna con provenienza (badge «Generata» / «Caricata»),
posizione di ancoraggio o avviso di ancora persa, e le azioni sostituisci /
rimuovi / riancora per elemento, più un controllo di riordino (drag oppure
frecce su/giù — il prototipo usa frecce per garantire l'accessibilità da
tastiera senza dipendere da drag-and-drop).

**Export ZIP — nessuna modifica al formato.** I sidecar di VE-03C
(`visuals/{assetId}.json`, `visuals/{assetId}.webp`) sono già chiavati per
`assetId`, non per lezione: un archivio con 0, 1, 2 o 3 file per lezione è
già rappresentabile dal formato esistente **senza alcuna modifica**. Cambia
solo il limite derivato del batch (sotto).

**`aiVisualExportBatch` — nuovo criterio di dimensionamento del batch.** Il
vecchio limite fisso di VE-03C (32 lezioni per richiesta, derivato da
`8_000_000 ÷ 204_800 = 39,06` con un'immagine per lezione) non regge più: nel
caso peggiore una lezione pesa fino a `3 × 204_800 = 614_400` byte, quindi
`8_000_000 ÷ 614_400 = 13,02` → **13 lezioni per batch nel caso peggiore
assoluto** (ogni lezione con 3 immagini al cap rigido), contro le 32 di
prima — una riduzione del 59 %. Invece di congelare un nuovo numero fisso
(sbagliato per ogni lezione con meno di 3 immagini, che sono la stragrande
maggioranza), il client cambia strategia di raggruppamento: accumula
lezioni nel batch corrente sommando `min(itemCount, 3) × 204_800` byte
worst-case; prima di aggiungere una lezione che farebbe superare
`8_000_000`, chiude il batch e ne apre uno nuovo. Concorrenza 2 batch,
deduplica e verifica d'ordine restano come in VE-03C. In pratica, con la
maggioranza delle lezioni a 0–1 immagini, i batch reali conterranno molte
più di 13 lezioni; il numero 13 è solo il limite di un caso patologico che
il criterio dinamico gestisce comunque correttamente.

---

## 15. Rollout e rollback

### 15.1 Sequenza dipendente da GVISUAL

MULTI-VISUAL **non può** iniziare l'implementazione runtime (fase 01)
scavalcando la dipendenza dichiarata in testa a questo documento: VE-01→05A
sono già scritte nel codice, quindi il lavoro di tipi/contratti di
MULTI-VISUAL-01 può procedere in parallelo alla revisione umana di VE
(Gate GVISUAL), **ma** nessuna fase MULTI-VISUAL che tocca persistenza, UI o
distribuzione (03, 04, 05) può precedere una decisione esplicita su GVISUAL,
per due ragioni indipendenti:

1. **Prodotto:** se il Gate GVISUAL conclude che l'arricchimento visivo a
   una immagine «non vale il suo costo» (esito esplicitamente ammesso da VE
   §17.1), estendere la stessa funzione a tre immagini prima di quella
   risposta sarebbe investire su un'ipotesi già respinta.
2. **Tecnico:** §6 di questo documento specifica l'adozione dal manifest
   singolo assumendo che quel manifest, quando esisterà in produzione, sia
   conforme al contratto VE. Se VE cambia forma durante la revisione del
   Gate GVISUAL, l'adattatore `adaptSingular` (§6.1) deve essere aggiornato
   di conseguenza **prima** di essere usato su dati reali.

### 15.2 Due percorsi possibili, e quale raccomandare

| Opzione | Descrizione | Compromesso |
|---|---|---|
| **A — sequenziale** | VE-05 esegue generazioni reali, Gate GVISUAL decide, **poi** MULTI-VISUAL-01→05 costruisce sopra un contratto singolo già validato in produzione | Più lento; l'adozione (§6) viene esercitata su dati reali, non solo su carta |
| **B — diretto** | MULTI-VISUAL assorbe da subito il ruolo di V1 dell'arricchimento visivo; VE-05 esegue le sue generazioni reali già dentro la forma a array (un array a un elemento durante il beta, prima che il docente aggiunga una seconda immagine) | Più veloce; l'adozione (§6) resta **non esercitata su dati reali** fino a quando non esisterà davvero una lezione con ≥ 2 immagini — un rischio noto, non un difetto nascosto |

**Raccomandazione di questo documento: opzione A.** Nessuna immagine reale
esiste oggi (§1): non c'è alcun costo di attesa nel far passare prima Gate
GVISUAL su una singola immagine, che resta comunque la funzione più
rischiosa dal punto di vista della qualità didattica (VE §17.1). La
decisione finale è del docente al gate umano di questo pilota, non di
questo documento.

### 15.3 Flag di distribuzione, sul modello di `AI_VISUAL_MODE`

Fase implementativa futura, non questa: `AI_VISUAL_MODE` (VE-02) governa già
`disabled | mock | openai` per la generazione. MULTI-VISUAL introduce, sullo
stesso modello:

- `AI_VISUAL_MULTI_WRITE` (`disabled | enabled`, default `disabled`) — gate
  la capacità di **scrivere** sotto il contratto a array (adozione inclusa).
  A `disabled`, ogni lezione resta per sempre nella forma che aveva:
  singolare se già adottata da VE, assente se non ha mai avuto immagini.
- `AI_VISUAL_MULTI_READ` (`disabled | enabled`, default coerente con
  `AI_VISUAL_MULTI_WRITE` ma **distinto**) — gate la capacità del renderer
  di **leggere** `visuals` array. Separare lettura e scrittura è la difesa
  di rollback descritta sotto.

### 15.4 Il rischio di rollback che riguarda i dati, non il codice

**Rischio reale, non teorico.** Una volta che una lezione è stata adottata
(§6.2) — cioè ha ricevuto una seconda immagine — il suo `LessonDoc` ha
`visuals` e **non ha più** `visual`. Se il flag di **scrittura**
(`AI_VISUAL_MULTI_WRITE`) viene disattivato dopo un incidente, il codice
runtime torna a comportarsi come se MULTI-VISUAL non esistesse — ma quella
specifica lezione, già adottata, non torna leggibile dal vecchio renderer a
manifest singolo: il vecchio codice non sa leggere `visuals`.

**Mitigazione, per questo la lettura ha un flag proprio.** Il renderer che
sa leggere `visuals` (§6.1) viene distribuito e attivato (`AI_VISUAL_MULTI_
READ = enabled`) **prima**, e indipendentemente, dall'attivazione della
scrittura. Un rollback che disattiva solo `AI_VISUAL_MULTI_WRITE` impedisce
nuove adozioni ma lascia il renderer capace di leggere quelle già avvenute:
nessuna lezione diventa illeggibile. Solo un rollback che riporta indietro
anche il **codice del renderer** (non solo il flag) riesporrebbe questo
rischio — ed è la ragione per cui un rollback di emergenza deve disattivare
i flag prima di considerare un rollback di codice, mai il contrario.

### 15.5 Rollback di questa fase (MULTI-VISUAL-00)

Essendo questa fase esclusivamente documentazione e prototipo, il rollback è
per definizione completo e gratuito: non aprire la PR a merge, o chiuderla.
Nessuno stato persistito, nessun file fuori da `documentazione/**`, nessuna
azione da disfare.

---

## 16. Fuori scope

Ereditati da VE §16 e confermati: diagrammi tecnici precisi, KaTeX/Mermaid,
profilo `economy`, import di immagini da ZIP, modifica dell'immagine dopo la
generazione (ritaglio/filtri), stili alternativi configurabili, persone
riconoscibili.

Nuovi per questo documento:

- **più di tre immagini per lezione** — vedi il vincolo matematico di §4;
- **immagini per pool, verifiche, UDA o mappe concettuali** — resta
  esclusivamente una funzione della lezione;
- **moderazione automatica del contenuto caricato** (§9.4) — dichiarata,
  non nascosta;
- **riordino via drag-and-drop nel prototipo** — il prototipo usa controlli
  a tastiera (frecce) per l'ordine; un'implementazione futura può aggiungere
  drag-and-drop come miglioramento, non come sostituto dell'accessibilità
  da tastiera;
- **bulk «rimuovi tutte le immagini»** (§8.5) — rimozione singola soltanto;
- **retrocessione automatica da array a manifest singolo** (§6.2) — mai, in
  nessuna condizione.

---

## 17. Rischi residui

Registrati perché siano decisioni, non dimenticanze.

1. **Il compromesso più grande di questo pilota è l'upload.** Riapre
   deliberatamente un punto che VE aveva chiuso come fuori scope, con la
   stessa motivazione originale (licenze, moderazione, provenienza) ancora
   valida e non risolta — solo delimitata dal perimetro a singolo docente
   (§9.4). Se SchoolForge dovesse mai smettere di essere uno strumento a
   singolo docente, questa decisione andrebbe rivista da zero.
2. **L'adozione (§6.2) non sarà mai stata esercitata su dati reali prima
   della prima lezione reale con due immagini**, indipendentemente
   dall'opzione di rollout scelta in §15.2 — nell'opzione A perché VE-05
   produce al più manifest singoli; nell'opzione B perché nessuna lezione
   avrà mai avuto un manifest singolo da adottare. Il codice di adozione va
   quindi trattato come **non provato in produzione** finché non lo è
   davvero, e va coperto da test che simulano esplicitamente il documento
   legacy (§18).
3. **Il margine di 229 KB su tre immagini al cap rigido (§4) è il 21,9 %
   del limite di documento.** Non è un margine ampio. Se in futuro
   Firestore cambiasse il proprio limite di documento, o se un campo
   aggiuntivo venisse introdotto nella mappa byte, questo margine andrebbe
   ricalcolato esplicitamente — non assunto.
4. **Il riordino a tastiera (frecce) è meno immediato di un drag-and-drop**
   per un docente abituato ad altre interfacce. È una scelta deliberata di
   accessibilità (§16), non un limite tecnico temporaneo.
5. **La riduzione del batch di export da 32 a un minimo di 13 lezioni nel
   caso peggiore (§14)** rallenta l'export massivo per corsi con molte
   lezioni riccamente illustrate. Il criterio dinamico mitiga il caso medio
   ma non elimina il caso peggiore, che resta un limite derivato e non
   scelto.
6. **Il duplicato dei byte resta**, moltiplicato: fino a tre WebP canonici
   in Storage e fino a tre copie base64 nella mappa Firestore per lezione
   svolta. È lo stesso compromesso di VE §17.2, di ampiezza fino a 3× invece
   di 1×; mitigato dagli stessi `sha256` per elemento, non eliminato.
7. **Nessuna delle domande aperte del gate umano di VE
   (`visual-enrichment-00-review.md` §7) è risolta da questo documento.**
   In particolare la domanda 5 di quel documento — «una sola immagine per
   lezione resta il limite giusto?» — è precisamente la domanda a cui
   questo pilota risponde «no, fino a tre», ma la risposta **a monte** — se
   la funzione vale il suo costo anche a una sola immagine — resta
   interamente aperta e non è competenza di questo documento deciderla.

---

## 18. Fasi

| Pacchetto | Sintesi | Dipendenze | Stato |
|---|---|---|---|
| **MULTI-VISUAL-00** | **Contratto e prototipo.** Forme dati chiuse dell'array, adozione dal manifest singolo, ancoraggio N-way, ciclo di vita esteso a generazione+upload, idempotenza e corse sull'elenco, cost model per immagine, rollout/rollback con flag separati lettura/scrittura, prototipo statico responsive. | VE-00→05A (documentali), `agent-orchestrator-roadmap.md` §12 | **Questo documento.** Nessun runtime. Gate GMULTI: PENDING. |
| **MULTI-VISUAL-01** | **Tipi e validatori puri.** `LessonVisualsManifest`, `LessonVisualItem`, validatore strutturale a chiavi chiuse, `adaptSingular` puro, risolutore d'ancora esteso a N item, test di non-regressione byte-identica dei contratti VE-01 esistenti (namespace `visual-enrichment/v1` invariato). Nessuna Function, nessuna UI, nessun provider. | MULTI-VISUAL-00; **decisione su GVISUAL raccomandata prima di procedere oltre questa fase** (§15.1) | Aperto. |
| **MULTI-VISUAL-02** | **Catena binaria dell'upload.** Callable `aiVisualUpload` (§9), riuso del normalizzatore VE-02 con l'allowlist di input estesa, cap `MAX_VISUAL_UPLOAD_INPUT_BYTES`, ticket nel namespace `visual-upload/v1`, cost model reale (zero provider). Nessuna UI, nessuna proiezione studente. | MULTI-VISUAL-01 | Aperto. |
| **MULTI-VISUAL-03** | **Persistenza e lifecycle dell'array.** Transazione di adozione (§6.2), promozione `add`/`replace` (§8.3–8.4), riordino (§8.6), rimozione per elemento (§8.5), Rules Firestore su `publicLessons.visuals`/`publicLessonVisuals` a nuova forma, aggiornamento del criterio di batching dell'export (§14). | MULTI-VISUAL-02 | Aperto. |
| **MULTI-VISUAL-04** | **UI.** Rendering N-way nel manuale (§7.3), galleria «Gestisci immagini» con riordino da tastiera, orchestrazione «Genera lezione con immagini» (§11) con costi separati per slot, flusso di upload nella stessa sessione, avvisi di ancora persa per elemento, responsive desktop/mobile. | MULTI-VISUAL-03 | Aperto. |
| **MULTI-VISUAL-05** | **Qualità e rollout controllato.** Benchmark reale su lezioni con più immagini (estensione del protocollo VE-05A), verifica empirica del margine di §4 su documenti reali, smoke DEV con flag `AI_VISUAL_MULTI_READ`/`WRITE` attivati in sequenza (§15.3–15.4), verifica del percorso di rollback su almeno una lezione adottata. | MULTI-VISUAL-04 | Aperto. |
| **Gate GMULTI** | **Approvazione umana.** Il docente giudica se tre immagini per lezione, incluso l'upload proprio, valgono il costo aggiuntivo rispetto alla singola immagine di VE. | MULTI-VISUAL-05 | **PENDING.** |

---

## 19. Test obbligatori

Per ciascuna fase implementativa, prima della relativa Definition of Done:

- **Non-regressione byte-identica.** Gli `inputHash` e le costanti congelate
  di VE-01 (pool, lezione, mappa, `visual_proposal` singolo) non si spostano
  di un byte con l'introduzione dei tipi ad array. Un test dedicato lo
  congela, come già fa VE-01 per il terzo kind (VE §15.1).
- **Validatore strutturale dell'array.** Chiavi esatte, `items.length` in
  `1..3`, mai `0` persistito, `contractVersion` letterale, unione chiusa di
  `styleVersion` coerente con `source`. Casi negativi: proprietà extra,
  array vuoto, quarto elemento, `styleVersion` incoerente con `source`.
- **`adaptSingular` — test dedicato con un `LessonDoc.visual` reale del
  contratto VE**, che verifica campo per campo l'equivalenza fra la lettura
  compatibile (§6.1) e un `LessonVisualsManifest` a un elemento scritto a
  mano, e la conservazione dell'ordine dei campi non rilevante ma della
  forma sì.
- **Test di adozione transazionale**, incluso il caso di retry idempotente
  (§6.2): un secondo tentativo di adozione sullo stesso `LessonDoc` non deve
  duplicare `items[0]` né toccare `visual` (già assente).
- **Test delle tre corse di §10.3**, ciascuno con un doppio commit
  concorrente simulato: `visual_slot_full` sul quarto elemento,
  `visual_order_stale` su un riordino con insieme non corrispondente,
  `visual_replace_target_missing` su un `replace` verso un `assetId` appena
  rimosso.
- **Test del limite matematico di §4**, che ricalcola l'espressione e fallisce
  se `MAX_VISUALS_PER_LESSON × ceil(MAX_VISUAL_BYTES/3)×4` supera il limite
  di documento dichiarato — così un cambiamento futuro di una qualunque
  delle costanti che rompe l'invariante fallisce in CI, non in produzione.
- **Test del criterio di batching dinamico dell'export** (§14): batch con
  lezioni a cardinalità mista (0, 1, 2, 3 immagini) non superano mai
  `8_000_000` byte worst-case dichiarati, e un batch composto interamente da
  lezioni a 3 immagini al cap non supera 13 elementi.
- **Test del renderer N-way** (§7.3): 0, 1, 2, 3 ancore distinte e il caso
  di ancore condivise, confrontando l'HTML risultante byte per byte contro
  una composizione manuale attesa; il caso a zero manifest resta
  byte-identico al renderer legacy (invariato da VE-04A).
- **Test dell'upload — pipeline di accettazione** (§9.2): file oltre il cap
  grezzo, formati non in allowlist, file corrotti che superano lo sniffing
  ma falliscono la decodifica reale, immagini con EXIF/GPS che devono
  risultare assenti nell'output.
- **Smoke responsive reale**, Chromium via CDP, 1440/1024/390/320 px, sugli
  stati del prototipo di questo pilota (§20 in `evidenze/multi-visual-00-
  review.md`) e, in una fase successiva, sui componenti React reali —
  stessa metodologia di VE §15.6 e di `vdif-00-prototipo-visivo.md`: mai
  `--window-size`, sempre `Emulation.setDeviceMetricsOverride`.
- **Test di rollback** (§15.4): con `AI_VISUAL_MULTI_WRITE = disabled` e
  `AI_VISUAL_MULTI_READ = enabled`, una lezione già adottata resta
  leggibile e renderizzata correttamente, mentre nessuna nuova adozione è
  possibile.
