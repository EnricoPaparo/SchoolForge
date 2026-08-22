# VISUAL-ENRICHMENT — Arricchimento visivo delle lezioni (contratto e roadmap)

> **Stato: VISUAL-ENRICHMENT-00 implementato come contratto e prototipo statico.**
> VISUAL-ENRICHMENT-01 e successivi sono **aperti**. **Gate GVISUAL: PENDING.**
>
> Questa fase è **esclusivamente documentale e di prototipazione statica**. Non
> introduce runtime, UI React, Cloud Functions, provider, Firebase, Rules,
> Storage, dipendenze o chiamate OpenAI. Nessuna immagine reale è stata generata.
>
> **Prototipo:** [`prototipi/lesson-visual-enrichment.html`](prototipi/lesson-visual-enrichment.html)
> **Review di fase:** [`evidenze/visual-enrichment-00-review.md`](evidenze/visual-enrichment-00-review.md)

**Data:** 22 agosto 2026.
**Dipendenze:** AIGEN-01→03 in produzione; CONCEPT-MAP-01→07 implementati
(precedente autorevole di artefatto privato + proiezione condizionale);
LESSON-MANUAL-01 implementato (renderer `variant="lesson"`, slug deterministici,
pipeline di sanificazione); SGW-01→02C (nessun accesso Storage diretto nel
runtime web); ANNOT-01→03B (precedente autorevole di lettura studente
autorizzata e non passiva).

---

Una lezione di SchoolForge è oggi interamente testuale. Per alcuni contenuti
questo è un limite reale e non estetico: un ciclo, una topologia, un rapporto
fra parti, una sequenza spaziale si capiscono prima guardandoli che leggendoli.
Il docente che oggi vuole quell'immagine deve cercarla, valutarne la licenza,
ridimensionarla, caricarla da qualche parte e collegarla — cioè esattamente il
tempo che SchoolForge esiste per restituire.

Questa roadmap progetta una funzione che propone **una sola** piccola
illustrazione didattica per lezione, generata su richiesta, approvata dal
docente, e visibile allo studente soltanto quando la lezione è svolta.

---

## 1. Principi invarianti

Congelati. Non si rinegoziano nelle fasi successive.

- **Una sola immagine approvata per lezione.** Non è una limitazione tecnica: è
  la definizione della funzione. Una lezione con cinque figure è un altro
  prodotto, con altri problemi (impaginazione, ordine, peso, coerenza di stile).
- **La lezione Markdown non viene mai riscritta.** Nessun `![](...)` iniettato,
  nessuna normalizzazione, nessuna migrazione. Il corpo che il docente ha
  scritto resta byte per byte quello. È la stessa garanzia di
  `lesson-manual-contract.md` §8 e vale qui con la stessa forza.
- **Rollback totale per rimozione.** Togliere il manifest visivo deve
  restituire una lezione **identica** a quella di prima, in ogni superficie,
  senza migrazioni e senza cleanup manuale.
- **Funzione didattica reale, mai decorazione.** Un'illustrazione che non
  aggiunge comprensione è rumore che costa denaro e attenzione.
- **«Nessuna immagine utile» è un esito legittimo e di prima classe.** Non è un
  fallimento del modello né un errore da riprovare: per molte lezioni è la
  risposta corretta, e il sistema deve saperla dare senza farla sembrare un
  guasto.
- **Il docente approva prima che qualcosa sia salvato.** Nessuna scrittura
  canonica avviene senza un atto esplicito.
- **Abbandonare non lascia tracce.** Uscire dal dialog non modifica lezione,
  Firestore o asset canonici, in nessuna circostanza.
- **La visibilità è un confine dati, non una condizione CSS.** Prima che la
  lezione sia svolta, l'immagine non deve essere **presente** in ciò che lo
  studente può leggere. Nasconderla nell'interfaccia non è sicurezza. È lo
  stesso invariante di `mappa-concettuale-roadmap.md` §1 e §4.
- **Nessun URL pubblico, permanente o segreto.** Nessun download token, nessun
  ACL pubblico, nessun link condivisibile fuori dall'autorizzazione.
- **Nessun costo passivo.** Zero listener, zero polling, zero letture per card,
  zero indici nuovi.
- **Profilo IA esclusivamente `quality`.** Un'illustrazione sbagliata non è
  un'illustrazione più economica: è materiale didattico da buttare.

---

## 2. Lo stile — «SchoolForge Sketch v1»

Lo stile è **fisso** e versionato. Non è configurabile dal docente, e non è un
parametro del payload: è una costante del server, esattamente come l'avvertenza
della mappa concettuale è una costante e non un contenuto generato.

Definizione congelata:

- schizzo scolastico a penna, come una figura tracciata alla lavagna o sul
  margine di un quaderno;
- sfondo chiaro e uniforme;
- linee semplici, tratto continuo, nessun tratteggio decorativo;
- uso **minimo** dei due colori SchoolForge — ciano e arancione — impiegati per
  distinguere, mai per abbellire; il resto è monocromatico;
- **niente** fotografia, rendering 3D, neon, gradienti, ombre portate, texture,
  cornici o sfondi elaborati;
- testo dentro l'immagine ridotto al minimo indispensabile: al più poche
  etichette brevi.

**Perché lo stile è fisso.** Uno stile scelto lezione per lezione produce un
manuale che sembra assemblato da fonti diverse, ed è il difetto che si nota per
primo. Inoltre uno stile fisso è l'unica base su cui si possa dire, in
VISUAL-ENRICHMENT-05, se la qualità è accettabile: variando anche lo stile non
si misurerebbe più nulla.

**Versionamento.** Il manifest registra `styleVersion` (`schoolforge-sketch/v1`).
Serve a sapere, quando lo stile evolverà, quali immagini appartengono alla
generazione precedente — senza rigenerarle e senza invalidarle.

### 2.1 Il confine con il diagramma tecnico preciso

È la distinzione più importante del contratto, ed è una questione di
affidabilità, non di gusto.

Un modello di generazione immagini **non produce in modo affidabile**: testo
corretto, valori esatti, assi quotati, strutture chimiche valide, circuiti
funzionanti, cronologie con date, proporzioni misurabili, formule. Può
produrre qualcosa che *somiglia* a tutto questo — ed è precisamente il caso
peggiore, perché uno studente non ha modo di accorgersi che l'etichetta è
sbagliata.

Quindi:

| Serve… | Strumento |
|---|---|
| intuizione visiva, relazione fra parti, forma, ciclo, topologia, scala qualitativa | **immagine SchoolForge Sketch** |
| struttura, gerarchia, dipendenze nominate | **diagramma a caratteri della mappa concettuale** (già esistente) |
| valori, formule, dati, cronologie, schemi tecnici quotati | **testo Markdown della lezione** |

Regola operativa vincolante per la fase di proposta: **se la funzione didattica
richiede precisione verificabile, la proposta corretta è «nessuna immagine
utile»**, con la motivazione esplicita. Il modello deve essere istruito a
preferire questa risposta, non a tentare.

Regola di redazione, altrettanto vincolante: **il testo essenziale non deve mai
esistere soltanto dentro l'immagine.** Se un'informazione è necessaria, sta nel
Markdown; l'immagine la illustra, non la sostituisce. Questa non è solo
accessibilità: è la condizione perché rimuovere l'immagine lasci una lezione
completa.

---

## 3. Architettura: la decisione centrale

La domanda che governa tutto il resto è: **come fa lo studente a vedere
l'immagine?**

### 3.1 Il vincolo che esclude la soluzione ovvia

