# SchoolForge — Verifiche differenziate per etichetta (VDIF) ed Esiti

**Stato:** **VDIF-00 completato** — contratto tecnico congelato, cost model,
matrice di test e prototipo UI approvabile. **Nessuna riga di codice runtime
implementata.** Nessuna modifica a Firebase, Security Rules, Cloud Functions,
indici, schema reale o dipendenze è introdotta da questo pacchetto.
**Data:** 11 agosto 2026.
**Dipendenze operative:** M4 (correzione manuale e IA) e VEX (varianti
equivalenti) implementati e distribuiti su DEV con **Gate GVEX PASS**;
`assignedQuestionOrders` e `resolveAssignedQuestions` già usati da tutti i
consumer downstream; LESSON-DEPTH-01 in produzione.
**Prototipo:** [`prototipi/verifiche-differenziate.html`](prototipi/verifiche-differenziate.html).
**Gate:** **GVDIF aperto.**

Questa roadmap affronta due bisogni distinti che condividono gli stessi dati:

1. **gli esiti non tornano indietro.** Il portale produce lezione, verifica e
   correzione, ma ciò che la classe ha sbagliato non raggiunge mai la lezione
   che l'aveva preparata;
2. **la didattica è a taglia unica.** Una classe reale ha studenti con
   obiettivi minimi e misure personalizzate. Non è un extra: è un obbligo
   normativo, e oggi il docente lo assolve fuori dallo strumento.

Il pacchetto **B — verifiche differenziate (VDIF)** è quello che questo
documento congela. Il pacchetto **A — Esiti (ESITI-01)** resta valido come
descritto in §12 ed è **indipendente e successivo** al Gate GVDIF.

---

## 1. Principi invarianti

Sono vincoli, non preferenze. Ogni fase VDIF-01→05 va misurata contro questa
lista, e una violazione è un blocker di merge.

1. **Le etichette sono strumenti operativi privati del docente.** Servono al
   sistema solo per sapere *quale versione servire*, mai *perché*.
2. **Nessun dato sanitario o certificativo nel database.** SchoolForge non
   memorizza diagnosi, certificazioni, PDP, BES o motivazioni sanitarie, né in
   campi dedicati né in campi liberi progettati per ospitarle.
3. **La UI invita a denominazioni operative neutrali** («Percorso A»,
   «Obiettivi essenziali», «Gruppo 2»), **senza alcun esempio diagnostico**:
   né nei placeholder, né negli stati vuoti, né nei testi di aiuto.
4. **Nessuna classificazione semantica automatica sui nomi.** SchoolForge non
   deduce, non deriva e non certifica che cosa rappresenti un'etichetta: il
   nome è una stringa opaca, confrontata solo per unicità (§5.A.5).
5. **Nessun nome, ID o riferimento di etichetta può comparire in dati o
   superfici leggibili dallo studente.** L'elenco chiuso è in §4.
6. **Un solo riferimento di etichetta per studente.** Nessuna precedenza da
   arbitrare: le combinazioni sono etichette a sé.
7. **Studente senza etichetta ⇒ verifica base.** Default esplicito.
8. **Etichetta senza variante per una domanda ⇒ domanda base.**
9. **«Nessuna domanda» è ammessa** per una specifica combinazione
   domanda × etichetta.
10. **Una configurazione che lascia un'etichetta con zero domande blocca
    l'attivazione.**
11. **Le varianti si configurano soltanto sulle domande comuni.**
12. **Le alternative provengono dalla stessa lezione della domanda base.**
13. **Le alternative non possono produrre duplicazioni** nella verifica
    risolta assegnata a uno studente.
14. **La configurazione è congelata semanticamente all'attivazione.**
15. **Cambiare l'etichetta di uno studente non modifica una verifica già
    attiva.**
16. **Nessuna configurazione viene corretta, eliminata o convertita in
    silenzio.**
17. **Qualunque incoerenza blocca l'attivazione** con un errore leggibile
    lato docente. Fail-closed sempre, degradazione silenziosa mai.
18. **Zero listener per card, zero query per riga, zero polling.**
19. **Riuso prima di costruzione.** Il meccanismo per servire domande diverse a
    studenti diversi esiste già (`assignedQuestionOrders` +
    `resolveAssignedQuestions`): VDIF ne cambia il **criterio di
    assegnazione**, non l'impianto.

---

## 2. Il modello in una frase

Il docente definisce alcune **etichette**, ne assegna **al massimo una** a
ciascuno studente, e in fase di bozza può, per ogni **domanda comune**,
scegliere esplicitamente per ciascuna etichetta fra **domanda base**,
**domanda alternativa** e **nessuna domanda**. Chi non ha etichetta, o ha
un'etichetta senza scelta per quella domanda, riceve la domanda base.

### 2.1 Decisioni prese (nessuna resta aperta)

| # | Decisione | Motivo |
|---|---|---|
| D1 | Una sola etichetta per studente | elimina ogni regola di precedenza; le combinazioni diventano etichette a sé (`Percorso A + ridotto`), al prezzo di una lista più lunga |
| D2 | Varianti solo sulle domande comuni | una domanda già in un gruppo VEX non è differenziabile: il conflitto fra sorteggio anti-copiatura e differenziazione è **eliminato**, non arbitrato (§6) |
| D3 | Alternative dalla stessa lezione | garantisce che la variante interroghi la stessa porzione di programma: è ciò che distingue un obiettivo minimo da una verifica diversa |
| D4 | Alternative non già selezionate | altrimenti lo studente riceverebbe la stessa domanda due volte |
| D5 | «Nessuna domanda» ammessa | la riduzione resta possibile, ma come eccezione decisa domanda per domanda, non come impostazione globale |
| D6 | Punteggio massimo diverso ammesso | la percentuale è già derivata dal proprio massimo: una verifica ridotta resta confrontabile senza penalizzazioni artificiali |
| D7 | Congelamento all'attivazione | coerente con `teacherSnapshot`, già immutabile per Rules. Cambiare idea richiede di riportare la verifica in bozza — gesto esplicito |
| D8 | Etichette in una **collezione owner-only separata**, non su `students/{uid}` | `students/{uid}` è leggibile dallo studente stesso e Firestore non nasconde singoli campi in lettura (§5.B.1) |
| D9 | Le configurazioni referenziano **`labelId` stabili**, mai il nome | una rinomina non deve rompere le bozze né cambiare l'assegnazione |
| D10 | Scelta **esplicita a tre valori**, mai un booleano o un campo assente | «base», «alternativa» e «nessuna» sono tre intenzioni diverse: l'assenza non può significare né la prima né la terza |

### 2.2 Che cosa esiste già e va riusato

| Serve | Esiste |
|---|---|
| servire domande diverse a studenti diversi | `SubmissionDoc.assignedQuestionOrders` (+ mirror `assignedAnswerKeys`) |
| risolvere «quali domande valgono per questa consegna» | `resolveAssignedQuestions` (`assignedVariant.ts`), già usato da correzione manuale, IA, restituzione, PDF ed export |
| sapere quali domande sono comuni | `commonEntryIds(selezionate, gruppi)` (`vexGroups.ts`), funzione pura |
| convertire `questionIndexEntryId` → `order` all'attivazione | `buildEquivalentSnapshotParts` (`vexSnapshot.ts`) |
| scegliere una domanda dal pool in modo accessibile e con anteprima | `VexQuestionSelect` (metadati + `questionPreview`, tastiera, Escape, click esterno) |
| lezione di provenienza di ogni domanda | `questionIndex.lessonFilename` / `VerificationQuestionRef.lessonFilename` |
| dialog conforme (viewport, backdrop, Escape, focus trap) | `DialogShell` |
| card full-width, menu «…», layout responsive | `RecordCard` + `RecordActionsMenu` |

---

## 3. Vocabolario congelato

| Termine | Significato esatto |
|---|---|
| **Etichetta** | Nome operativo privato del docente, con `labelId` stabile. Non è una categoria, non è una diagnosi, non ha semantica per il sistema. |
| **Assegnazione** | La relazione «questo studente ha questa etichetta». Vive in un documento owner-only separato. |
| **Domanda base** | La domanda comune selezionata nella verifica, valida per tutti finché una scelta esplicita non la sostituisce. |
| **Alternativa** | Una domanda dello stesso `lessonFilename` della base, non selezionata nella verifica, che sostituisce la base per una specifica etichetta. |
| **Omissione** | La scelta esplicita «Nessuna domanda» per una combinazione domanda × etichetta. |
| **Verifica risolta** | L'insieme di domande effettivamente servito a uno studente, dopo differenziazione e VEX. |
| **Configurazione privata** | `config.differentiation`, la struttura di bozza owner-only che descrive le scelte. |
| **Snapshot differenziato** | `teacherSnapshot.differentiation`, la stessa struttura convertita in `order` e congelata all'attivazione. |

