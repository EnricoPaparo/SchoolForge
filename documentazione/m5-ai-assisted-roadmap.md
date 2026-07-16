# M5 — Correzione assistita da IA · Roadmap e contratto (M5-00)

**Data:** 15 luglio 2026 · **Fase:** M5-00 (contratto/cost model/documentazione) **completata**; **M5-01 implementato** (gateway server-side minimale, **solo mock**).
**Natura:** progettazione evidence-based. **M5-00** non ha toccato codice. **M5-01** ha aggiunto due Cloud Functions v2 `onCall` (`aiCorrectionPreview`/`aiCorrectionRun`) in **modalità mock deterministica** — **nessun provider reale, nessuna API key, nessuna chiamata di rete, zero token, nessuna scrittura Firestore, nessuna UI** — vedi §16 (M5-01). Il resto della roadmap (M5-02→M5-05) **non** è implementato.
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

**Può contenere soltanto:**
- `ownerUid`, `actorUid`;
- `verificationId`;
- `requestId`;
- `status` della run;
- `timestamp` (creazione/aggiornamento);
- `provider`/`model`;
- **conteggi** (aperte inviate/valutate/scartate, chiuse deterministiche, consegne elaborate/escluse/fallite);
- **token/costo stimati ed effettivi**;
- **esito sintetico per consegna** (`succeeded|partial|failed`);
- **codici errore non sensibili**.

**Non deve mai contenere:** testo delle risposte, testo delle domande, soluzioni, feedback, prompt, output grezzo del provider, nome/email dello studente.

Il documento è **owner-only**. La granularità dettagliata (punteggio per domanda) vive già nelle `evaluations` della correzione: `aiCorrectionRuns` **non** la duplica.

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

## 15. Human Gate necessari (ancora aperti)

Questi punti **non** sono decisi in M5-00 e **non** vanno inventati:

| # | Decisione | Nota |
|---|---|---|
| HG-M5-1 | **Provider e modello** | Contratto provider-agnostic (§14). La scelta richiede conferma del docente e verifica di **disponibilità e costo attuali** su documentazione ufficiale. Nessun default fissato. Candidati di categoria «piccolo/economico» sono ammessi solo come esempi da verificare, non come default. |
| HG-M5-2 | **Budget massimo per singola operazione** | Tetto di spesa oltre cui il preflight blocca la conferma. Valore da approvare. |
| HG-M5-3 | **Budget giornaliero** | Tetto cumulato oltre cui il gateway rifiuta nuove operazioni. Valore da approvare. |
| HG-M5-4 | **Retention minima dei metadati di audit** | Per quanto tempo conservare i documenti `aiCorrectionRuns` (solo metadati/conteggi/costi). Valore da approvare. |

Ulteriori limiti prudenti (max consegne/aperte/caratteri/token per operazione, §12) hanno **default prudenti proposti** ma i valori definitivi possono essere confermati insieme a HG-M5-2/3.

---

## 16. Roadmap implementativa minimale (M5-00 → M5-05)