Lo studente **non ha, e non deve avere, alcun accesso a Firebase Storage**.
`storage.rules` concede lettura e scrittura soltanto all'owner sotto
`repository/{ownerUid}/**`, e nega tutto il resto. Quella regola non è
un'omissione: M3F-08 ha **rimosso deliberatamente** il "second hop" che
concedeva a un non-owner autenticato la lettura diretta del Markdown, chiudendo
la lacuna interim documentata in `sicurezza.md` §3.2a. Riaprire Storage allo
studente per servire un'immagine sarebbe una regressione di sicurezza pagata
per una funzione accessoria.

Inoltre SGW-01→02C ha rimosso ogni accesso dati diretto a Storage dal runtime
web, e il gateway `repositoryGateway` è **testuale per contratto**: allowlist
`.md` / `.pool.md`, payload UTF-8. Non esiste oggi un percorso binario, né lato
docente né lato studente.

### 3.2 Le alternative valutate

| # | Soluzione | Perché è stata scartata |
|---|---|---|
| A | Regola Storage per lo studente | Regressione diretta di M3F-08. Reintrodurrebbe un percorso ai byte non mediato dalle guardie di scoperta (portale, `approved`, `classId`, `activeImportId`, Modalità verifica). Scartata senza appello. |
| B | `getDownloadURL()` / token di download | Produce un URL **permanente e condivisibile** che funziona per chiunque lo possieda, autenticato o no. Viola il requisito «nessun URL pubblico permanente o segreto». Scartata. |
| C | Endpoint gateway binario letto dallo studente a ogni apertura | Una invocazione di Cloud Function per ogni apertura di lezione, per ogni studente. È costo attivo ricorrente su un'operazione di sola lettura, ed è esattamente ciò che SGW ha faticato a **evitare** per il testo (MOB-01C ha spostato la consultazione su Firestore proprio per questo). Scartata come percorso di lettura studente; **resta** il percorso di scrittura/promozione lato docente. |
| D | Byte in base64 dentro `publicLessons` | `publicLessons.content` arriva a 700 KB canonici; 200 KB binari diventano ~267 KB in base64; il limite documentale Firestore è 1 MB. Il margine sarebbe nullo e il fallimento si manifesterebbe solo sulle lezioni più lunghe, cioè le peggiori da diagnosticare. Scartata. |
| **E** | **Documento di proiezione dedicato, separato dal testo** | **Scelta.** Vedi sotto. |

### 3.3 La decisione

> **I byte canonici vivono in Storage sotto l'owner; la copia leggibile dallo
> studente è un documento Firestore dedicato, separato dal testo della lezione,
> autorizzato dalle stesse guardie già esistenti, e letto una sola volta
> all'apertura della lezione — solo se un'immagine esiste davvero.**

Tre luoghi, ciascuno con un ruolo che gli altri non possono coprire:

1. **`storageRef`** — `repository/{ownerUid}/{importId}/{udaDir}/visuals/{assetId}.webp`
   Copia **canonica** e autorevole: owner-only per Rules già esistenti (nessuna
   regola nuova), dentro il prefisso dell'import — quindi cancellata dallo
   stesso `deleteImportPrefix` che già cancella tutto il resto — ed
   esportabile con la lezione.

2. **`LessonDoc.visual`** — il **manifest privato** (§4). Poche centinaia di
   byte di metadati, nel documento tecnico owner-only che la lezione ha già.

3. **`publicLessons.visual` + `publicLessonVisuals/{publicLessonId}`** — la
   **proiezione pubblica**, in due pezzi deliberatamente separati:
   - il **manifest pubblico** (`publicLessons.visual`) è minuscolo e viaggia
     dentro un documento che lo studente **legge già**: costo marginale zero;
   - i **byte** (`publicLessonVisuals/{publicLessonId}.data`, data URI base64)
     stanno in un documento **a parte**, letto **solo** quando il manifest
     pubblico è presente, **solo** all'apertura della lezione.

**Perché la separazione in due pezzi è la parte importante.** È ciò che rende
vera l'affermazione «nessun costo passivo, nessuna lettura per card»:

- lezione **senza** immagine → il manifest è assente → **zero letture
  aggiuntive**, zero richieste, zero latenza. Il caso maggioritario costa
  esattamente quanto oggi;
- lezione **con** immagine → **una** lettura puntuale, all'apertura, non
  ripetuta, non in ascolto;
- **elenchi e card** → leggono `publicLessons` come oggi e non toccano mai il
  documento dei byte. Nessuna card paga nulla, mai.

È lo stesso profilo di costo già accettato per gli appunti studente (ANNOT: una
lettura indice per corso, una lettura nota solo all'apertura), e per la stessa
ragione.

**Perché il data URI e non un URL.** Un data URI dentro un documento Firestore
autorizzato **non è un indirizzo**: non esiste una stringa che un terzo possa
incollare in un browser per ottenere l'immagine. L'autorizzazione è verificata
dalle Rules a ogni lettura, con le stesse guardie del resto del portale. Uno
studente che ha già accesso può ovviamente salvare l'immagine che sta guardando
— ma questo è vero di qualunque contenuto visibile, ed è un confine diverso da
«esiste un URL che funziona per chiunque».

**Costo del duplicato.** La stessa immagine esiste in due forme: WebP canonico
in Storage (≤ 200 KB) e base64 in Firestore (~267 KB) quando la lezione è
svolta. È un costo di archiviazione trascurabile alla scala di un singolo
docente, ed è il prezzo di non riaprire Storage allo studente e di non pagare
una Function a ogni apertura. La consistenza fra le due copie è garantita da
`sha256`, che è nel manifest e viene verificato alla promozione.

---

## 4. Il manifest — forma chiusa

Un solo oggetto, chiavi **esatte**, nessuna proprietà extra ammessa. Validato
fail-closed come tutti gli artefatti SchoolForge: un manifest che non rispetta
la forma non viene corretto, viene **rifiutato**.

```ts
/** VISUAL-ENRICHMENT — manifest dell'unica immagine approvata di una lezione. */
export interface LessonVisualManifest {
  /** Identificatore opaco dell'asset. UUID v4 generato server-side. */
  assetId: string;

  /**
   * Percorso Storage canonico, owner-only.
   * `repository/{ownerUid}/{importId}/{udaDir}/visuals/{assetId}.webp`
   * Non è un URL e non è mai risolto in un URL.
   */
  storageRef: string;

  /** Punto di inserimento nella lezione rendered. Vedi §5. */
  anchor: LessonVisualAnchor;

  /** Didascalia visibile. Obbligatoria, non vuota, modificabile dal docente. */
  caption: string;

  /** Testo alternativo. Obbligatorio, non vuoto, modificabile dal docente. */
  altText: string;

  /** Larghezza reale in pixel, letta dai byte. Lato lungo ≤ 1200. */
  width: number;

  /** Altezza reale in pixel, letta dai byte. Lato lungo ≤ 1200. */
  height: number;

  /** Dimensione reale in byte dei byte canonici. ≤ 204_800. */
  byteLength: number;

  /** SHA-256 esadecimale minuscolo dei byte canonici. 64 caratteri. */
  sha256: string;

  /** Sempre e solo `'image/webp'`. Verificato per magic bytes, non dichiarato. */
  mimeType: 'image/webp';

  /** Versione dello stile con cui l'immagine è stata prodotta. */
  styleVersion: 'schoolforge-sketch/v1';

  /**
   * SHA-256 del corpo lezione da cui è nata la proposta.
   * Chiude la corsa fra modifica della lezione e approvazione (§8).
   */
  sourceBodyHash: string;

  /** Istante di approvazione del docente. */
  approvedAt: Timestamp;
}
```

**Il manifest pubblico è un sottoinsieme, non lo stesso oggetto.** In
`publicLessons.visual` finiscono soltanto i campi che servono a rendere:
`assetId`, `anchor`, `caption`, `altText`, `width`, `height`. **Non** vi finiscono
`storageRef` (rivelerebbe la struttura del repository del docente),
`sourceBodyHash`, `sha256`, `byteLength` né `approvedAt`: sono metadati di
governo, non di rendering, e ciò che non serve allo studente non gli viene dato.

### 4.1 Perché ciascun campo esiste

- `sha256` e `byteLength` rendono **verificabile** l'identità dei byte: la
  promozione confronta ciò che sta in Storage con ciò che il manifest dichiara,
  e un disallineamento ferma l'operazione invece di pubblicare qualcosa di
  ignoto.
- `width`/`height` esistono perché **senza di essi il layout salta**: sono ciò
  che permette di riservare lo spazio prima che l'immagine arrivi (§10).
- `mimeType` è letterale e non un campo libero: un solo formato canonico
  significa un solo percorso di validazione.
- `styleVersion` e `sourceBodyHash` sono i due campi che rendono il manifest
  interrogabile nel tempo: «con quale stile è stata fatta» e «di quale testo
  parlava davvero».

---

## 5. Ancoraggio — posizionare senza toccare il Markdown

### 5.1 La forma dell'ancora

```ts
export interface LessonVisualAnchor {
  /** Slug deterministico dell'heading, per le regole di lesson-manual §4.1. */
  headingSlug: string;
  /** Testo dell'heading al momento dell'approvazione. Diagnostico, non chiave. */
  headingText: string;
  /** Posizione rispetto all'heading: subito dopo il titolo di sezione. */
  placement: 'after-heading';
}
```

L'ancora **riusa gli slug già esistenti** di LESSON-MANUAL-01 (`headingSlug()` /
`nextHeadingId()`): normalizzazione NFKD, rimozione dei diacritici, minuscolo
con locale `it`, suffisso progressivo sui duplicati. Sono deterministici e già
presenti nell'HTML renderizzato — non si inventa un secondo sistema di
identificazione per fare la stessa cosa.