---

## 4. Perimetro privacy — elenco chiuso

Né `labelId`, né `labelName`, né alcun valore derivato da essi (hash, indice
posizionale, colore, contatore, ordinamento osservabile) può comparire in:

| Superficie | Perché è nell'elenco |
|---|---|
| `students/{uid}` | leggibile dallo studente stesso (`firestore.rules`: `allow read: if isOwner() \|\| (isAuthenticated() && request.auth.uid == uid)`) |
| `publishedProjection/*` | leggibile da ogni compagno di classe autorizzato |
| `publicLessons/*` | proiezione studente |
| `SubmissionDoc` | leggibile dallo studente finché `draft` |
| `SubmissionReceiptDoc` | leggibile dallo studente dopo la consegna |
| `correctionReturns/*` | leggibile dallo studente quando `visibleToStudent == true` |
| PDF studente | generato nel browser dalla proiezione |
| PDF di correzione / archivio | consegnato allo studente o alla scuola |
| CSV / export registro | consegnato fuori dallo strumento |
| schermata di svolgimento (`OnlineExamView`) | vista studente |
| restituzione (`StudentCorrectionView`) | vista studente |
| messaggi di errore lato studente | testo mostrato allo studente |
| payload o snapshot pubblici, `topicOutline` incluso | contratto chiuso già in vigore |
| log applicativi e `auditEvents.reason` | `auditEvents` è owner-only ma non deve trasportare il **nome** dell'etichetta (§5.A.8) |

**Canali laterali da negare esplicitamente**, perché nessuno di essi è un
campo e tutti rivelerebbero comunque la differenziazione:

- **numero di domande.** Uno studente con omissioni riceve meno domande. È
  **inevitabile e accettato**: è il senso stesso della funzionalità. Ciò che
  non è ammesso è **dire perché** — nessun testo, badge, nota o numerazione
  con buchi può segnalare che manca qualcosa. La numerazione mostrata allo
  studente è **densa e locale** (1..N sulle domande realmente assegnate),
  esattamente come già avviene in VEX;
- **`topicOutline`.** Resta il perimetro **complessivo** della verifica —
  unione delle lezioni di tutte le domande selezionate, base e alternative
  insieme — quindi **identico per ogni studente** e muto sull'etichetta,
  esattamente come già stabilito per VEX (`sicurezza.md` §2);
- **ordine.** L'ordine visivo resta lo shuffle locale già esistente, non
  persistito, e non correla con l'etichetta;
- **messaggi di errore.** Un errore lato studente non dice mai «la tua
  configurazione», «il tuo percorso» o «la tua variante»: usa lo stesso testo
  generico già in uso per VEX.

---

## 5. Modello dati congelato

> I nomi dei campi sono **definitivi**. Nessuno di questi tipi è implementato
> da VDIF-00: sono il contratto che VDIF-01→04 dovranno rispettare alla
> lettera.

### A. Registro etichette

**Percorso:** `differentiationLabels/{labelId}` — collezione **top-level**,
**owner-only in lettura e scrittura**.

Perché top-level e non una sottocollezione di `students`: l'etichetta esiste
indipendentemente dagli studenti che la usano (può esistere senza assegnazioni,
e sopravvive alla rimozione di uno studente), ed è referenziata anche dalle
bozze di verifica, che non appartengono ad alcuno studente.

| Campo | Tipo | Regola |
|---|---|---|
| *document id* | `string` | `labelId` opaco generato client-side (`crypto.randomUUID()`), **immutabile**, mai derivato dal nome |
| `ownerUid` | `string` | `== request.auth.uid`, **immutabile** |
| `name` | `string` | trim applicato prima della scrittura; **1–40 caratteri** e **≤ 120 byte UTF-8**; nessun carattere di controllo, nessun newline |
| `nameKey` | `string` | forma normalizzata **usata esclusivamente per il confronto di unicità** (§5.A.5). Mai mostrata, mai esportata, mai usata come chiave di configurazione |
| `createdAt` | `Timestamp` | `== request.time` |
| `updatedAt` | `Timestamp` | `== request.time` a ogni scrittura |

**Contratto chiuso:** `keys().hasOnly([...])` e `hasAll([...])` sulle sei
chiavi sopra. Nessun campo `color`, `note`, `description`, `category`,
`priority` o `order`: ognuno di essi sarebbe l'appiglio per scriverci una
motivazione, ed è esattamente ciò che il principio 2 vieta.

**5.A.5 — Normalizzazione per il confronto.** `nameKey = name` con: trim,
collasso degli spazi interni multipli in uno singolo, `toLowerCase()` e
normalizzazione Unicode `NFKC`. **Nulla di più**: nessuna rimozione di accenti,
nessuna traslitterazione, nessun stemming, nessuna sinonimia. La normalizzazione
serve a impedire «Percorso A» e «percorso  a» come etichette distinte, non a
interpretare il nome. È un **helper puro condiviso** (`labelNameKey.ts`),
unica fonte per UI e servizio.

**5.A.6 — Unicità.** `nameKey` è unico per docente. In un sistema
single-owner con al più poche decine di etichette, l'unicità è verificata dal
**servizio** sulla lista già caricata in memoria, non da un vincolo Firestore
(che non esiste) né da una query dedicata. È un vincolo applicativo dichiarato:
l'unico principal che può scrivere è l'owner, lo stesso già fidato per
`teacherSnapshot`/`config` (`sicurezza.md` §3).

**5.A.7 — Conteggio di utilizzo.** Nessun contatore persistito, in nessuna
forma. La fonte **autorevole** è il calcolo derivato dalle assegnazioni già
caricate nella scheda Studenti: un contatore denormalizzato richiederebbe una
transazione a ogni assegnazione e potrebbe divergere. Vedi §14 per il modello
di costo.

**5.A.8 — Audit.** Tre nuove azioni: `label.created`, `label.updated`,
`label.deleted`. `targetId == labelId`. **`reason` resta `null`**: il registro
audit è owner-only, ma non c'è alcun motivo per farvi transitare il nome
dell'etichetta, e l'assenza è la difesa più semplice da verificare.

**5.A.9 — Comportamento legacy.** La collezione non esiste oggi. Assenza
totale = zero etichette, stato vuoto, nessuna migrazione. Un documento privo di
`nameKey` (impossibile per il contratto chiuso, ma possibile per manomissione)
è **fail-closed**: escluso dalla lista con errore leggibile, mai riparato in
silenzio.

### B. Assegnazione studente → etichetta

**Percorso:** `studentLabelAssignments/{studentUid}` — collezione **top-level**,
**owner-only in lettura e scrittura**, id **deterministico** uguale allo
`studentUid`.

**5.B.1 — Perché `labelId` NON può stare su `students/{uid}` (dimostrazione).**

`firestore.rules` concede oggi:

```
match /students/{uid} {
  allow read: if isOwner() || (isAuthenticated() && request.auth.uid == uid);
  ...
}
```

Lo studente **legge il proprio documento** — è il percorso che `RoleGate` usa
(`getOwnStudentDoc`) per risolvere stato, classe e telemetria di accesso. Le
Firestore Security Rules autorizzano **per documento, non per campo**: non
esiste alcun costrutto — né `hasOnly` in lettura, né una projection
server-side — che consenta di restituire allo studente `students/{uid}` privo
di un singolo campo. Aggiungere `labelId` lì significherebbe che **ogni
studente potrebbe leggere la propria etichetta** con una `getDoc` banale dalla
console del browser, e questo è esattamente il principio 5.

È la stessa ragione — dichiarata in `architettura.md` ADR-12 — per cui il corpo
lezione vive in `publicLessons` e non dentro il documento tecnico `lessons`:
*«Le Firestore Security Rules autorizzano per documento, non per campo:
separare i dati tecnici dalla proiezione pubblica in documenti diversi permette
regole semplici e verificabili»*. VDIF applica lo stesso principio nella
direzione opposta: il dato sensibile resta **fuori** dal documento che lo
studente legge.

Le alternative scartate, e perché:

| Alternativa | Perché scartata |
|---|---|
| `labelId` su `students/{uid}` | leggibile dallo studente (sopra) |
| Sottocollezione `students/{uid}/label/current` | tecnicamente owner-only (le Rules non si ereditano), ma appende un dato del **docente** sotto l'albero identitario dello studente, e rende l'elenco delle assegnazioni una collection-group query invece di una lettura di collezione |
| Array `studentUids[]` dentro l'etichetta | rende «una sola etichetta per studente» un invariante da mantenere a mano su N documenti, e cresce senza limite dichiarato |
| Mappa `{studentUid: labelId}` in un unico documento | limite 1 MiB e contesa in scrittura su ogni singola assegnazione |

