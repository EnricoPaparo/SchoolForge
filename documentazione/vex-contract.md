# VEX — Contratto varianti equivalenti

**Stato:** VEX-01A, VEX-01B **e VEX-02A implementati**. VEX-01A: modello dati, validazioni
pure e builder docente draft-time (client). VEX-01B: attivazione `equivalent_variants`
operativa (snapshot VEX + proiezione pubblica **solo domande comuni**), callable server-side
`assignVerificationVariant` (assegnazione uniforme, RNG sicuro, transazione idempotente,
unica scrittura `assignedQuestionOrders`), isolamento delle alternative e Rules server-only.
VEX-02A: **svolgimento studente della variante assegnata** — il portale instrada
`equivalent_variants` sulla callable (avvio/ripresa/refresh idempotenti), `OnlineExamView`
mostra **solo** le domande assegnate, autosave/consegna sono ristretti alla variante (client
fail-closed + **Rules**: `answers`/`flagged` ⊆ `assignedAnswerKeys`), PDF studente disabilitato
in VEX. VEX-02B: **correzione, IA, restituzione ed export sulla sola variante assegnata** —
risolutore canonico condiviso (`assignedVariant.ts`), scheletro correzione + totali +
restituzione + payload IA costruiti esclusivamente su `assignedQuestionOrders` (fail-closed).
`same_questions` resta invariato e **non** invoca la callable. **VEX non è ancora deployabile:**
resta **VEX-03 / Gate GVEX** (rollout coordinato, smoke, evidenze). VEX-00B ha congelato il contratto.
**Natura (VEX-00B):** documentazione + prototipo. **Nessun codice applicativo, Function, Rule,
indice, schema reale, dipendenza o deploy** è introdotto dal pacchetto VEX-00B.
**Base:** UX e decisioni di prodotto già approvate in
[`evoluzioni-apprendimento-roadmap.md` §6](evoluzioni-apprendimento-roadmap.md). Questo
documento **non riprogetta** VEX: congela i nomi dei campi, il contratto di
assegnazione/sicurezza/costo e delimita gli scope VEX-01A/01B/02/03.

---

## 1. Inventario — cosa è GIÀ implementato e va riusato (non reimplementare)

| Fondazione | Dove | Fatti verificati |
|---|---|---|
| **Shuffle locale Fisher–Yates** | `apps/web/src/features/student/examShuffle.ts` (`shuffleWithRng`), usato in `OnlineExamView.tsx` | Ordine **solo visivo**, RNG iniettabile, non muta l'input; **mai persistito** (Firestore/session/localStorage); cambia liberamente a ogni mount/refresh; risposte e flag restano legati all'`order` originale. Va **riusato tale e quale** anche in `equivalent_variants`. |
| **`maxCharacters`** | `packages/lesson-contract` (parser/serializer/schema/`maxCharacters.ts`), editor pool, `VerificationTeacherQuestionSnapshot.maxCharacters`, `PublicVerificationQuestion.maxCharacters` | Contratto pool V2 + editor + snapshot/proiezione + limite runtime `OnlineExamView`; default effettivo **2000** se assente/legacy. Congelato all'attivazione. È il limite tecnico **della singola** risposta aperta assegnata; **non** è un criterio di equivalenza VEX (vedi §2.4). |
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
  /** Default 'same_questions' solo se il campo è ASSENTE (legacy); valore malformato ⇒ errore. */
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

### 2.4 `maxCharacters` NON è un criterio di equivalenza (decisione definitiva del docente)

`maxCharacters` **non** è un criterio di equivalenza pedagogica: è **soltanto** il limite
tecnico della singola risposta aperta. Di conseguenza, per VEX:

- ogni domanda conserva il **proprio** `maxCharacters` già esistente (nessuna modifica);
- `OnlineExamView` applica il limite della **domanda effettivamente assegnata** (come già
  oggi, dallo snapshot/proiezione);
- due alternative dello stesso gruppo **possono** avere `maxCharacters` **differenti**;
- **nessuna** validazione, warning o blocco confronta `maxCharacters`;
- **nessun** nuovo campo nel question index (`QuestionIndexEntry`/`QuestionIndexPayload`)
  o nei question ref (`VerificationQuestionRef`);
- **nessun reimport** richiesto;
- **nessuna** nuova lettura, scrittura o occupazione Firestore.

La coerenza pedagogica **sostanziale** delle alternative resta responsabilità del docente.

---

## 3. Validazione dei gruppi

Alternative dello stesso gruppo **devono** avere:

- stessa **UDA** (`udaDir` della `VerificationQuestionRef`);
- stesso **tipo** (`aperta` / `chiusa_singola` / `chiusa_multipla`);
- stessa **difficoltà** intera 1–5;
- ⇒ di conseguenza stesso **`maxPoints`**, perché `maxPoints === difficolta`;
- riferimento **valido** (entryId presente tra i `questionRefs`);
- domanda presente **al massimo in un gruppo**; snapshot costruibile.