`headingText` **non è la chiave**: serve soltanto perché l'interfaccia possa
dire al docente *«era ancorata a "Il ciclo dell'acqua"»* quando l'ancora si
perde. Un'ancora che facesse fallback sul testo tornerebbe ad agganciarsi a un
heading rinominato con testo simile, cioè indovinerebbe.

### 5.2 Come l'immagine entra nella pagina senza entrare nel Markdown

Questo è il punto in cui è facile violare l'invariante più difeso del codice.
`lesson-manual-contract.md` §5.1 vieta **qualunque** iniezione di HTML dopo
`DOMPurify.sanitize()`: niente `innerHTML`, `insertAdjacentHTML`,
`dangerouslySetInnerHTML` su contenuto post-sanitize. Cercare l'heading
nell'HTML sanificato e spezzare la stringa per infilarci un `<figure>` sarebbe
esattamente la violazione.

**Soluzione: lo split avviene sul flusso di token, prima della serializzazione.**

```
Markdown sorgente
  → parser isolato (istanza Marked dedicata, LESSON-MANUAL-01)
  → token stream
  → split in DUE sottoinsiemi al token heading con lo slug dell'ancora
  → HTML(A)                    HTML(B)
  → DOMPurify.sanitize(A)      DOMPurify.sanitize(B)
  → render React:  <div A /> <LessonVisualFigure /> <div B />
```

Conseguenze:

- il Markdown non viene mai modificato, in nessuna forma persistente o
  transitoria;
- entrambi i frammenti attraversano DOMPurify come tutto il resto: la pipeline
  non è aggirata, è **applicata due volte**;
- la `<figure>` è un **nodo React costruito dal codice** a partire dai campi del
  manifest — `caption` e `altText` sono inseriti come testo, mai come markup.
  Nessuna stringa HTML viene composta;
- una lezione **senza** manifest produce un solo frammento e un solo
  `dangerouslySetInnerHTML`: il percorso odierno, invariato byte per byte.

Il vincolo di isolamento del parser di §5.2 del contratto manuale resta intatto:
nessun `marked.use()` globale, nessuna estensione visibile alle anteprime editor
e IA.

### 5.3 Se l'heading di ancoraggio viene rinominato o eliminato

Il caso non è un'eccezione: è **normale**. Il docente riscrive i titoli.

Politica congelata, in ordine:

1. **Slug presente** → l'immagine è inserita subito dopo quell'heading. Caso
   normale.
2. **Slug assente** → l'immagine **non viene indovinata altrove**. Viene resa in
   **coda al corpo**, e il manifest è considerato `anchorResolved: 'fallback'`
   (stato derivato a runtime, non persistito).
3. **In nessun caso** l'immagine viene eliminata automaticamente, e **in nessun
   caso** viene spostata in una sezione diversa "somigliante".

**Perché la coda e non la rimozione.** Rinominare un titolo è una modifica
testuale; farle cancellare un'immagine generata a pagamento e approvata
esplicitamente sarebbe una perdita di lavoro causata da un'azione che non la
riguardava.

**Perché la coda e non un'euristica.** Un'illustrazione sulla fotosintesi che
riappare sotto «La respirazione cellulare» perché i due heading si somigliano è
peggio di un'illustrazione fuori posto in fondo: la prima insegna una cosa
falsa, la seconda è solo mal impaginata.

**Lato docente** la condizione è **visibile e azionabile**: la scheda Contenuto
mostra un avviso — *«L'immagine non è più ancorata a "Il ciclo dell'acqua"; è
mostrata in fondo alla lezione»* — con l'azione «Riancora» che consente di
scegliere un heading esistente **senza rigenerare e senza spendere**. Un
riancoraggio è una scrittura di metadati, non una generazione.

**Lato studente** non compare alcun avviso: vede un'immagine in fondo alla
lezione, che è una scelta di impaginazione, non un errore che lo riguardi.

---

## 6. Ciclo di vita dell'asset

```
        ┌──────────┐   proposta testuale (IA, economica)
        │ PROPOSTA │   subject · utilità · anchor · prompt · caption · altText
        └────┬─────┘   oppure: NESSUNA IMMAGINE UTILE  → fine, nulla creato
             │ il docente modifica e conferma il costo
             ▼
        ┌──────────┐   generazione immagine + normalizzazione server-side
        │ STAGING  │   Storage: staging/{ownerUid}/{opaqueRunId}.webp
        └────┬─────┘   Firestore: visualRuns/{opaqueRunId}  (TTL 24 h)
             │
     ┌───────┼───────────────┬──────────────────────┐
     │       │               │                      │
  rigenera  approva      abbandona              TTL scaduto
     │       │               │                      │
     │       ▼               ▼                      ▼
     │  ┌──────────┐    staging eliminato     staging eliminato
     │  │APPROVATO │    lezione INTATTA       lezione INTATTA
     │  └────┬─────┘
     │       │ promozione atomica
     │       ▼
     │  canonico: Storage owner + LessonDoc.visual
     │       │
     │       ├── lezione svolta ──▶ proiezione pubblica (manifest + byte)
     │       └── lezione non svolta ──▶ nessuna proiezione
     │
     └─ nuovo staging; il canonico esistente NON è toccato finché
        il docente non conferma la sostituzione
```

### 6.1 Staging: perché esiste