| Campo | Tipo | Regola |
|---|---|---|
| *document id* | `string` | `== studentUid`. Identità deterministica: **un solo documento per studente**, garantita dal path, senza query di unicità (stesso schema di `submissions/{verificationId}_{studentUid}`) |
| `studentUid` | `string` | `== {studentUid}` del path, **immutabile** |
| `ownerUid` | `string` | `== request.auth.uid`, **immutabile** |
| `labelId` | `string` | id di un'etichetta esistente dello stesso owner; **non nullable** |
| `createdAt` | `Timestamp` | `== request.time` |
| `updatedAt` | `Timestamp` | `== request.time` |

**5.B.2 — «Nessuna etichetta» è l'assenza del documento**, non un valore
sentinella. Motivo: un `labelId: null` sarebbe un secondo modo di dire la
stessa cosa, e ogni lettore dovrebbe gestirne due. L'assenza è già lo stato di
default più restrittivo, come `students/{uid}` assente = `pending`
(`sicurezza.md` §3.1). Rimuovere l'etichetta ⇒ `deleteDoc`.

**5.B.3 — Studente eliminato.** `removeStudent` elimina anche
`studentLabelAssignments/{uid}` **nello stesso batch**. Non è una cascata
silenziosa: è la stessa operazione, già confermata dal docente, e il documento
residuo sarebbe un puntatore a un utente inesistente. Se il batch fallisce,
nulla viene eliminato. Un'assegnazione orfana eventualmente sopravvissuta è
**ignorata in lettura** (nessuno studente corrispondente) e non blocca nulla,
ma **non conta** come utilizzo ai fini della cancellazione di un'etichetta
(§5.E), perché il conteggio si costruisce intersecando con gli studenti reali.

**5.B.4 — Etichetta rinominata.** L'assegnazione non cambia: referenzia
`labelId`. Zero scritture, zero migrazioni.

**5.B.5 — Audit.** `student.labelAssigned` con `targetId == studentUid` e
`reason == null` — **mai** il nome dell'etichetta, e nemmeno il `labelId`:
`auditEvents` non è student-readable, ma non serve a ricostruire chi aveva
quale percorso, e la sua assenza rende il vincolo verificabile con un grep.

### C. Configurazione privata della verifica (bozza)

Vive dentro `verifications/{id}.config`, che è **già owner-only** e già
scritto dal medesimo `updateVerificationConfig` di titolo, classe, data,
perimetro, domande e gruppi VEX. **Nessun documento nuovo, nessuna scrittura
aggiuntiva.**

```ts
/** VDIF — scelta esplicita a tre valori per una combinazione domanda × etichetta. */
export type DifferentiatedChoice =
  | { kind: 'base' }
  | { kind: 'alternative'; questionIndexEntryId: string }
  | { kind: 'none' };

/** VDIF — scelte per una singola domanda base comune. */
export type DifferentiatedQuestionConfig = {
  /** Domanda base: `questionIndexEntryId` STABILE, come i gruppi VEX (mai `order`). */
  baseQuestionIndexEntryId: string;
  /** Chiave = labelId stabile. Un'etichetta assente ⇒ domanda base (principio 8). */
  choices: Record<string, DifferentiatedChoice>;
};

/** VDIF — blocco versionato dentro `VerificationConfig`. */
export type VerificationDifferentiationConfig = {
  /** Versione del contratto. VDIF-01→05 scrivono e accettano solo `1`. */
  version: 1;
  /** Una voce per ogni domanda base che ha almeno una scelta non-base. */
  questions: DifferentiatedQuestionConfig[];
};

export type VerificationConfig = {
  // …campi esistenti…
  /** Assente su bozze legacy e su verifiche non differenziate ⇒ nessuna differenziazione. */
  differentiation?: VerificationDifferentiationConfig;
};
```

**Vincoli di forma, validati fail-closed prima di ogni scrittura:**

- `version` è il letterale `1`. Un valore diverso — o assente su un blocco
  presente — è un **errore leggibile**, mai un default;
- `questions[].baseQuestionIndexEntryId` è unico dentro `questions[]`;
- le chiavi di `choices` sono `labelId` esistenti dello stesso owner;
- `kind` appartiene esattamente a `{'base','alternative','none'}`;
- `alternative` porta **esattamente** `questionIndexEntryId`, nessuna
  proprietà extra: nessun testo, nessuna preview, nessun `order`, nessun nome
  di etichetta;
- proprietà extra a qualunque livello ⇒ errore, non rimozione silenziosa;
- **potatura esplicita, mai silenziosa**: una voce le cui scelte sono tutte
  `base` è equivalente all'assenza della voce, e la UI la scrive comunque come
  assenza. Il salvataggio bozza **riconcilia** la configurazione con la
  selezione corrente esattamente come `reconcileEquivalentGroups` fa oggi con
  i gruppi VEX, e ciò che rimuove lo dichiara nel riepilogo — non è una
  correzione nascosta, è l'effetto visibile di una deselezione già fatta dal
  docente.

**Perché `kind: 'base'` è rappresentabile pur essendo equivalente
all'assenza:** durante la modifica il docente deve poter *tornare* alla base in
modo esplicito, e il dialog deve poter mostrare quale radio è selezionata senza
inferirlo. Il valore esiste nel modello di editing e nel salvataggio; una voce
composta di sole `base` non viene persistita, perché sarebbe rumore.

**Perché non il nome dell'etichetta come chiave:** una rinomina romperebbe ogni
bozza esistente, e il nome tornerebbe a viaggiare dentro la configurazione,
avvicinandolo di un passo alle superfici pubbliche (D9).

### D. Snapshot all'attivazione

**5.D.1 — Che cosa resta nella configurazione privata.** `config` non viene
riscritto dall'attivazione: `config.differentiation` resta com'è, come già
avviene per `config.equivalentGroups`. È la traccia di ciò che il docente
aveva configurato, non la fonte autorevole dopo l'attivazione.

**5.D.2 — Che cosa viene congelato.** Un blocco nuovo dentro
`teacherSnapshot`, che le Rules già rendono immutabile dopo l'attivazione
(nessuna regola di update post-`draft` include `teacherSnapshot` fra le
`affectedKeys()` consentite — `sicurezza.md` §3.2):

```ts
export type DifferentiatedChoiceSnapshot =
  | { kind: 'base' }
  /** `order` (0-based) dentro `teacherSnapshot.questions[]`. */
  | { kind: 'alternative'; order: number }
  | { kind: 'none' };

export type DifferentiatedQuestionSnapshot = {
  /** `order` (0-based) della domanda base dentro `questions[]`. */
  baseOrder: number;
  /** Chiave = labelId. Etichetta assente ⇒ base. */
  choices: Record<string, DifferentiatedChoiceSnapshot>;
};

export type VerificationDifferentiationSnapshot = {
  version: 1;
  questions: DifferentiatedQuestionSnapshot[];
  /**
   * Elenco chiuso dei labelId che hanno almeno una scelta non-base, congelato
   * per rendere lo snapshot autosufficiente: la risoluzione non deve mai
   * rileggere `differentiationLabels` (che può essere rinominata o svuotata
   * dopo l'attivazione).
   */
  labelIds: string[];
  /**
   * Order delle alternative introdotte dalla differenziazione: sono presenti in
   * `questions[]` (quindi hanno testo e soluzione congelati) ma NON in
   * `commonQuestionOrders` e NON in alcun `equivalentGroups[].alternativeOrders`.
   */
  differentiatedAlternativeOrders: number[];
};
```

`teacherSnapshot.questions[]` all'attivazione contiene **l'unione**: domande
selezionate (comuni + membri VEX) **più** tutte le alternative differenziate
realmente referenziate. Ognuna con testo, opzioni, `soluzione`, `difficolta`,
`maxCharacters`, come già oggi. Serve perché correzione, IA, restituzione e PDF
leggono da lì, e una verifica attiva non deve mai rileggere il pool corrente
(ADR-07).

**5.D.3 — Snapshot dell'assegnazione.** Un secondo blocco, congelato nella
stessa transazione:

```ts
export type VerificationLabelAssignmentSnapshot = {
  version: 1;
  /** studentUid → labelId, letto al momento dell'attivazione. Owner-only. */
  byStudentUid: Record<string, string>;
};
```

Vive in `teacherSnapshot.labelAssignments`, **owner-only e immutabile**.
È ciò che rende vero il principio 15: la risoluzione per uno studente usa
**questa** mappa, mai il documento `studentLabelAssignments` corrente. Cambiare
l'etichetta di uno studente dopo l'attivazione non ha alcun effetto sulla
verifica attiva — non perché qualcuno lo impedisca, ma perché nessuno lo
legge più.

