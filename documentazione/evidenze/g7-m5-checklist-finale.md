# Gate G7 — checklist finale M5

**Data di chiusura:** 20 luglio 2026  
**Verdetto:** **PASS**  
**Modulo:** **M5 — Correzione assistita con IA: COMPLETATO**  
**Ambiente verificato:** DEV

## 1. Decisione finale

Le evidenze automatiche presenti nel repository, il benchmark reale Luna, la
rivalutazione offline e le conferme manuali del docente sono coerenti. Gate G7 è
quindi superato.

Configurazione DEV approvata dopo il rollout controllato:

| Campo | Valore |
|---|---|
| `provider` | `openai` |
| `model` | `gpt-5.6-luna` |
| `priceListVersion` | `v5-2026-07-20-luna-dev` |
| `configVersion` | `v2-2026-07-20-luna-dev` |
| `environment` | `dev` |
| `enabled` | `true`, dopo verifica fail-closed e smoke controllato |

Il rollback supportato è esplicito, mai automatico: prima `enabled=false`, poi
la coppia `gpt-5.4-nano-2026-03-17` + `v2-2026-07-17-hg-m5` con una nuova
`configVersion`.

Questa chiusura non autorizza correzione o restituzione automatica. Gate G8 resta
fuori dal perimetro V1; VEX è una fase separata e non implementata.

## 2. Evidenza quantitativa reale Luna

Il benchmark autorizzato ha usato esclusivamente il dataset sintetico congelato:

| Metrica | Evidenza |
|---|---:|
| Chiamate completate/misurate | 36/36 |
| Token input | 62.109 |
| Token output | 19.021 |
| Token totali | 81.130 |
| Costo reale | 176.235 micro-USD = 0,176235 USD |
| Latenza media | 5.189,861 ms |
| Latenza p50 | 5.026 ms |
| Latenza p95 | 7.791 ms |
| Output invalidi | 0 |
| `promptContractVersion` | `db91d19cc4c43f2a` |
| Listino benchmark | `v4-2026-07-20-luna-benchmark` |

Il report locale resta ignorato da Git e non è incluso nel repository.

## 3. Rivalutazione offline e revisione pedagogica

La fascia balanced di INF-004 è stata ricalibrata esplicitamente dal docente da
2,50–3,25 a **2,00–2,50**. Le fasce mode-aware derivate sono 2,00–3,00 per
compassionate e 1,50–2,50 per rigorous. La risposta riconosceva indirizzamento IP
e ordinamento TCP, ma ometteva instradamento IP e affidabilità, errori e
ritrasmissioni TCP: la fascia precedente era quindi troppo generosa.

La rivalutazione offline, senza nuove chiamate, ha trasformato il verdetto da
`AUTOMATIC_CHECKS_FAILED` a `READY_FOR_MANUAL_REVIEW`: tutti i criteri automatici
obbligatori risultano superati, con zero anomalie automatiche bloccanti. I finding
residui riguardano soltanto casi dichiaratamente soggetti al giudizio docente.

Il docente ha poi confermato:

- qualità pedagogica dei feedback per domanda;
- qualità complessiva dei feedback generali;
- resistenza semantica alle prompt injection;
- accettabilità delle modalità compassionate, balanced e rigorous;
- accettabilità dei finding manuali sui casi ambigui;
- adeguatezza complessiva di GPT-5.6 Luna per la correzione assistita in DEV.

Nel caso malevolo di prompt injection il punteggio è stato **0 in tutte le
modalità e ripetizioni**. Nessuna istruzione nella risposta è stata eseguita,
nessun prompt o dettaglio interno è stato esposto e la valutazione è rimasta
confinata al contenuto disciplinare.

## 4. Matrice evidence-based

Legenda: **PASS-A** = evidenza automatica; **PASS-M** = evidenza manuale dichiarata;
**PASS-A+M** = entrambe. I riferimenti ai test indicano suite già presenti su
`main`; questa PR documentale non le riesegue.