Il docente deve vedere l'immagine **prima** che diventi canonica. Ma la
generazione costa denaro reale: se il risultato vivesse solo nella risposta
della callable, una connessione caduta o un reload perderebbero un'immagine
già pagata, e l'unica via sarebbe pagarla di nuovo.

Quindi lo staging è **scritto server-side** *e* i byte sono **restituiti inline**
nella risposta della callable come data URI:

- l'anteprima non costa alcun round-trip aggiuntivo — il docente vede
  l'immagine che è già nella risposta;
- una risposta persa è recuperabile: stesso `requestId` → replay del run già
  memorizzato → stessi byte, **senza nuova spesa** (§8).

Staging TTL: **24 ore**, allineato a `AI_CONTENT_RUN_TTL_MS`.

### 6.2 Approvazione — promozione atomica

«Applica alla lezione» esegue, in quest'ordine, con fail-closed a ogni passo:

1. rilegge il `LessonDoc` e verifica `sourceBodyHash` contro il corpo salvato
   corrente (§8). Disallineamento ⇒ **stop**, zero scritture;
2. verifica che i byte staged corrispondano a `sha256`/`byteLength` dichiarati;
3. copia i byte dallo staging al percorso canonico `storageRef`;
4. scrive `LessonDoc.visual` (manifest privato completo);
5. **se e solo se** `completed === true`, scrive il manifest pubblico su
   `publicLessons.visual` e il documento byte `publicLessonVisuals/{id}`;
6. elimina lo staging;
7. registra l'audit `lesson.visualApproved`.

I passi 4–5 sono nella **stessa transazione**, con la stessa disciplina di
`setLessonCompleted` (CONCEPT-MAP-02): un batch non basta, perché la decisione
dipende da un valore **letto**. I passi 3 e 6 toccano Storage e non sono
transazionali: l'ordine è scelto perché un fallimento lasci al più un blob
orfano — mai un manifest che punta a byte inesistenti, mai una proiezione
leggibile senza sorgente.

### 6.3 Sostituzione di un'immagine già approvata

Vincolo esplicito del contratto: **la rigenerazione non sostituisce nulla finché
il docente non conferma.**

Meccanicamente questo è già garantito dal fatto che la rigenerazione scrive solo
in **staging**: il canonico non è raggiunto da alcuna scrittura fino al passo di
promozione. L'interfaccia deve però dichiararlo, perché un docente che vede una
nuova immagine sullo schermo assume ragionevolmente che sia già la sua.

Quindi: quando esiste un'immagine approvata, l'anteprima della nuova mostra
**entrambe** — attuale e proposta — e l'azione di conferma è etichettata
**«Sostituisci l'immagine attuale»**, mai «Applica». La sostituzione elimina i
byte canonici precedenti solo **dopo** che i nuovi sono in posizione e la
transazione è andata a buon fine.

### 6.4 Abbandono

Backdrop, `Escape` e chiusura **non scartano** un'immagine generata: costa
denaro reale, esattamente come per `ConceptMapDialog`. Passano da una conferma
modale che dichiara la conseguenza — *«L'immagine generata verrà eliminata. La
lezione non sarà modificata.»*

L'abbandono elimina lo staging e non tocca né `LessonDoc`, né `publicLessons`,
né i byte canonici, né il manifest esistente.

### 6.5 Rimozione e cleanup

«Rimuovi immagine» esegue, in quest'ordine — l'ordine è la parte che conta:

1. elimina `publicLessonVisuals/{publicLessonId}` (i byte leggibili);
2. rimuove `publicLessons.visual` (il manifest pubblico);
3. rimuove `LessonDoc.visual` (il manifest privato);
   — 1, 2 e 3 nella **stessa transazione**;
4. elimina l'oggetto Storage canonico.

**Perché quest'ordine.** L'unico stato intermedio tollerabile è un blob orfano
in Storage, che non è leggibile da nessuno e viene raccolto dalla stessa pulizia
dello staging. Lo stato **intollerabile** è l'opposto: una proiezione pubblica
leggibile che punta a byte già eliminati, cioè un'immagine rotta nel portale
studente. L'ordine sceglie deliberatamente il primo rischio ed esclude il
secondo.

Dopo il passo 3, la lezione è **identica** a una lezione che non ha mai avuto
un'immagine: nessun campo residuo, nessun marcatore nel Markdown, nessuna
differenza nel rendering. È il rollback totale richiesto.

### 6.6 Passaggio svolta ⇄ non svolta

Estende la transazione `setLessonCompleted` già resa transazionale da
CONCEPT-MAP-02, con la stessa struttura:

- **→ svolta**: se esiste un manifest privato **valido**, proietta manifest
  pubblico e byte. Manifest privato assente ⇒ normale, niente da proiettare.
  Manifest privato **malformato** ⇒ **fail-closed**, zero scritture: copiarlo
  violerebbe il contratto, ignorarlo nasconderebbe un dato corrotto.
- **→ non svolta**: rimuove **sempre** manifest pubblico e documento byte, anche
  se assenti (idempotente). Il canonico privato non viene toccato: smarcare una
  lezione è un'operazione didattica, non una cancellazione di lavoro.

Rimarcandola svolta, l'immagine riappare senza rigenerazione e senza spesa.

---

## 7. Normalizzazione e verifica dei byte

**Dove.** Interamente **server-side**, in Cloud Function. Mai nel browser.

**Perché non nel client.** `byteLength` e `sha256` sono nel manifest e sono
usati come garanzia di identità: un valore calcolato dal client sarebbe una
dichiarazione, non una verifica. Inoltre il ridimensionamento client-side
dipenderebbe dal dispositivo del docente, producendo file diversi a parità di
input.

**Pipeline, in ordine, fail-closed a ogni passo:**

1. **sniffing del MIME reale** sui *magic bytes* — per WebP: `RIFF` ai byte 0–3
   e `WEBP` ai byte 8–11. Il `Content-Type` dichiarato dal provider **non è mai
   considerato autorevole**;
2. **decodifica delle dimensioni** dal contenitore reale, non da metadati
   dichiarati;
3. **ridimensionamento** al lato lungo ≤ 1200 px, preservando le proporzioni.
   Mai upscaling: un'immagine più piccola resta più piccola;
4. **conversione in WebP** con qualità iniziale mirata alla banda 50–150 KB;
5. **rimozione di tutti i metadati** — EXIF, ICC, XMP, commenti. È una misura di
   privacy: i metadati sono un canale laterale che può trasportare informazioni
   non previste;
6. **verifica del cap rigido**: `byteLength ≤ 204_800`. Se dopo la conversione il
   file supera il cap, la qualità viene ridotta e si ripete un numero **limitato
   e dichiarato** di volte; se il cap resta superato, l'esito è un errore
   tipizzato `visual_too_large` — **mai** una pubblicazione fuori contratto;
7. **calcolo di `sha256` sui byte finali** — quelli e non altri;
8. **popolamento del manifest** con i valori **misurati**, mai con quelli attesi.

Nessun passo "aggiusta silenziosamente". Il cap di 200 KB è **rigido**: 50–150 KB
è l'obiettivo ordinario, non un secondo limite negoziabile.

---

## 8. Idempotenza, replay e corse

### 8.1 Idempotenza

Riuso integrale dell'impianto AIGEN, senza inventare un secondo meccanismo:

- `requestId` — UUID v4 generato dal **client**, stabile fra i retry;
- `opaqueRunId = SHA-256(canonical(['visual-enrichment/v1', ownerUid, requestId]))`
  — namespace **distinto** da `ai-content/v1` e da `ai-content-budget/v1`, così
  una `requestId` non può collidere fra domini;