**Nota di dimensione.** La mappa è `studentUid → labelId`: due stringhe per
studente approvato, decine di studenti, ordine di grandezza dei kilobyte. Il
controllo di limite esistente (`verificationSnapshotLimits.ts`) va esteso per
comprenderla, con la stessa soglia conservativa già in uso.

**5.D.4 — Risoluzione delle domande per uno studente (algoritmo congelato).**

Funzione **pura**, condivisa, senza IO — nome congelato
`resolveDifferentiatedOrders`:

```
input:  snapshot (questions, commonQuestionOrders, equivalentGroups,
                  differentiation, labelAssignments), studentUid, rng
output: number[]  (order assegnati, ordinati in modo crescente)

1. labelId := snapshot.labelAssignments.byStudentUid[studentUid]   // può mancare
2. base    := insieme di commonQuestionOrders
3. per ogni q in differentiation.questions:
     se q.baseOrder ∉ base                       -> ERRORE (incoerenza)
     choice := labelId ? q.choices[labelId] : assente
     se choice assente o choice.kind == 'base'   -> nessuna modifica
     se choice.kind == 'none'                    -> base := base \ {q.baseOrder}
     se choice.kind == 'alternative'             -> base := (base \ {q.baseOrder}) ∪ {choice.order}
4. per ogni gruppo VEX: estrai UNA alternativa con l'RNG sicuro già esistente
                        e aggiungila a base
5. se |base| == 0                                -> ERRORE (nessuna domanda)
6. verifica che base non contenga duplicati      -> ERRORE altrimenti
7. restituisci base ordinato
```

**Proprietà volute:** la differenziazione agisce **solo** sulle comuni (passo
3) e VEX **solo** sui gruppi (passo 4). I due passi non possono interferire
perché operano su insiemi disgiunti — invariante garantito dalle guardie di
mutua esclusione (§6) e ri-verificato all'attivazione. L'ordine dei due passi
è irrilevante: il risultato è lo stesso. La differenziazione è
**deterministica**; l'unica casualità resta quella di VEX, già congelata in
`vex-contract.md` §4.2b.

**5.D.5 — Come si producono `assignedQuestionOrders`.** Esattamente come oggi:
la callable `assignVerificationVariant` (già esistente) scrive **una sola
volta**, in transazione idempotente, `assignedQuestionOrders` +
`assignedAnswerKeys` sulla submission al primo avvio. VDIF sostituisce il solo
**calcolo** dell'insieme (`resolveDifferentiatedOrders` al posto della sola
estrazione VEX). Il contratto di scrittura, l'idempotenza, il retry e il costo
restano identici a `vex-contract.md` §4.2.

**Conseguenza di rilievo:** in `same_questions` **con differenziazione attiva**
il flusso studente **non è più interamente client-side** — deve passare dalla
callable, perché la proiezione pubblica non può contenere le alternative
differenziate. Il routing diventa:

| Modalità | Differenziazione | Percorso |
|---|---|---|
| `same_questions` | assente | client-side, invariato, **zero callable** |
| `same_questions` | presente | callable (stessa di VEX) |
| `equivalent_variants` | assente | callable, invariato |
| `equivalent_variants` | presente | callable |

Il discriminante è rispecchiato nella `publishedProjection` come **booleano
puro** `differentiated: boolean` — mai il numero di etichette, mai i `labelId`.
È l'unico dato aggiuntivo sulla proiezione, ed è identico per tutti gli
studenti della classe: dice «questa verifica passa dalla callable», non
«questa verifica è diversa per te».

**5.D.6 — Che cosa NON entra nella proiezione pubblica.** In presenza di
differenziazione la `publishedProjection.questions` contiene, come già in VEX,
**solo le domande comuni non differenziate**: una domanda base con almeno una
scelta non-base **non** vi compare, altrimenti uno studente potrebbe leggerla
anche quando gli è stata omessa o sostituita. Le domande assegnate arrivano
**solo** dalla callable.

**5.D.7 — Perché `SubmissionDoc` e le proiezioni studente non contengono
`labelId`/`labelName`.** `assignedQuestionOrders` è già sufficiente a servire,
correggere, restituire ed esportare: `resolveAssignedQuestions` filtra lo
snapshot su quegli order e non ha mai bisogno di sapere *perché* quell'insieme
è quello. Aggiungere l'etichetta sarebbe un dato **non necessario** su un
documento **student-readable** — la definizione esatta di ciò che il principio
5 vieta. Il legame studente → etichetta resta esclusivamente in
`teacherSnapshot.labelAssignments`, owner-only.

**5.D.8 — Replay e retry.** Invariati rispetto a VEX: se
`assignedQuestionOrders` esiste ed è valido, viene restituito senza nuove
scritture; se esiste ed è **invalido**, è fail-closed (nessuna rigenerazione
silenziosa). Una risposta persa dopo il commit è indistinguibile da un replay e
produce lo stesso risultato, perché la transazione è read-or-assign.

**5.D.9 — Cambio etichetta successivo e studente senza etichetta.** Il primo è
irrilevante (§5.D.3). Il secondo riceve la base: `labelId` assente ⇒ passo 3
non modifica nulla.

### E. Rinomina ed eliminazione

| Regola | Contratto |
|---|---|
| Nomi unici per docente | su `nameKey` (§5.A.5). Un duplicato è rifiutato con errore leggibile che nomina l'etichetta in conflitto |
| La rinomina conserva l'ID | `labelId` immutabile; cambiano solo `name`, `nameKey`, `updatedAt`. Assegnazioni, bozze e snapshot **non** vengono toccati |
| Etichetta assegnata ⇒ non eliminabile | almeno un'assegnazione a uno studente esistente |
| Etichetta usata in almeno una bozza ⇒ non eliminabile | almeno una `verifications` in `status == 'draft'` la cui `config.differentiation` contiene il `labelId` con scelta non-base |
| Eliminazione fail-closed | il preflight che accerta i due usi **precede** ogni scrittura. Se il preflight non è eseguibile (errore di lettura), l'eliminazione **non parte**: mai «probabilmente libera» |
| Nessuna cascata silenziosa | eliminare un'etichetta non modifica né rimuove assegnazioni o configurazioni. Se è in uso, non si elimina — punto |
| Dove è ancora usata | il messaggio è **specifico e azionabile**: «Assegnata a 3 studenti» e/o «Usata in 2 bozze: *Reti — 12/03*, *Chimica — 05/04*». Nel menu «…» la voce **Elimina** è disabilitata con il motivo associato via `aria-describedby`, **mai nascosta** |

**Verifiche già attive:** non contano come uso. Il loro snapshot è
autosufficiente (`labelIds` e `labelAssignments` congelati): eliminare
l'etichetta non le altera in alcun modo. Bloccare l'eliminazione per una
verifica chiusa un anno fa renderebbe le etichette immortali.

---

## 6. Mutua esclusione VEX ↔ differenziazione

Il contratto è **bidirezionale** e **indipendente dall'ordine delle
operazioni**: qualunque sequenza di azioni del docente produce lo stesso
insieme di stati leciti.

1. Una domanda **membro di un gruppo VEX** non può ricevere varianti per
   etichetta.
2. Una domanda base **con almeno una scelta non-base** non può entrare in un
   gruppo VEX.
3. Una domanda usata come **alternativa differenziata** non può
   contemporaneamente essere: domanda comune selezionata; membro di un gruppo
   VEX; alternativa di un'altra combinazione in modo da produrre duplicazioni
   nella stessa assegnazione risolta.
4. Il builder delle varianti mostra il controllo **«Varianti»** anche sulle
   domande VEX, **disabilitato** con motivazione leggibile associata via
   `aria-describedby`. Non nascosto: un controllo che compare solo su alcune
   righe lascia il docente a chiedersi perché.
5. Il builder VEX mostra le domande coinvolte nella differenziazione come
   **non selezionabili**, con motivazione leggibile.
6. **Nessuna conversione automatica.** Per passare da una modalità all'altra il
   docente deve prima rimuovere le varianti differenziate e poi creare il
   gruppo VEX, oppure prima sciogliere il gruppo VEX e poi configurare le
   varianti. Due gesti espliciti, nessun «ti sistemo io».
7. Uno stato **concorrente, legacy o manomesso** che contiene entrambe le
   configurazioni sulla stessa domanda **blocca l'attivazione** con errore
   leggibile (§7, guardia G11).
8. **Helper puro condiviso** — nome congelato `classifyQuestionParticipation`,
   modulo `questionParticipation.ts`:

