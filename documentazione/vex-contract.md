# VEX — Contratto varianti equivalenti

**Stato:** VEX-00B — consolidamento tecnico + prototipo statico del builder.
**Natura:** documentazione + prototipo. **Nessun codice applicativo, Function, Rule,
indice, schema reale, dipendenza o deploy** è introdotto da questo pacchetto.
**Base:** UX e decisioni di prodotto già approvate in
[`evoluzioni-apprendimento-roadmap.md` §6](evoluzioni-apprendimento-roadmap.md). Questo
documento **non riprogetta** VEX: congela i nomi dei campi, il contratto di
assegnazione/sicurezza/costo e delimita gli scope VEX-01A/01B/02/03.

---

## 1. Inventario — cosa è GIÀ implementato e va riusato (non reimplementare)

| Fondazione | Dove | Fatti verificati |
|---|---|---|
| **Shuffle locale Fisher–Yates** | `apps/web/src/features/student/examShuffle.ts` (`shuffleWithRng`), usato in `OnlineExamView.tsx` | Ordine **solo visivo**, RNG iniettabile, non muta l'input; **mai persistito** (Firestore/session/localStorage); cambia liberamente a ogni mount/refresh; risposte e flag restano legati all'`order` originale. Va **riusato tale e quale** anche in `equivalent_variants`. |
| **`maxCharacters`** | `packages/lesson-contract` (parser/serializer/schema/`maxCharacters.ts`), editor pool, `VerificationTeacherQuestionSnapshot.maxCharacters`, `PublicVerificationQuestion.maxCharacters` | Contratto pool V2 + editor + snapshot/proiezione + limite runtime `OnlineExamView`; default effettivo **2000** se assente/legacy. Congelato all'attivazione. Riusato per validare l'equivalenza delle aperte. |
| **POOL-SIMPLE v2** | `packages/lesson-contract`, `VerificationQuestionRef.difficolta`, snapshot | Difficoltà **intera 1–5**, `maxPoints === difficolta`, **`peso` eliminato**. |
| **`teacherSnapshot` immutabile** | `VerificationTeacherSnapshot` (owner-only), congelato all'attivazione; Rules vietano update post-attivazione | Contiene `questions[]` con `soluzione`, `difficolta`, `maxCharacters`; **mai** copiato nella proiezione pubblica. |
| **`publishedProjection` senza soluzioni** | `PublishedProjectionDoc.questions: PublicVerificationQuestion[]` | Mai `soluzione`/`poolStorageRef`/`questionIndexEntryId`; leggibile dallo studente solo se `active` + `public` + `classId` combacia. |
| **Submission deterministica** | `submissions/{verificationId}_{studentUid}` | Una consegna per (studente, verifica) garantita dall'id; `answers`/`flagged` **keyed per `order.toString()`**. |
| **Autosave / ripresa / consegna** | `OnlineExamView.tsx` | Draft→autosave→submit atomico + receipt; immutabile dopo `submitted`. |
| **Correzione manuale / IA / restituzione** | `evaluations` keyed per `order`, `correctionReturns`, gateway IA M5 | Tutto ragiona sugli **`order`**; `maxPoints` letto dalla proiezione, mai ricalcolato. |

### `VerificationConfig.questionsPerStudent` — decisione (nessun codice in questa PR)

`questionsPerStudent?: number | null` è **dichiarato** in `apps/web/src/types/firestore.ts`
ma **non è usato** da alcuna logica applicativa (solo in fixture di test). **Non è
implementato** e non va dichiarato tale.

**Decisione di contratto:** il campo è **assorbito** dal nuovo modello e sarà
**rimosso** in VEX-01A. In `equivalent_variants` le domande per studente sono
**derivate** e non configurabili a mano:

```
questionsPerStudent (derivato) = commonQuestionOrders.length + equivalentGroups.length
```

