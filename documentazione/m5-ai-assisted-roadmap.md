# M5 — Correzione assistita da IA · Roadmap e contratto (M5-00)

**Data:** 17 luglio 2026 · **Fase:** M5-00→M5-04C implementati; **M5-05A/B preparati**; **M5-05C**, **M5-05D1**, **M5-05D2A**, **M5-05D2B-1**, **M5-05D2B-2** e **M5-05E-1** implementati; provider reale ancora disabilitato.
**Natura:** roadmap incrementale evidence-based. M5-01→M5-04C hanno costruito e integrato il flusso mock; M5-05A/B hanno preparato decisione e dataset; M5-05C aggiunge adapter e harness senza attivare il provider. **Nessuna API key, chiamata reale, costo o deploy; M5 e G7 non sono completati.**
**Codice ispezionato (sola lettura):** `types/firestore.ts` (`SubmissionDoc`, `CorrectionDoc`, `QuestionEvaluation`, `CorrectionEventDoc`, `CorrectionReturnDoc`), `features/repository/corrections/*` (`correctionContract.ts`, `correctionsService.ts`, `correctionWorkspaceLoader.ts`, `correctionRegisterExport.ts`), `features/repository/verifications/submissionsMonitorService.ts`, `features/teacher/VerificationsView.tsx` (tabella «Consegne online» + apertura `CorrectionWorkspace`), `firestore.rules` (matrice `corrections`/`correctionEvents`/`correctionReturns`).

> **Questa fase supera** la vecchia roadmap generica **M5-A..E** e i contratti stale `proposeCorrection`/`approveCorrection`/`bulkApproveCorrections`/`enableAutomaticCorrection` (che ipotizzavano una «proposta IA» persistente e una correzione automatica). Il nuovo modello è: **una sola azione batch «Correggi con IA» che scrive direttamente nelle `evaluations` di correzioni `in_progress`**, restando bozze modificabili dal docente. Vedi §14 (provider-agnostic) e §16 (roadmap M5-00→M5-05).

---

## 1. Obiettivo e non-obiettivi

### 1.1 Obiettivo
Ridurre il tempo di correzione delle **domande aperte** di verifiche online già consegnate, facendo pre-compilare da un modello IA i punteggi e i feedback **come bozza**, sempre sotto controllo umano, all'interno del flusso di correzione M4 **già esistente e invariato nella sua semantica**. Le domande **chiuse** sono valutate da logica **deterministica** locale, senza consumare token.

### 1.2 Non-obiettivi (espliciti)
- **Nessuna correzione automatica definitiva.** L'IA non completa, non restituisce, non rende visibile nulla allo studente.
- **Nessuna piattaforma IA general-purpose**, nessun chatbot, nessun assistente conversazionale.
- **Nessuna generazione di domande, contenuti o soluzioni.**
- **Nessun retrieval, web access, tool calling, code execution** o interpretazione di contenuti forniti dallo studente.
- **Nessuna struttura «proposta IA» persistente** accanto a risposta/soluzione/correzione: l'IA scrive nelle normali `evaluations`.
- **Nessun listener/polling aggiuntivo**, nessun servizio sempre attivo.
- Gate **G8** e correzione automatica: **rinviati** (fuori da tutta la linea M5-00→M5-05).

---

## 2. Flusso UX completo della tabella batch («Consegne online»)

La tabella «Consegne online» (oggi in `VerificationsView.tsx`, alimentata da `submissionsMonitorService`) diventa una tabella con **selezione a checkbox** e una **toolbar di azioni batch sopra la tabella**. Nessuna azione IA per-riga.

### 2.1 Struttura
- **Checkbox per riga** + checkbox «seleziona tutte le eleggibili» nell'intestazione.
- **Toolbar unica sopra la tabella**, con i comandi batch:
  1. **Correggi con IA**
  2. **Completa**
  3. **Riapri**
  4. **Restituisci**
- Ogni comando opera **solo** sulle righe **selezionate ed eleggibili** per quel comando (§3).
- Colonna **«Valutate»** (`10/13`) al posto di «Punteggio» (§5); percentuale conservata separatamente quando disponibile.

### 2.2 Passi del comando «Correggi con IA»
1. Il docente seleziona una o più consegne e preme **Correggi con IA** (unico pulsante, in toolbar).
2. **Preflight/preview (chiamata server-side, senza provider):** una prima invocazione Function `onCall` calcola l'insieme eleggibile server-side (§4) e restituisce alla UI i dati per un **dialog di conferma** con:
   - consegne **selezionate** (n.);
   - consegne **realmente elaborabili** (n.);
   - consegne **escluse** e **motivo** (per consegna: es. «non consegnata», «già completata», «nessuna domanda ancora valutabile», «oltre i limiti di dimensione»);
   - **domande aperte** che saranno inviate all'IA (n.);
   - **domande chiuse** che saranno valutate **deterministicamente** (n., 0 token);
   - **consegne con sole chiuse** elaborabili (n., 0 chiamate provider);
   - **stima token/costo** (input+output) e **costo massimo stimato** dell'operazione;
   - **modello/provider** utilizzato (dal feature flag/config server; §14–§15).
   Il **preflight non chiama il provider e non consuma token** (§4, §12).
3. Il docente **conferma** o annulla. Nessuna spesa avviene prima della conferma.
4. Alla conferma, una **seconda invocazione Function** `onCall` esegue l'operazione. Il server **ripete tutte le verifiche di eleggibilità** (§4): se i dati di una consegna sono cambiati dopo il preview, quella consegna è **esclusa con motivo** e **non** elaborata con una stima ormai vecchia. Per ogni consegna eleggibile confermata:
   - valuta le **chiuse** in modo deterministico (§5.1);
   - se e solo se restano **aperte** eleggibili, invia **una sola richiesta provider per consegna** con **tutte** quelle aperte; una consegna con **sole chiuse** non genera **alcuna** chiamata provider;
   - valida l'output (§7–§8) e scrive i risultati nelle `evaluations` della correzione `in_progress` (creandola se assente, in stato `in_progress`).
5. **Risultato finale** mostrato al docente: **riuscite / escluse / fallite**, per consegna, con motivo sintetico. **Nessun successo parziale è nascosto**: una consegna in cui alcune aperte falliscono resta con quelle domande **non valutate** (`points: null`) e viene segnalata come parzialmente riuscita.
6. Le correzioni restano **`in_progress`**: il docente le apre, rivede, modifica, completa o restituisce con il flusso M4 esistente.

### 2.3 Le altre azioni batch (Completa/Riapri/Restituisci)
Riutilizzano i **service M4 esistenti** (`completeCorrection`, `reopenCorrection`, `returnCorrection`) applicati riga per riga sulle sole selezionate ed eleggibili, ciascuna con **riepilogo pre-esecuzione** e **risultato finale** (riuscite/escluse/fallite). Vedi §3 per l'eleggibilità e M5-04 per lo scope.

---

## 3. Macchina a stati e criteri di eleggibilità

Gli stati di dominio **non cambiano**: `SubmissionDoc.status` (`draft|submitted`), `CorrectionDoc.status` (`in_progress|completed|returned`), e la UI status `Da correggere` derivata (`deriveCorrectionUiStatus`) quando non esiste ancora una `CorrectionDoc`. M5 **non introduce nuovi stati**.