```ts
export type QuestionParticipation =
  | 'common_free'              // comune, nessuna variante, fuori da ogni gruppo VEX
  | 'vex_member'               // membro di un gruppo equivalente
  | 'differentiated_base'      // comune con almeno una scelta non-base
  | 'differentiated_alternative'; // referenziata come alternativa, non selezionata

export function classifyQuestionParticipation(input: {
  selectedEntryIds: readonly string[];
  equivalentGroups: readonly EquivalentGroupConfig[];
  differentiation?: VerificationDifferentiationConfig;
}): Map<string, QuestionParticipation>;
```

**Nessuna UI ricostruisce autonomamente questa classificazione.** Il builder
VEX, il builder delle varianti, il riepilogo di attivazione e le guardie
leggono tutti da qui. È la stessa disciplina di `resolveAssignedQuestions`:
un'unica fonte di verità, altrimenti due schermate divergono e nessuno se ne
accorge finché non è in produzione.

9. **VEX e differenziazione convivono nella stessa verifica**, su domande
   diverse. Esempio da mantenere come caso di test end-to-end:

| Domanda | Ruolo |
|---|---|
| Q1 | comune, con alternativa per l'etichetta L1 |
| Q2 | membro di un gruppo VEX (Q2a / Q2b) |
| Q3 | comune, invariata |

- **Studente con etichetta L1:** Q1-alternativa + un membro estratto del
  gruppo Q2 + Q3.
- **Studente senza etichetta:** Q1-base + un membro estratto del gruppo Q2 +
  Q3.

10. **Test obbligatori** (dettaglio in §15): variante → tentativo di creare
    gruppo VEX; gruppo VEX → tentativo di aggiungere variante; alternativa
    differenziata → tentativo di selezionarla come comune; configurazione
    incoerente arrivata all'attivazione; modifica concorrente fra apertura
    bozza e attivazione.

---

## 7. Guardie di attivazione (fail-closed)

Tutte le precondizioni, nell'**ordine esatto** in cui vanno eseguite. Le
guardie G01→G16 sono **preflight**, fuori dalla transazione, su dati riletti
autorevolmente. G17→G20 sono **dentro** la transazione.

### 7.1 Ordine di letture e scritture

```
FASE 0 — preflight (nessuna scrittura, fuori transazione)
  R1  getDoc  verifications/{id}                      -> stato bozza + config
  R2  getDocs differentiationLabels                   -> etichette dell'owner
  R3  getDocs studentLabelAssignments                 -> assegnazioni correnti
  R4  getDocs students                                -> già caricati dal contesto
  R5  Storage: loadSelectedQuestionsWithSolutions(
        questionRefs ∪ alternative differenziate)     -> UNA lettura, come oggi
  R6  getDocs udas + lessons (già eseguite oggi)      -> topicOutline autorevole
  ── validazioni pure G01..G16 su questi dati ──
  ── costruzione teacherQuestions, snapshot VDIF, snapshot VEX, proiezione ──

FASE 1 — transazione (client Firestore SDK, come oggi)
  T1  transaction.get verifications/{id}
  G17 stato ancora 'draft'
  G18 questionRefs invariati                (sameQuestionRefs, già esistente)
  G19 config.differentiation invariata      (confronto strutturale profondo)
  G20 fingerprint assegnazioni invariato    (§7.3)
  T2  transaction.update verifications/{id} (status, visibility, teacherSnapshot)
  T3  transaction.set    publishedProjection/data

FASE 2 — dopo la transazione
  W1  setDoc auditEvents (verification.activated)     — invariato
```

**Confine transazionale.** Resta quello attuale: una transazione client
Firestore SDK sul solo documento verifica più la sua proiezione, come descritto
in `architettura.md` §6.3. VDIF **non** introduce una Cloud Function di
attivazione. Motivo: tutte le letture necessarie sono owner-only e già
disponibili al client docente; l'unico principal che potrebbe scrivere dati
incoerenti è l'owner stesso, già fidato per ogni altro percorso owner-only
(`sicurezza.md` §3). La callable resta l'unica cosa server-side, e resta
`assignVerificationVariant`.

### 7.2 Elenco delle guardie

| ID | Condizione bloccante | Messaggio (sostanza) |
|---|---|---|
| G01 | verifica non trovata | «Verifica non trovata.» |
| G02 | verifica non in bozza / già attiva | «Verifica non attivabile: non è in bozza.» |
| G03 | `differentiation` presente con `version != 1` o proprietà extra | «Configurazione delle varianti non riconosciuta.» |
| G04 | `labelId` referenziato **inesistente** | nomina l'ID e la domanda |
| G05 | `labelId` di **altro owner** | stesso messaggio di G04: non si conferma l'esistenza altrui |
| G06 | assegnazione che punta a uno **studente inesistente** | l'assegnazione è ignorata; **non** blocca (§5.B.3) |
| G07 | assegnazione di uno studente di **altro owner** | blocca: indica manomissione |
| G08 | `baseQuestionIndexEntryId` **non selezionato** nella verifica | nomina la domanda |
| G09 | alternativa **inesistente** nel `questionIndex` corrente | nomina base e alternativa |
| G10 | alternativa **rimossa dal pool** fra bozza e attivazione | riferimento in chiaro, mai un ID nudo |
| G11 | alternativa di **lezione diversa** dalla base | nomina le due lezioni |
| G12 | alternativa **già selezionata** come domanda della verifica | nomina la domanda |
| G13 | **duplicazione** nella verifica risolta di almeno un'etichetta | nomina etichetta e domanda |
| G14 | **conflitto VEX**: base differenziata dentro un gruppo, o alternativa differenziata dentro un gruppo, o entrambe le configurazioni sulla stessa domanda | nomina la domanda e le due configurazioni |
| G15 | un'etichetta resta con **zero domande** | nomina l'etichetta e quante domande le restano |
| G16 | **punteggio massimo non valido** per almeno un'etichetta (≤ 0, non intero, o non pari alla somma delle `maxPoints` risolte) | nomina l'etichetta |
| G16b | `teacherSnapshot` o `publishedProjection` **oltre il limite** dimensionale conservativo | «La verifica è troppo grande per essere congelata.» |
| G17 | stato cambiato **durante** l'attivazione | invita a riprovare |
| G18 | **selezione domande** cambiata durante l'attivazione | messaggio già esistente, invariato |
| G19 | **configurazione varianti** cambiata durante l'attivazione | «La configurazione delle varianti è cambiata durante l'attivazione. Riprova.» |
| G20 | **assegnazioni studente** cambiate durante l'attivazione | «Le etichette degli studenti sono cambiate durante l'attivazione. Riprova.» |
| G21 | **retry dopo risposta persa** | la transazione rilegge lo stato: se la verifica è già `active`, G02 blocca **senza scrivere nulla**. Nessuna doppia attivazione, nessuna doppia proiezione |

**G16 in dettaglio.** Il massimo per etichetta è la somma delle `maxPoints`
delle domande realmente risolte per quell'etichetta. È **legittimamente diverso**
fra etichette (D6): la guardia verifica che sia un intero positivo, non che sia
uguale a quello base.

### 7.3 Fingerprint delle assegnazioni (G20)

La transazione non può rileggere `studentLabelAssignments` (documenti fuori dal
suo perimetro senza costo aggiuntivo, e una `getDocs` non è ammessa dentro una
transazione Firestore client). Il preflight calcola quindi un **fingerprint
deterministico** delle assegnazioni — coppie `studentUid:labelId` ordinate,
serializzate canonicamente e ridotte a SHA-256 via Web Crypto, stessa tecnica
già usata da `STRUCTURE-IMPORT-01` per `manifestCanonical` — e lo confronta con
un secondo calcolo eseguito **immediatamente prima** di aprire la transazione.

Limite dichiarato, senza ipocrisia: questa è una finestra **stretta**, non
nulla. In un sistema **single-owner** l'unico principal capace di cambiare le
assegnazioni è il docente stesso, dalla stessa sessione; la finestra reale è
quella di due schede aperte dello stesso browser. Ciò che il fingerprint
garantisce è che uno snapshot palesemente stantio non venga congelato in
silenzio; ciò che non garantisce è la serializzabilità completa, che
richiederebbe una Cloud Function di attivazione — costo sproporzionato rispetto
al rischio in questo modello.

---

## 8. UI — sezione Studenti

Allineata al **portale attuale** (card `RecordCard` full-width, menu «…» in
alto a destra, tablist accessibile), non alla tabella descritta nella prima
stesura di questa roadmap.