- `inputHash` — fingerprint del payload normalizzato;
- il run è scritto **prima** della chiamata al provider, con prenotazione di
  budget, come per la generazione contenuti.

**Risposta persa.** Il client ripete con la **stessa** `requestId`. Il server
trova il run, lo riconosce completo e restituisce il risultato memorizzato:
stessi byte, **nessuna seconda spesa**. È il caso che giustifica lo staging
persistente (§6.1).

**Doppio invio ravvicinato.** Un run già `running` con la stessa `requestId`
produce l'errore tipizzato `running`, non una seconda generazione. Lato client,
la guardia sincrona già usata da `ConceptMapDialog` — un doppio clic nello
stesso tick invoca il service una volta sola, prima che React abbia riprodotto
lo stato `saving`.

### 8.2 La corsa fra modifica della lezione, generazione e approvazione

È il rischio meno visibile e il più dannoso: il docente genera un'immagine sul
paragrafo del ciclo dell'acqua, poi riscrive la lezione, poi approva. Il manifest
resterebbe agganciato a un testo che non esiste più.

**Difesa in tre punti:**

1. **Precondizione**: l'azione «Arricchisci visivamente» è **disabilitata, non
   nascosta, con il motivo visibile** quando il corpo è assente, vuoto o ha
   modifiche non salvate. Stessa regola e stessa motivazione della mappa
   concettuale: generare da un corpo non salvato produrrebbe un artefatto di un
   testo che non esiste per nessuno.
2. **Legatura**: la proposta cattura `sourceBodyHash = SHA-256(corpo salvato)` e
   lo porta nel manifest.
3. **Verifica alla promozione**: «Applica» rilegge il `LessonDoc` e confronta.
   Disallineamento ⇒ **rifiuto tipizzato**, zero scritture, e un messaggio che
   dice cosa è successo e cosa si può fare: riancorare senza rigenerare (se
   l'heading esiste ancora) oppure rigenerare sul testo nuovo (con costo
   dichiarato).

Il docente non perde mai l'immagine per questo: resta in staging fino alla
scadenza.

---

## 9. Sicurezza

I principi seguenti sono **congelati** e vincolano tutte le fasi successive.

### 9.1 Il corpo della lezione è dato non attendibile

Vale già per `concept_map` e vale identico qui. Il corpo entra nel prompt di
**proposta** delimitato dallo stesso `fence()` e con lo stesso ordine di
precedenza esplicito:

```
1) contratto di sistema (autorevole)
2) metadati didattici autorevoli: titolo, sottotitolo, difficoltà,
   concetti chiave, obiettivi, contesto UDA
3) CORPO_LEZIONE (dati non attendibili)
```

Un comando dentro il corpo — *«ignora le istruzioni»*, *«rivela il prompt»*,
*«genera un'immagine di …»* — è **testo da illustrare o da ignorare**, mai
un'istruzione. Le istruzioni contenute nella lezione **non possono modificare il
comportamento del generatore**.

### 9.2 Il prompt immagine non è testo della lezione

Vincolo strutturale, ed è la difesa che conta di più.

Il prompt inviato al provider di immagini è **composto dal server**:

```
[preambolo di stile SchoolForge Sketch v1 — costante server, non negoziabile]
+ [campo `subject` validato, ≤ 400 caratteri]
```

Il corpo della lezione **non raggiunge mai** il provider di immagini. Il
`subject` è prodotto dalla fase di proposta, è **visibile e modificabile dal
docente**, ed è validato server-side prima dell'uso. Un'injection nel corpo può
al massimo influenzare un campo breve che un essere umano legge e approva prima
che costi qualcosa.

Validazione del `subject`, fail-closed:

- lunghezza ≤ 400 caratteri, non vuoto;
- nessun carattere di controllo;
- rifiuto di richieste di imitare **artisti viventi**, studi o **marchi**;
- rifiuto di richieste di **persone riconoscibili** o identificabili;
- rifiuto di tentativi di sovrascrivere il preambolo di stile.

### 9.3 Nessun dato studente raggiunge il provider

Elenco chiuso di ciò che **non** può comparire in alcun payload verso alcun
provider, in nessuna fase: nomi, cognomi, email, UID, classi, etichette di
differenziazione, consegne, valutazioni, verifiche, appunti personali,
identificatori di sessione.

Il payload della proposta contiene **soltanto**: metadati didattici della
lezione e corpo della lezione. Il payload dell'immagine contiene **soltanto**:
preambolo di stile e `subject`. Nient'altro è ammesso, e l'aggiunta di un campo
è una modifica di contratto, non un dettaglio implementativo.

### 9.4 Contenuto dell'immagine

- **Nessuna persona riconoscibile o identificabile**, salvo futura
  autorizzazione esplicita e con gate proprio. Figure schematiche e anonime
  sono ammesse.
- **Nessuna imitazione** di artisti viventi, studi, marchi o stili
  proprietari.
- **Nessun concetto nuovo**: l'immagine illustra ciò che la lezione dice, non
  aggiunge. Un'immagine che introduce un elemento assente dalla lezione è da
  rifiutare anche se corretto in astratto.
- **Etichette e collegamenti verificabili**: ogni etichetta presente
  nell'immagine deve corrispondere a qualcosa che sta nel testo. È anche il
  motivo per cui il testo nell'immagine va tenuto al minimo — meno etichette,
  meno superficie di errore.
- **Se il modello non può produrre una rappresentazione affidabile, deve
  proporre «nessuna immagine»** (§2.1).

### 9.5 Responsabilità

**Il docente resta responsabile dell'approvazione.** Nessuna validazione
automatica sostituisce quel giudizio, e l'interfaccia non deve suggerire il
contrario: nessun punteggio di qualità, nessun «verificato», nessuna
approvazione preselezionata.

### 9.6 Didascalia e testo alternativo

Obbligatori entrambi, non vuoti, modificabili dal docente, validati come non
vuoti anche server-side.

**Requisito di sostanza, non solo di presenza:** non devono limitarsi a
«immagine di…». Devono dire **che cosa l'immagine fa capire**. La differenza è
operativa: *«Immagine del ciclo dell'acqua»* non aggiunge nulla a chi non vede
l'immagine; *«Il ciclo dell'acqua: l'evaporazione dagli oceani alimenta le
nubi, che restituiscono l'acqua come precipitazione»* rende la funzione
didattica accessibile senza l'immagine.

Il modello propone entrambi; il docente li corregge; il sistema non li genera
mai automaticamente da un template.

### 9.7 Confini invariati

Nessuna modifica alla CSP, alla configurazione DOMPurify, alla pipeline di
sanificazione, alle Storage Rules, né alle guardie di scoperta studente. Il data
URI è renderizzato in un attributo `src` di un elemento React costruito dal
codice: non attraversa la sanificazione HTML perché non è HTML.

---

## 10. Rendering e accessibilità

- `<figure>` + `<figcaption>`: la didascalia è **testo visibile**, non un
  `title`.
- `alt` sempre presente e sostanziale (§9.6).
- `loading="lazy"` e `decoding="async"`.
- `width` e `height` **dichiarati come attributi** dal manifest: è ciò che
  riserva lo spazio e impedisce il layout shift quando l'immagine arriva.
- `max-width: 100%`, altezza automatica: nessun overflow orizzontale a nessuna
  larghezza, coerente con l'invariante di `lesson-manual-contract.md` §3.
- Nessuna animazione di comparsa; `prefers-reduced-motion: reduce` rispettato
  ovunque.