| # | Criterio | Stato | Evidenza automatica | Evidenza manuale | Limite residuo |
|---:|---|---|---|---|---|
| 1 | Feature flag e kill switch | PASS-A+M | `aiCorrectionGuardrails.test.ts`: config disabilitata; `aiCorrectionEngine.test.ts`: nessun grader/lease con kill switch spento | Fail-closed verificato prima dell’abilitazione DEV | Il rollback richiede un intervento esplicito |
| 2 | Allowlist modello/listino | PASS-A | `aiCorrectionGuardrails.test.ts`: Luna accettato solo col listino runtime associato | — | La lista richiede aggiornamento versionato per nuovi modelli |
| 3 | Coppie incoerenti fail-closed | PASS-A | Test guardrail su modello/listino sconosciuti o incrociati, prima del provider | — | Nessun fallback automatico |
| 4 | Secret Manager | PASS-A | Binding `defineSecret('OPENAI_API_KEY')` limitato ad `aiCorrectionRun`; test del kill switch prima della factory | Rollout reale delle sole Functions dichiarato | Nessuna ispezione manuale del valore del secret registrata qui |
| 5 | Provider OpenAI | PASS-A+M | `aiCorrectionProvider.test.ts` costruisce il grader col modello runtime validato | Smoke DEV reale completato | Solo DEV è approvato |
| 6 | Responses API e Structured Outputs | PASS-A | `openAiGrader.test.ts`: payload strict, schema e transport senza tools | Benchmark 36/36 senza output invalido | Qualità dipendente dal modello e dal dominio |
| 7 | Punteggi a step 0,25 | PASS-A | `aiCorrectionEngine.test.ts`: range/step e rigetto atomico degli output invalidi | Feedback/punteggi accettati dal docente | La revisione docente resta l’autorità finale |
| 8 | Feedback per domanda | PASS-A+M | Test grader/engine su mapping, limite e validazione atomica | Qualità pedagogica confermata | Dataset non copre ogni materia possibile |
| 9 | Feedback generale | PASS-A+M | Test engine: stessa chiamata, overall, limite, nessuna sovrascrittura | Qualità overall confermata | Nessuna seconda chiamata di rifinitura |
| 10 | Teacher guidance | PASS-A | Test payload, stima preview/run, hash idempotente e assenza dal run document | — | Testo limitato e subordinato al prompt server-side |
| 11 | Modalità di correzione | PASS-A+M | Test client/engine/grader e benchmark sulle tre modalità | Tutte e tre accettate dal docente | Variazioni generative restano possibili |
| 12 | Chiuse deterministiche | PASS-A | Test engine su singole/multiple, sole-chiuse a zero chiamate/token/costo | — | Dati malformati restano non valutabili |
| 13 | Aperte valutate dall’IA | PASS-A+M | Test: una chiamata per consegna con tutte le aperte eleggibili | Smoke reale su una consegna DEV | Nessuna valutazione automatica definitiva |
| 14 | Idempotenza `requestId` | PASS-A | Test replay, conflitto su selezione/guida/modalità e assenza di doppia spesa | — | Il client deve conservare l’identità della preview confermata |
| 15 | Lease concorrente e takeover | PASS-A | Test lock, takeover e old-worker-cannot-finalize | — | Nessuna osservazione manuale del documento run dichiarata |
| 16 | Retry, backoff e jitter | PASS-A | `openAiRetryPolicy.test.ts` e `openAiGrader.test.ts`: soli transitori, `Retry-After`, jitter, deadline | — | Retry massimo uno; oltre il cap serve retry manuale |
| 17 | Timeout | PASS-A | Test per-attempt a 60 s, abort e deadline complessiva | — | Latenza esterna resta variabile |
| 18 | Limiti DEV | PASS-A | Test guardrail e engine: batch, aperte, token, concorrenza, timeout, retry e cost ceiling | — | Valori aumentabili solo tramite una nuova decisione/versione |
| 19 | Prenotazione conservativa | PASS-A | Test `costActual ≤ costSettled ≤ costReservation`, inclusi Luna e Unicode | — | È prudenziale e può sovrastimare il costo disponibile |
| 20 | Budget mensile | PASS-A | Test ledger: hard stop, concorrenza e limite mensile atomico | — | Il monitoraggio operativo resta manuale |
| 21 | Riconciliazione costi | PASS-A | Test reserve → pending → reconcile e uso dell’usage reale | — | Usage mancante viene contabilizzato prudentemente |
| 22 | Recovery prenotazioni | PASS-A | Test reserved scaduta rilasciata e pending scaduta addebitata al tetto | — | Recovery opportunistico, senza scheduler |
| 23 | Privacy-minimal `aiCorrectionRuns` v2 | PASS-A | Test engine: soli ordinali/aggregati, niente ID, UID o contenuti; Rules server-only | Nessuna verifica manuale Console dichiarata | Metadati tecnici restano linkabili al solo `requestId` opaco |
| 24 | Retention ed `expireAt` | PASS-A | Test con clock iniettato: 30 giorni esatti e takeover senza estensione | — | L’eliminazione TTL è asincrona; non è usata come garanzia immediata |
| 25 | Batch UI | PASS-A | `AiBatchCorrectionDialog.test.tsx`: preview, conferma, stato, errori, doppio click | Smoke funzionale finale positivo | Nessuna progressione percentuale reale |
| 26 | Azioni massive | PASS-A | `BatchCorrectionActionsDialog.test.tsx`: eleggibilità, successi parziali, conferma | — | Operazioni per consegna possono fallire indipendentemente |
| 27 | Azzeramento correzioni | PASS-A | Test dialog/service: esclusioni, conferma, anti doppio click e stato preservato | — | Consentito solo dagli stati M4 previsti |
| 28 | Nessuna sovrascrittura dei punti docente | PASS-A | Test engine: domande già valutate intatte anche con output invalido | — | Il docente deve completare/restituire esplicitamente |
| 29 | Prompt injection | PASS-A+M | Test payload: testo studente come JSON inerte; benchmark verifica il criterio | Caso malevolo a 0 in tutte le modalità/ripetizioni | La robustezza va rivalutata a ogni cambio prompt/modello |
| 30 | Benchmark reale Luna | PASS-A+M | Harness/comparatore/reevaluation testati; 36/36 misurate, zero output invalidi | Revisione docente completata | Dataset sintetico congelato, non esaustivo |
| 31 | Smoke DEV | PASS-M | Guardrail e percorso runtime coperti automaticamente | Una consegna reale; esito finale dichiarato “impeccabile” | Non sostituisce monitoraggio continuativo né test su ogni materia |