Le schede diventano **Studenti · Classi · Etichette**, con la stessa `tablist`
già esistente in `StudentsView`: `role="tablist"`, `role="tab"` con
`aria-selected` e `aria-controls`, `role="tabpanel"` con `aria-labelledby`,
roving `tabIndex`, ←/→ ciclici, Home/End, focus visibile, nessuno scorrimento
orizzontale a nessuna larghezza. Con tre schede la navigazione da tastiera
diventa ciclica su tre elementi: `handleTabKeyDown` va generalizzato a una
lista, non duplicato.

### 8.A Scheda Etichette

**Subito sotto le schede:** pulsante **«Nuova etichetta»** a **larghezza
piena**, stessa anatomia visiva di «Nuova classe» (`btn-primary`, altezza
sobria, icona `IconPlus` a sinistra) — non un banner.

**Una card full-width per etichetta** (`RecordCard`, `actionLayout` dedicato,
compatto e senza riquadri metrica come `class-admin`):

- **titolo in ciano SchoolForge** (`--color-brand-blue`), come ogni altra card;
- **`titleMeta`** con il numero di studenti associati: «4 studenti» / «1
  studente» / «Nessuno studente»;
- **utilizzo nelle bozze**, mostrato **solo se già disponibile senza costo
  passivo**: le bozze del docente sono già caricate nella sezione Verifiche, ma
  **non** nella sezione Studenti. Contratto: la scheda Etichette **non** carica
  le verifiche per mostrare questo dato in lista. Il conteggio d'uso nelle
  bozze viene calcolato **on-demand**, una sola volta, nel **preflight di
  eliminazione** — che è esattamente il momento in cui serve davvero
  (§14);
- **menu «…» in alto a destra** (`RecordActionsMenu`), con:
  - **Modifica** (`IconPencil`);
  - **Elimina** (`IconTrash`, classe `menuDanger`), **azione distruttiva**;
    **disabilitata con motivo visibile** quando l'etichetta è in uso, associato
    via `aria-describedby`.

**Stato vuoto** — curato e compatto, mai una pagina spoglia:

> **Nessuna etichetta.**
> Le etichette servono a te, per servire domande diverse a studenti diversi
> nella stessa verifica. Usa nomi operativi — «Percorso A», «Obiettivi
> essenziali» — e assegnane al massimo una per studente.
> Gli studenti non le vedono mai.

Nessun esempio diagnostico, nessuna sigla normativa, in nessun punto della UI.

**Creazione e rinomina** — entrambe in `DialogShell`:

- input moderno a larghezza piena, `label` visibile e associata;
- **contatore** «12/40» accanto all'etichetta del campo, `aria-live="polite"`;
- limiti applicati: `maxLength` sul campo **e** validazione byte prima della
  scrittura;
- **Invio** salva, **Escape** annulla (`closeOnEscape` di `DialogShell`);
- **guardia anti-doppio-click** sincrona con un `ref`, come in `ClassesTab`:
  due click nello stesso tick non creano due etichette;
- **il testo digitato è conservato in caso di errore**, il focus torna
  nell'input;
- **nessuna linea separatrice sopra il footer**;
- dialog sempre **dentro la viewport** (`max-height: calc(100dvh - 2rem)`,
  scroll interno, footer sempre raggiungibile — già garantito da
  `DialogShell`).

La rinomina usa un **dialog**, non l'editing inline della card classe: il
campo ha un contatore e un vincolo di unicità da comunicare, che in linea
starebbero stretti.

### 8.B Card Studente

La card attuale **resta**. Si aggiunge, dentro `identityControl`, un **secondo
campo** «Etichetta» accanto (desktop) o immediatamente sotto (mobile) al
selettore «Classe»:

- `<label>` **visibile** e semanticamente associata (`htmlFor`), più
  `aria-label` esteso col nome dello studente, esattamente come «Classe»;
- prima opzione **«Nessuna etichetta»** (valore vuoto), poi le etichette in
  ordine alfabetico;
- **salvataggio immediato** alla `change`, come «Classe» — nessun menu, nessun
  pulsante di conferma: è una modifica che deve essere rapida;
- **stato busy circoscritto** alla sola card interessata;
- **il valore selezionato è conservato in caso di errore**, con messaggio
  ancorato alla card, non un reset silenzioso al valore precedente;
- il click sulla select **non apre la card** — `RecordCard` esclude già
  `select` dal fallback di apertura.

**Ricerca.** La barra di ricerca studenti comprende anche il **nome
dell'etichetta**, accanto a nome, email, stato e classe, con lo stesso
`haystack` in minuscolo. «Nessuna etichetta» è cercabile come stringa, esatto
parallelo di «nessuna classe» già in uso.

**Mobile.** Classe ed Etichetta **entrambe leggibili**, ciascuna a larghezza
piena in una propria riga sotto nome ed email: niente troncamenti, niente
overflow, nessun affiancamento che comprimerebbe due select su 320 px. Trigger
«…» in alto a destra; target touch ≥ 44 px per select e trigger; ordine visivo
identità → Classe → Etichetta → riquadri → errori.

---

## 9. UI — bozza della verifica

Per ogni **domanda comune** dell'elenco delle domande selezionate:

- pulsante **«Varianti (n)»**, dove **n = numero di etichette con scelta
  non-base** su quella domanda. `n = 0` ⇒ «Varianti».

Per le domande **membro di un gruppo VEX**:

- **stesso pulsante, visibile e disabilitato**;
- motivo associato via `aria-describedby`: «Questa domanda è in un gruppo di
  varianti equivalenti: non può avere varianti per etichetta.»;
- **nessun controllo semplicemente nascosto** (§6.4).

### 9.1 Dialog delle varianti

Struttura, dall'alto:

1. **intestazione**: numero della domanda, tipologia, difficoltà — es. «Domanda
   3 · Aperta · Difficoltà 3»;
2. **testo della domanda base**;
3. **soluzione base** (owner-only, come ogni altra superficie docente);
4. **una card/riga per ciascuna etichetta**, in ordine alfabetico;
5. **prima l'etichetta, poi la scelta**: si decide *per chi*, non *cosa*;
6. **selezione a tre valori** (`radiogroup` per etichetta):
   **Domanda base** (default) · **Domanda alternativa** · **Nessuna domanda**;
7. **alternative filtrate**, e il filtro è un contratto, non un'euristica:
   - **stessa lezione** della base (`lessonFilename` identico — D3);
   - **non già selezionate** nella verifica (D4);
   - **non appartenenti a un gruppo VEX**;
   - **non capaci di creare duplicazioni**: esclude ciò che è già assegnato
     alla **stessa** etichetta come alternativa di un'altra domanda;
8. **anteprima reale** della domanda alternativa — `questionPreview` già
   caricata nel `questionIndex`, mai una nuova lettura;
9. **spiegazione quando non esistono alternative**: «Questa lezione non ha
   altre domande disponibili per una variante.» — una lista vuota senza
   spiegazione sembra un guasto;
10. **salvataggio esplicito** della configurazione: il dialog ha «Annulla» e
    «Salva varianti»; «Salva varianti» aggiorna lo **stato locale della
    bozza** e marca la bozza *dirty*;
11. **nessuna scrittura Firebase mentre si modifica localmente**: il flusso
    canonico corrente salva soltanto con **«Salva bozza»**, e VDIF non lo
    cambia. `differentiation` viaggia nello **stesso**
    `updateVerificationConfig` di titolo, classe, data, perimetro, domande e
    gruppi VEX — **zero scritture aggiuntive**.

**Riuso di `VexQuestionSelect`.** Il selettore delle alternative riusa il
componente esistente, **senza duplicarne accessibilità e anteprima**. È già una
listbox accessibile con due righe (metadati + preview reale), tastiera, Escape
e click esterno; gli serve soltanto un `options` filtrato e una `label`
diversa. Se un requisito di VDIF richiedesse una modifica al componente,
va fatta **dentro** `VexQuestionSelect` in modo retrocompatibile, mai
forkandolo.

---

## 10. UI — riepilogo prima dell'attivazione

Prima della conferma, **owner-only** e **mai persistito** in alcuna proiezione
studente, il pannello di conferma esistente mostra:

- **studenti che riceveranno la verifica base** (n);
- **studenti che riceveranno una verifica differenziata** (n);
- **numero di etichette coinvolte**;
- **numero di sostituzioni** (scelte `alternative`);
- **numero di omissioni** (scelte `none`);
- **studenti senza etichetta** (n) — è il momento in cui ci si accorge di aver
  dimenticato qualcuno;
- **conteggio finale delle domande per ciascuna etichetta**, più la riga
  «Nessuna etichetta»;
- **blocker per etichetta**, se presenti: elenco esplicito, in rosso, con
  l'azione bloccata dichiarata.