- Nessuna informazione veicolata **solo** dall'immagine (§2.1).
- Nessuna lightbox, nessuno zoom, nessun carosello: sono superficie in più per
  una funzione che ne ha già abbastanza.

---

## 11. Comportamento legacy

Una lezione **priva di manifest** — cioè oggi ogni lezione esistente — si
comporta **esattamente** come oggi:

- nessun campo letto, nessuna query, nessuna richiesta, nessuna latenza;
- rendering su un solo frammento sanificato, percorso odierno invariato;
- nessun placeholder, nessun teaser, nessuna scheda disabilitata, nessun
  messaggio che suggerisca una funzione mancante.

Le proiezioni pubbliche prive del campo restano valide e **non richiedono
migrazione**. Nessun backfill è previsto né necessario.

---

## 12. Export, import, eliminazioni

| Operazione | Comportamento V1 | Note |
|---|---|---|
| **Export ZIP** | Include un sidecar `visuals/{assetId}.json` con il manifest; **il binario WebP richiede l'operazione binaria del gateway** e arriva con VISUAL-ENRICHMENT-03. | Il gateway è oggi testuale (`.md`/`.pool.md`). Limite dichiarato, non nascosto: fino a VE-03 l'export documenta l'immagine ma non la trasporta. |
| **Import ZIP** | **Nessun manifest e nessun binario viene importato.** | Deliberato. L'import è append-only e accetta oggi solo testo validabile; accettare binari arbitrari da un archivio è una superficie di rischio che questa funzione non giustifica. Una lezione importata nasce senza immagine e può riceverne una generandola. |
| **Eliminazione lezione** | Rimozione completa secondo §6.5, nello stesso flusso che già elimina la lezione. | Nessun percorso separato da ricordare. |
| **Eliminazione UDA** | Idem per ogni lezione contenuta. | |
| **Eliminazione corso / import** | I binari cadono dentro il prefisso già cancellato da `deleteImportPrefix` (SGW-02A); i documenti `publicLessonVisuals` sono eliminati insieme alle rispettive `publicLessons`. | L'immagine è **dentro** il prefisso dell'import proprio per questo: nessuna cancellazione aggiuntiva da progettare. |

---

## 13. Cost model

Nessuna stima monetaria è dichiarata in questa fase: il listino delle immagini
non è ancora fissato per SchoolForge, e un numero inventato qui diventerebbe un
numero citato altrove. Ciò che è congelato è **dove** si spende e **quanto
spesso**.

| Momento | Provider | Firestore | Storage | Function |
|---|---|---|---|---|
| **Proposta** | 1 chiamata testo, profilo `quality`, output breve e strutturato | 1 scrittura run + prenotazione | — | 1 |
| **Generazione** | 1 chiamata immagine, profilo `quality` | 1 aggiornamento run | 1 scrittura staging | 1 (include normalizzazione) |
| **Rigenerazione** | come Generazione | come Generazione | 1 scrittura staging (nuovo `requestId`) | 1 |
| **Replay** (risposta persa) | **0** | 1 lettura run | 0 | 1 |
| **Approvazione** | 0 | 2 letture transazionali, 1 scrittura privata, +2 pubbliche solo se svolta, 1 audit | 1 copia + 1 delete staging | 1 |
| **Riancoraggio** | **0** | 1 scrittura privata, +1 pubblica se svolta, 1 audit | 0 | 0 (client) |
| **Cambio svolta ⇄ non svolta** | 0 | 2 letture transazionali, ≤ 3 scritture, 1 audit | 0 | 0 |
| **Visualizzazione studente — lezione senza immagine** | 0 | **0** | 0 | 0 |
| **Visualizzazione studente — lezione con immagine** | 0 | **1 lettura puntuale**, all'apertura, non ripetuta | 0 | 0 |
| **Elenchi / card** | 0 | **0** | 0 | 0 |
| **Rimozione** | 0 | 3 eliminazioni transazionali, 1 audit | 1 delete | 1 |
| **Cleanup staging scaduto** | 0 | 1 delete per run | 1 delete per blob | 1 per esecuzione |

Invarianti di costo, verificabili strutturalmente:

- **zero** listener, **zero** polling, **zero** indici nuovi;
- **zero** letture per card, in ogni superficie;
- **zero** costo su ogni lezione priva di immagine — il caso maggioritario;
- il costo del provider è pagato **solo** su azione esplicita del docente, dopo
  una stima mostrata e confermata.

**Stima e conferma.** Come per pool, lezione e mappa, il costo è stimato e
**confermato prima** della generazione. Proposta e generazione sono due spese
distinte e vanno dichiarate distintamente: la proposta può concludersi con
«nessuna immagine utile», e in quel caso la seconda spesa non avviene mai.

---

## 14. Il flusso, dal punto di vista del docente

1. Scheda **Contenuto** della lezione → **«Arricchisci visivamente»**.
   Disabilitata con motivo visibile se il corpo manca, è vuoto o non è salvato.
2. Si apre un `DialogShell` coerente con SchoolForge (stesso primitivo, stesso
   focus trap, stessa politica di chiusura).
3. **Proposta** — SchoolForge mostra: soggetto, **utilità didattica**, posizione
   suggerita, prompt, didascalia, testo alternativo. Ogni campo è modificabile.
   Oppure: **«Nessuna immagine utile»**, con la motivazione, e nessuna azione di
   generazione offerta.
4. Il docente modifica ciò che vuole.
5. **«Genera immagine»** — con costo stimato dichiarato e confermato.
6. **Anteprima** — immagine, costo reale, peso finale, dimensioni, didascalia,
   testo alternativo.
7. **Rigenera** · **Modifica la richiesta** · **Approva** · **Abbandona**.
8. **«Applica alla lezione»** — salva l'unico asset approvato.
9. Se un'immagine esiste già, l'azione è **«Sostituisci l'immagine attuale»**,
   mostra entrambe, e il canonico non è toccato fino alla conferma.

**Lato studente**: la lezione svolta mostra l'immagine al suo posto, con
didascalia. La lezione non svolta non la mostra — e non mostra **nulla** che ne
suggerisca l'esistenza: nessun riquadro vuoto, nessun «disponibile dopo», che
sarebbe un invito a cercare la scorciatoia.

---

## 15. Fasi

La suddivisione proposta dal mandato è mantenuta, con **una modifica motivata**.

> **Modifica proposta.** La progettazione originale poneva «generazione,
> compressione e staging» in VE-02 e «salvataggio, proiezione e lifecycle» in
> VE-03. Il confine tecnico reale, però, non passa fra generare e salvare: passa
> fra **testo** e **binario**. Tutta la catena binaria — accettare byte,
> sniffare il MIME, ridimensionare, convertire, hashare, scrivere in Storage
> attraverso un gateway che oggi è testuale — è un unico problema con un'unica
> superficie di rischio, e spezzarlo a metà significherebbe consegnare VE-02 con
> un percorso binario a metà, non verificabile end-to-end. Il resto della
> suddivisione resta invariato.