`maxCharacters` **non** è un criterio di equivalenza (vedi §2.4): non viene confrontato,
non genera warning né blocchi. Due alternative possono avere limiti caratteri diversi.

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
| rimozione `questionsPerStudent` | `VerificationConfig` | trascurabile | campo inutilizzato, assorbito |

`maxCharacters` **non** compare in questa matrice: non viene aggiunto al question index né
ai question ref, non richiede reimport e non introduce alcun costo/storage/schema (§2.4).

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

### VEX-01A — **modello dati + validazione builder (client, draft-time)** ✅ IMPLEMENTATO
- ✅ `distributionMode` + `equivalentGroups` aggiunti a `VerificationConfig`;
  **`questionsPerStudent` rimosso** dal tipo, dal writer e dalle fixture (assorbito);
- ✅ helper puro centralizzato `normalizeDistributionMode` (`vexDistribution.ts`),
  **fail-closed**: **solo `undefined`** (campo assente, documento legacy)→`same_questions`;
  valore valido→sé stesso; **qualsiasi altro valore presente** — `null`, stringa vuota,
  stringhe sconosciute, array, oggetti, numeri — →errore leggibile (mai fallback
  silenzioso di valori malformati); niente controlli-stringa duplicati in UI;
- ✅ builder docente draft-time (`VexBuilder.tsx`, subito dopo il picker, solo in bozza):
  creare/eliminare gruppi, aggiungere/rimuovere alternative, riepilogo derivato,
  validazioni §3 (UDA/tipo/difficoltà/`maxPoints`, riferimento valido, domanda in un solo
  gruppo, snapshot costruibile; warning non bloccanti) — **`maxCharacters` non è confrontato**
  (§2.4) —, eliminazione gruppo vuoto; nessun drag-and-drop; nessun reimport;
- ✅ helper puro di riconciliazione/derivazione (`vexGroups.ts`) e di conversione
  entryId→order per lo snapshot futuro (`vexSnapshot.ts`), completamente testati; i tipi
  snapshot (`EquivalentGroupSnapshot`, `teacherSnapshot.distributionMode`/
  `commonQuestionOrders`/`equivalentGroups`) sono **dichiarati** e pronti per VEX-01B;
- ✅ salvataggio bozza esteso **senza scritture aggiuntive**: `distributionMode` ed
  `equivalentGroups` viaggiano nello stesso `updateVerificationConfig` di titolo/classe/
  questionRefs; dirty-state include modalità e gruppi; passare a `same_questions`
  **preserva** i gruppi nella bozza ma li rende inattivi/non conteggiati;
- ✅ **guardia fail-closed di rollout parziale:** `activateVerification` **rifiuta**
  `equivalent_variants` **prima** di leggere il pool, aprire la transazione o scrivere
  documenti, con messaggio esatto _«Le varianti equivalenti saranno attivabili dopo il
  completamento del servizio di assegnazione sicura.»_; nessuna callable ancora;
  `same_questions` invariato per comportamento e costo. La guardia è applicativa
  (nessun feature-flag remoto/Firebase config) e sarà rimossa da VEX-01B.

### VEX-01B — **callable di assegnazione + sicurezza + isolamento** ✅ IMPLEMENTATO
- ✅ **attivazione `equivalent_variants` operativa** (guardia VEX-01A rimossa):
  `activateVerification` costruisce lo snapshot VEX (conversione entryId→order, ri-validazione
  autorevole §3) e scrive la `publishedProjection` con **solo le domande comuni**;
- ✅ Cloud Function callable **`assignVerificationVariant`** (v2 `onCall`, scale-to-zero,
  regione `us-central1`) §4.1 — input chiuso `{ verificationId }`, autorizzazione fail-closed
  (auth, studente approvato dello stesso owner, classe, verifica `active` + `onlineEnabled`,
  modalità `equivalent_variants`, snapshot valido);
- ✅ **algoritmo di assegnazione §4.2b** (`verificationVariantCore.ts`): una alternativa per
  gruppo, scelta **uniforme** server-side, RNG crittograficamente sicuro (`node:crypto.randomInt`)
  in produzione e **iniettabile** nei test, casualità usata solo in assenza di assegnazione,
  nessun bilanciamento globale, ripetizioni ammesse;
- ✅ transazione idempotente §4.2 (read-or-assign) con **unica** scrittura
  `assignedQuestionOrders` su `submissions/{id}` al primo avvio, **0 scritture** ai riaccessi;
  assegnazione persistita **invalida** ⇒ fail-closed (nessuna rigenerazione silenziosa);
- ✅ proiezione pubblica che **non** espone le alternative; risposta callable sanitizzata
  (solo domande assegnate, **nessuna** soluzione/alternativa non assegnata/teacherSnapshot/gruppo);
- ✅ Rules/isolamento: `assignedQuestionOrders` è **server-only** (creazione/modifica/rimozione
  dal client negate; altri studenti non lo leggono; autosave lo lascia immutato);