Il riepilogo è **derivato puro** dagli stessi dati del preflight: nessuna
lettura aggiuntiva, nessuna scrittura, nessun documento. Non mostra **mai**
nomi diagnostici predefiniti — mostra i nomi che il docente ha scelto, e basta.

---

## 11. Qualità visiva

Vincoli, non suggerimenti. Il prototipo li rispetta tutti e li rende
verificabili a occhio.

- superfici **grafite/blu notte** (`--color-surface*`), mai nero puro;
- **ciano** (`--color-brand-blue`) per struttura e informazione: titoli card,
  icone metrica, accento laterale;
- **arancione SchoolForge** (`--color-brand-interactive`) su **hover e focus**,
  mai a riposo, mai come colore di stato;
- **verde** solo per esiti positivi, **rosso** solo per azioni distruttive ed
  errori;
- **card full-width**, bordi e raggi coerenti (`--radius`, `--radius-lg`);
- menu **«…» in alto a destra**;
- microinterazioni sobrie; **niente gradienti gratuiti**; niente effetto
  «dashboard aziendale» generico;
- **niente tabella su mobile**;
- **niente textarea ridimensionabili** (`textarea { resize: none }` globale,
  già in vigore e protetto da test statico);
- **target touch ≥ 44 px** su ogni controllo interattivo sotto il breakpoint
  mobile o con `pointer: coarse`;
- **`:focus-visible`** sempre percepibile, mai rimosso;
- **`prefers-reduced-motion`** rispettato: transizioni e sollevamenti annullati;
- **dialog entro `100dvh`**, scroll interno, **footer sempre raggiungibile**;
- scrollbar nascosta **solo visivamente** e solo dove il contratto già lo
  prevede (`DialogShell`);
- **nessun overflow orizzontale a 320 px**.

---

## 12. Pacchetto A — Esiti per lezione (ESITI-01)

Invariato rispetto alla stesura precedente, e **indipendente e successivo** al
Gate GVDIF.

### Perché è quasi gratis

Il collegamento *domanda → lezione → UDA* è già tracciato:

| Dato | Dove vive già |
|---|---|
| punti per domanda e per consegna | `CorrectionDoc.evaluations[order]` (`points`, `maxPoints`) |
| lezione e UDA di provenienza | `config.questionRefs[order]` (`udaDir`, `lessonFilename`) |
| titoli leggibili del perimetro | `config.topicOutline` |

Manca solo la media: è una **derivazione pura**, calcolata su richiesta dai
documenti che il workspace di correzione già legge. Nessuna collezione nuova,
nessuna scrittura, nessuna migrazione, nessuna Rule, nessun prompt.

### Che cosa calcola

1. per ogni domanda, media di `points / maxPoints` sulle sole correzioni in
   stato `completed` (una correzione in corso non è un dato);
2. aggregazione per lezione e per UDA, pesata sul numero di valutazioni.

### Come si difende dai numeri che sembrano fatti

«Fotosintesi 43%» ha l'aria di un fatto anche quando è una media su quattro
valutazioni. Le cose che possono essere poche sono **due**, con problemi
opposti:

| | Se è poco | Il numero è | Rimedio |
|---|---|---|---|
| **consegne corrette** | 4 su 22 | **instabile** — cambierà finendo di correggere | copertura, non soglia |
| **domande di quella lezione** | 1 sola | **stretto** — stabile, ma misura quella domanda | dichiararlo, non nasconderlo |

Da cui tre regole, e **nessuna soglia arbitraria da calibrare**: gli Esiti si
aprono su verifiche con correzione completa e, se incompleta, la copertura
(«corrette 18 su 22») è dichiarata in evidenza; ogni riga porta su quante
domande si basa; il solo caso tagliato è l'incrocio dei due.

### Interfaccia

Sulla card di una verifica **chiusa**, nel menu azioni esistente, la voce
`Esiti`. Apre un dialog con una tabella UDA · Lezione · Padronanza · N
valutazioni, ordinata dalla più debole. Nient'altro: nessuna generazione,
nessun rimando.

### Interazione con VDIF

Con la differenziazione attiva, studenti diversi possono avere risposto a
domande diverse della **stessa** lezione. La media per lezione resta corretta
perché è già pesata sul numero di valutazioni: una domanda risposta da meno
studenti pesa meno. La riga dichiara il numero di valutazioni, quindi il dato
resta onesto senza alcuna logica dedicata a VDIF. **Nessuna etichetta compare
negli Esiti**: aggregano per lezione, non per studente né per gruppo.

### Fuori dal pacchetto

La generazione automatica di lezioni di ripasso (` - R`) è stata **valutata e
scartata**: richiedeva un blocco di prompt dedicato, una nuova versione del
prompt e una campagna di misura, per duplicare un percorso manuale già
disponibile in tre clic. Non è rinviata: è fuori perimetro.

### DoD

Vista `Esiti` funzionante su una verifica chiusa reale; nessuna scrittura
introdotta; test sulla derivazione (media, aggregazione, correzioni non
completate escluse, copertura dichiarata, numero di domande per riga).

---

## 13. Roadmap eseguibile

| Fase | Scope | Dipende da | DoD |
|---|---|---|---|
| **VDIF-00** ✅ | Contratto tecnico, privacy, cost model, matrice di test e **prototipo UI**. Solo documentazione e prototipo statico. | GVEX PASS | Questo documento + `prototipi/verifiche-differenziate.html` + fasi in `piano-implementazione.md`. Zero runtime. |
| **VDIF-01** | **Registro etichette owner-only**: tipi, `differentiationLabels`, CRUD, `labelNameKey.ts`, unicità, Rules owner-only a contratto chiuso, audit, **scheda Etichette** (card, dialog crea/rinomina, elimina protetta, stato vuoto). | VDIF-00 | CRUD reale su DEV; test Rules Emulator (owner ok, studente sempre negato, contratto chiuso, chiavi extra negate); unicità; nessun indice nuovo. |
| **VDIF-02** | **Assegnazione privata studente → etichetta**: `studentLabelAssignments`, selettore nella card studente, ricerca per etichetta, Rules, audit, eliminazione studente nello stesso batch. | VDIF-01 | Assegnazione/rimozione reali; test Rules (studente non legge né scrive, altro owner negato); ricerca; nessuna etichetta in alcun dato studente. |
| **VDIF-03** | **Builder delle varianti**: `classifyQuestionParticipation`, pulsante «Varianti (n)», dialog a tre valori, filtro alternative, riuso `VexQuestionSelect`, `config.differentiation` nello stesso «Salva bozza», **mutua esclusione VEX bidirezionale**. | VDIF-02 | Configurazione salvata e ricaricata; helper puro condiviso usato da tutte le UI; test dei cinque scenari di §6.10; zero scritture aggiuntive. |
| **VDIF-04** | **Attivazione**: guardie G01→G21, snapshot privato (`differentiation` + `labelAssignments`), `resolveDifferentiatedOrders`, produzione di `assignedQuestionOrders` via callable esistente, routing `differentiated` sulla proiezione, riepilogo pre-attivazione. | VDIF-03 | Attivazione reale con ≥ 2 etichette, ≥ 1 sostituzione e ≥ 1 omissione; ogni guardia coperta da test; idempotenza e replay verdi. |
| **VDIF-05** | **Consumer downstream**: svolgimento, correzione manuale, correzione IA, restituzione, PDF, CSV, ricevute e **privacy audit** end-to-end. | VDIF-04 | Ogni consumer opera sulla sola assegnazione; audit di privacy che dimostra l'assenza di etichette in ogni superficie di §4. |
| **GVDIF** | **Rollout DEV e gate umano multi-studente**: smoke reale con più studenti etichettati e non, isolamento, correzione, restituzione, export. | VDIF-05 | Checklist firmata in `evidenze/gvdif-human-gate.md`. **Aperto.** |
| **ESITI-01** | Vista di **sola lettura** degli esiti aggregati per UDA/lezione (§12). **Indipendente e successiva a GVDIF.** | GVDIF | §12, DoD. |

### 13.1 Fuori scope da VDIF — esplicito

Le misure seguenti **non** entrano in VDIF, in nessuna fase, nemmeno come
campo predisposto:

- **tempo aggiuntivo**;
- **limiti temporali personalizzati**;
- **materiali consultabili**;
- **formulari**;
- **limiti di caratteri personalizzati** (`maxCharacters` resta il limite
  tecnico della singola domanda, non una misura per studente);
- **ulteriori misure compensative o dispensative** di qualunque natura.

Sono un **asse distinto**: proprietà della *consegna*, non della *selezione
delle domande*. Richiederebbero una roadmap autonoma, un modello dati proprio e
un'analisi di privacy separata. Introdurne una «già che ci siamo» dentro VDIF
significherebbe congelare oggi un contratto sbagliato.