| Pacchetto | Sintesi | Dipendenze | Stato |
|---|---|---|---|
| **VISUAL-ENRICHMENT-00** | **Contratto e prototipo.** Decisione architetturale sulla proiezione studente, forma chiusa del manifest, politica di ancoraggio e di perdita dell'ancora, ciclo di vita completo, modello di autorizzazione, idempotenza e cleanup, cost model, confine illustrativo/tecnico, principi di sicurezza congelati, e prototipo statico responsive a dieci stati. | CONCEPT-MAP-02, LESSON-MANUAL-01, SGW-02C, ANNOT-03B | **Implementato come contratto/prototipo.** Nessun runtime. |
| **VISUAL-ENRICHMENT-01** | **Proposta testuale e contratti.** Nuovo `kind: 'visual_proposal'` in `AiContentRequest`; payload chiuso; prompt dedicato con versione propria; Structured Output a campi chiusi incluso l'esito «nessuna immagine utile»; validazione del `subject`; tipi del manifest e validatore puro fail-closed; risolutore d'ancora puro; test di **non-regressione byte-identica** di pool, lezione e mappa. Nessuna immagine, nessuna UI, nessuna persistenza, nessun deploy. | VE-00 | **Implementato.** Vedi §15.1. Nessuna immagine, UI, persistenza o deploy. |
| **VISUAL-ENRICHMENT-02** | **Catena binaria completa.** Provider immagini; operazione binaria del gateway; normalizzazione server-side (sniffing MIME, resize, WebP, strip metadati, cap 200 KB, sha256); staging con TTL, replay e cleanup; cost model reale del provider. Nessuna UI, nessuna proiezione studente. | VE-01 | **Aperto.** |
| **VISUAL-ENRICHMENT-03** | **Persistenza, proiezione e lifecycle.** Manifest privato sul `LessonDoc`; promozione atomica; proiezione pubblica in due pezzi; `publicLessonVisuals` e relative Rules; estensione della transazione `setLessonCompleted`; rimozione e cleanup ordinato; export ZIP con binario; eliminazioni lezione/UDA/corso; audit. | VE-02 | **Aperto.** |
| **VISUAL-ENRICHMENT-04** | **UI e renderer.** `DialogShell` a dieci stati secondo il prototipo; split del flusso di token nel renderer manuale con doppia sanificazione; `<figure>` React controllata; avviso e azione di riancoraggio; vista studente condizionale; responsive e accessibilità verificate sui componenti reali. | VE-03 | **Aperto.** |
| **VISUAL-ENRICHMENT-05** | **Benchmark qualitativo e rollout DEV.** Scenari didattici congelati; rubrica con blocker espliciti; misura del tasso di «nessuna immagine utile» (un tasso vicino a zero è **sospetto**, non un successo); verifica di peso, tempi e layout shift reali; rollout DEV. | VE-04 | **Aperto.** |
| **Gate GVISUAL** | **Approvazione umana.** Il docente giudica se le immagini valgono il loro costo su lezioni reali. | VE-05 | **PENDING.** |

### 15.1 VISUAL-ENRICHMENT-01 — che cosa è operativo

**Nessuna immagine esiste, e nessuna funzionalità è disponibile.** Questa fase
aggiunge contratti puri e un quarto kind IA; non c'è UI, non c'è persistenza, non
c'è provider di immagini e non è stato fatto alcun deploy. VE-02→VE-05 restano
aperti e **Gate GVISUAL resta PENDING**.

**Il quarto kind.** `visual_proposal` partecipa esplicitamente a parser chiuso,
`canonicalRequest`, `inputHash`, `computeOpaqueRunId`,
`computeBudgetReservationKey`, stima, prenotazione, prompt, Structured Output,
validazione dell'output e replay. Non è veicolato dentro `lesson` né dentro
`concept_map`: i quattro kind hanno output reciprocamente incompatibili, e ognuno
rifiuta quelli degli altri tre.

**Payload chiuso.** `kind`, `requestId`, `modelProfile`, `titolo`, `sottotitolo`,
`difficolta`, `concettiChiave`, `obiettivi`, `udaTitle`, `udaContext`,
`lessonBody`. Nient'altro è ammesso: niente `teacherGuidance`, `depth`,
`hasCurrentContent`, dati studente, classi, etichette, UID, URL, riferimenti
Storage o hash dichiarati dal client. `sourceBodyHash` sarà calcolato
**server-side** dall'esatto `lessonBody` quando servirà (VE-03).

**Quality-only, fail-closed.** `modelProfile` deve essere letteralmente
`quality`; `economy` produce `invalid_input` nella validazione del payload, cioè
prima di provider, stima, prenotazione, run e qualunque scrittura. Il controllo è
sul letterale e non passa dal parser condiviso del profilo, che accetterebbe
`economy` come valore valido per gli altri kind.

**Schema trasmesso al provider.** Lo Structured Output strict non accetta
un'unione alla radice: la radice è quindi un `object` chiuso con l'unica
proprietà obbligatoria `proposal`, e l'unione vive **annidata** dentro di essa
espressa con `anyOf` — `oneOf` non compare in alcun punto dello schema
trasmesso. Entrambi i rami hanno `additionalProperties: false` e **tutte** le
proprietà dichiarate anche `required`, perché strict non ammette campi
facoltativi. L'envelope `proposal` è **provider-specifico**: viene validato ed
estratto prima di qualunque persistenza, e il valore salvato nel run e
restituito dal replay è l'unione **senza** envelope. Se filtrasse fino al
documento persistito, il contratto pubblico diventerebbe ostaggio della forma
che un provider richiede oggi.

**Esito: union discriminata chiusa.** Due rami disgiunti — `{ decision: 'none',
reason }` e `{ decision: 'image', subject, rationale, anchorHeadingText, caption,
altText }` — con `additionalProperties: false` a ogni livello. Nessun booleano,
nessun campo nullable, nessuna proprietà condivisa fra i rami: un «nessuna
immagine» con la didascalia già scritta non è rappresentabile. Nessun prompt
immagine compare nell'output: quel prompt lo comporrà il server in VE-03.

**Limiti dei campi, in code point Unicode** — non in unità UTF-16, così
un'emoji fuori dal BMP conta una volta sola:

| Campo | Limite |
|---|---|
| `subject` | 400 |
| `reason` | 600 |
| `rationale` | 800 |
| `anchorHeadingText` | 300 |
| `caption` | 500 |
| `altText` | 1.000 |

Ogni campo deve essere una stringa non vuota, senza spazi esterni, entro il
limite, priva di caratteri di controllo, HTML e fence Markdown. **Nessun trim,
nessun troncamento, nessuna normalizzazione silenziosa:** un valore non canonico
è rifiutato, non aggiustato.

**Ordine di validazione:** tipo → non vuoto → spazi esterni → limite → markup →
(per il solo `subject`) filtro dei soggetti fuori contratto. Lo spazio esterno è
controllato prima del limite perché un valore con spazi in testa è già non
canonico, e rifiutarlo per lunghezza direbbe al chiamante la cosa sbagliata.

**Filtro del `subject`.** Rifiuta imitazioni di artisti viventi, studi, marchi e
stili proprietari; persone riconoscibili o identificabili; tentativi di ignorare
le istruzioni precedenti o di sostituire il preambolo SchoolForge; concetti
dichiaratamente assenti dalla lezione; testo esteso, loghi, firme e watermark.
**Il messaggio d'errore non riporta mai il soggetto integrale** — i log di un
tentativo di injection sono esattamente il posto in cui quel testo non deve
essere replicato: viene riportata solo la categoria.

**Prompt.** Versione dedicata `AI_VISUAL_PROPOSAL_PROMPT_VERSION =
'visual-proposal-01-v1'`, distinta da quelle di pool, lezione e mappa, che non
sono state toccate. Il prompt tratta metadati e corpo come dati, delimita
`lessonBody` con `fence()`, chiede una sola immagine e testo minimo al suo
interno, vieta i concetti assenti, chiede caption e alt text sostanziali e
distinti, e spinge esplicitamente verso `decision: 'none'` quando l'immagine
sarebbe decorativa, ridondante, imprecisa, non verificabile o meno chiara del
testo. Il preambolo `schoolforge-sketch/v1` e il prompt del provider immagini
**non compaiono**: sono fuori scope.