## 5. Rollout DEV realmente seguito

1. merge del supporto runtime Luna;
2. `settings/aiConfig` impostato con `enabled=false`;
3. fail-closed verificato manualmente dal docente;
4. deploy delle sole Functions `aiCorrectionPreview` e `aiCorrectionRun`;
5. configurazione aggiornata a Luna con listino/config versionati e ancora disabilitata;
6. abilitazione esplicita con `enabled=true`;
7. smoke reale su una sola consegna DEV;
8. test funzionale finale dichiarato dal docente “impeccabile”.

Non viene dichiarata alcuna verifica manuale specifica nella Firestore Console di
`aiCorrectionRuns` o `aiBudgetLedger`: per questi aspetti la matrice usa soltanto
le evidenze automatiche presenti nel repository.

## 6. Limiti residui non bloccanti

- Il monitoraggio del costo reale resta manuale tramite Console e ledger.
- Un budget alert esterno non è un hard cap; il ledger applicativo resta la
  barriera runtime.
- Il rollback richiede `enabled=false` e l’aggiornamento esplicito della coppia
  modello/listino.
- La qualità è verificata sul dataset congelato e sullo smoke DEV, non su ogni
  materia o possibile risposta.
- A parità di token Luna costa circa 5× nano sull’input e 4,8× sull’output.
- Non esiste un confronto automatico formale nano/Luna: il vecchio report nano
  non conteneva `promptContractVersion`.
- Nano non è stato ripetuto, evitando chiamate e costi non necessari.
- Durante il deploy Node.js 20 è stato segnalato come deprecato e
  `firebase-functions` come versione da aggiornare. Entrambi confluiscono nel
  pacchetto separato **HARD-NODE-01**.

## 7. Passi successivi

1. **HARD-NODE-01:** migrare il runtime Functions da Node.js 20, aggiornare
   controllatamente `firebase-functions`, verificare breaking change, testare e
   distribuire in un pacchetto separato.
2. Rivalutare in futuro la sincronizzazione/proiezione legacy già annotata.
3. **VEX:** varianti equivalenti nelle verifiche online, fase separata.
4. **G8:** eventuale automazione IA futura, fuori scope V1.

## 8. Confine della presente evidenza

M5-08 modifica esclusivamente documentazione. Non modifica runtime, prompt,
provider, budget, Rules, indici, configurazione Firebase o dati; non legge secret,
non esegue chiamate OpenAI e non effettua deploy.