---

## 14. Cost model

Riferimento: `students` e `classes` sono già caricati una volta all'apertura
della sezione Studenti (`loadAll`).

| Evento | Letture | Scritture | Note |
|---|---|---|---|
| **Caricamento scheda Etichette** | **1 query** `differentiationLabels` (collezione intera, decine di documenti), unita al `Promise.all` esistente di `loadAll` | 0 | **nessuna query per etichetta**, **nessuna lettura per card** |
| **Caricamento assegnazioni** | **1 query** `studentLabelAssignments`, nello stesso `Promise.all` | 0 | mappa `studentUid → labelId` in memoria; **nessun listener per studente** |
| **Creazione etichetta** | 0 (unicità sulla lista già in memoria) | **2**: documento + audit | come `createClass` |
| **Rinomina** | 0 | **2**: update + audit | `labelId` invariato ⇒ nessuna propagazione |
| **Eliminazione** | **1 query mirata** sulle bozze per il preflight d'uso (`status == 'draft'`, già indicizzata) | **2**: delete + audit, **solo** se il preflight è verde | fail-closed: preflight non eseguibile ⇒ nessuna scrittura |
| **Assegnazione a uno studente** | 0 | **2**: set/delete + audit | stesso schema di `assignStudentClass` |
| **Apertura builder varianti** | **0** | 0 | `questionIndex` e `questionPreview` sono già in memoria nella bozza |
| **Salvataggio bozza** | 0 | **1**: lo `updateVerificationConfig` **esistente**, esteso con `differentiation` | **zero scritture aggiuntive** |
| **Attivazione** | preflight: verifica + etichette + assegnazioni + studenti + **1** lettura Storage delle domande (già oggi) + udas/lessons (già oggi) | **3**: update verifica + set proiezione + audit — **invariato** | le alternative differenziate entrano nella **stessa** lettura Storage: nessuna lettura in più per alternativa |
| **Primo avvio studente** | 1 callable + letture server-side già necessarie | **1**: `assignedQuestionOrders` + `assignedAnswerKeys` (stessa scrittura) | identico a VEX §4.3 |
| **Replay / refresh** | 1 callable + lettura submission | **0** | read-or-assign idempotente |
| **Retry transazionale** | rilettura in transazione | **0** in caso di replay | G21 |
| **Consumer downstream** | **0 aggiuntive** | 0 | correzione, IA, restituzione, PDF e CSV riusano `resolveAssignedQuestions` su documenti già caricati |

### 14.1 Vietati, senza eccezioni

- **lettura per card** (una `getDoc` per etichetta o per studente);
- **query per etichetta** nella lista (una `where('labelId','==',…)` per riga);
- **listener per studente** o per etichetta;
- **polling** di qualunque genere;
- **duplicazione di dati** di etichetta su documenti pubblici.

### 14.2 Indici

**Nessun indice composito nuovo è richiesto.**

- `differentiationLabels`: nessuna query filtrata — si legge la collezione
  intera (owner-only, decine di documenti). Gli indici a campo singolo
  automatici bastano;
- `studentLabelAssignments`: idem;
- preflight di eliminazione sulle bozze: riusa una query per `status` sulle
  verifiche dell'owner, coperta dagli indici a campo singolo automatici; se in
  VDIF-01 dovesse servire un secondo filtro di uguaglianza, va **dichiarato in
  quella PR con motivazione**, non introdotto qui a scatola chiusa.

---

## 15. Matrice minima dei test (congelata)

| # | Test | Livello |
|---|---|---|
| T01 | ownership: solo l'owner legge/scrive `differentiationLabels` | Rules Emulator |
| T02 | isolamento fra docenti: etichetta di altro owner mai leggibile né referenziabile | Rules + unit |
| T03 | **lo studente non legge le etichette** (get e list negati) | Rules Emulator |
| T04 | **lo studente non legge le assegnazioni** (la propria inclusa) | Rules Emulator |
| T05 | **lo studente non può scrivere** etichette né assegnazioni | Rules Emulator |
| T06 | una sola etichetta per studente (id deterministico, secondo documento impossibile) | Rules + unit |
| T07 | rinomina con `labelId` stabile: assegnazioni e bozze intatte | unit + integrazione |
| T08 | eliminazione libera quando non in uso | integrazione |
| T09 | eliminazione **bloccata** se assegnata ad almeno uno studente | unit + integrazione |
| T10 | eliminazione **bloccata** se usata in almeno una variante di bozza | unit + integrazione |
| T11 | ricerca studenti per nome etichetta (e per «nessuna etichetta») | unit UI |
| T12 | scelta **domanda base**: risolve la base | unit puro |
| T13 | alternativa della **stessa lezione** accettata | unit puro |
| T14 | alternativa di **altra lezione** rifiutata (G11) | unit puro |
| T15 | **«Nessuna domanda»**: la base è rimossa per quella sola etichetta | unit puro |
| T16 | **zero domande risultanti** per un'etichetta ⇒ attivazione bloccata (G15) | unit + integrazione |
| T17 | conflitto VEX **in entrambe le direzioni** (variante→gruppo, gruppo→variante) | unit + UI |
| T18 | alternativa differenziata **non selezionabile come comune** | unit + UI |
| T19 | **duplicazioni** nella verifica risolta rifiutate (G13) | unit puro |
| T20 | **pool modificato** fra bozza e attivazione ⇒ blocco leggibile (G09/G10) | integrazione |
| T21 | **cambio etichetta dopo l'attivazione** non altera la verifica attiva | integrazione |
| T22 | **studente senza etichetta** riceve la base | unit + integrazione |
| T23 | **replay** della callable: stessa assegnazione, zero scritture | Functions + emulator |
| T24 | **doppia attivazione** rifiutata senza scritture (G02/G21) | integrazione |
| T25 | **risposta persa** dopo il commit: retry idempotente | Functions |
| T26 | **nessuna etichetta in dati e UI studente** — audit automatizzato su ogni superficie di §4 | test strutturale |
| T27 | correzione manuale sulla **sola assegnazione** | unit + integrazione |
| T28 | correzione IA sulla **sola assegnazione** | Functions |
| T29 | restituzione sulla **sola assegnazione** | integrazione |
| T30 | PDF/CSV sulla **sola assegnazione** | unit |
| T31 | modifica concorrente fra apertura bozza e attivazione (G18/G19/G20) | integrazione |
| T32 | configurazione con **proprietà extra** rifiutata (G03) | unit puro |
| T33 | `classifyQuestionParticipation`: le quattro classi, e nessuna UI che le ricostruisca (test strutturale sul sorgente) | unit + strutturale |

**T26 in dettaglio.** È il test che tiene in piedi il principio 5: un test
strutturale che, dato l'insieme dei writer delle superfici di §4, verifica che
nessuno di essi possa mai ricevere `labelId`/`labelName` — stessa tecnica del
test statico che vieta a `textarea` di essere ridimensionabile e a
`STRUCTURE-IMPORT-01` di importare Firebase.

---

## 16. Rischi residui accettati

| # | Rischio | Perché è accettato |
|---|---|---|
| R1 | **Il numero di domande rivela la differenziazione** a uno studente attento | è intrinseco alla funzionalità; ciò che si difende è il *motivo*, non il *fatto* (§4) |
| R2 | La **finestra** fra fingerprint delle assegnazioni e transazione non è nulla (§7.3) | single-owner: la finestra reale è due schede dello stesso browser. Chiuderla richiederebbe una Cloud Function di attivazione, sproporzionata |
| R3 | L'**unicità dei nomi** è un vincolo applicativo, non un vincolo del database | stesso confine Rules/service già in vigore per `evaluations` e `teacherSnapshot` (`sicurezza.md` §3) |
| R4 | Un docente può comunque **scrivere una diagnosi dentro il nome** di un'etichetta | SchoolForge non lo impedisce e non lo può impedire senza classificazione semantica, che il principio 4 vieta. Difesa: nessun esempio diagnostico nella UI, testo esplicito nello stato vuoto, e il nome non lascia mai il lato docente |
| R5 | `same_questions` **con differenziazione** perde il percorso interamente client-side | è il prezzo dell'isolamento delle alternative; il costo resta 1 callable + 1 scrittura al primo avvio, poi zero |
| R6 | Le **verifiche attive** non bloccano l'eliminazione di un'etichetta | il loro snapshot è autosufficiente; l'alternativa renderebbe le etichette immortali |

---

## 17. Decisioni aperte

**Nessuna.** Ogni scelta di modello dati, UI, sicurezza, costo e sequenza è
presa e motivata sopra. Le fasi VDIF-01→05 sono implementabili senza tornare a
chiedere.