### 3.1 Eleggibilità «Correggi con IA» (per consegna)
Una consegna è **elaborabile** dal comando se e solo se:
- la submission è `status == 'submitted'` (mai una bozza studente);
- la correzione, se esiste, è `status == 'in_progress'` (mai `completed`/`returned` → prima va riaperta con l'azione dedicata);
- esiste **almeno una domanda ancora valutabile**, cioè `evaluations[order].points === null`, **di qualunque tipo** — aperta **oppure** chiusa;
- rientra nei **limiti prudenti** di dimensione (§12): caratteri risposta, numero domande, token stimati.

**Consegne con sole domande chiuse non valutate sono elaborabili** (decisione approvata): vengono valutate **deterministicamente** (§5.1), con **zero chiamate provider** e **zero token**, e il risultato è salvato nella normale correzione `in_progress`. La presenza di domande aperte **non** è un prerequisito.

Sono **escluse con motivo** solo quando: non consegnate; correzione già `completed`/`returned`; **nessuna domanda ancora valutabile** (ogni `order` ha già `points !== null`); oltre i limiti prudenti (§12).

### 3.2 Regola di non-sovrascrittura
- Una domanda **già valutata** (dal docente o da una precedente esecuzione IA — `points !== null`) **non viene mai sovrascritta**.
- L'IA valuta **solo** le aperte con `points === null`.
- Le **chiuse** sono valutate deterministicamente **solo se** ancora `points === null`.

### 3.3 Eleggibilità delle altre azioni batch
- **Completa:** solo correzioni **interamente valutate e valide** (`isCorrectionComplete`), `status == 'in_progress'`.
- **Riapri:** solo correzioni `completed` o `returned`.
- **Restituisci:** solo correzioni `completed`.
- **Nessuna restituzione automatica** da parte dell'IA in nessun caso.

---

## 4. Contratto tra UI, gateway server-side e service M4

Tre livelli, con confini netti; il provider è dietro il gateway e **non è mai** raggiungibile dal client.

**Decisione architetturale (M5-00, vincolante).** Il gateway è realizzato con **Cloud Functions v2 `onCall`**, con **due chiamate server-side** per ogni operazione batch:
1. **`aiCorrectionPreview`** — chiamata di **preflight/preview** eseguita **prima** della conferma. Calcola eleggibilità, conteggi e stima token/costo. **Non chiama il provider** e **non consuma token IA**.
2. **`aiCorrectionRun`** — chiamata di **esecuzione** eseguita **dopo** la conferma. Ricontrolla l'eleggibilità e applica le valutazioni.

Quindi **esattamente 2 invocazioni Function per operazione batch** (preview + run). Durante l'esecuzione: **al massimo una chiamata provider per ogni consegna che contiene domande aperte eleggibili**; consegne con **sole chiuse** → **nessuna** chiamata provider. Il gateway processa le consegne con **concorrenza limitata e configurabile** (§9).

```
 UI (VerificationsView, batch toolbar)
   │  1) selezione → aiCorrectionPreview (onCall)  ── nessun provider, 0 token
   ▼
 aiCorrectionPreview (Cloud Function v2 onCall, scale-to-zero)
   │  verifica ID token→owner; rilegge submission+projection/snapshot (Admin SDK)
   │  calcola eleggibilità + conteggi aperte/chiuse + stima token/costo
   ▼
 UI  ── dialog di conferma (selezionate/elaborabili/escluse+motivo/aperte/chiuse/stima/modello)
   │  2) conferma → aiCorrectionRun (onCall), stesso requestId
   ▼
 aiCorrectionRun (Cloud Function v2 onCall, scale-to-zero)
   │  1. verifica Firebase ID token → owner
   │  2. crea/aggiorna aiCorrectionRuns/{requestId} (idempotenza + stato + audit)
   │  3. RILEGGE server-side submission + publishedProjection/teacherSnapshot
   │  4. RIPETE l'eleggibilità (§3): consegna con dati cambiati dal preview → esclusa con motivo
   │  5. valuta chiuse (deterministico, 0 token) — §5.1
   │  6. SOLO se restano aperte eleggibili: UNA richiesta provider per consegna
   │  7. valida output (schema rigido + range punteggi 0..maxPoints, step 0,25)
   │  8. scrive evaluations nella CorrectionDoc in_progress (Admin SDK, batch)
   │  9. aggiorna aiCorrectionRuns/{requestId} (conteggi/costi/esito) — §10
   ▼
 Firestore: corrections/{submissionId} (in_progress, evaluations aggiornate)
            aiCorrectionRuns/{requestId}  (stato+idempotenza+audit, MAI contenuti)
```

- **La UI non invia mai testi** (risposte/domande/soluzioni) al gateway: invia **solo ID autorizzati** (`verificationId`, elenco di `submissionId`, `requestId`, eventuali `order` target). Entrambe le Function **rileggono server-side** submission, snapshot e soluzioni tramite quegli ID, verificando ownership. Questo impedisce al client di far passare testo arbitrario spacciandolo per parte della verifica (§11).
- **Ricontrollo al `run`:** l'eleggibilità è verificata **di nuovo** al momento dell'esecuzione, non fidandosi del preview: una consegna i cui dati sono cambiati (es. domanda valutata nel frattempo, correzione completata, submission non più coerente) è **esclusa con motivo** e non elaborata con una stima ormai vecchia.
- **La scrittura sulle `evaluations` passa per le stesse invarianti M4** (`assertValidQuestionPoints`, `computeCorrectionTotals`, transizioni). Il gateway **non** completa né restituisce: lascia `status == 'in_progress'`.
- **Riuso, non duplicazione:** il gateway server-side replica le regole pure di `correctionContract.ts` (range, step 0,25, `isCorrectionComplete`) come **unico** punto di validazione server; la UI continua a usare i service M4 client per Completa/Riapri/Restituisci.

---

## 5. Domande chiuse deterministiche e aperte assistite

### 5.1 Chiuse — deterministico, 0 token
Le domande `chiusa_singola`/`chiusa_multipla` hanno soluzione nota nello snapshot docente (`teacherSnapshot`/`publishedSnapshot`). La correttezza è calcolabile **localmente sul server** confrontando `SubmissionDoc.answers[order]` con la soluzione frozen. **Regola minimale M5 (tutto-o-niente):**
- **`chiusa_singola`:** risposta **esatta** → `maxPoints`; qualunque altra risposta (errata o vuota) → `0`.
- **`chiusa_multipla`:** **confronto insiemistico esatto**, indipendente dall'ordine, tra l'insieme delle opzioni selezionate e l'insieme corretto:
  - insieme **esattamente uguale** → `maxPoints`;
  - risposta **incompleta**, contenente **opzioni errate**, o **vuota** → `0`.
- **Nessuna penalità né punteggio parziale** in M5. Un eventuale scoring parziale futuro è **fuori scope** e richiede una **decisione prodotto separata**.
- **Nessuna chiamata provider**, **nessun token**.

Le chiuse sono valutate **solo se** `points === null` (non sovrascrive mai il docente né una valutazione precedente).

### 5.2 Aperte — assistite dall'IA
Solo le aperte con `points === null` sono inviate al provider, **tutte in un'unica richiesta per consegna**. L'input è **chiuso** (§6): testo domanda, criterio/soluzione di riferimento, `maxPoints`, risposta studente — nient'altro. L'output è **strutturato e validato** (§7–§8).

---

## 6. Schema dell'input chiuso inviato al provider

Un solo messaggio per consegna, con **istruzioni fisse** (system) e **dati chiusi** (user). Nessun contenuto studente è mai trattato come istruzione (§11).

```jsonc
// Payload logico costruito SERVER-SIDE (mai dal client)
{
  "requestId": "uuid-v4",            // idempotenza (§9)
  "model": "<da config server>",     // §14–§15
  "task": "grade_open_questions",
  "submissionRef": "verifId_studentUid",
  "questions": [
    {
      "order": 3,
      "maxPoints": 2,                 // frozen dalla projection
      "questionText": "…",            // testo domanda (snapshot docente)
      "referenceSolution": "…",       // soluzione/criterio del docente
      "studentAnswer": "…"            // contenuto NON attendibile, marcato come dato
    }
    // … tutte le aperte eleggibili della consegna
  ],
  "gradingRules": {
    "step": 0.25,
    "min": 0,
    "boundedByMaxPoints": true,
    "feedbackLanguage": "it",
    "feedbackMaxChars": 500
  }
}
```

Regole di costruzione:
- La `studentAnswer` è **etichettata come dato non attendibile** e racchiusa da delimitatori; le istruzioni di grading precedono e non sono modificabili dal suo contenuto.
- Limiti prudenti su caratteri per risposta e per richiesta (§12): oltre soglia → la domanda/consegna è **esclusa** dal preflight, non troncata silenziosamente in modo ambiguo.

---

## 7. Schema strutturato dell'output atteso

Output **rigido**, una entry per `order` inviato, nessun campo libero fuori schema. Deve essere validabile con uno schema stretto (es. JSON Schema / structured output del provider quando disponibile).

```jsonc
{
  "requestId": "uuid-v4",            // deve combaciare con l'input
  "results": [
    {
      "order": 3,                    // deve esistere tra gli order inviati
      "points": 1.5,                 // number; validato §8
      "feedback": "…"               // opzionale, string, ≤ feedbackMaxChars
    }
    // … una entry per ciascun order richiesto
  ]
}
```

Regole di accettazione (§8): ogni `order` deve appartenere agli `order` inviati; `points` deve superare la validazione; entry per `order` non richiesti, duplicate o mancanti → gestite come da §8/§9 (scarto della singola entry, mai corruzione dell'intera correzione).

---

## 8. Validazione punteggi e multipli di 0,25

Lato server, per **ogni** `points` restituito, si applicano **esattamente** le regole M4 (`correctionContract.ts`), mai fidandosi dell'output grezzo:
- `Number.isFinite(points)`;
- `0 <= points <= maxPoints` (con `maxPoints` **frozen** dalla projection, non dal modello);
- **multiplo esatto di 0,25** (`isQuarterPointStep`, confronto nel dominio intero `points*4`);
- normalizzazione anti-rumore (`normalizeQuestionPoints`, `round(points*4)/4`) **solo** dopo che il valore ha già passato la validazione.

Comportamento su output non conforme:
- entry con `points` non valido, `order` inesistente/duplicato, o `feedback` oltre soglia → **scartata la singola domanda** (`points` resta `null`, la domanda risulta «non valutata»), **senza** corrompere le altre valutazioni della stessa correzione;
- output totalmente non parsabile / `requestId` non combaciante → **nessuna scrittura** per quella consegna, che risulta **fallita** nel risultato batch.

---

## 9. Idempotenza, retry, timeout e successi parziali

- **`requestId` per operazione:** ogni operazione batch genera un `requestId`, materializzato in **`aiCorrectionRuns/{requestId}`** (§10). Un retry con lo **stesso** `requestId` non deve produrre doppie valutazioni: la scrittura è **idempotente** perché (a) non sovrascrive domande già valutate (§3.2) e (b) il documento `aiCorrectionRuns/{requestId}` consente di riconoscere un'operazione già applicata.
- **Retry:** consentito a livello di **singola consegna** fallita; poiché l'IA valuta solo `points === null`, un retry completa solo ciò che manca, senza rifare il lavoro già scritto.
- **Timeout:** timeout provider prudente per richiesta; allo scadere la consegna è **fallita** (nessuna scrittura parziale della singola richiesta) e ritentabile.
- **Successo parziale:** se in una consegna alcune aperte sono valutate e altre no, le valutate vengono scritte, le altre restano `null`; la consegna è marcata **parzialmente riuscita** nel risultato. **Mai** nascondere un successo o un fallimento parziale.
- **Concorrenza limitata e configurabile:** il batch processa le consegne con un **grado di parallelismo massimo** configurabile (default prudente basso), per contenere costi e rate limit.

---

## 10. `aiCorrectionRuns/{requestId}` — stato, idempotenza, audit e utilizzo

Serve **un solo** documento operativo (futuro, **non creato in M5-00**), identificato dal `requestId` dell'operazione batch, che funge **contemporaneamente** da:
- **stato dell'operazione batch** (in corso / completata / fallita);
- **idempotency record** (un retry con lo stesso `requestId` riconosce l'operazione già applicata — §9);
- **audit minimale** dell'operazione IA;
- **contatore di utilizzo/costo**.

**`aiCorrectionRuns/{requestId}`** — **una sola collezione**, nessuna seconda collezione di audit IA, nessuna «proposta IA» persistente.

**Contratto privacy-minimal M5-05D2A. Può contenere soltanto:** versione contratto, stato, `selectionHash` SHA-256, numero di consegne, modalità/provider/modello e versioni config/listino applicabili, lease tecnica (`executionId`/scadenza), timestamp, conteggi aggregati, token/costi, risultati `{ ordinal, status, reasonCode? }` ed `expireAt`.

**Non contiene:** `submissionId`, `verificationId` in chiaro, UID (`ownerUid`, `actorUid`, `studentUid` o equivalenti), nomi/email, domande, risposte, soluzioni, feedback, prompt, output grezzo, snapshot o altri testi didattici. `requestId` resta soltanto l'ID tecnico del documento e non è duplicato nei campi.

La selezione è ordinata server-side e l'hash copre `verificationId` + insieme canonico. Gli ordinali derivano da quell'ordine; live e replay associano `ordinal → submissionId` usando esclusivamente la selezione corrente già validata. Un insieme diverso con lo stesso `requestId` è un conflitto. I run legacy privi della versione privacy non vengono migrati, modificati o riutilizzati: il chiamante deve generare un nuovo `requestId`.

La collezione è **server-only**: nessun client, owner incluso, può leggerla o scriverla; l'Admin SDK delle Functions bypassa le Rules. `expireAt` usa una retention DEV tecnica provvisoria di **30 giorni**, in attesa di HG-M5-4. Il campo non cancella alcun documento finché una policy TTL Firebase non viene configurata separatamente; questa PR non configura né deploya la policy.

---

## 11. Privacy, sicurezza e mitigazione prompt injection

- **Chiave provider mai lato client / repo / Firestore / log.** Vive solo in **Secret Manager**, letta esclusivamente dalla Cloud Function.
- **Gateway server-side autenticato:** verifica il **Firebase ID token** e che il chiamante sia **realmente l'owner** (`settings/owner`, stesso pattern del `repositoryGateway` esistente).
- **Autorizzazione per ID, non per testo:** il client passa solo ID; il server **rilegge** submission, snapshot e soluzioni via Admin SDK, verificando ownership e coerenza (`verificationId`↔`submissionId`↔`ownerUid`). Il client **non può** iniettare testi arbitrari come se fossero parte della verifica.
- **Contenuto studente = non attendibile e potenzialmente ostile.** Le risposte sono trattate come **dati**, mai come istruzioni: delimitatori espliciti, istruzioni di grading fisse e prioritarie, nessuna esecuzione/interpretazione di comandi contenuti nella risposta. Nessun tool calling, nessun retrieval, nessun web.
- **Nessun dato sensibile nei log tecnici:** né risposte, né soluzioni, né PII. Solo `requestId`, conteggi, esito, durata (coerente con il logging del gateway esistente).
- **Superficie minima del prompt:** solo i campi di §6; nessun identificativo personale dello studente inviato al provider (si usa `order`/`submissionRef` tecnico, non nome/email).

---

## 12. Cost model

Simboli: **C** = consegne eleggibili in un batch; **A** = aperte eleggibili medie per consegna; **CH** = chiuse per consegna; **T_in/T_out** = token input/output stimati per consegna.

| Voce | Valore |
|---|---|
| **Chiamate provider** | **1 per consegna** con aperte eleggibili → **C** chiamate per batch (mai 1 per domanda). Consegne con sole chiuse → **0** chiamate. |
| **Token (stima)** | Per consegna ≈ `T_in = overhead_prompt + Σ(len(domanda)+len(soluzione)+len(risposta))` e `T_out ≈ A × (token_punteggio + token_feedback)`. Il preflight stima e mostra input+output e un **costo massimo**. |
| **Chiuse** | **0 token**: valutazione deterministica server-side. |
| **Letture Firestore** | Per consegna: 1 submission + projection/snapshot (riletti server-side) + eventuale correction esistente. Nessun listener, nessun polling. |
| **Scritture Firestore** | Per consegna: 1 update `corrections/{id}` (evaluations, batch). Per operazione: 1 documento `aiCorrectionRuns/{requestId}` (creato e poi aggiornato con stato/conteggi/costi/esito). Le altre azioni batch (Completa/Riapri/Restituisci) usano le scritture M4 già esistenti. |
| **Invocazioni Cloud Functions** | **Esattamente 2 per operazione batch**: 1 `aiCorrectionPreview` (preflight, **0 token**) + 1 `aiCorrectionRun` (esecuzione, itera le consegne server-side con concorrenza limitata). Cloud Functions v2 `onCall`, **scale-to-zero**, nessuna istanza sempre attiva. |
| **Limiti batch (prudenti, valori definitivi = Human Gate §15)** | max **consegne per operazione**, max **aperte per consegna**, max **caratteri per risposta**, max **token per consegna**, max **token per operazione**. |
| **Soglie di sicurezza spesa** | **budget massimo per singola operazione** e **budget giornaliero**: preflight blocca se la stima supera il tetto per operazione; il gateway rifiuta se il cumulato giornaliero supera il tetto. Valori definitivi = **Human Gate** (§15). |

**Principi di costo:** scale-to-zero; nessun listener/polling aggiuntivo; **al massimo una chiamata provider per consegna** (0 per consegne con sole chiuse); 2 invocazioni Function per operazione (preview senza token + run); concorrenza limitata e configurabile; preflight e stima **prima** della conferma; feature flag per **disattivare completamente M5**; provider/modello **sostituibili** senza cambiare il dominio applicativo.

---

## 13. Cosa viene persistito e cosa resta transitorio

| Dato | Persistenza |
|---|---|
| Punteggi/feedback generati dall'IA | **Persistiti** nelle normali `evaluations` di `corrections/{submissionId}` (bozza `in_progress`, modificabile). **Nessuna** struttura «proposta IA» separata. |
| `aiCorrectionRuns/{requestId}` (stato+idempotenza+audit+utilizzo) | **Persistito** (metadati/conteggi/costi/esito, §10), **senza** contenuti. |
| Prompt costruito, risposta grezza del provider, testo risposte studente inviato | **Transitori**: vivono solo nell'esecuzione della Function, **non** salvati, **non** loggati. |
| Stima costo/preflight | **Transitoria** (UI); solo i conteggi/costi finali finiscono nell'audit. |
| Stato correzione | Invariato: resta `in_progress` fino ad azione umana esplicita. |

---

## 14. Strategia provider-agnostic

- Il **dominio applicativo non conosce il provider.** Il gateway espone un'interfaccia interna `AiGrader` con un metodo «valuta aperte (input chiuso) → output strutturato validato». Le implementazioni (mock, provider reale) sono intercambiabili dietro quell'interfaccia.
- **Provider e modello** provengono da **configurazione server** (env/Secret/feature flag), **mai** hard-coded nel dominio, **mai** scelti dal client.
- **Output strutturato** con schema rigido lato nostro: se il provider offre structured output nativo lo si usa, altrimenti si valida comunque contro lo schema (§7–§8). La validazione dei punteggi (§8) è **indipendente dal provider**.
- **M5-01 introduce un provider mock** (deterministico, 0 costo) per sviluppare e testare tutto il flusso senza provider reale; il provider reale entra solo in **M5-05** su DEV.
- **Nessun default di modello viene fissato qui.** La scelta di provider+modello è un **Human Gate** (§15): va confermata verificando **disponibilità e costo attuali sulla documentazione ufficiale del provider** al momento della scelta, senza adottare come default un modello potenzialmente obsoleto.

---

## 15. Human Gate — decisioni approvate, attivazione ancora chiusa

Questi punti non erano decisi in M5-00. Il docente li ha approvati il **17 luglio 2026**; l'evidenza autoritativa è [evidenze/hg-m5-human-gate.md](evidenze/hg-m5-human-gate.md). L'approvazione decisionale non attiva il provider e non supera G7.

| # | Decisione | Nota |
|---|---|---|
| HG-M5-1 | **APPROVATO — provider e modello** | OpenAI Responses API, Structured Outputs, snapshot pinned `gpt-5.4-nano-2026-03-17`; alias mobile vietato. |
| HG-M5-2 | **APPROVATO — budget per operazione** | Hard ceiling 250.000 micro-USD applicato a `costReservationMicroUsd`, comprensivo dei tentativi. |
| HG-M5-3 | **APPROVATO — budget giornaliero/mensile** | Hard ceiling 1.000.000 micro-USD/giorno UTC e 5.000.000 micro-USD/mese UTC. |
| HG-M5-4 | **APPROVATO — retention** | `expireAt` server-generated a 30 giorni; policy TTL reale rinviata a M5-05E-2. |

Restano aperti l'attivazione operativa, Secret Manager, TTL reale, smoke DEV e Gate G7. Gli altri ceiling tecnici DEV (§12) restano non aumentabili dalla configurazione.

---

## 16. Roadmap implementativa minimale (M5-00 → M5-05)

| Pacchetto | Scope | Dipende da |
|---|---|---|
| **M5-00** *(questo doc)* | Contratto tecnico, UX batch, sicurezza, privacy, cost model. **Solo documentazione.** | M4 completato (Gate G6) |
| **M5-01** ✅ | Le due Cloud Function v2 `onCall` **`aiCorrectionPreview`**/**`aiCorrectionRun`** (scale-to-zero), **feature flag** globale `disabled\|mock` (default `disabled`, risolto solo server-side), interfaccia **provider-agnostic** `AiGrader` + **`MockAiGrader`** deterministico. **Solo mock**: nessun provider reale, nessuna API key, **nessuna chiamata esterna**, **zero token**, **nessuna scrittura Firestore** (`aiCorrectionRun` restituisce `written: false`). Autorizzazione owner riusando il pattern del Repository Gateway; validazione input rigorosa (solo ID, no duplicati/malformati, limite prudente consegne); codici errore stabili e non sensibili. Nessuna UI. Codice: `functions/src/aiCorrectionGatewayCore.ts` (+ test), `functions/src/aiCorrectionGateway.ts`. | M5-00 |
| **M5-02** ✅ | Motore server-side completo (solo mock): preflight reale (rilettura server-side di verifica/teacherSnapshot/submission/correction, eleggibilità, conteggi, stima token deterministica, **nessuna scrittura, nessun grader**); scoring **deterministico** delle chiuse (incl. **sole chiuse**); **IA** per le aperte via **`MockAiGrader`** (una chiamata per consegna) con validazione output/punteggi; scrittura atomica per consegna nel contratto M4 (evaluations/totali/mirror `correctionSummary`, mai sovrascrittura, semantica evento su riapertura); idempotenza + `aiCorrectionRuns/{requestId}` (solo metadata). **Senza UI.** **Nessuna** chiamata esterna, **zero token**, **costo 0**. Codice: `functions/src/aiCorrectionEngine.ts` (+ test), wiring in `aiCorrectionGateway.ts`. | M5-01 |
| **M5-03** ✅ | **UI batch:** checkbox per riga (selezione stabile per id), **toolbar** con l'unico pulsante «Correggi con IA», **dialog di conferma** con conteggi/esclusioni+motivo/stima token/costo e banner «Modalità mock — costo reale 0», **risultato finale** (riuscite/parziali/escluse/fallite, `tokensActual`/`costActual` 0). Colonna **«Valutate»** `n/totale` al posto di «Punteggio». Payload **chiuso** (solo i tre ID). Sviluppato e testato **con il mock**. Codice: `apps/web/src/features/repository/corrections/aiCorrectionClient.ts` + `correctionProgressService.ts`, `apps/web/src/features/teacher/AiBatchCorrectionDialog.tsx`, wiring in `VerificationsView.tsx`. | M5-02 |
| **M5-04** ✅ | **Azioni massive** Completa / Riapri / Restituisci sulle sole righe selezionate ed eleggibili, con **riepilogo di conferma** (selezionate/eleggibili/escluse+motivo/conseguenza) e **risultato** (riuscite/escluse/fallite, successo parziale visibile). Riuso **esclusivo** dei service M4 (`completeCorrection`/`reopenCorrection`/`returnCorrection`), invocati una volta per consegna con **concorrenza limitata a 3**; un errore per-riga non blocca le altre. Eleggibilità calcolata dalla **stessa** lettura owner-only di M5-03 (nessuna lettura per riga). Dopo il batch: **una sola** rilettura mirata; la **selezione è persistente** (M5-04A: non si deseleziona nulla, per poter concatenare azioni sullo stesso gruppo). Codice: `apps/web/src/features/repository/corrections/batchCorrectionActions.ts` (+ `correctionProgressService.ts` esteso), `apps/web/src/features/teacher/BatchCorrectionActionsDialog.tsx`, wiring in `VerificationsView.tsx`. Rifinitura UX **M5-04A** (spaziatura dialog, icone/dimensioni toolbar, selezione persistente). | M5-03 |
| **M5-04B** ✅ | **Feedback generale** della consegna durante la correzione IA: `AiGraderOutput.generalFeedback` prodotto nella **stessa** chiamata delle aperte (mai una seconda); motivazione + consiglio (o complimento se massimo), tono professionale, nessun dato personale, **≤ 700 caratteri**; scritto nel campo **`generalFeedback` esistente** della `CorrectionDoc` **solo** se la consegna è interamente valutata e il docente non ne ha già uno (mai sovrascritto), nella stessa transazione (nessuna lettura/scrittura in più). Sole chiuse → feedback deterministico senza grader. `tokensActual`/`costActual` restano 0; testo mai in `aiCorrectionRuns`. Codice: `functions/src/aiCorrectionGatewayCore.ts` (contratto + `buildMockGeneralFeedback`/`validateGeneralFeedback` + `MockAiGrader`), `aiCorrectionEngine.ts`, `aiCorrectionGateway.ts`. | M5-04 |
| **M5-04C** ✅ | **Scoring chiuse deterministico corretto + «Azzera correzione».** (A) chiusa_singola: normalizzazione soluzione **canonica** `["id"]` + legacy `"id"`; soluzione malformata → **non valutabile** (mai zero ingiusto). (B) chiusa_multipla: **punteggio parziale** equo (reward/penalty, clamp 0..max, multiplo 0,25), opzioni dal `teacherSnapshot`. (C) **feedback deterministico** per le chiuse (solo conteggi, mai ID/soluzioni), a **0 grader/token/costo**; il feedback generale usa i totali finali con i parziali. (D) azione docente **«Azzera correzione»** (icona gomma per riga): `clearCorrection()` atomico che azzera punti+feedback e `generalFeedback`, ricalcola i totali, aggiorna il mirror, resta `in_progress`, scrive un evento `correctionCleared` (metadata); **no-op** se non c'è nulla; rifiuta completed/returned; nessuna migrazione degli zeri già persistiti. Codice: `functions/src/aiCorrectionEngine.ts`+`aiCorrectionGateway.ts`; `apps/web/.../correctionsService.ts`+`correctionProgressService.ts`+`ClearCorrectionDialog.tsx`, Rules `correctionCleared`. | M5-04B |
| **M5-05** | **Provider reale su DEV**, smoke test, verifica audit/costi/sicurezza, **Gate G7** (IA assistita). **Prerequisiti bloccanti:** provider/modello, chiave in Secret Manager e budget reali. | M5-04C, **HG-M5-1/2/3/4 (bloccanti qui)** |

> **M5-01→M5-04C si sviluppano e testano interamente con il provider mock deterministico**, senza provider/modello reale, senza chiave reale e **senza alcuna chiamata esterna**. Provider, modello, Secret Manager e budget reali diventano **bloccanti solo prima di M5-05** (HG-M5-1/2/3/4). La Function in **modalità mock** deve essere **impossibile da confondere** con il provider reale (config esplicita, nessun fallback silenzioso al provider reale).
>
> **Gate G8** e la **correzione automatica** restano **fuori** da questa linea.

### 16.1 Stato M5-01 (implementato) — cosa resta a M5-02

**Consegnato da M5-01** (`functions/src/`): le due Function `onCall` `aiCorrectionPreview`/`aiCorrectionRun` scale-to-zero; feature flag `AiFeatureMode` `disabled|mock` risolto solo da `AI_CORRECTION_MODE` server-side (default `disabled`, nessun fallback implicito verso un provider reale, che non esiste ancora nel codice); autorizzazione **owner-only** (uid dal token Firebase, owner da `settings/owner`); validazione rigorosa dell'input (solo `verificationId`/`submissionIds`/`requestId`, id ben formati e appartenenti alla verifica, no duplicati, limite prudente `MAX_SUBMISSIONS_PER_OPERATION`); interfaccia provider-agnostic `AiGrader` con `MockAiGrader` **deterministico** (marcato `id: 'mock'`, nessuna rete/tool, punteggi quarto di punto in `[0, maxPoints]`); codici errore stabili (`unauthenticated`/`not_owner`/`feature_disabled`/`invalid_input`/`batch_limit_exceeded`) mappati a `HttpsError`, log non sensibili. `aiCorrectionRun` **non scrive** e ritorna `written: false`. **Zero token, nessuna chiamata esterna.**

### 16.2 Stato M5-02 (implementato) — cosa resta a M5-03

**Consegnato da M5-02** (`functions/src/aiCorrectionEngine.ts` + wiring): il motore server-side completo, **solo con `MockAiGrader`**.
- **Preflight reale** (`runPreview`): rilegge server-side verifica + `teacherSnapshot` (domande e soluzioni congelate) + submission + eventuali correction; classifica ogni consegna come **elaborabile** o **esclusa** con codice sintetico (`not_found`/`wrong_owner`/`wrong_verification`/`not_submitted`/`snapshot_unavailable`/`correction_not_in_progress`/`nothing_to_grade`/`too_large`); conta selezionate/elaborabili/escluse/chiuse/aperte/sole-chiuse/già-valutate; stima **token deterministica** delle sole aperte; **nessuna scrittura**, **nessuna** invocazione del grader, **costo 0**.
- **Scoring chiuse** (`scoreClosedQuestion`): tutto-o-niente (singola esatta → `maxPoints`; multipla insiemistica esatta → `maxPoints`; altrimenti `0`), **zero grader**.
- **Aperte**: una sola `grader.grade()` per consegna con tutte le aperte eleggibili; **validazione server-side** rigorosa (`validateGraderOutput`): `requestId`, order esistente/non duplicato/non estraneo, `points` finito, `0..maxPoints`, multiplo di 0,25, feedback entro limite. Output invalido → domanda resta `points: null`, correzione mai corrotta.
- **Scrittura** (`commitSubmission`, transazione atomica per consegna): crea la correction `in_progress` se assente oppure fa merge **non distruttivo** (mai sovrascrivere `points !== null`); aggiorna totali derivati e il mirror `submissions/{id}.correctionSummary`/`correctionStatus`; su correction **riaperta** (`reopenCount > 0`) scrive l'evento `scoreAdjusted` con delta minimale, esattamente come M4. Un errore su una consegna non annulla le altre; concorrenza limitata (`SUBMISSION_CONCURRENCY`).
- **Idempotenza concorrente con lease** (`aiCorrectionRuns/{requestId}`): l'esecuzione acquisisce, in transazione, una **lease temporale** (`executionId` + `leaseExpiresAt`) sul run doc. Un run già `completed`/`partial`/`failed` → **replay** del risultato salvato (`idempotentReplay: true`); un run `running` con **lease valida** posseduta da un altro `executionId` → il chiamante **non** invoca grader né scrive (risposta `running`, `idempotentReplay: true`); una **lease scaduta** (crash/timeout) può essere **presa in carico** da un nuovo tentativo; `finishRun` scrive **solo se** l'`executionId` è ancora il proprietario della lease, così un worker vecchio **non** può sovrascrivere il risultato del tentativo successivo. Lo **stesso `requestId` con selezione diversa** (selectionHash) è **rifiutato** (`invalid_input`); un retry non duplica valutazioni (merge non distruttivo). Stati: `running`/`completed`/`partial`/`failed`.
- **Token e costo** (mock): `tokensEstimated` è **deterministico** e include **domanda + soluzione di riferimento + risposta dello studente** + overhead per domanda, con la **stessa** formula in preview e run. `tokensActual` proviene dall'**usage reale** riportato dal provider (`AiGraderOutput.usage`) e in modalità **mock è sempre `0`** (nessun token reale consumato). `costEstimated`/`costActual` restano **0** col mock. Il contratto è già predisposto perché un provider reale (M5-05) riporti l'usage effettivo, senza implementarlo ora.
- **`aiCorrectionRun`** ripete **tutte** le verifiche del preview (nessuna autorizzazione persistente): dati cambiati dal preview → consegna esclusa (`changed_since_preview`). **Nessun** completamento/restituzione automatici. **Zero token reali, nessuna chiamata esterna.**

**Forma corrente di `aiCorrectionRuns/{requestId}` (M5-05D2A + E-1).** Contratto v2 **server-only e privacy-minimal**: nessun `submissionId`, `verificationId`, UID o testo. Conserva soltanto versione, stato, SHA-256 della selezione canonica, numero/conteggi aggregati, provider/modello/versioni tecniche applicabili, token/costo, lease, timestamp, `expireAt` e risultati `{ ordinal, status, reasonCode? }`. La Function ricostruisce gli ID soltanto nella response live/replay dalla selezione corrente validata. HG-M5-4 ha confermato la retention a 30 giorni; nessuna eliminazione avviene finché M5-05E-2 non configura e deploya la policy TTL.

**Resta a M5-05D (non implementato):** configurazione/attivazione reale su DEV, benchmark effettivo, budget/hard stop e Gate G7 (HG-M5-1/2/3/4 bloccanti). **M5 non è completo.**

### 16.3 Stato M5-03 (implementato)

**Consegnato da M5-03** (`apps/web/src/`): la **UI batch** che consuma **esclusivamente** il gateway mock M5-01/M5-02.
- **Client callable tipizzato** (`aiCorrectionClient.ts`): wrapper `httpsCallable` su `aiCorrectionPreview`/`aiCorrectionRun`; `buildRequest` costruisce il **payload chiuso** (solo `verificationId`/`submissionIds`/`requestId`, mai testi/risposte/soluzioni/nomi/email); `newRequestId` client-side; etichette leggibili e messaggi d'errore **senza dettagli sensibili**.
- **Tabella «Consegne online»**: checkbox per riga con **selezione stabile per id** (invariata durante sorting e update del listener); checkbox «seleziona tutte» sulle sole righe eleggibili; colonna **«Valutate»** `n/totale` (da una **singola lettura mirata** delle `corrections`, `correctionProgressService.ts` — owner-only, nessun listener/polling) al posto di «Punteggio»; percentuale separata. **Nessun** pulsante IA per riga.
- **Toolbar**: unico pulsante «Correggi con IA» sopra la tabella, disabilitato senza selezione o durante un'operazione.
- **Dialog** (`AiBatchCorrectionDialog.tsx`): al montaggio chiama `preview` (nessuna scrittura); mostra selezionate/elaborabili/escluse+motivo/chiuse/aperte/sole-chiuse/già-valutate/token stimati/costo stimato e il banner **«Modalità mock — costo reale 0»**; alla conferma chiama `run` con lo **stesso** `requestId` (guardia anti doppio-invio); gestisce `running` (già in corso), `completed`, `partial`, `failed`, `idempotentReplay`; risultato con riuscite/parziali/escluse/fallite + motivo sintetico per consegna + `tokensEstimated`/`tokensActual` (0) + `costActual` (0). Riuso di `DialogShell` (focus trap/Escape/focus restore/busy).
- **Aggiornamento post-run minimale**: stato/percentuale arrivano già dal listener del monitor (mirror `correctionSummary`); «Valutate» si aggiorna con una **singola rilettura mirata**. Nessun reload/polling/listener aggiuntivo. Le correzioni restano `in_progress`.

### 16.4 Stato M5-04 (implementato) — cosa resta a M5-05

**Consegnato da M5-04** (`apps/web/src/`): le **azioni massive** sulle correzioni selezionate, che **riusano** i service M4 senza duplicarne la logica.
- **Toolbar**: tre pulsanti — **Completa**, **Riapri**, **Restituisci** — accanto a «Correggi con IA», sopra la tabella. Operano sulle righe selezionate; disabilitati senza selezione o mentre un'operazione (IA o massiva) è in corso. **Nessun** pulsante sulle singole righe.
- **Eleggibilità** (`batchCorrectionActions.ts`, funzioni pure `classifyRow`/`computeEligibility`), calcolata dalla **stessa** lettura owner-only di M5-03 (`correctionProgressService.ts` esteso con `status`/totali): **Completa** solo `in_progress` con **tutte** le domande valutate; **Riapri** solo `completed`/`returned`; **Restituisci** solo `completed`. Le altre righe sono **escluse** con motivo leggibile. La validazione **definitiva** resta ai service M4 (gli errori diventano esiti per-riga).
- **Dialog di conferma** (`BatchCorrectionActionsDialog.tsx`, riuso di `DialogShell`): azione, selezionate, eleggibili, escluse+motivo, **conseguenza** dell'azione (Restituisci → subito visibile allo studente, soluzioni nascoste; Riapri → una restituzione viene temporaneamente nascosta), Annulla + conferma esplicita, `busy`, guardia anti doppio-click. Se **zero eleggibili**: nessun service invocato, messaggio chiaro.
- **Esecuzione** (`runBatchCorrectionAction`): il service M4 corretto una volta per consegna eleggibile, con **concorrenza limitata a 3** (`mapWithConcurrency`, mai `Promise.all` senza limite); un errore per-riga non blocca le altre; nessun retry automatico.
- **Risultato**: riuscite/escluse/fallite con motivo sintetico per ogni fallimento; **successo parziale visibile**. Dopo il batch: **una sola** rilettura mirata (aggiorna «Valutate»/stato/percentuale).
- **Selezione persistente (M5-04A)**: dopo «Correggi con IA», Completa, Riapri o Restituisci la selezione resta **invariata** — non si deseleziona né le riuscite né le fallite; cambia **solo** manualmente dal docente (la rilettura finale aggiorna stato/«Valutate»/percentuale senza toccare `selectedSubmissionIds`; ordinamento e refresh non perdono la selezione). Un ID non più presente nel dataset può essere rimosso come normale pulizia. **Motivazione UX**: permette di concatenare sullo stesso gruppo **Correggi con IA → Completa → Restituisci**.
- **Rifinitura UX (M5-04A)**: riga azioni condivisa nei dialog (`.dialog-actions`: gap coerente, pulsanti mai attaccati, responsive full-width sotto breakpoint stretto); toolbar batch con **icone coerenti** (`IconSparkles`/`IconCircleCheck`/`IconRotateCcw`/`IconSend`, dal set interno `components/icons.tsx`, nessuna libreria) e **dimensioni uniformi** su griglia responsive 4 → 2 → 1 colonne.
- **Invarianti**: nessuna modifica alle `evaluations`; nessuna restituzione automatica dopo «Correggi con IA»; nessuna nuova Cloud Function; nessuna modifica ad `aiCorrectionPreview`/`aiCorrectionRun`; **nessuna** modifica alle Security Rules (i service M4 scrivono già entro le Rules esistenti); nessun listener/polling; nessuna lettura/scrittura Firestore aggiuntiva; nessun provider reale o chiamata esterna.

**Resta a M5-05D** (non implementato): attivazione reale su DEV, secret valorizzato, benchmark, budget, smoke, audit/costi entro soglie e **Gate G7**. **M5 non è completo.**

### 16.5 Stato M5-04B (implementato) — feedback generale della consegna

**Consegnato da M5-04B** (`functions/src/`): la generazione del **feedback generale** durante la correzione IA, minimale e provider-agnostic (solo mock).
- **Contratto** (`aiCorrectionGatewayCore.ts`): `AiGraderOutput.generalFeedback?: string` (motivazione + consiglio, o complimento se massimo; ≤ 700 caratteri, nessun dato personale) prodotto **nella stessa** chiamata delle aperte; `AiGraderInput.submissionContext { priorPoints, totalMaxPoints }` per calcolare i **totali finali** senza una seconda chiamata. `buildMockGeneralFeedback` (deterministico, `[mock]`) e `validateGeneralFeedback` (stringa non vuota ≤ 700).
- **Motore** (`aiCorrectionEngine.ts`): passa `submissionContext` (già-valutate + chiuse) al grader; per **sole chiuse** costruisce il feedback deterministico senza chiamare il grader (**0 token, 0 costo**, nessuna quota aggiunta); `tokensEstimated` aggiunge la quota per il feedback (⌈700/4⌉) **solo** per le consegne con domande aperte, identica in preview e run; `tokensActual`/`costActual` restano **0**.
- **Validazione atomica** (M5-04B): con domande aperte il feedback generale è **richiesto**. Se l'output è assente/non stringa/vuoto/> 700, l'**intero** output del grader per quella consegna è invalido → **nessun** punteggio, **nessun** feedback, **nessun** `commitSubmission` (consegna `failed`, nessuna scrittura parziale); le altre consegne proseguono e le valutazioni già presenti del docente restano intatte.
- **Scrittura** (`aiCorrectionGateway.ts`): applica il feedback al campo `generalFeedback` **esistente** della `CorrectionDoc`, nella **stessa** transazione delle valutazioni, **solo** se la consegna è ora interamente valutata **e** il testo docente è vuoto (mai sovrascritto). Nessuna lettura/scrittura Firestore aggiuntiva, nessuna nuova struttura.
- **UI**: nessun pannello/colonna/campo nuovo — il testo compare nel campo **«Feedback generale»** già esistente del workspace M4, completamente modificabile dal docente; il flusso di restituzione allo studente è invariato.
- **Privacy**: il testo del feedback **non** è mai scritto in `aiCorrectionRuns` (solo metadata).
- **Invarianti**: nessuna nuova Cloud Function, nessuna nuova chiamata IA (una sola per consegna), nessuna modifica a Rules/indici/schema, nessuna nuova dipendenza, nessun provider reale.

**Resta a M5-05D** (non implementato): attivazione reale su DEV, secret valorizzato, benchmark, budget e Gate G7. **M5 non è completo.**

### 16.6 Stato M5-04C (implementato) — scoring chiuse + «Azzera correzione»

**Root cause chiusa singola.** Il contratto canonico salva la soluzione come **array** `["id"]`; il motore la trattava come stringa e assegnava sempre 0. Ora `normalizeSingleSolution` accetta il **canonico** `["id"]` e il **legacy** `"id"`; soluzione assente/vuota/multi-elemento/malformata → **non valutabile** (mai zero ingiusto), la domanda resta `points: null`.

**Chiusa multipla — punteggio parziale.** Con `correctIds`/`optionIds` dal `teacherSnapshot`: `reward = correctSelected/correctTotal`, `penalty = wrongTotal>0 ? wrongSelected/wrongTotal : 0`, `raw = clamp(reward − penalty, 0, 1)`, `points = round₀.₂₅(maxPoints·raw)`, clampato `0..max`. Ordine/duplicati irrilevanti; ID sconosciuti = selezioni errate; soluzione/opzioni incoerenti → non valutabile. Esempio (3 corrette, 2 errate, max 6): 2/0→4, 3/0→6, 2/1→1, tutte→0, nessuna→0.

**Feedback deterministico chiuse.** Singola: «Risposta corretta./non corretta./non fornita.». Multipla: «N risposte corrette su M; K selezioni errate.» oppure «Tutte le risposte corrette sono state selezionate.»/«Risposta non fornita.». **Solo conteggi**, mai ID o testi di soluzione; **0 grader/token/costo**; scritto insieme ai punti. Il feedback generale (M5-04B) usa i **totali finali** inclusi i parziali delle multiple.

**«Azzera correzione».** `clearCorrection()` (transazione): verifica esistenza + `in_progress`; azzera tutti i `points` a `null`, rimuove i feedback per domanda e `generalFeedback`, ricalcola `totalPoints/maxPoints/percentage` con l'helper canonico, aggiorna il mirror `correctionSummary`/`correctionStatus` di submission e receipt, **mantiene** `status: 'in_progress'`; scrive **un solo** evento `correctionCleared` (metadata). Preserva consegna/answers/receipt/attentionEvents/`CorrectionReturnDoc`; non cancella documenti; non riapre. **No-op** leggibile se non c'è nulla da azzerare; rifiuta senza scritture parziali se lo stato è cambiato. UI: pulsante icona **gomma** per riga (visibile solo su correzione `in_progress` con contenuto), `DialogShell` di conferma con azione **distruttiva rossa**, guardia anti doppio-click, selezione della riga preservata (IA subito rilanciabile). **Nessuna migrazione** degli zeri già persistiti (`points !== null` resta «valutato»).

**Invarianti M5-04C:** nessun cambiamento al provider (solo mock), nessuna nuova dipendenza, nessuna modifica a indici/schema; la sola modifica alle Rules è il nuovo evento `correctionCleared` (append-only, owner-only, `in_progress → in_progress`, timestamp server). Nessuna modifica alla consegna dello studente né al modello di visibilità.

**Resta a M5-05D** (non implementato): attivazione reale su DEV, secret valorizzato, benchmark, budget e Gate G7. **M5 non è completo.**

---

### 16.7 Stato M5-05C (implementato) — adapter OpenAI e benchmark harness disabilitati

- `OpenAiGrader` implementa `AiGrader` usando l'SDK Node/TypeScript ufficiale e la Responses API con Structured Outputs (`text.format`, JSON Schema strict). Costruzione del payload, trasporto e validazione applicativa restano separati; il transport è iniettato nei test.
- Modalità server-side esplicite: `disabled|mock|openai`, con default `disabled` e nessun fallback silenzioso. `openai` richiede modello esplicito e secret disponibile; configurazione incompleta produce `provider_config_invalid` prima di run metadata, scritture o chiamate provider.
- Il binding Functions v2 `OPENAI_API_KEY` è associato soltanto ad `aiCorrectionRun`. Questa fase **non crea né valorizza il secret**, non configura un modello, non abilita `openai` e non esegue deploy.
- Una richiesta contiene tutte e sole le aperte eleggibili della consegna. Sono esclusi nomi, email, UID, classe, corso/lezione completa e domande chiuse; il feedback generale resta nella stessa risposta.
- Timeout massimo 60 secondi per tentativo; retry SDK disattivati; al massimo un retry applicativo per errori transitori. Output OpenAI incompleto, malformato o fuori range è rifiutato prima di merge e scrittura; anche le chiuse calcolate in memoria non vengono persistite in quella consegna.
- `m5BenchmarkHarness.ts` legge il dataset sintetico M5, usa i raggruppamenti `benchmarkSubmissions`, accetta un `AiGrader` iniettato e produce un report in memoria con punteggi, feedback, latenza, usage e flag di output invalido. Non promuove modelli e non modifica gli intervalli attesi.

**Stato operativo:** provider reale disabilitato, nessuna API key, nessuna chiamata reale, nessun costo e nessun deploy. Human Gate M5-05 e Gate G7 restano aperti; attivazione DEV, benchmark reale, budget/hard stop e decisione finale appartengono a M5-05D.

### 16.8 Stato M5-05D1 (implementato) — guardrail server-side, provider reale ancora non attivabile

Prima parte di M5-05D: i **guardrail server-side obbligatori** che devono precedere qualsiasi attivazione del provider reale. Il provider **resta disabilitato**; nessuna API key è letta, nessuna chiamata reale è eseguita, nessun deploy. Mock e modalità `disabled` sono **invariati** e restano deterministici a costo zero; le domande chiuse restano a 0 token/costo.

**Wired (attivo a runtime, testato senza rete/emulatore):**

- **Configurazione runtime `settings/aiConfig`** (`aiCorrectionRuntimeConfig.ts`): parsing **fail-closed** (`enabled`, `provider: 'openai'`, `model`, `environment: 'dev'`, `limits`, `budget.monthlyUsd`, `configVersion`, `priceListVersion`). Documento assente, incompleto, invalido o con coppia `model`/`priceListVersion` sconosciuta ⇒ provider reale **disabilitato**. `settings/aiConfig.model` è l'unica fonte del modello; `OPENAI_MODEL` non viene usata. La config è letta solo server-side con una `get` puntuale, nessun listener/polling, mai esposta al client.
- **Kill switch senza deploy e ordine fail-closed**: sul percorso `openai` l'ordine è **auth/owner → config runtime → kill switch → classificazione/limiti → lettura secret e costruzione grader → lease/scritture**. Config non abilitata ⇒ `feature_disabled` prima di leggere `OPENAI_API_KEY`, costruire transport/provider, classificare, acquisire lease o scrivere. La preview applica lo stesso ordine e non consulta environment per il modello.
- **Hard ceiling DEV** (`aiCorrectionLimits.ts` e parser config): Firestore può impostare valori uguali o più restrittivi, mai superiori a 30 consegne/operazione, 20 aperte/consegna, 10 000 token stimati/consegna, 300 000 token stimati/operazione, concorrenza 3, timeout 60 000 ms, retry 1 e budget mensile 5 USD. I primi quattro limiti sono applicati nel preflight; superamento ⇒ `limit_exceeded`.

**Preparato e testato (moduli puri, non ancora collegati al runtime):**

- **Listino prezzi versionato + costi** (`aiCorrectionCost.ts`): il listino production contiene solo lo snapshot immutabile verificato `gpt-5-nano-2025-08-07` ($0,05/M input, $0,40/M output), fonte ufficiale [OpenAI GPT-5 nano](https://developers.openai.com/api/docs/models/gpt-5-nano), verifica 2026-07-16. Il lookup è usato esclusivamente per validare la coppia modello/listino; calcolo costi, prenotazioni e riconciliazione restano puri/non wired.
- **Ledger di budget mensile** (`aiCorrectionBudget.ts`): prenotazione atomica per `requestId`, riconciliazione idempotente che libera l'eccedenza, recovery via scadenza (nessun job esterno), hard stop al 100%, stati 50/80/100.

**Letture reali sul percorso `openai` (oltre alla lettura owner di autenticazione):** preview = 1 config + 1 verifica + 1 submission e 1 correction per ID selezionato. Run = lo stesso preflight (1 config + 1 verifica + 2 letture per ID), riusato dopo la lease senza rileggere verifica/submission/correction; `beginRun` legge il run doc una volta, ogni `commitSubmission` rilegge transazionalmente la correction elaborata per proteggere dalle race e `finishRun` rilegge il run doc una volta. Rispetto al run precedente, D1 aggiunge la sola lettura config; mock non aggiunge letture. Nessun nuovo indice o schema client.

### 16.9 Stato M5-05D2A — privacy e ciclo di vita dei run

- Nuovi `aiCorrectionRuns` nel contratto v2 privacy-minimal: nessun ID di consegna/verifica, UID o contenuto; soltanto metadata aggregati, lease e risultati ordinali.
- Selezione canonica server-side e SHA-256; replay ricostruito dalla selezione corrente, conflitto su insieme differente. Run legacy non ricostruibili ⇒ nuovo `requestId`, senza migrazione o dual write.
- `expireAt` server-generated a 30 giorni DEV tramite clock iniettato. È un valore tecnico provvisorio: HG-M5-4 resta aperto e nessuna TTL policy è configurata/deployata.
- Rules esplicite server-only per `aiCorrectionRuns`, `settings/aiConfig` e `aiBudgetLedger`; nessuna autorizzazione client ampliata.

**Resta a M5-05D2B-2 (non implementato):** retry controllato con backoff/jitter e `Retry-After`. Restano inoltre benchmark reale, TTL policy effettiva, **Human Gate HG-M5-1/2/3/4 e Gate G7**. **Il provider reale è disabilitato e M5 non è completo.**

### 16.10 Stato M5-05D2B-1 (implementato) — costo e budget mensile collegati al runtime

Collega **realmente** al runtime i moduli puri di costo e budget introdotti da M5-05D1, **senza** attivare il provider reale, chiamate OpenAI, secret, TTL policy o deploy, e conservando integralmente il contratto privacy-minimal v2 di M5-05D2A.

- **Calcolo costi versionato.** Stima e costo effettivo distinguono `inputTokens*/outputTokens*/totalTokens*` e `costEstimatedMicroUsd`/`costActualMicroUsd`, in **micro-USD interi** (nessun float sui confronti di budget). La stima usa `ceil` (conservativa), l'effettivo `nearest`; entrambi da `model` + `priceListVersion` validati e dal listino versionato. Mock e sole-chiuse restano **0 token / 0 costo**. L'usage effettivo è validato (interi non negativi, coerenza del totale): se il provider non lo espone chiaramente non si inventa alcun consumo. Un output rifiutato che portava usage **già fatturabile** viene comunque contabilizzato, senza salvare punteggi/feedback invalidi (nuovo `AiGraderInvalidOutputError` provider-agnostico che trasporta l'usage).
- **Stima informativa vs. tetto di prenotazione (due valori distinti).** `costEstimatedMicroUsd` è la **stima informativa** mostrata all'utente, basata sul contenuto didattico (realistica). `costReservationMicroUsd` è il **tetto conservativo realmente prenotato** sul ledger: per **ogni** chiamata provider somma il **massimo output ammesso** dal grader (`maxOutputTokensPerCall`, hard cap imposto al provider) e un **upper bound provabile dell'input** dell'**esatto** payload (`reservationInputTokenUpperBound`, **byte UTF-8** della richiesta serializzata: il tokenizer BPE è byte-level, quindi input fatturato ≤ byte del payload — prudente su tutto Unicode, `String.length` UTF-16 sottostimerebbe emoji/CJK/combinati). Poiché output effettivo ≤ max e input effettivo ≤ bound, vale **sempre** `costActualMicroUsd ≤ costReservationMicroUsd` per ogni risposta valida entro i limiti consentiti (invariante testata). Preview e run restano coerenti sulla **stima**; il ledger prenota il **tetto**.
- **Preview.** Restituisce la stima tipizzata con lo **stesso** contratto del run (coincide a parità di selezione/config); **non** prenota budget, **non** scrive il ledger, **non** costruisce/chiama il provider e non dichiara un costo effettivo.
- **Fail-closed se il ledger non è disponibile.** Sul percorso reale con lavoro aperto, le porte `reserveBudget`/`markBudgetInvoked`/`reconcileBudget` **e** i bounds di costo del grader sono **obbligatori**: se manca anche solo uno, si fallisce con `budget_unavailable` **prima** di costruire/chiamare il provider — nessuna correzione scritta, nessun falso successo, nessuna spesa non tracciata (mai fail-open).
- **Ledger mensile atomico** (`aiBudgetLedger/{YYYY-MM}`, chiave UTC deterministica, server-only). La prenotazione avviene **atomicamente prima** della chiamata provider, è idempotente su `requestId` (retry/replay/concorrenza non raddoppiano), rifiuta `budget_exceeded` prima di qualsiasi chiamata, ha **hard stop al 100%**. Due esecuzioni concorrenti non superano insieme il budget (transazione su singolo documento). La **riconciliazione** libera l'eccedenza e addebita l'effettivo (≤ tetto), è idempotente e gestisce completed/partial/failed; verifica prima la titolarità della lease (`executionId`): un worker vecchio dopo un takeover non riconcilia né finalizza la prenotazione del nuovo worker.
- **Macchina a stati crash-safe della prenotazione.** Ogni prenotazione ha uno `status`: `reserved` (provider non ancora invocato) o `pending` (provider potenzialmente invocato). La transizione `reserved → pending` avviene in una transazione **subito prima** della prima chiamata provider, gated dalla lease. Recupero via scadenza (nessuno scheduler): una `reserved` scaduta è **rilasciata** (mai arrivata al provider → nessun costo, recuperabile); una `pending` scaduta è **addebitata al tetto** (crash dopo il provider: in dubbio si **sovrastima**, mai si sottocontabilizza — la spesa non sparisce mai dal ledger). Un retry/takeover con lo stesso `requestId` completa la riconciliazione senza doppio addebito idempotente.
- **Ordine sicuro del run:** auth/owner → config/kill switch → preflight/eleggibilità/limiti → stima → lease → **prenotazione** (`reserved`) → **markBudgetInvoked** (`reserved → pending`, gated) → chiamata provider → commit → **riconciliazione** (gated) → finalizzazione (gated). `completed`/replay e `locked`/`conflict`/`legacy` non prenotano né chiamano il provider. Il clock di lease/prenotazione è letto al punto corretto (dopo preflight lenti). Se il `markBudgetInvoked` rileva la perdita della lease, il run non elabora.
- **`aiCorrectionRuns` v2** esteso con soli metadata aggregati (token e costo stimati/effettivi + tetto prenotato in micro-USD, versioni tecniche già ammesse); **nessun** ID/UID/PII/contenuto. Il ledger contiene solo importi tecnici e prenotazioni (`status`) per `requestId` opaco. Replay invariato.

**Human Gate.** Nessun nuovo valore di budget: si usa il solo budget mensile DEV validato dalla config (hard ceiling ≤ 5 USD/mese). Budget per-operazione e giornaliero **non** sono introdotti: restano aperti per HG-M5. HG-M5-1/2/3/4 e Gate G7 **non** sono superati; il provider reale **non è attivabile** in questa PR.

**Costi Firestore aggiunti.** Preview: **nessuna** lettura/scrittura oltre a M5-05D2A (una `get` di `settings/aiConfig` già esistente sul percorso reale; nessun accesso al ledger). Run reale con lavoro aperto: **+3 transazioni** sul **singolo** documento mensile — prenotazione (1 read + 1 write), markBudgetInvoked (run doc + ledger read, 1 write), riconciliazione (run doc + ledger read, 1 write). Operazioni mock e sole-chiuse: **nessun** accesso al ledger. Replay/`locked`/`conflict`/`budget_exceeded`/`budget_unavailable`: **nessuna** transazione di budget (o solo la reserve fallita). Nessun listener, polling, scheduler o risorsa sempre attiva: il settlement delle prenotazioni scadute avviene alla lettura successiva, dentro la stessa transazione di reserve/reconcile.

**Resta a M5-05D2B-2 (non implementato):** retry applicativo con backoff/jitter e `Retry-After`. Restano benchmark reale, TTL policy effettiva, **Human Gate HG-M5-1/2/3/4 e Gate G7**. **Il provider reale è disabilitato e M5 non è completo.**

### 16.11 Stato M5-05D2B-2 (implementato) — retry applicativo controllato del provider

Aggiunge il **retry applicativo unico** del provider OpenAI (con backoff, jitter, `Retry-After`, deadline e accounting coerente), **senza** attivare il provider reale, chiamate, secret, TTL o deploy.

- **Policy retry unica.** L'SDK OpenAI gira **sempre** con `maxRetries: 0`: l'unica policy è quella applicativa SchoolForge (`openAiRetryPolicy.ts`, pura e iniettabile). Numero di retry e timeout per tentativo vengono dalla **config runtime validata** (la config può solo **restringere** i ceiling DEV: retry ≤ 1, timeout ≤ 60 s). Massimo **un** retry ⇒ **≤ 2 tentativi** per chiamata; nessun retry di batch né seconda Function; nessuno scheduler/polling. Mock e sole-chiuse: nessun retry/provider/costo.
- **Errori ritentabili** (solo transitori): connessione, timeout di trasporto, HTTP 408/409/429/≥ 500 (allineati al comportamento ufficiale dell'SDK). **Non** ritentati: 4xx permanenti (400/401/403/404/422), config invalida, `budget_exceeded`/`budget_unavailable`, output Structured Output invalido, validazione applicativa/feedback fallita, errori Firestore, perdita lease, abort intenzionale, errore non classificabile (**fail-closed**).
- **`Retry-After`.** `OpenAiTransportError` esteso con `status`/`retryAfterMs`/`billingRisk`. Parser **puro** in millisecondi: `retry-after-ms`, `Retry-After` in secondi, `Retry-After` come HTTP-date; assente/invalido/negativo/`NaN`/`Infinity`/enorme (> 24h) ⇒ fallback al backoff. Valore valido ≤ cap ⇒ rispettato; **oltre** il cap (8 s) ⇒ **niente attesa arbitraria**: si interrompe il retry e si restituisce un errore ritentabile **manualmente**.
- **Backoff + jitter.** Policy pura centralizzata: esponenziale con **full jitter**, `random`/`sleep`/clock **iniettati** (nessun `Math.random`/timer non controllabile nei test), delay **cappato** (base 500 ms, max 4 s), finito e non negativo, `sleep` **annullabile** via `AbortSignal` senza timer pendenti. Valori bassi e prudenti (costi Function durante l'attesa, UX docente, timeout totale, rate limit).
- **Deadline complessiva e lease.** Timeout per tentativo ≤ 60 s; **deadline globale monotona** (`RUN_OVERALL_DEADLINE_MS`) controllata **prima di ogni tentativo**: nessun retry se il tempo residuo non copre `delay + tentativo`; nessun nuovo tentativo dopo la deadline (consegne non iniziate ⇒ `deadline_exceeded`, nessuna scrittura parziale). Function `aiCorrectionRun` con `timeoutSeconds = 540` **esplicito**; `RUN_LEASE_MS` portata a **9 min** così la lease copre l'intera invocazione (non scade mentre il worker titolare esegue) e resta margine (`RUN_FINALIZE_MARGIN_MS`) per riconciliazione e finalizzazione. Un worker che perde la lease non inizia altri tentativi.
- **Retry e budget.** Il tetto di prenotazione copre **tutti** i tentativi potenzialmente fatturabili: `bound × (maxRetries + 1)` (retry=0 ⇒ 1 tentativo, retry=1 ⇒ 2). La prenotazione **iniziale** copre l'intera policy: **nessuna** seconda prenotazione tra i tentativi. Budget insufficiente per il massimo numero di tentativi ⇒ rifiuto **prima** della prima chiamata provider.
- **Accounting dei tentativi.** `costActualMicroUsd` contiene **solo** l'usage realmente noto; i tentativi dal costo **incerto** (timeout/abort dopo l'invio, 5xx/408 senza usage) sono contabilizzati in `costSettledMicroUsd` in modo **prudente fino al tetto del tentativo**, mai oltre la prenotazione: `costActual ≤ costSettled ≤ costReservation`. Il ledger addebita `costSettled` (mai sottocontabilizzare, nessun doppio addebito, nessun `actual` inventato). Prima tentativo incerto + secondo riuscito ⇒ `actual` = solo usage noto, settlement = actual noto + bound del tentativo incerto.
- **Osservabilità.** `aiCorrectionRuns` estende i **soli aggregati tecnici**: `retry.attemptsTotal/retriesTotal/retryReasonCodes/retryDelayTotalMs/unknownBillingAttempts` + `costSettledMicroUsd`. **Nessun** ID/UID/PII/contenuto; log con esito aggregato/retry/durata/reason code, mai testo didattico o header/API key.
- **UX.** Nessun redesign: codici esclusione leggibili (`rate_limited`, `provider_timeout`, `provider_unavailable`, `deadline_exceeded`, `retry_after_exceeded`) mappati a messaggi neutri; selezione docente invariata dopo un errore; nessuno stack trace/response body/header esposto.

**Costi Firestore aggiunti:** invariati rispetto a M5-05D2B-1 (il retry avviene **dentro** la stessa chiamata grader: nessuna transazione ledger aggiuntiva, una sola reserve/markInvoked/reconcile per operazione). Nessun listener/polling/scheduler.

**Stato al termine di D2B-2:** restavano aperti benchmark reale, primo smoke DEV, TTL policy, HG-M5-1/2/3/4 e Gate G7. Le decisioni HG sono state poi approvate in E-1; provider reale e G7 restano disabilitati/aperti.

### 16.12 Stato M5-05E-1 (implementato) — Human Gate e guardrail di costo approvati

Il docente ha approvato il 17 luglio 2026 le decisioni **HG-M5-1/2/3/4**, formalizzate in [evidenze/hg-m5-human-gate.md](evidenze/hg-m5-human-gate.md). L’approvazione è decisionale: provider reale, Secret Manager, chiamate, costi, TTL policy e deploy restano disabilitati/non eseguiti; M5 e Gate G7 restano aperti.

- **Modello/listino:** OpenAI Responses API con Structured Outputs, snapshot pinned `gpt-5.4-nano-2026-03-17`; alias mobile vietato. Listino corrente `v2-2026-07-17-hg-m5`: input 200.000 e output 1.250.000 micro-USD/M token. Il listino v1 resta soltanto storico; la config reale accetta esclusivamente la coppia approvata.
- **Config fail-closed:** `maxOperationCostMicroUsd` ≤ 250.000, `dailyBudgetMicroUsd` ≤ 1.000.000, `monthlyBudgetMicroUsd` ≤ 5.000.000; tutti obbligatori, interi e positivi. Assenza, tipo errato, zero o superamento ceiling invalidano l’intero documento.
- **Ordine economico:** auth/owner → config/kill switch → classificazione/limiti → grader e prenotazione comprensiva dei tentativi → hard ceiling operazione → lease → reserve atomica giornaliera+mensile → pending → provider. `operation_budget_exceeded` avviene prima di lease/ledger/provider; `daily_budget_exceeded` e `budget_exceeded` prima del provider.
- **Ledger:** lo stesso `aiBudgetLedger/{YYYY-MM}` conserva `dailySpentMicroUsd` e prenotazioni con `dayKey` UTC. Spesa, reserved attive e pending concorrono al giorno; le pending scadute restano prudenzialmente contabilizzate. Reconcile usa giorno/mese originali anche oltre mezzanotte.
- **Retention:** `AI_RUN_RETENTION_DAYS = 30`; `expireAt` server-generated resta testato con clock iniettato. Nessuna cancellazione avviene senza la policy TTL reale.

**Prossimo pacchetto M5-05E-2:** Secret Manager, TTL reale, deploy DEV con kill switch spento, creazione controllata della config Firestore e primo smoke controllato. Nessuna di queste azioni è inclusa in E-1.

---

## 17. Criteri di accettazione per pacchetto

- **M5-00 (DoD):** documento presente e coerente; vecchia roadmap M5-A..E e contratti stale superati; README/INDEX/piano/api-contract/architettura/sicurezza/decisioni allineati senza dichiarare implementato ciò che non lo è; `pnpm format:check` verde. Nessuna modifica a codice/Rules/schema/dipendenze.
- **M5-01:** due Function `onCall` `aiCorrectionPreview`/`aiCorrectionRun`; nessun invio possibile senza feature flag attivo; **provider mock deterministico** sostituibile all'interfaccia `AiGrader`; **nessuna secret reale richiesta né finta**, **nessuna chiamata esterna**; modalità mock non confondibile col provider reale; gateway rifiuta chiamanti non-owner.
- **M5-02:** chiuse valutate a 0 token, **incluse le consegne con sole chiuse**; chiuse tutto-o-niente (§5.1); aperte valutate solo se `points === null`; ogni `points` scritto rispetta `0..maxPoints` e step 0,25; output non valido scartato senza corrompere la correzione; `requestId` rende il retry idempotente via `aiCorrectionRuns`; nessun contenuto in `aiCorrectionRuns`; **solo mock, nessuna chiamata esterna**.
- **M5-03:** un solo pulsante «Correggi con IA» sopra la tabella; nessun pulsante per riga; conferma con selezionate/elaborabili/escluse+motivo/aperte/chiuse/consegne-sole-chiuse/stima/modello; risultato finale con riuscite/escluse/fallite senza nascondere successi parziali; colonna «Valutate» `n/m`; testabile con mock.
- **M5-04:** Completa solo su interamente valutate e valide; Riapri solo su completed/returned; Restituisci solo su completed; ogni azione con riepilogo+risultato; nessuna restituzione automatica; testabile con mock.
- **M5-04B:** feedback generale prodotto nella **stessa** chiamata delle aperte (nessuna seconda chiamata), ≤ 700 caratteri, nessun dato personale, tono professionale; applicato al campo `generalFeedback` esistente **solo** se la consegna è interamente valutata e il docente non ne ha già uno (mai sovrascritto); sole chiuse → deterministico senza grader, **0 token/costo**; totali finali; **validazione atomica**: output del feedback invalido → intero output del grader scartato (niente punteggi/feedback/commit, consegna `failed`), nessuna scrittura parziale, le altre consegne proseguono; quota token per il feedback solo per consegne con aperte (preview = run); mock a `tokensActual`/`costActual` 0; nessun contenuto in `aiCorrectionRuns`; nessuna modifica a Rules/indici/schema.
- **M5-04C:** chiusa_singola canonica `["a"]` e legacy `"a"` → max; errata/non-fornita → 0; soluzione malformata → non valutabile (mai zero); chiusa_multipla con la formula reward/penalty (esempi 4/6/1/0/0), ordine/duplicati irrilevanti, ID sconosciuti penalizzati, sempre `0..max` e multiplo di 0,25; feedback deterministici solo-conteggi senza ID/soluzioni; **0 grader/token/costo** per le chiuse; feedback generale sui totali finali coi parziali; `clearCorrection` atomico (azzera punti+feedback+generale, ricalcola totali, mirror, `in_progress`, un solo evento `correctionCleared`, no-op se nulla, rifiuta completed/returned, nessuna scrittura parziale su race); UI gomma per riga con conferma distruttiva, selezione preservata, IA rilanciabile; Rules `correctionCleared` owner-only append-only con test mirati; nessuna migrazione degli zeri persistiti.
- **M5-05:** provider reale solo su DEV dietro flag; **prerequisiti bloccanti HG-M5-1/2/3/4 soddisfatti**; smoke su casi reali; audit/costi osservabili entro le soglie; nessun web/retrieval/tool; evidenze per **G7**.
- **M5-05C:** adapter OpenAI e harness testabili senza rete; default `disabled`; `mock` invariato; `openai` fail-closed senza modello/secret; Structured Outputs + validazione applicativa; timeout 60 s, retry massimo 1 senza moltiplicazione SDK; nessun secret creato, chiamata reale, costo, deploy o superamento di Human Gate/G7.
- **M5-05D1:** config runtime `settings/aiConfig` fail-closed e unica fonte del modello; ordine auth/owner → config/kill switch → classificazione/limiti → secret/grader → lease; hard ceiling DEV 30 consegne, 20 aperte, 10 000 token/consegna, 300 000 token/operazione, concorrenza 3, timeout 60 s, retry 1, budget 5 USD; allowlist production limitata allo snapshot verificato `gpt-5-nano-2025-08-07`; calcolo costi e ledger budget restano **puri/non wired**; mock e sole-chiuse invariati a 0 token/costo; nessun secret reale, chiamata, costo, deploy o superamento Human Gate/G7. **Provider reale non ancora attivabile.**
- **M5-05D2A:** contratto run v2 senza ID/UID/contenuti; selezione canonica + SHA-256, replay ordinale sicuro e legacy fail-safe; `expireAt` 30 giorni DEV provvisorio senza policy TTL; Rules tecniche server-only; budget/costo/retry ancora non wired; nessun provider reale o deploy.
- **M5-05D2B-1:** costo versionato (input/output/total, micro-USD interi, `ceil` stima / `nearest` effettivo) e ledger mensile atomico collegati al runtime; **tetto di prenotazione conservativo** distinto dalla stima informativa (massimo output del grader + upper bound provabile dell'input dell'esatto payload → `costActualMicroUsd ≤ costReservationMicroUsd`); **macchina a stati crash-safe** `reserved → pending` (reserved scaduta rilasciata/recuperabile, pending scaduta addebitata al tetto: mai sottocontabilizzare) con `markBudgetInvoked` gated dalla lease prima del provider; **fail-closed** `budget_unavailable` se porte di budget o bounds del grader mancano sul percorso reale; prenotazione idempotente prima della chiamata provider con hard stop, riconciliazione idempotente con gate di titolarità della lease; usage effettivo validato e contabilizzato anche su output rifiutato, mai inventato; preview stima senza prenotare; mock e sole-chiuse a 0; run doc/ledger senza ID/UID/PII; budget solo dalla config (≤ 5 USD/mese), retry rimandato a M5-05D2B-2; nessun secret, chiamata, costo, TTL o deploy; Human Gate/G7 aperti.
- **M5-05D2B-2:** retry applicativo **unico** (SDK `maxRetries: 0`), ≤ 1 retry dalla config runtime (ceiling DEV), su soli transitori (connessione/408/409/429/≥ 500), no-retry fail-closed su permanenti/output invalido/abort/budget; `Retry-After` (ms/secondi/HTTP-date, cap 8 s oltre cui manuale) + backoff esponenziale con full jitter (base 500 ms, cap 4 s), `random`/`sleep`/clock iniettati, sleep annullabile senza timer pendenti; deadline complessiva monotona con margine, Function `timeoutSeconds = 540` esplicito e `RUN_LEASE_MS` a 9 min coerenti; prenotazione = `bound × (retry + 1)` (nessuna seconda prenotazione, budget insufficiente ⇒ rifiuto prima del provider); accounting prudente `costActual ≤ costSettled ≤ costReservation` (tentativi incerti al tetto, mai sottocontabilizzare/doppio addebito/actual inventato); telemetria retry aggregata privacy-safe in `aiCorrectionRuns`; UX invariata con codici leggibili; mock/sole-chiuse senza retry/sleep/ledger; nessun secret, chiamata, costo, TTL o deploy; Human Gate/G7 aperti.

---

## 18. Fuori scope (esplicito)

- **Generazione di domande.**
- **Chatbot / assistente conversazionale.**
- **Retrieval / web access.**
- **Correzione automatica definitiva.**
- **Restituzione automatica.**
- **Gate G8** (IA automatica).

---

## 19. Sintesi

- **Un solo comando batch «Correggi con IA»**, sopra la tabella, sulle sole consegne selezionate ed eleggibili, con **preflight/stima/conferma** e **risultato finale** trasparente sui successi parziali.
- L'IA scrive **direttamente** nelle `evaluations` di correzioni `in_progress` (bozza modificabile): **nessuna struttura ridondante**, **nessun completamento/restituzione automatici**.
- **Chiuse deterministiche (0 token)**, **aperte assistite** con **una richiesta per consegna**, output **strutturato e validato**, punteggi **0..maxPoints** multipli di **0,25**, mai fidandosi dell'output grezzo.
- **Sicurezza:** chiave solo in Secret Manager, gateway owner-only, autorizzazione **per ID** (rilettura server-side), contenuto studente **non attendibile**, **nessun** web/retrieval/tool, log senza contenuti/PII.
- **Costo:** scale-to-zero, nessun listener/polling, limiti prudenti, feature flag di spegnimento, provider **sostituibile**.
- **Human Gate HG-M5-1/2/3/4 approvati:** la decisione è registrata, ma provider reale, Secret Manager, TTL, smoke DEV e Gate G7 restano disabilitati/aperti.
- **Roadmap:** M5-00 (questo) → M5-01 gateway/flag/Secret/mock → M5-02 deterministico+IA → M5-03 UI batch → M5-04 azioni massive → M5-05 provider reale DEV + **G7**. **G8/automatica rinviati.**