- ✅ test unitari + gateway (core puro, network-free) e Rules Emulator; budget §4.3 rispettato.
- ❌ **NON** in VEX-01B (restano a VEX-02/03): UI studente/`OnlineExamView`, correzione/IA/
  restituzione filtrate, PDF studente, Gate GVEX.

### VEX-02A — **svolgimento studente della variante assegnata** ✅ IMPLEMENTATO
- ✅ routing fail-closed su `distributionMode` (rispecchiato nella `publishedProjection`):
  `same_questions` resta client-side **senza** callable; `equivalent_variants` passa da
  `assignVerificationVariant` via `verificationVariantClient`;
- ✅ avvio/ripresa/refresh idempotenti (stessa variante); la submission deterministica non è
  duplicata, `assignedQuestionOrders` non è mai riscritto dal client, nessuna nuova assegnazione
  dopo riapertura docente (M4 invariato);
- ✅ `OnlineExamView` consuma **solo** le domande assegnate (order canonici; shuffle visivo
  invariato e non persistito; `maxCharacters` della domanda assegnata); navigatore/«da
  rivedere»/contatori sulla sola variante; nessun testo rivela altre alternative;
- ✅ risposta callable validata **fail-closed** (modalità/coerenza order/assenza soluzioni);
  modalità sconosciuta o payload malformato bloccano l'avvio, **nessun** fallback;
- ✅ autosave/consegna ristretti alla variante: filtro client fail-closed + **Rules**
  (`answers`/`flagged` keys ⊆ `assignedAnswerKeys`, mirror string server-only di
  `assignedQuestionOrders` — le Rules non convertono numeri→stringa); cadenza/write invariati;
- ✅ PDF studente **disabilitato e nascosto** in `equivalent_variants`; `same_questions` invariato;
- ✅ loading/spinner sobrio, guardia doppio-click, nessun setState post-unmount, retry su errore;
- ✅ test web mirati + Rules Emulator (subset risposte). Nessun listener/polling; nessun nuovo
  documento; nessuna lettura pool/Storage o delle alternative dal browser.

### VEX-02B — **correzione/IA/restituzione/export filtrati** ✅ IMPLEMENTATO
- ✅ **risolutore canonico** `resolveAssignedQuestions` (`assignedVariant.ts`): unica fonte di
  verità su quali domande dello snapshot si applicano a una consegna. `same_questions`=tutte;
  `equivalent_variants`=variante validata fail-closed (comuni + una per gruppo, no estranei/
  duplicati/inesistenti, `assignedAnswerKeys` coerente); **mai** fallback all'intero banco;
- ✅ **correzione manuale**: lo scheletro delle `evaluations` è costruito dal teacherSnapshot
  sulla **sola variante** (la proiezione pubblica ha solo le comuni); il workspace mostra e
  valuta solo la variante; un'evaluation con order estraneo blocca il caricamento (fail-closed);
  totali/percentuale/completezza sulla variante (`maxPoints` = somma delle assegnate);
- ✅ **IA** (`aiCorrectionEngine`): `classifySubmission` restringe skeleton/openOrders/closedOrders/
  `totalMaxPoints` alla variante; payload solo domande aperte assegnate; assegnazione malformata
  ⇒ consegna **esclusa** (`invalid_variant`) prima del grader e della prenotazione budget, le
  altre proseguono; closed-only ⇒ zero provider/token/costo; idempotenza/lease/budget invariati;
- ✅ **restituzione**: `CorrectionReturnDoc` self-contained con **solo** domande/risposte/
  evaluation assegnate; testo/opzioni dal teacherSnapshot filtrato; `setSolutionsVisible` espone
  solo le soluzioni assegnate; nessun `commonQuestionOrders`/`equivalentGroups`/`alternativeOrders`/
  alternative non assegnate; vista studente invariata;
- ✅ **export**: PDF docente completo invariato; registro/riepilogo PDF+CSV usano i totali della
  variante (dal `correctionSummary`, già evaluation-based); PDF studente resta disabilitato in VEX;
- ✅ **ciclo di vita**: nessun documento assignment separato; eliminare la submission elimina
  `assignedQuestionOrders`/`assignedAnswerKeys`; riapertura/azzeramento/completamento/restituzione
  conservano la variante; dopo eliminazione un nuovo svolgimento riceve una **nuova** assegnazione
  server-side (la submission precedente non esiste più);
- ✅ Rules invariate (correctionReturns già student-own-read-only; return doc costruito server-side);
  test web + Functions mirati. Nessuna nuova query/lettura/documento; write invariati.

### VEX-03 / Gate GVEX — **rollout coordinato + evidenze** (aperto)
- deploy coordinato callable+Rules+client, smoke multi-studente, verifica assenza fughe e costi reali.

### VEX-03 — **hardening equità/costi/smoke**
- gate multi-studente, nessuna fuga di alternative/soluzioni, verifica costi reali.

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