| Pacchetto | Scope | Dipende da |
|---|---|---|
| **M5-00** *(questo doc)* | Contratto tecnico, UX batch, sicurezza, privacy, cost model. **Solo documentazione.** | M4 completato (Gate G6) |
| **M5-01** ✅ | Le due Cloud Function v2 `onCall` **`aiCorrectionPreview`**/**`aiCorrectionRun`** (scale-to-zero), **feature flag** globale `disabled\|mock` (default `disabled`, risolto solo server-side), interfaccia **provider-agnostic** `AiGrader` + **`MockAiGrader`** deterministico. **Solo mock**: nessun provider reale, nessuna API key, **nessuna chiamata esterna**, **zero token**, **nessuna scrittura Firestore** (`aiCorrectionRun` restituisce `written: false`). Autorizzazione owner riusando il pattern del Repository Gateway; validazione input rigorosa (solo ID, no duplicati/malformati, limite prudente consegne); codici errore stabili e non sensibili. Nessuna UI. Codice: `functions/src/aiCorrectionGatewayCore.ts` (+ test), `functions/src/aiCorrectionGateway.ts`. | M5-00 |
| **M5-02** ✅ | Motore server-side completo (solo mock): preflight reale (rilettura server-side di verifica/teacherSnapshot/submission/correction, eleggibilità, conteggi, stima token deterministica, **nessuna scrittura, nessun grader**); scoring **deterministico** delle chiuse (incl. **sole chiuse**); **IA** per le aperte via **`MockAiGrader`** (una chiamata per consegna) con validazione output/punteggi; scrittura atomica per consegna nel contratto M4 (evaluations/totali/mirror `correctionSummary`, mai sovrascrittura, semantica evento su riapertura); idempotenza + `aiCorrectionRuns/{requestId}` (solo metadata). **Senza UI.** **Nessuna** chiamata esterna, **zero token**, **costo 0**. Codice: `functions/src/aiCorrectionEngine.ts` (+ test), wiring in `aiCorrectionGateway.ts`. | M5-01 |
| **M5-03** | **UI batch:** checkbox per riga, **toolbar** con «Correggi con IA», **dialog di conferma** con stima costi, **risultato finale** (riuscite/escluse/fallite). Colonna **«Valutate»** al posto di «Punteggio». Sviluppabile e testabile **con il mock**. | M5-02 |
| **M5-04** | **Azioni massive** Completa / Riapri / Restituisci sulle sole righe selezionate ed eleggibili, con riepilogo e risultato; riuso dei service M4. Sviluppabile e testabile **con il mock**. | M5-03 |
| **M5-05** | **Provider reale su DEV**, smoke test, verifica audit/costi/sicurezza, **Gate G7** (IA assistita). **Prerequisiti bloccanti:** provider/modello, chiave in Secret Manager e budget reali. | M5-04, **HG-M5-1/2/3/4 (bloccanti qui)** |

> **M5-01→M5-04 si sviluppano e testano interamente con il provider mock deterministico**, senza provider/modello reale, senza chiave reale e **senza alcuna chiamata esterna**. Provider, modello, Secret Manager e budget reali diventano **bloccanti solo prima di M5-05** (HG-M5-1/2/3/4). La Function in **modalità mock** deve essere **impossibile da confondere** con il provider reale (config esplicita, nessun fallback silenzioso al provider reale).
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
- **Idempotenza** (`aiCorrectionRuns/{requestId}`): un run già `completed`/`partial`/`failed` viene **rieseguito idempotente** restituendo il risultato salvato; lo **stesso `requestId` con selezione diversa** (selectionHash) è **rifiutato** (`invalid_input`); un retry non duplica valutazioni (merge non distruttivo). Stati: `running`/`completed`/`partial`/`failed`.
- **`aiCorrectionRun`** ripete **tutte** le verifiche del preview (nessuna autorizzazione persistente): dati cambiati dal preview → consegna esclusa (`changed_since_preview`). **Nessun** completamento/restituzione automatici. **Zero token reali, nessuna chiamata esterna.**

**Forma di `aiCorrectionRuns/{requestId}` (M5-02).** Documento **owner-only**, **solo metadata**: `ownerUid`/`actorUid`, `verificationId`, `requestId`, `mode`/`provider: 'mock'`, `status`, timestamp, **`selectionHash`** (hash deterministico FNV-1a della selezione, mai risposte/contenuti), conteggi, `tokensEstimated`/`tokensActual`, `cost: 0`, ed **esito sintetico per consegna** (submissionId + outcome + conteggi + eventuale codice motivo). **Vietati** e assenti: testi di domande, risposte, soluzioni, feedback, prompt, output grezzo, nomi, email. **Retention: ancora non decisa** — è l'Human Gate **HG-M5-4** (da definire prima di M5-05); nessun valore è fissato qui. La collezione **non** è pensata per lettura diretta dal client: il risultato è restituito dalla Function.

**Resta a M5-03/04/05 (non implementati):** UI batch (checkbox, toolbar «Correggi con IA», conferma costi, colonna «Valutate») = **M5-03**; azioni massive Completa/Riapri/Restituisci = **M5-04**; provider reale su DEV + Secret Manager + budget + Gate G7 = **M5-05** (HG-M5-1/2/3/4 bloccanti).

---

## 17. Criteri di accettazione per pacchetto

- **M5-00 (DoD):** documento presente e coerente; vecchia roadmap M5-A..E e contratti stale superati; README/INDEX/piano/api-contract/architettura/sicurezza/decisioni allineati senza dichiarare implementato ciò che non lo è; `pnpm format:check` verde. Nessuna modifica a codice/Rules/schema/dipendenze.
- **M5-01:** due Function `onCall` `aiCorrectionPreview`/`aiCorrectionRun`; nessun invio possibile senza feature flag attivo; **provider mock deterministico** sostituibile all'interfaccia `AiGrader`; **nessuna secret reale richiesta né finta**, **nessuna chiamata esterna**; modalità mock non confondibile col provider reale; gateway rifiuta chiamanti non-owner.
- **M5-02:** chiuse valutate a 0 token, **incluse le consegne con sole chiuse**; chiuse tutto-o-niente (§5.1); aperte valutate solo se `points === null`; ogni `points` scritto rispetta `0..maxPoints` e step 0,25; output non valido scartato senza corrompere la correzione; `requestId` rende il retry idempotente via `aiCorrectionRuns`; nessun contenuto in `aiCorrectionRuns`; **solo mock, nessuna chiamata esterna**.
- **M5-03:** un solo pulsante «Correggi con IA» sopra la tabella; nessun pulsante per riga; conferma con selezionate/elaborabili/escluse+motivo/aperte/chiuse/consegne-sole-chiuse/stima/modello; risultato finale con riuscite/escluse/fallite senza nascondere successi parziali; colonna «Valutate» `n/m`; testabile con mock.
- **M5-04:** Completa solo su interamente valutate e valide; Riapri solo su completed/returned; Restituisci solo su completed; ogni azione con riepilogo+risultato; nessuna restituzione automatica; testabile con mock.
- **M5-05:** provider reale solo su DEV dietro flag; **prerequisiti bloccanti HG-M5-1/2/3/4 soddisfatti**; smoke su casi reali; audit/costi osservabili entro le soglie; nessun web/retrieval/tool; evidenze per **G7**.

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
- **Human Gate aperti:** provider/modello, budget per operazione, budget giornaliero, retention audit.
- **Roadmap:** M5-00 (questo) → M5-01 gateway/flag/Secret/mock → M5-02 deterministico+IA → M5-03 UI batch → M5-04 azioni massive → M5-05 provider reale DEV + **G7**. **G8/automatica rinviati.**