In `same_questions` corrisponde al numero totale di domande configurate. Non si
introduce alcun sotto-campionamento numerico «N domande a caso su M»: la selezione è
sempre esplicita (comuni + un'alternativa per gruppo). La rimozione del campo inutilizzato
avverrà in VEX-01A insieme al resto del modello dati; **questa PR non tocca il tipo**.

---

## 2. Contratto target — campi definitivi (congelati, non ancora implementati)

> Nomi **definitivi**. Struttura minimale: nessun documento per domanda, nessuna copia
> del pool, una sola scrittura aggiuntiva al primo avvio.

### 2.1 `VerificationConfig` (draft, editabile dal docente)

```ts
type EquivalentGroupConfig = {
  /** id stabile del gruppo, generato client-side alla creazione (immutabile). */
  id: string;
  /** alternative del gruppo, come questionIndexEntryId STABILI (non order). */
  questionIndexEntryIds: string[];
};

type VerificationConfig = {
  // …campi esistenti…
  /** Default 'same_questions' (assente/legacy ⇒ 'same_questions'). */
  distributionMode: 'same_questions' | 'equivalent_variants';
  /** Presente solo in 'equivalent_variants'. Gruppi di alternative. */
  equivalentGroups?: EquivalentGroupConfig[];
  // questionsPerStudent: RIMOSSO in VEX-01A (assorbito dal modello, vedi §1).
};
```

Nel **draft** i gruppi referenziano `questionIndexEntryId` stabili (gli stessi id di
`config.questionRefs[].questionIndexEntryId`), **non** gli `order` (che esistono solo
dopo l'attivazione). Le domande non incluse in alcun gruppo sono **comuni**.

### 2.2 `VerificationTeacherSnapshot` (owner-only, congelato all'attivazione)

```ts
type EquivalentGroupSnapshot = {
  id: string;
  /** order (0-based) delle alternative del gruppo dentro questions[]. */
  alternativeOrders: number[];
};

type VerificationTeacherSnapshot = {
  // …campi esistenti (questions[] con soluzione/difficolta/maxCharacters)…
  distributionMode: 'same_questions' | 'equivalent_variants';
  /** order (0-based) delle domande comuni (assegnate a tutti). */
  commonQuestionOrders: number[];
  /** Presente solo in 'equivalent_variants'. */
  equivalentGroups: EquivalentGroupSnapshot[];
};
```

All'attivazione ogni `questionIndexEntryId` del draft è **convertito** nell'`order`
congelato della corrispondente voce di `questions[]`. `commonQuestionOrders` +
l'unione degli `alternativeOrders` = insieme completo configurato. Lo snapshot resta
**immutabile** (Rules già vietano l'update di `teacherSnapshot`).

### 2.3 `SubmissionDoc` (assegnazione persistita, server-only)

```ts
type SubmissionDoc = {
  // …campi esistenti…
  /**
   * Presente solo in 'equivalent_variants'. Scritto UNA SOLA VOLTA dal server al
   * primo avvio: order (0-based) effettivamente assegnati allo studente
   * (comuni + una alternativa per gruppo). Mai riscritto. Assente ⇒ non ancora
   * assegnata.
   */
  assignedQuestionOrders?: number[];
};
```

**Invarianti:**

- `assignedQuestionOrders` è scritto **solo dal server** (callable), mai dal client;
- `answers`/`flagged` continuano a usare gli **order originali** (nessuna rinumerazione);
- **nessuna copia** delle domande dentro la submission; **nessun documento per domanda**;
- in `same_questions` il campo è **assente** e il flusso resta interamente client-side.

### 2.4 Metadato `maxCharacters` per la validazione draft (VEX-01A — congelato)

Il builder deve verificare che le aperte dello **stesso gruppo** abbiano lo **stesso
`maxCharacters` effettivo**, ma oggi **né `QuestionIndexEntry` né `VerificationQuestionRef`
espongono questo dato** (il valore vive nel pool ed entra nello snapshot solo
all'attivazione). Decisione congelata per VEX-01A:

- **`QuestionIndexEntry`** aggiungerà `maxCharacters` **solo** per le domande `aperta`;
- il valore scritto è quello **effettivo già normalizzato dal pool parser**, incluso il
  **default 2000** quando il pool non lo specifica (il default viene materializzato **nel
  question index**, non lasciato implicito);
- **`QuestionIndexPayload`**, **`questionIndexService`** e **`VerificationQuestionRef`**
  propagano lo **stesso** campo (una sola definizione, nessuna divergenza);
- **nessun testo, soluzione o risposta** viene aggiunto al question index (resta
  privacy-minimal: solo metadato numerico per le aperte);
- **nessun nuovo documento, query o lettura**: è un piccolo campo nei documenti
  `questionIndex` **già esistenti** → costo trascurabile;
- il builder confronta il valore **direttamente dai `VerificationQuestionRef` selezionati**;
- la validazione è **ripetuta autorevolmente all'attivazione** usando le domande
  realmente caricate dal pool (il ref è un aiuto UX, il pool resta l'autorità);
- **fail-closed sui corsi legacy:** se una domanda aperta di un corso **già importato**
  non possiede il nuovo metadato, `equivalent_variants` **fallisce in modo leggibile**
  chiedendo di **reimportare il corso**; **`same_questions` continua a funzionare senza
  reimport**;
- **nessun fallback silenzioso a 2000** su un indice privo del campo: assumere 2000
  potrebbe nascondere un limite personalizzato realmente impostato nel pool e produrre
  un'equivalenza falsa. L'assenza del campo su un'aperta ⇒ errore «reimporta il corso»,
  non un default implicito.

Questa decisione è **solo di contratto** (VEX-01A): questa PR **non** modifica alcun tipo,
service o schema reale.

---

## 3. Validazione dei gruppi

Alternative dello stesso gruppo **devono** avere:

- stessa **UDA** (`udaDir` della `VerificationQuestionRef`);
- stesso **tipo** (`aperta` / `chiusa_singola` / `chiusa_multipla`);
- stessa **difficoltà** intera 1–5;
- stesso **`maxCharacters` effettivo** per le aperte (default 2000 se assente);
- ⇒ di conseguenza stesso **`maxPoints`**, perché `maxPoints === difficolta`.

**Bloccante SOLO:**

1. riferimento mancante/corrotto (un `questionIndexEntryId` non è tra i `questionRefs`);
2. alternative incompatibili (una delle condizioni sopra non è soddisfatta);
3. nessuna domanda complessiva (0 comuni e 0 gruppi con alternative);
4. snapshot non costruibile (conversione entryId→order impossibile);
5. **stessa domanda in più gruppi** (una `questionIndexEntryId` può stare in **un solo** gruppo).

**NON bloccante (warning o silenzioso):**

- gruppo con **una sola** alternativa → warning «Una alternativa possibile — assegnata a tutti»;
- **una sola combinazione** complessiva → warning «Una sola variante possibile»;
- combinazioni **inferiori** al numero di studenti → warning non bloccante;
- **ripetizione** della stessa variante tra studenti → ammessa (nessun vincolo di unicità).

**Gruppo vuoto** (0 alternative) → **eliminato automaticamente**, senza errore.

Numero di **varianti possibili** = prodotto del numero di alternative di ogni gruppo
(gruppi con 1 alternativa contribuiscono con fattore 1).

---

## 4. Sicurezza e costi (decisioni obbligatorie)

### 4.1 Isolamento delle alternative

1. Lo studente **non** riceve né può leggere alternative **non assegnate**.
2. In `equivalent_variants` **`publishedProjection` NON contiene tutte le alternative
   leggibili dallo studente**: la proiezione pubblica per lo studente non deve esporre
   l'intero pool di alternative. Le domande assegnate arrivano **solo** dalla callable.
3. Una **Cloud Function callable** (owner o studente autenticato) al primo avvio:
   - verifica approvazione studente, classe, verifica `active` + `public` + `onlineEnabled`;
   - legge il `teacherSnapshot` congelato (server-side, mai esposto al client);
   - **crea o recupera atomicamente** l'assegnazione;
   - restituisce **solo** le domande assegnate **senza soluzioni** (forma `PublicVerificationQuestion`).

### 4.2 Concorrenza e idempotenza

4. Primo avvio concorrente (due tab/reload): una **transazione** garantisce **una sola**
   assegnazione definitiva; retry/reload sono **idempotenti** e restituiscono la stessa
   variante. Nessuna doppia scrittura di `assignedQuestionOrders`.
5. **Nessun listener, polling o scheduler.**
6. **Nessun documento per domanda.**
7. **Nessuna copia completa del pool.**
8. **Una sola scrittura aggiuntiva** al primo avvio: `assignedQuestionOrders` nella submission.
9. Agli accessi successivi: **nessuna nuova scrittura** se l'assegnazione esiste già.
10. Il flusso **`same_questions` resta client-side** e **non paga** il costo della callable VEX.

### 4.2b Algoritmo di assegnazione (VEX-01B — congelato)

- per **ogni gruppo** viene scelta **esattamente una** alternativa; le comuni sono sempre
  tutte assegnate;
- scelta **uniforme** (ogni alternativa del gruppo equiprobabile), decisa **server-side**;
- **RNG crittograficamente sicuro** in produzione (es. `crypto.randomInt`/
  `crypto.getRandomValues`), **iniettabile** nei test per determinismo;
- la casualità è usata **solo** quando l'assegnazione **non esiste** ancora; la
  transazione persiste `assignedQuestionOrders` una sola volta;
- **retry, doppia tab e refresh** restituiscono **sempre** l'assegnazione **già
  persistita** (nessuna nuova estrazione, nessun ri-sorteggio);
- **nessun bilanciamento globale** tra studenti e **nessuna garanzia** che studenti
  diversi ricevano varianti diverse; le **ripetizioni** sono **ammesse** (già classificate
  come warning non bloccante in §3);
- **nessuna lettura o scrittura aggiuntiva** rispetto al contratto §4.1–4.3 (l'estrazione
  è in-memory dentro la stessa transazione del primo avvio).

### 4.3 Budget indicativo (da documentare, non misurato qui)

| Evento | Costo |
|---|---|
| **Primo avvio** (`equivalent_variants`) | 1 callable + poche letture server-side già necessarie alla validazione (verifica + snapshot) + **1** create/update submission |
| **Refresh / ripresa** | 1 callable + lettura submission + verifica/snapshot, **0 scritture** |
| **`same_questions`** | invariato, interamente client-side, **0 callable VEX** |

Nessun costo continuo; nessun listener/polling/scheduler.

**Matrice schema/costo delle modifiche VEX-01A** (nessuna in questa PR; congelate):

| Modifica schema | Dove | Costo | Note |
|---|---|---|---|
| `distributionMode` | `VerificationConfig`, `teacherSnapshot` | trascurabile (campo enum su doc esistente) | default `same_questions` |
| `equivalentGroups` | `VerificationConfig` (entryId), `teacherSnapshot` (order) | trascurabile (piccolo array su doc esistente) | solo `equivalent_variants` |
| `assignedQuestionOrders` | `SubmissionDoc` | **1** scrittura al primo avvio, poi 0 | server-only |
| **`maxCharacters` (aperte)** | `QuestionIndexEntry` → `QuestionIndexPayload` → `questionIndexService` → `VerificationQuestionRef` | **trascurabile**: un piccolo campo numerico nei documenti `questionIndex` **già esistenti**; **nessun** nuovo documento, query o lettura | scritto solo per le `aperta`; valore effettivo normalizzato (incl. default 2000); nessun testo/soluzione aggiunto; assenza su corso legacy ⇒ errore «reimporta» in `equivalent_variants`, `same_questions` non richiede reimport |
| rimozione `questionsPerStudent` | `VerificationConfig` | trascurabile | campo inutilizzato, assorbito |

### 4.4 PDF

- **PDF docente:** continua a contenere **l'insieme completo** configurato (invariato).
- **PDF studente:** in `equivalent_variants` deve essere **disabilitato/nascosto**. Un PDF
  generato dalla proiezione completa esporrebbe tutte le alternative → **requisito di
  sicurezza**: `studentPdfEnabled` è forzato inefficace/nascosto quando
  `distributionMode == 'equivalent_variants'` (lo studente non ha una proiezione completa
  da cui generare il PDF, e la UI non offre il download). Da implementare in VEX-02.

---

## 5. Correzione e restituzione (formalizzazione)

- Il **workspace docente** filtra `teacherSnapshot.questions` usando
  `submission.assignedQuestionOrders`: mostra e corregge **solo** gli order assegnati a
  quello studente.
- L'**IA** corregge **solo** gli order assegnati (input costruito dalla variante assegnata).
- **Totali e percentuali** sono calcolati sulla **variante assegnata**; poiché i gruppi
  equivalenti garantiscono lo **stesso `maxPoints`**, il denominatore è coerente tra
  studenti con varianti diverse.
- `correctionReturns` contiene **solo** le domande realmente assegnate; **nessuna
  alternativa non assegnata** raggiunge lo studente.
- **Azzeramento, completamento, riapertura e restituzione** restano **invariati**
  (continuano a ragionare per `order`).

---

## 6. Modalità

### `same_questions`
- usa **tutte** le domande configurate;
- ordine casuale **locale** già implementato (`shuffleWithRng`);
- **nessuna** nuova Function o scrittura; flusso attuale **invariato**.

### `equivalent_variants`
- domande comuni + **una** alternativa per ogni gruppo;
- assegnazione **una sola volta** al primo avvio, **persistita** nella submission;
- refresh/login mantengono la **stessa** variante; solo l'**ordine visivo** può cambiare
  (stesso `shuffleWithRng` applicato all'insieme assegnato).

---

## 7. Scope dei pacchetti

### VEX-00 / VEX-00B (questo pacchetto) — **docs + prototipo**
Contratto congelato (questo file), aggiornamenti minimi alla documentazione e prototipo
statico `prototipi/vex-builder.html` con tutti gli stati/warning/validazioni. Nessun
codice applicativo.

### VEX-01A — **modello dati + validazione builder (client, draft-time)**
- aggiungere `distributionMode` + `equivalentGroups` a `VerificationConfig`; **rimuovere
  `questionsPerStudent`** (assorbito);
- **metadato `maxCharacters` (§2.4):** aggiungerlo a `QuestionIndexEntry` (solo aperte,
  valore effettivo già normalizzato dal pool incluso il default 2000) e propagarlo in
  `QuestionIndexPayload`, `questionIndexService` e `VerificationQuestionRef`; nessun
  testo/soluzione/risposta nel question index; nessun nuovo documento/query/lettura;
- builder docente draft-time: creare/eliminare gruppi, aggiungere/rimuovere alternative,
  riepilogo derivato, validazioni §3 (bloccanti e warning) — incluso il confronto
  `maxCharacters` per le aperte direttamente dai ref selezionati —, eliminazione gruppo
  vuoto; **fail-closed «reimporta il corso»** se un'aperta di un corso legacy non ha il
  metadato (§2.4), senza fallback silenzioso a 2000; `same_questions` funziona senza
  reimport;
- estendere `teacherSnapshot` con `distributionMode`/`commonQuestionOrders`/
  `equivalentGroups` e la **conversione entryId→order all'attivazione**, ripetendo
  **autorevolmente** la validazione (incluso `maxCharacters`) sulle domande caricate dal
  pool;
- **nessuna** callable ancora; `same_questions` invariato.

### VEX-01B — **callable di assegnazione + sicurezza + isolamento**
- Cloud Function callable (owner/student-auth) §4.1;
- **algoritmo di assegnazione §4.2b:** una alternativa per gruppo, scelta uniforme
  server-side, RNG crittograficamente sicuro in produzione e iniettabile nei test,
  casualità usata solo in assenza di assegnazione, nessun bilanciamento globale,
  ripetizioni ammesse;
- transazione di assegnazione idempotente §4.2, unica scrittura `assignedQuestionOrders`;
- proiezione pubblica che **non** espone le alternative in `equivalent_variants`;
- Rules/isolamento: lo studente non legge alternative non assegnate;
- test concorrenza/idempotenza/isolamento/refresh; budget §4.3.

### VEX-02 — **flusso studente + correzione/restituzione + PDF**
- `OnlineExamView` consuma la variante assegnata (stesso shuffle visivo);
- workspace docente/IA/restituzione filtrati per `assignedQuestionOrders` §5;
- PDF studente disabilitato/nascosto in `equivalent_variants` §4.4.

### VEX-03 — **hardening equità/costi/smoke**
- gate multi-studente, nessuna fuga di alternative/soluzioni, verifica costi reali.

---

## 8. Prototipo

`documentazione/prototipi/vex-builder.html` — HTML/CSS/JS standalone, senza CDN/rete/dati
reali, stile SchoolForge esistente. Rappresenta: dettaglio verifica draft con picker;
sezione «Distribuzione online» (Stesse domande / Varianti equivalenti); riepilogo
(comuni, gruppi, per studente, varianti possibili, punteggio massimo); domande comuni;
≥3 gruppi (valido multi-alternativa, singola alternativa con warning, incompatibilità
bloccante); azioni Aggiungi alternativa / Rimuovi / Elimina gruppo / Crea gruppo; nessun
drag-and-drop; desktop + simulazione mobile impilata senza overflow orizzontale; stato
«Una sola variante possibile»; stato vuoto iniziale; testo che chiarisce che l'ordine
resta comunque casuale. È una **estensione naturale** della UI Verifiche, senza cambiare
header o design globale.