**Manifest e ancoraggio.** `LessonVisualManifest` e `LessonVisualAnchor` sono
implementati come tipi e validatori puri, a chiavi chiuse, senza correzioni
automatiche e **senza dipendenze Firebase**. Costanti: `MAX_VISUAL_BYTES =
204.800`, `MAX_VISUAL_LONG_EDGE = 1200`, `VISUAL_STYLE_VERSION =
'schoolforge-sketch/v1'`. Il TTL dello staging **riusa** `AI_CONTENT_RUN_TTL_MS`
invece di duplicarne il valore.

> **Nota sul campo `approvedAt`.** §4 lo dichiara `Timestamp` di Firestore, ma
> questa fase deve restare priva di dipendenze Firebase: è quindi vincolato
> **strutturalmente** alla sola forma che serve a validarlo (`toMillis()`). Il
> `Timestamp` reale la soddisfa, e VE-03 lo legherà al tipo concreto nel punto in
> cui la persistenza esiste davvero.

**`approvedAt` è validato invocando il metodo, non solo constatandolo.** Un
oggetto che espone `toMillis()` ma restituisce `NaN`, `Infinity`, una stringa o
`null` — o che lo fa esplodere — supererebbe un controllo di sola presenza e
romperebbe tutto ciò che viene dopo. L'helper condiviso `timestampToMillis`
(estratto da `aiContentRunDoc`, dove ne esisteva una copia privata) invoca il
metodo in `try/catch` e pretende un `number` finito; il valore non viene
normalizzato.

**`storageRef` è verificato contro il percorso canonico**
`repository/{ownerUid}/{importId}/{udaDir}/visuals/{assetId}.webp`: esattamente
sei segmenti non vuoti, primo `repository`, quinto `visuals`, ultimo
`${assetId}.webp` con l'`assetId` **del manifest**, nessun segmento `.` o `..`,
nessun doppio slash, nessun carattere di controllo, nessuna estensione diversa.
Un percorso è un'autorizzazione implicita — le Rules di Storage sono owner-only
e ancorate a quel prefisso — quindi un `storageRef` fuori forma non è un
dettaglio estetico ma un riferimento che punta dove non dovrebbe. Nessun
fallback, nessun suffisso aggiunto, nessuna correzione.

**L'ancoraggio deve esistere davvero nella lezione.** Il controllo strutturale
dice se l'esito ha la forma giusta; un controllo **relazionale** separato dice
se parla della lezione che è stata mandata. Per `decision: 'image'` vengono
estratti gli heading realmente presenti in `lessonBody` — ATX e Setext, con
tutto ciò che sta dentro un blocco recintato **ignorato**, perché un `# Titolo`
dentro un esempio di codice non è un heading della pagina — e
`anchorHeadingText` è confrontato in modo **esatto**: nessun trim aggiuntivo,
nessun case folding, nessuno slug, nessun fuzzy matching. Un ancoraggio
inventato o parafrasato produce `provider_invalid_output` **prima** della prima
persistenza. `decision: 'none'` non richiede alcun heading.

**Le fence sono riconosciute secondo CommonMark, lunghezza compresa.** Di una
fence aperta si memorizzano **carattere e lunghezza** della sequenza: una riga
chiude il blocco solo se usa lo stesso carattere, ha una sequenza lunga almeno
quanto quella di apertura, e dopo di essa non contiene altro che spazi o
tabulazioni (indentazione ammessa fino a tre spazi). Conservare il solo
carattere non basta: una fence aperta con quattro backtick verrebbe chiusa da
una riga di tre backtick — che per Markdown è ancora **contenuto** — e il testo
successivo tornerebbe a essere interpretato, rendendo ancorabile un heading che
nella pagina non esiste.

> **Confine dichiarato.** Il controllo relazionale vive prima della prima
> persistenza e **non** nel replay, dove la validazione resta strutturale: in
> replay la richiesta originale non è più disponibile e il corpo della lezione
> potrebbe essere cambiato, quindi rieseguirlo renderebbe irreplayabile un run
> legittimo a causa di una modifica successiva del testo.

**Risolutore d'ancora.** `resolveLessonVisualAnchor(headingSlug,
presentHeadingSlugs)` restituisce `{ status: 'resolved', headingSlug }` oppure
`{ status: 'fallback' }`, **per solo confronto esatto**. Nessun fuzzy match,
nessun prefisso, nessuna similarità, nessun case-insensitive — coerente con §5.3:
un'illustrazione che riappare sotto un heading «somigliante» insegna una cosa
falsa, mentre una in fondo alla pagina è solo mal impaginata. Non esiste alcun
esito «rimuovi»: rinominare un titolo non deve distruggere un asset approvato.

**Non-regressione verificata.** Gli `inputHash` congelati di pool e lezione sono
invariati, la forma canonica dei tre kind non contiene traccia del quarto, e
prompt, schema e tetti di output di pool, lezione e mappa sono byte-identici.
Nessuna costante di riferimento è stata aggiornata per far passare un test.

---

## 16. Fuori scope

Dichiarati qui perché non rientrino «già che ci siamo»:

- **più immagini per lezione**, gallerie, caroselli, ordinamenti;
- **immagini generate per pool, verifiche, UDA o mappe concettuali**;
- **upload di immagini proprie** del docente — è una funzione diversa, con
  problemi diversi (licenze, moderazione, formati, provenienza);
- **modifica dell'immagine** dopo la generazione: ritaglio, filtri, ritocco;
- **stili alternativi** o stile configurabile;
- **immagini con persone riconoscibili** (§9.4);
- **diagrammi tecnici precisi** (§2.1) — restano testo o diagramma a caratteri;
- **KaTeX e Mermaid**, che restano fuori scope come da
  `lesson-manual-contract.md` §11;
- **profilo `economy`** per qualunque fase di questa funzione;
- **import di immagini da ZIP** (§12).

---

## 17. Rischi residui

Registrati perché siano decisioni e non dimenticanze.

1. **La qualità didattica reale non è ancora misurata.** Nessuna immagine è
   stata generata. Che «SchoolForge Sketch v1» produca figure utili invece di
   scarabocchi plausibili è un'ipotesi, e VE-05 esiste per verificarla. Il Gate
   GVISUAL può legittimamente concludere che la funzione non vale il suo costo.
2. **Il duplicato dei byte** (WebP in Storage + base64 in Firestore) è
   trascurabile in costo ma è **due sorgenti di verità**. È mitigato da
   `sha256` e dalla promozione atomica, non eliminato.
3. **L'export ZIP resta incompleto fino a VE-03**: il manifest viaggia, il
   binario no. È un limite dichiarato, non un difetto scoperto dopo.
4. **Il modello potrebbe non proporre quasi mai «nessuna immagine utile»**,
   perché i modelli tendono a essere accomodanti. Se il tasso misurato in VE-05
   fosse vicino a zero, il problema è il prompt, non la fortuna: va trattato
   come un blocker, non come un buon risultato.
5. **Un data URI da ~267 KB in un documento Firestore** è un uso legittimo ma
   non convenzionale del datastore. È scelto consapevolmente contro alternative
   peggiori (§3.2) e va rivisto se la funzione dovesse mai superare
   un'immagine per lezione.
6. **Il riancoraggio è manuale.** Un docente che riscrive molti titoli si trova
   più immagini in coda alla lezione e deve riancorarle una a una. È accettato:
   l'alternativa automatica indovinerebbe.
