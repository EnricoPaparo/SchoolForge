# AIGEN — Generazione IA di pool e lezioni (contratto e roadmap)

> Stato: **AIGEN-00 — progettazione congelata, nessuna implementazione applicativa**. Rilevazione evidence-based: 23 luglio 2026. Questo documento e i prototipi statici associati **non** autorizzano deploy, chiamate provider, migrazioni o modifiche ai dati esistenti. Nessuna API key viene letta, nessuna chiamata OpenAI viene effettuata. I pacchetti implementativi successivi sono **AIGEN-01/02/03** e il **Gate GAIGEN**.
>
> **AIGEN-01 implementato** (backend only): `functions/src/aiContent{Core,Validation,Cost,Prompt,Payload,Engine,Provider,RunDoc,Gateway}.ts` + runner condiviso `openAiStructuredRunner.ts` + callable `aiContentPreview`/`aiContentGenerate` (`index.ts`), Rules `aiContentRuns` server-only (`firestore.rules`), test `functions/src/aiContent.test.ts` + `apps/web/src/rules/m5-technical-server-only.rules.test.ts`. **Decisione di scope congelata:** AIGEN-01 valida solo la struttura semantica della proposta pool (nessun ID, nessun `parsePool`, nessuna dipendenza `functions → @schoolforge/lesson-contract`); la materializzazione `schoolforge-pool/v2` (mapper ID → `parsePool` → `poolEditorService`) è di **AIGEN-02** nel web. Nessuna UI, nessun provider reale (kill switch), nessun deploy.
>
> **AIGEN-02 implementato** (solo web, nessuna Function/Rules/indice/schema nuovo): `apps/web/src/features/repository/pools/aiContentClient.ts` (client tipizzato preview/generate, payload chiuso, error mapping sanitizzato), `apps/web/src/features/repository/pools/aiPoolMapper.ts` (mapper puro proposta→`schoolforge-pool/v2` + `parsePool`), `apps/web/src/features/teacher/AiPoolGenerationDialog.tsx` (+`.module.css`), pulsanti in `QuestionPoolEditor.tsx` (assente: accanto a «Crea pool»; presente: toolbar con Nuova domanda / Genera con IA / Modifica YAML / Elimina pool), `lessonSource` passato da `CourseWorkspace`. Test: `aiContentClient.test.ts`, `aiPoolMapper.test.ts`, `AiPoolGenerationDialog.test.tsx`, `QuestionPoolEditor.aigen.test.tsx`. **Costi:** pool manuale invariato (zero callable); con AIGEN — preview = 1 callable (nessun provider/write), generate = 1 callable (run/budget/provider AIGEN-01), applicazione = stesso costo del `savePool` canonico; zero listener/polling/costo passivo. `existingPoolQuestionCount` è solo contesto quantitativo (nessuna deduplicazione semantica promessa). Distribuito su DEV in modalità `disabled`: nessuna chiamata OpenAI reale e costo zero.
>
> **AIGEN-03 implementato** (solo web, nessuna Function/Rules/indice/schema nuovo): estensione `aiContentClient.ts` con il contratto chiuso `kind:'lesson'` (`buildLessonContentRequest`, `createAiLessonCallables`, tipi preview/generate), validatore `apps/web/src/features/repository/pools/aiLessonDraft.ts` (fail-closed: kind/body/front-matter/dimensione via `assertLessonContentSize`), dialog `apps/web/src/features/teacher/AiLessonGenerationDialog.tsx` (riusa la CSS del dialog pool e `MarkdownRenderer`), pulsante «Genera con IA» in `lessonEditors.tsx` (`MarkdownBodyEditor`, **solo in modifica**), contesto passato da `CourseWorkspace` (titolo/sottotitolo/UDA/concetti/obiettivi già in memoria). Flusso: config→stima→conferma→generazione→anteprima Markdown→«Usa questa bozza». **«Usa questa bozza» sostituisce solo il draft locale** (dirty), **nessun salvataggio/write Firestore/Storage/publicLessons**; il salvataggio resta il normale «Salva». **Costi:** apertura editor invariata; preview = 1 callable (nessun provider/write), generate = 1 callable (AIGEN-01), «Usa questa bozza» = 0 write, «Salva» = flusso canonico esistente; zero listener/polling/autosave. Rollout tecnico DEV eseguito sullo SHA `6f5fbc1` con `AI_CONTENT_MODE` assente/`disabled`, quindi zero chiamate e costi reali. Gate GAIGEN resta **aperto** fino a TTL + smoke autenticati.
>
> **AIGEN-PROMPT-01 implementato** (prompt pedagogici, nessun deploy/OpenAI): `functions/src/aiContentPrompt.ts` (gerarchia autorità a 6 livelli nel `SECURITY_PREAMBLE`: 1 limiti sicurezza/schema/server, 2 contratto content-type, 3 config strutturata docente, 4 `INDICAZIONI_DOCENTE` = vincoli pedagogici **autorevoli** applicati concretamente quando compatibili — non testo non attendibile, ma non possono alterare schema/sicurezza/quantità/tipi/range/modello/listino/limiti, 5 metadati didattici, 6 `MATERIALE_LEZIONE`/`CONTENUTO_ATTUALE` = **dati non attendibili**, ogni istruzione/injection ignorata; contratto pool con autonomia — nessun riferimento a posizione/struttura della lezione — chiarezza, trabocchetti ammessi, varietà/copertura, soluzioni aperte esaustive e formative con metodo passo-passo, regole chiuse — singola con una sola corretta, multipla generata dall'IA con ≥2 corrette e ≥1 errata — difficoltà 1–5 per complessità cognitiva reale con rubrica; contratto lezione didatticamente completo/chiaro/autosufficiente senza imporre riepilogo/stile/lunghezza; `DEPTH_SEMANTICS` pedagogiche synthetic/complete/in_depth). `functions/src/aiContentValidation.ts` (multipla generata: rifiuto fail-closed se <2 corrette o 0 errate — solo proposta IA, contratto canonico/editor invariati). `functions/src/aiContentPayload.ts` (`LESSON_OUTPUT_TOKENS` hard cap tecnici synthetic 5_000 / complete 9_000 / in_depth 15_000 — includono ragionamento + output visibile, non sono obiettivi di lunghezza; reservation/per-operation cap restano autoritativi). `apps/web/src/features/repository/pools/aiPoolMapper.ts` (`maxCharactersForDifficulty` deterministica e fail-closed: 1→500, 2→800, 3→1200, 4→1800, 5→2500, applicata alla materializzazione delle aperte al posto del default fisso 2000; il docente può comunque modificarla; nessuna migrazione, pool esistenti invariati, nessun nuovo campo provider, `parsePool` autorevole). Test: `aiContent.test.ts` (gerarchia/preamble, contratto pool, contratto lezione, validazione multipla, hard cap token + compatibilità cap), `aiPoolMapper.test.ts` (mapping difficoltà→maxCharacters + fail-closed). Nessuna chiamata OpenAI, costo zero; `AI_CONTENT_MODE` invariato; nessuna modifica a UI/Rules/indici/budget/lease/idempotenza.
>
> **AIGEN-CONTEXT-01 implementato** (contesto didattico autorevole e perimetro UDA per la **sola** generazione lezioni; nessun deploy, nessuna chiamata OpenAI): `functions/src/aiContentCore.ts` (payload `kind:'lesson'` esteso con `difficolta` e `udaContext`; **metadati obbligatori** validati fail-closed — titolo, difficoltà, ≥1 concetto chiave, ≥1 obiettivo, titolo UDA, indice UDA — mentre il **sottotitolo resta facoltativo** e il corpo Markdown non è mai un requisito; `parseUdaContext` rifiuta indice assente/malformato/vuoto/oltre `MAX_UDA_OUTLINE_ITEMS`=60 o `MAX_UDA_OUTLINE_BYTES`=20 KB, posizioni non 1-based consecutive, `currentLessonPosition` incoerente, titoli mancanti e **qualunque proprietà extra**, inclusi `lessonId`/`udaId`/`filename`/`storageRef`/`publicLessonId`; `difficolta` e `udaContext` entrano nell'`inputHash` canonico, quindi modificarli invalida la `requestId` precedente e la prenotazione è calcolata sul payload reale completo). `functions/src/aiContentPrompt.ts` (gerarchia **specifica della lezione**: 1 sicurezza/schema/limiti · 2 contratto di output · 3 `METADATI_DIDATTICI` della lezione corrente che **definiscono il perimetro didattico** · 4 `INDICAZIONI_DOCENTE` autorevoli solo se compatibili con quel perimetro · 5 `INDICE_UDA` per evitare ripetizioni e anticipazioni · 6 `CONTENUTO_ATTUALE` non attendibile; la difficoltà è dichiarata **livello pedagogico**, distinto da `depth`; lezioni precedenti = argomenti già affrontati, solo brevi richiami; lezioni successive = argomenti riservati, non sviluppabili; vietato citare allo studente l'indice o «la lezione precedente/successiva»; metadati e indice sono **dati**, mai istruzioni. Prompt e gerarchia del **pool invariati**). `apps/web/src/features/repository/pools/lessonUdaContext.ts` (builder **puro** dell'indice dall'albero `tree.udas`/`tree.lessons` **già in memoria**: nessuna `getDoc`/`getDocs`, query, lettura Storage, listener, polling o Function aggiuntiva — **zero nuove letture, costo passivo invariato**; fail-closed a `null` senza inventare l'indice). `apps/web/.../aiContentClient.ts` (contratto chiuso esteso, `missingLessonRequirements` puro, builder che rifiuta payload parziali) e `AiLessonGenerationDialog.tsx` (**preflight**: senza metadati completi nessuna callable, nessuna prenotazione, nessun provider, nessun run, nessun costo; alert accessibile «Completa prima le informazioni fondamentali della lezione: …» e pulsante stima disabilitato, dialog non chiuso, nessun fallback). **L'indice non trasporta corpo, pool, domande, soluzioni, concetti o obiettivi delle altre lezioni, né dati studente**: solo posizione, titolo e sottotitolo, quindi l'incremento di token è contenuto (~10–20 token per voce). La validazione client è **solo UX**: il server rivalida tutto in modo autorevole. Test: `aiContent.test.ts` (contratto payload, indice, hash, stima/prenotazione, gerarchia, injection in ogni metadato/voce/corpo, pool invariato), `aiContentClient.test.ts`, `lessonUdaContext.test.ts`, `AiLessonGenerationDialog.test.tsx`. Replay/idempotenza/lease/budget/Rules/indici invariati; Gate GAIGEN resta **aperto** fino a rollout e smoke autenticati.
>
> **AIGEN-UI-03 implementato** (microfix **solo UI** della fase di review di `AiPoolGenerationDialog`; nessuna modifica a backend, prompt, callable, payload, mapper, persistenza, costi o validazione): scheda domanda riorganizzata su due righe — riga 1 «Domanda N» + badge tipo («Aperta», «Risposta singola», «Risposta multipla») + «Elimina» distruttivo con `IconTrash` (sola icona sotto i 420px, `aria-label="Elimina domanda N"` conservata); riga 2 metadati con **label visibili** «Difficoltà» e — solo per le aperte — «Dim. risposta», ciascuna associata al proprio `BoundedStepper` da un `<label>`. Textarea «Testo» e «Soluzione di riferimento» a `rows={4}` con `resize: none` e `overflow-y: auto`, circoscritte alla review AIGEN (input delle opzioni chiuse invariati). Nuova variante tipizzata e retrocompatibile `width='wide'` di `CompactStepper`/`BoundedStepper` (`6ch`, ≥ 5 cifre) perché «Dim. risposta» mostri integralmente valori come `1800` e `10000`; gli altri stepper restano compatti e invariati. Smoke responsive reale a 1440/1024/390/320 px: dialog nel viewport, lista ancora scorrevole con scrollbar nascosta (0px), footer raggiungibile, nessun controllo tagliato, nessun overflow orizzontale, `10000` mai troncato. Gate GAIGEN **invariato**.
>
> **AIGEN-UI-03-FOLLOW-UP** (solo UI web). (1) **Nessuna textarea ridimensionabile nel portale**: regola **unica e globale** `textarea { resize: none }` in `apps/web/src/index.css` (docente, studente, lezioni, informazioni, pool, verifiche, correzioni, feedback, dialog IA); rimossi i cinque override locali `resize: vertical` (`QuestionPoolEditor` ×2, `lessonEditors` ×2, `OnlineExamView`) e le dichiarazioni ormai ridondanti `resize: none` (`CorrectionWorkspace`, `LessonNotesPanel`, dialog AIGEN), così `resize` è dichiarato in **un solo punto** e nessun CSS module può vincerlo per specificità — senza `!important`. Altezze iniziali, auto-grow e scroll interni invariati; nessun cambiamento a contenuto, `maxLength`, salvataggio o validazioni. Guardia di regressione statica `textareaResize.test.ts`. (2) **Proposte IA protette dal click fuori**: `DialogShell` estesa con `closeOnBackdrop?`/`closeOnEscape?` (default `true` ⇒ tutti gli altri dialog invariati); nei due dialog AIGEN le fasi `generating`/`review`/`applying` diventano **explicit-dismiss only** — backdrop ed Escape ignorati, nessun `onClose` involontario, proposta e modifiche locali intatte. L'uscita durante la review passa da una conferma leggera inline (stesso pattern della conferma di applicazione, nessun dialog annidato): «Abbandonare la proposta generata? Le modifiche non applicate andranno perse.» con **tre azioni esplicite**: «Continua la revisione» (chiude solo la conferma, proposta e modifiche locali intatte), «Modifica configurazione» (scarta la proposta e torna alla fase `configure` **senza chiudere il dialog**, con nuova `requestId` e conservando profilo/stile/profondità/quantità/indicazioni già scelti — nessuna callable, write o costo) e «Abbandona e chiudi» distruttivo, unico a invocare `onClose` (una sola volta, doppio click protetto). Le tre azioni si impilano a tutta larghezza sotto i 480px: layout ordinato e senza overflow a 390 e 320 px. **Applicazione diretta**: «Crea pool»/«Aggiungi al pool» avviano subito il flusso canonico al primo click — la conferma intermedia «Verrà creato un pool con N domande» è stata rimossa perché ridondante dopo configurazione, stima, generazione e revisione; il doppio click resta impedito dalla guardia sincrona `applyStartedRef`, e un errore di validazione o salvataggio lascia il dialog in review con proposta e modifiche locali integre (nessun pool parziale, nessuna chiusura automatica). Gate GAIGEN **invariato**.

> **LESSON-MANUAL-02 applicato allo split tuning esteso:** rubrica 15×0–4 e protocollo restano congelati; gli 8 campioni baseline economy sono stati prodotti da LESSON-TUNE-01 e sottoposti a review tecnica. Verdetto baseline: **REVISIONE_SOSTANZIALE**; conferma disciplinare e visiva docente ancora obbligatoria. Evidenza: `evidenze/lesson-tune-01-baseline-review.md`.

> **LESSON-MANUAL-03 implementato:** il runner locale protetto resta dry-run di default, usa versioni congelate, Node 22, TTY, frase esatta e chiave letta per ultima; output/report restano in `functions/lib/` gitignored, zero Firestore/Storage. L'esecuzione reale corrente è avvenuta tramite il runner esteso LESSON-TUNE-01; ogni ulteriore lotto richiede nuova autorizzazione.
>
> **LESSON-TUNE-01 — baseline e candidati A–D:** baseline, A e B sono stati valutati; C è stato eseguito 8/8 su `economy`, senza Firestore/Storage. Sette costi noti sommano 27.618 µUSD, ma `LT01-09` ha billing risk: totale effettivo non determinabile, tetto prudenziale 218.798 µUSD. C corregge massa/peso e struttura, ma resta **REVISIONE_SOSTANZIALE** per un esercizio IPv4 con premesse incompatibili. Il candidato `lesson-tune-01-candidate-d-v1` aggiunge soltanto audit generale di compatibilità delle premesse e precisione terminologica. Dopo il congelamento, il percorso quality ha completato tuning e holdout con 12/12 PASS; dettagli nelle evidenze LESSON-TUNE-MODEL-02 e LESSON-TUNE-HOLDOUT-01.
>
> **LESSON-TUNE-MODEL-01:** il candidato D economy resta respinto per due blocker (`LM02-02` IPv4 e `LM02-03` calore). Nessun candidato E: il confronto successivo mantiene prompt D e otto casi tuning invariati e cambia soltanto il profilo chiuso in `quality` → `gpt-5.6-luna` + `v5-2026-07-20-luna-dev`. Il tuning quality ha risolto entrambi i blocker; i quattro holdout sono stati aperti soltanto dopo il congelamento e valutati separatamente.
>
> **LESSON-TUNE-MODEL-02:** confronto quality reale completato 8/8 sul prompt D invariato. Sette costi noti sommano 150.771 µUSD; `LM02-04` ha billing risk, quindi totale effettivo `null`; tetto 1.070.842 µUSD. Tutti gli scenari tuning sono `PASS`, inclusi i precedenti blocker IPv4 e calore; il successivo holdout separato ha confermato il verdetto **PROMPT_INVARIATO** su `quality`. Nessuna promozione runtime automatica. Evidenze: `evidenze/lesson-tune-06-quality-review.md` e `evidenze/lesson-tune-07-quality-holdout-review.md`.
>
> **LESSON-TUNE-HOLDOUT-01 completato:** esecuzione reale unica dei quattro holdout congelati sul percorso esplicito `quality + holdout`, con prompt D, dataset, payload e token cap invariati. Tutti i campioni sono `PASS`, senza blocker; costo effettivo 124.993 µUSD (0,124993 USD), nessun billing risk, zero Firestore/Storage. Insieme al tuning quality: 12/12 `PASS`, verdetto finale **PROMPT_INVARIATO**; nessun candidato E. Evidenza: `evidenze/lesson-tune-07-quality-holdout-review.md`. La promozione runtime resta separata e subordinata al Gate GAIGEN.
>
> **AIGEN-01-REVIEW-FIX-2 (blocker risolti).** (1) **Preview indipendente dal provider**: `selectContentProvider({withProvider})` costruisce il provider **solo** per `generate`; la preview (`withProvider=false`) non lo costruisce e non tocca il secret, mentre `generate` openai senza secret resta `provider_config_invalid` prima di reserve/rete (test di wiring concreto, non solo sul core). (2) **Retry riuscito dopo billing risk**: il runner propaga `priorBillingRisk` fino all'engine; un successo dopo un tentativo incerto salva il contenuto valido ma con `actualCostMicroUsd = null` e `settledCostMicroUsd = reservation cap` (mai sotto-contabilizzare); output invalido dopo billing risk → settlement conservativo. (3) **`markProviderPending` fail-closed** (`canMarkProviderPending`, transazione): richiede run `running` + lease valida + `executionId` **e** prenotazione esistente, `reserved`, di importo == `reservedCostMicroUsd`; qualunque incoerenza → `false`, zero chiamate provider. (4) **Ordine auth**: `auth → owner → AI_CONTENT_MODE/kill switch → payload` (un anonimo riceve `unauthenticated` prima di `feature_disabled`). (5) **Replay fail-closed rafforzato**: `parseStoredRunDocument` verifica la coerenza output↔kind (lesson→`{body}` entro limite, pool→`{questions}` non vuoto; output scambiato/malformato → `null`).
>
> **AIGEN-01-REVIEW-FIX (blocker risolti).** (1) **Feature switch dedicato** `AI_CONTENT_MODE` (`disabled|mock|openai`, default+ignoti → `disabled`, nessun fallback) in `aiContentCore.resolveAiContentMode`, distinto da `AI_CORRECTION_MODE`: la correzione IA resta invariata; `disabled` → `feature_disabled` **prima** di provider/secret/lease/budget/write. (2) **Provider OpenAI realmente cablato** riusando il transport Responses API della correzione (`OpenAiTransport`/`createOpenAiSdkTransport`) tramite il runner condiviso `openAiStructuredRunner` (stessa policy retry/timeout/classificazione errori, nessun nuovo client): Structured Output strict, modello server-side, `max_output_tokens` reale, secret letto **solo** su `generate` in mode `openai`; mock a rete zero e usage zero espliciti; openai senza secret/transport → `provider_config_invalid` prima della rete. (3) **Preview senza secret** (nessun binding `OPENAI_API_KEY`, nessun provider/prenotazione/scrittura; solo `feature_disabled` se disabled). (4) **Prenotazione conservativa distinta dalla stima**: `estimatedCostMicroUsd` (UI) vs `reservationCostMicroUsd = ceil(byteUTF8(payload esatto) input + hard max_output_tokens) × tentativi`; vale `actual ≤ settled ≤ reservation`. (5) **Macchina budget `reserved → pending → reconciled`**: `markProviderPending` gated dalla lease **subito prima** del provider (se fallisce, provider non chiamato); reconcile/finalize gated dalla lease; crash: reserved scaduta → rilascio, pending scaduta → addebito tetto, worker vecchio dopo takeover → no-op. (6) **Errori/usage tipizzati** (pre-invocazione vs invocazione-incerta): mock costo zero; openai con usage valido → costo effettivo; openai senza usage valido o invocazione-incerta → settlement conservativo della reservation; output invalido con usage valido → costo effettivo, nessun `completed`. (7) **Lease derivata** da `attemptTimeout × tentativi + backoff + margine finalizzazione` (≥ 5 min, > intera finestra timeout+retry); `crypto.randomUUID()` per `executionId`. (8) **TTL Firestore reale**: `expireAt`/`createdAt`/`updatedAt`/`leaseExpiresAt` come `Timestamp` (adapter `aiContentRunDoc`); policy TTL configurata solo al rollout. (9) **Parser fail-closed** del run (`parseStoredRunDocument`, niente `as`): valida contractVersion/kind/status/inputHash/modello/costi/lease/expireAt e coerenza output↔stato; legacy/malformato/`completed` senza output → `null` (mai replay). (10) **inputHash** dalla serializzazione canonica dell'**intera** richiesta normalizzata (tutti i campi, niente `join` artigianali). (11) **Limiti dell'intero payload** (numero/lunghezza concetti-obiettivi, titoli/UDA, `existingPoolQuestionCount`, dimensione UTF-8 complessiva). (12) **Bound prudenziale del documento run completo** (output + metadati + overhead < 1 MiB) prima della write `completed`. (13) **Structured Output strict discriminato** pool (aperta/chiusa_singola/chiusa_multipla, nessuna `soluzione` non vincolata); validator runtime resta autorevole.
>
> Ambito di AIGEN-00 (PR originale): **solo nuovi file** — questo documento, i due prototipi statici `documentazione/prototipi/ai-pool-generator.html` e `documentazione/prototipi/ai-lesson-generator.html`, e l'evidenza di review `documentazione/evidenze/aigen-00-review.md`. Nessun file applicativo, test runtime, Function, Rule, indice, configurazione, dipendenza o documento generale esistente è modificato.

## 0. Obiettivo

Progettare in modo definitivo due funzionalità, **riusando l'infrastruttura IA esistente** (correzione IA M5/TWU-02) come modello architetturale, ma **senza riusare il dominio della correzione** (submission, punteggi, feedback, `aiCorrectionRuns`):

1. **Generazione pool** — l'IA propone un pool `schoolforge-pool/v2` di domande a partire dal testo di una lezione.
2. **Generazione lezione** — l'IA propone una bozza Markdown del corpo di una lezione.

Entrambe restano **owner-only**, con profili modello astratti `economy`/`quality`, mapping modello/listino esclusivamente server-side, OpenAI Responses API + Structured Output, kill switch, config runtime fail-closed, budget mensile, stima/prenotazione/riconciliazione del costo, timeout e retry controllato, `requestId`/idempotenza, telemetria tecnica privacy-minimal, documenti tecnici non leggibili dal client e **nessun fallback silenzioso tra modelli**.

---

## 1. Inventario del riuso reale (sola lettura)

Ispezione read-only dell'infrastruttura esistente. Percorsi verificati il 23 luglio 2026.

### 1.1 Componenti realmente riusabili (come **pattern**, non come dominio)

| Componente | Percorso | Cosa si riusa |
|---|---|---|
| Profili modello chiusi | `functions/src/aiCorrectionModelProfile.ts` | `ModelProfile = 'economy' \| 'quality'`, `MODEL_PROFILE_RESOLUTIONS` (economy→`gpt-5.4-nano` @ listino v2; quality→`gpt-5.6-luna` @ listino v5-luna-dev), `parseModelProfileField` (puro, fail-closed, mai throw). **Riuso diretto del modulo** (import), non duplicazione. |
| Listino prezzi versionato | `functions/src/aiCorrectionCost.ts` | `PRICE_LISTS`, `lookupModelPrice`, `tokenCostMicroUsd` (arrotondamento `ceil` per stima/prenotazione, `nearest` per costo reale), micro-USD interi (`USD_MICRO = 1_000_000`), `estimateCostBreakdown`, `actualCostMicroUsd`. **Riuso diretto**. |
| Config runtime / kill switch | `functions/src/aiCorrectionRuntimeConfig.ts` | `settings/aiConfig` (Admin-only, mai al client): `enabled`, `provider:'openai'`, `environment:'dev'`, `limits`, `maxOperationCostMicroUsd (≤250_000)`, `dailyBudgetMicroUsd (≤1_000_000)`, `monthlyBudgetMicroUsd (≤5_000_000)`, `RUNTIME_MODEL_PRICE_LISTS` (coppia modello→listino autoritativa). Fail-closed: assente/incompleto/`enabled=false` ⇒ provider reale disabilitato. **Riuso diretto della porta di lettura config**. |
| Budget ledger | `functions/src/aiCorrectionBudget.ts` | Ledger mensile con aggregati giornalieri, `reserve`/`markPending`/`reconcile`, settlement delle prenotazioni scadute, `availableMicroUsd`/`availableDailyMicroUsd`, idempotenza per `requestId`. **Riuso diretto** (stesso ledger, chiavi `requestId` distinte). |
| Guardrail limiti | `functions/src/aiCorrectionLimits.ts` | `enforceOperationLimits` + `DEV_LIMITS` (concurrency 3, `attemptTimeoutMs 60_000`, `maxApplicationRetries 1`). **Riuso del pattern**; per AIGEN servono limiti nuovi orientati ai contenuti (§8). |
| Errori tipizzati + ordine controlli | `functions/src/aiCorrectionGatewayCore.ts` | `AiGatewayError`/`AiGatewayErrorCode`, `resolveAiFeatureMode`, ordine **auth → owner → feature flag → input**. **Riuso del pattern e della classe errore** (estesa con codici nuovi, §Error codes). |
| Transport provider | `functions/src/openAiGrader.ts`, `aiCorrectionProvider.ts` | Chiamata **Responses API** con **Structured Output**, timeout per tentativo, retry classificato (`retryPolicy`), estrazione usage token. **Riuso del transport**; lo *schema* di output è nuovo (pool/lezione). |
| Run tecnico | `functions/src/aiCorrectionEngine.ts` | `aiCorrectionRuns/{requestId}` privacy-minimal (`AI_RUN_CONTRACT_VERSION=2`, retention approvata, lease, `status`, token/costo stimati/reali). **Riuso del pattern**, **NON** della collection (§5). |
| Preferenze IA docente | TWU-02 (`teacherAiPreferences/{ownerUid}`) | Il profilo modello di default owner-only è già un contratto chiuso. AIGEN può leggerlo come default, senza nuovi campi. |
| Contratto pool | `packages/lesson-contract/src/{parser,serializer,maxCharacters,types}.ts` | `parsePool`/`serializePool` `schoolforge-pool/v2`: `difficolta` intera 1–5, `maxPoints === difficolta`, **no `peso`**, `maxCharacters` solo aperte (contratto `DEFAULT 2000`, range `[1,10000]`; in generazione AIGEN-PROMPT-01 il valore iniziale è **derivato dalla difficoltà** via `maxCharactersForDifficulty`, editabile dal docente). **Riuso diretto** per validazione finale. |
| Limite dimensione lezione | `apps/web/src/features/repository/programs/lessonContentSize.ts` | `MAX_LESSON_CONTENT_BYTES = 700_000` (UTF-8), `utf8ByteLength`, `assertLessonContentSize`. **Riuso diretto** come cap dell'output lezione. |
| Callable client | `apps/web/src/features/repository/corrections/aiCorrectionClient.ts` | Pattern `httpsCallable` con payload chiuso e `requestId`; callable esistenti `aiCorrectionPreview`/`aiCorrectionRun`. **Riuso del pattern**; nuovi callable dedicati (§2). |

### 1.2 Componenti da **non** riusare

- `aiCorrectionRuns` (collection): appartiene al dominio correzione (submission/verifica). AIGEN usa `aiContentRuns` (§5).
- `aiCorrectionEngine` end-to-end: modella `submission → grading → correctionWrite`. AIGEN genera **contenuti**, non valuta consegne. Si riusa il *pattern* (reserve→provider→validate→reconcile→finalize), non il flusso.
- `aiCorrectionGateway.ts` (onCall correzione), `validateAiCorrectionRequest`, `assertTeacherQuestionV2Invariant`, scoring, `correctionReturns`, feedback, `submissionIds`, `verificationId`: dominio consegne, fuori scope.
- Persistenza automatica del risultato nel dominio didattico: AIGEN **non** scrive mai pool/lezione senza conferma esplicita del docente (§Operazione 1/2).

### 1.3 Nuovi contratti necessari

- Callable `aiContentPreview` / `aiContentGenerate` con payload chiuso discriminato `kind: 'pool' | 'lesson'`.
- Motore condiviso **AI Content Generation** (`aiContentCore` + `aiContentEngine`) con guardrail e ordine fail-closed riusati da entrambe le operazioni.
- Schemi Structured Output nuovi: `PoolGenerationOutput`, `LessonGenerationOutput`.
- Prompt builder separati `poolGenerationPrompt` / `lessonGenerationPrompt` con gerarchia e difese injection (§Prompt).
- Collection tecnica `aiContentRuns/{opaqueRunId}` con TTL 24h (§5).
- Cost model dedicato ai contenuti (§Cost model) sui listini server-side già presenti.

### 1.4 Limiti tecnici già presenti nel repository (vincolanti)

- **Documento Firestore ≤ 1 MiB.** Il corpo lezione condivide il documento `publicLessons`/`lessons`: il cap riusato è `MAX_LESSON_CONTENT_BYTES = 700_000` byte UTF-8.
- **Costo per operazione ≤ 250_000 µUSD (0,25 USD)**, budget giornaliero ≤ 1 USD, mensile ≤ 5 USD (`aiCorrectionRuntimeConfig`). Non aumentabili via Firestore.
- **Un solo retry applicativo** (`maxApplicationRetries = 1`) e **timeout 60 s** per tentativo.
- **Pool v2**: difficoltà intera 1–5, `maxPoints === difficolta`, no `peso`, `maxCharacters` solo aperte.

> **Gap rilevati.** Nessun conflitto bloccante con l'architettura esistente. Un solo punto d'attenzione, non bloccante: i codici errore di `AiGatewayErrorCode` sono orientati alla correzione (`batch_limit_exceeded`, `submissionIds`); AIGEN-01 dovrà **estendere** l'enum con codici propri (§Error codes) senza rimuovere quelli esistenti. Documentato qui, non risolto con workaround.

---

## 2. Architettura condivisa da congelare

### 2.1 Callable

Due callable server-side dedicati (nomi **congelati**):

- **`aiContentPreview`** — nessuna chiamata provider, nessuna generazione, nessuna prenotazione budget.
- **`aiContentGenerate`** — una sola generazione logica (una chiamata provider per tentativo, max 1 retry).

Il client **non** invia mai: model ID tecnico, `priceListVersion`, prezzi, budget, API key, system prompt, parametri arbitrari del provider. Il server risolve **sempre** modello e listino dal profilo tramite `MODEL_PROFILE_RESOLUTIONS` (mapping chiuso).

### 2.2 Payload chiuso (discriminato)

Campi ammessi dal client (qualsiasi altra proprietà ⇒ `invalid_input`):

**Comuni**
- `requestId: string` (UUID client, stabile tra i retry della stessa operazione)
- `kind: 'pool' | 'lesson' | 'concept_map'`
- `modelProfile: 'economy' | 'quality'`
- `teacherGuidance?: string` (trim, ≤ 500 caratteri, nessun troncamento silenzioso — oltre ⇒ `invalid_input`)

`teacherGuidance` e `modelProfile` libero valgono per `pool` e `lesson`: la
mappa concettuale (§ 6bis) ha un payload proprio e più povero, e non li ammette.

**`kind: 'pool'`** → `poolConfig`:
- `level: 'base' | 'balanced' | 'advanced'` (range difficoltà: base 1–3, balanced 1–5, advanced 3–5)
- `counts: { aperta: number; chiusa_singola: number; chiusa_multipla: number }` (ogni valore intero ≥ 0; totale ≥ 1 e ≤ 30)
- `lessonContext`: metadati + testo lezione (materiale didattico, delimitato e non attendibile), entro i cap di input (`content_too_large`, §8.1)
- `existingPoolQuestionCount?: number` — **solo** contesto quantitativo (quante domande esistono già). **Non** è un meccanismo di anti-duplicazione: un semplice conteggio non consente di rilevare duplicati semantici. Gli ID tecnici del pool esistente **non** sono mai inviati né generati dal modello (§5.4).

**`kind: 'lesson'`** → `lessonConfig`:
- `depth: 'synthetic' | 'complete' | 'in_depth'`
- `context`: `{ titolo?, sottotitolo?, concettiChiave?: string[], obiettivi?: string[], currentBody?: string, udaTitle? }` — solo dati **già in memoria** nell'editor; nessuna nuova query per arricchire il prompt
- `hasCurrentContent: boolean`

**`kind: 'concept_map'`** (CONCEPT-MAP-01, implementato):
- `modelProfile: 'economy'` — **fisso**, non un default: `quality` è rifiutato,
  mai degradato in silenzio;
- `lessonBody: string` — corpo Markdown della lezione, non vuoto, entro
  `MAX_LESSON_SOURCE_BYTES` (200.000 byte UTF-8), **non normalizzato** (nessun
  trim: al prompt arriva ciò che è realmente salvato, e l'`inputHash` copre quel
  testo);
- nient'altro. Niente titolo, metadati, UDA, indice, pool o indicazioni docente:
  la mappa deve poter affermare soltanto ciò che è ricavabile dal corpo, e ciò
  che non riceve non può contraddirlo. Qualunque proprietà extra ⇒
  `invalid_input`.

### 2.3 Ordine dei controlli (fail-closed)

Nessuna chiamata provider parte se un controllo precedente fallisce:

1. autenticazione (`unauthenticated`)
2. owner autorizzato (`not_owner`)
3. feature flag / kill switch (`feature_disabled`)
4. validazione payload chiuso (`invalid_input`)
5. validazione dimensioni input (`content_too_large` / `limit_exceeded`)
6. risoluzione profilo → modello/listino (`provider_config_invalid`)
7. stima e limiti (`limit_exceeded` / `operation_budget_exceeded`)
8. lease/idempotenza (replay noto → risultato o `running`)
9. prenotazione budget (`budget_exceeded` / `daily_budget_exceeded` / `budget_unavailable`)
10. provider (una chiamata; retry ≤ 1)
11. validazione output (`output_invalid` / `output_too_large`)
12. persistenza temporanea del risultato in `aiContentRuns`
13. riconciliazione costo (reserve → actual)
14. finalizzazione run (`completed`)

`aiContentPreview` esegue **solo 1–7** (senza prenotazione né provider) e restituisce la stima.

### 2.4 PREVIEW — comportamento

`aiContentPreview`: non chiama il provider, non genera, non prenota budget, non crea listener/polling. Calcola input stimato, output massimo, tentativi massimi e **costo prudenziale** con la **stessa formula del run**. Restituisce il **modello astratto** mostrabile (`economy`/`quality`), mai il model ID reale né la API key. Applica gli stessi limiti del run: se un limite è superato, restituisce l'error code corrispondente (nessuna generazione).

### 2.5 GENERATE — comportamento

`aiContentGenerate`: **una sola generazione logica**, **una sola chiamata provider per tentativo**, **massimo un retry** applicativo/tecnico (come `maxApplicationRetries = 1`). **Nessuna** seconda chiamata "critica"/"revisore". Output **Structured Output**. Validazione **completa** prima di restituire. **Nessuna scrittura automatica** al pool o alla lezione: il risultato è solo proposto.

---

## 3. Idempotenza e recupero risultato — `aiContentRuns`

Collection tecnica **distinta** da `aiCorrectionRuns`, **server-only**.

### 3.1 Id documento e chiave budget (fingerprint pseudonimi)

**`opaqueRunId`** = **SHA-256 completo** (esadecimale, non troncato) della **serializzazione canonica e non ambigua** della tupla:

```
["ai-content/v1", authenticatedOwnerUid, requestId]
```

La serializzazione è canonica (es. `JSON.stringify` dell'array di stringhe, che è già deterministico e non ambiguo perché ogni elemento è delimitato), **mai** una semplice concatenazione di stringhe (che confonderebbe `a`+`bc` con `ab`+`c`). `opaqueRunId` è **sempre calcolato server-side dall'UID autenticato** (`request.auth.uid`) e **non è mai accettato dal client**.

**Chiave di prenotazione budget** — le prenotazioni su `aiBudgetLedger` **non** usano direttamente `requestId` (potrebbe collidere con una `requestId` della correzione IA sullo stesso ledger). Chiave tecnica **namespaced e opaca**:

```
budgetReservationKey = SHA-256( canonical(["ai-content/v1", authenticatedOwnerUid, requestId]) )
```

(stessa tupla e stessa serializzazione canonica dell'`opaqueRunId`). La chiave **non** contiene UID né `requestId` in chiaro e vive in uno spazio di chiavi distinto da quello della correzione.

> **Natura del dato.** `opaqueRunId`, `budgetReservationKey` e `inputHash` sono **fingerprint pseudonimi**, **non** dati anonimi: derivano in modo deterministico dall'UID autenticato e dal `requestId`, quindi sono ricollegabili all'owner da chi possiede quei valori. Nel documento **non** compaiono UID in chiaro né ID didattici in chiaro, ma il documento **non** è anonimo e resta **server-only**.

### 3.2 Contratto del run (campi persistiti)

- `contractVersion` (intero)
- `kind` (`'pool' | 'lesson'`)
- `status` (`'running' | 'completed' | 'failed'`)
- `inputHash` (hash del payload normalizzato: kind, profilo, config, guidance, materiale — **hash, non testo**; fingerprint pseudonimo)
- `budgetReservationKey` (chiave namespaced opaca usata sul ledger, §3.1 — mai UID/requestId in chiaro)
- `modelProfile` (`economy`/`quality`)
- `model` e `priceListVersion` risolti **server-side**
- token stimati/reali (`estimatedInput`, `maxOutput`, `actualInput`, `actualOutput`)
- costo `estimatedMicroUsd` / `reservedMicroUsd` / `actualMicroUsd`
- lease/execution metadata (`leaseOwner` opaco, `leaseExpiresAtMs`, `attemptsTotal`)
- `output` strutturato generato (pool JSON o corpo Markdown), entro il cap §3.4
- `createdAt` / `updatedAt`
- `expireAt` (per TTL Firebase)

### 3.3 Cosa **non** viene persistito

Testo sorgente della lezione; `teacherGuidance`; prompt (system o assemblato); API key; email/nome docente; UID in chiaro; dati studenti; **raw response** del provider. Il risultato strutturato è conservato **solo** per rendere idempotente il replay ed evitare di perdere una generazione **già pagata** in caso di interruzione di rete.

### 3.4 Cap dimensionale dell'output persistito

Il limite Firestore di 1 MiB riguarda **l'intero documento** — tutti i campi, le stringhe UTF-8 e l'overhead di serializzazione — **non** il solo campo `output`. Per questo l'output temporaneo ha un cap **più prudente** di quello della lezione salvata, e la scrittura è preceduta da un **controllo della dimensione complessiva stimata del documento**.

- **Limite canonico della lezione salvata**: **`MAX_LESSON_CONTENT_BYTES = 700_000`** byte UTF-8 — **invariato** (contratto esistente `lessonContentSize.ts`, riguarda il documento lezione canonico).
- **Limite dell'output temporaneo in `aiContentRuns`**: **≤ 600_000 byte** UTF-8 per il campo `output` (pool o corpo lezione). Più prudente dei 700_000 canonici, così i restanti campi tecnici del run (hash, metadata, lease, costi) restano sotto 1 MiB.
- **Pool**: massimo 30 domande, dentro lo stesso cap 600_000 byte.
- **Mappa concettuale**: **≤ 32_000 byte** UTF-8 (`MAX_CONCEPT_MAP_OUTPUT_BYTES`),
  applicati al **documento composto** e non ai campi grezzi — è il documento che
  verrà persistito e proiettato. Due ordini di grandezza sotto la lezione: una
  mappa lunga è una mappa fallita.
- **Controllo pre-scrittura**: la dimensione complessiva stimata del documento `aiContentRuns` è verificata **prima** della persistenza.

Un output oltre il limite temporaneo **fallisce prima della persistenza** (`output_too_large`), **senza** provider replay incompleto e **senza** scrivere un documento sovradimensionato. Il costo già speso resta registrato solo se il run può essere persistito entro i limiti; altrimenti la generazione è respinta come fallita in modo pulito.

### 3.5 Retention (congelata)

- **`expireAt = createdAt + 24h`**.
- La **cancellazione TTL non è immediata** ed è una **delete Firestore fatturabile** (una scrittura per documento eliminato): il TTL è cleanup **differito**, senza alcuna promessa di eliminazione puntuale.
- La **TTL policy** della collection group `aiContentRuns` (campo `expireAt`) va **configurata durante il rollout** (console/`gcloud firestore`), **non** implicitamente dal codice applicativo. Finché non è configurata, i documenti restano fino a cancellazione manuale.
- Il **provider reale resta disabilitato** (kill switch) finché **Rules, TTL policy e smoke DEV** non sono verificati.
- `aiContentRuns` contiene **output generato potenzialmente sensibile** (testo lezione/pool) e resta **server-only**: Rules negano lettura/scrittura diretta dal client (§8.1/AIGEN-01).
- Replay **soltanto** tramite callable dopo **nuova autorizzazione** (auth+owner+feature+budget rifatti).
- **Nessun listener, polling o scheduler.**

### 3.6 Semantica replay (stesso `requestId`)

| Situazione | Esito |
|---|---|
| Run `completed`, stesso `inputHash` | Restituisce lo **stesso** risultato; **zero** nuova chiamata/costo |
| Run `running` con lease valida | `running` (nessuna seconda chiamata) |
| Run `running` con lease **scaduta** | Takeover controllato (nuova lease), un tentativo consentito |
| Stesso `requestId`, `inputHash` **diverso** | `invalid_input` |
| Run legacy/malformato | Fail-closed (`provider_config_invalid`) |

**Replay vs modifiche del docente.** `aiContentRuns` conserva **la proposta originale del modello**. Le modifiche fatte dal docente nella preview (edit/elimina di una domanda proposta, edit del Markdown della bozza):

- restano **locali** finché il docente non preme `Aggiungi al pool`/`Crea pool` (pool) o `Usa questa bozza` (lezione);
- **non** modificano `aiContentRuns`;
- vengono persistite **soltanto** tramite i servizi canonici (pool → `poolEditorService`; lezione → draft locale dirty poi `Salva` canonico dell'editor);
- un **replay** dello stesso `requestId`/`inputHash` restituisce la **proposta originale**, **non** le modifiche locali non salvate.

---

## 4. Gerarchia prompt e sicurezza

Due prompt builder **separati**: `poolGenerationPrompt`, `lessonGenerationPrompt`. Gerarchia obbligatoria (dal più autorevole al meno):

1. sicurezza, schema e limiti server (system, non sovrascrivibile);
2. contratto dell'operazione (pool v2 / corpo lezione);
3. quantità/range/profondità scelti dal docente;
4. metadati didattici autorevoli (titolo, concetti, obiettivi);
5. indicazioni del docente **compatibili**;
6. testo della lezione / bozza corrente come **contenuto non attendibile**.

Il materiale della lezione, il draft e le indicazioni sono **delimitati** (blocchi marcati) e trattati come **dati**, mai come system instructions.

### 4.1 Resistenza prompt injection

- Frasi nel Markdown tipo "ignora le istruzioni precedenti" **non** vengono eseguite.
- Il testo sorgente **non** può cambiare schema, quantità, range o modello.
- Le indicazioni docente **non** possono richiedere output fuori schema.
- Nessun contenuto può richiedere tool, rete, file, segreti o chiamate esterne.
- **Nessun dato studente** entra nei prompt.
- Il modello **non** sceglie il proprio modello o costo.
- Output estraneo o incompleto ⇒ **rifiutato integralmente** (Structured Output + validazione post).

### 4.2 Requisiti pool prompt
Esatto numero di domande per tipo; intervallo difficoltà corretto; domande autonome e non ambigue; distrattori plausibili; soluzioni coerenti; **nessuna conoscenza sostanziale inventata** (fondata sul testo della lezione); varietà senza duplicazioni; lingua coerente con la lezione.

### 4.3 Requisiti lezione prompt
Tono scolastico professionale; chiarezza didattica; coerenza con obiettivi/concetti; struttura Markdown sobria; niente stile blog/marketing/social; nessun fatto non verificabile presentato come certo; nessun riferimento al fatto che il testo sia generato da IA; **nessun front matter o HTML**.

---

## 5. Operazione 1 — Generazione pool

### 5.1 Posizione UI (congelata)
- **Pool assente**: `Crea pool` · `Genera con IA`.
- **Pool esistente** (toolbar del pool): `Nuova domanda` · `Genera domande con IA` · `Modifica YAML` · `Elimina pool`.

Disponibile sia per creare il primo pool sia per aggiungere domande a un pool esistente.

### 5.2 Dialog configurazione
1. **Profilo**: Economy / Quality.
2. **Livello**: Base (1–3) / Bilanciato (1–5) / Avanzato (3–5).
3. **Quantità per tipo**: aperte, risposta singola, risposta multipla — interi ≥ 0, totale ≥ 1, **max 30**, nessun campo libero per tipi non supportati.
4. **Indicazioni**: opzionale, trim, **≤ 500** caratteri, contatore, nessun troncamento silenzioso.
5. **Riepilogo**: numero totale, distribuzione per tipo, intervallo difficoltà, token stimati, costo massimo stimato, profilo.

### 5.3 Flusso
Configura → calcola stima → conferma la spesa → genera → visualizza domande → modifica/elimina proposte → conferma `Aggiungi al pool`/`Crea pool` → solo allora il **service canonico** del pool (`poolEditorService`) scrive. **L'IA non salva direttamente.**

- **Pool assente**: genera un nuovo `schoolforge-pool/v2`; applicazione solo dopo conferma; write canonica.
- **Pool esistente**: **aggiunge** le nuove domande; non sovrascrive/cancella le esistenti; **ID tecnici generati dal sistema** (mai dal modello); collisioni ID risolte dal sistema prima del salvataggio; pool risultante **validato integralmente** (`parsePool`) prima della write.

### 5.4 Output strutturato pool + pipeline ID tecnici

Il provider restituisce **contenuti semantici**, **mai** ID tecnici persistiti. Per ogni domanda: tipo supportato; difficoltà intera nel range; testo; soluzione; `maxCharacters` per le aperte (contratto esistente); opzioni e soluzione coerenti per le chiuse. Per le chiuse il modello riferisce la soluzione alle opzioni tramite un **riferimento locale non autorevole** (es. indice/lettera d'opzione nella risposta), che il server usa solo per ricostruire la relazione — **non** come ID persistito.

**Pipeline deterministica provider → mapper ID → parsePool → applicazione** (risolve la contraddizione «il provider non genera ID» ↔ «`schoolforge-pool/v2` richiede identificativi validi»):

1. il provider restituisce **domande strutturate senza ID persistiti** (Structured Output);
2. il **server valida** struttura, tipo, difficoltà, soluzione e opzioni (coerenza semantica, quantità esatte, range);
3. all'**applicazione**, un **mapper deterministico** assegna `questionLocalId` e `optionId` **validi e non collidenti** (generati dal sistema, univoci nell'intero pool risultante, inclusi gli ID già esistenti in caso di pool esistente);
4. viene costruito il **documento `schoolforge-pool/v2` completo** (con gli ID assegnati, `maxPoints === difficolta`, nessun `peso`);
5. **`parsePool` valida il documento finale** prima della scrittura **canonica** (`poolEditorService`).

**Nessun ID prodotto dal modello è considerato autorevole.**

Validazioni obbligatorie (fail-closed, rifiuto integrale): quantità esatta per ogni tipo; totale esatto; difficoltà nel range; `maxPoints === difficolta`; risposta singola con **una** sola soluzione; multipla con **almeno una** soluzione valida; soluzione **contenuta** nelle opzioni; opzioni senza ID duplicati (garantito dal mapper); **nessun `peso`**; nessun campo estraneo; parser finale `schoolforge-pool/v2`; limite dimensionale. La generazione si basa sul testo della lezione e **non inventa** nozioni sostanziali non supportate.

**Anti-duplicazione (onesta).** `existingPoolQuestionCount` è solo contesto quantitativo e **non** rileva duplicati semantici. Per AIGEN-01 **non** si invia l'intero pool esistente al modello: si eviterebbe di pagare token extra per una **falsa** garanzia di deduplicazione. Il modello genera una proposta; **il docente elimina o modifica** eventuali duplicati nella preview prima di applicare.

### 5.5 Anteprima risultato
Mostra tipo, difficoltà, preview domanda, soluzione, opzioni (dove presenti), modifica, elimina proposta, conteggio finale aggiornato, **costo reale** della generazione, pulsante finale di applicazione. Chiudere il dialog prima dell'applicazione **non** modifica il pool.

---

## 6. Operazione 2 — Generazione lezione

### 6.1 Posizione UI (congelata)
Nel **MarkdownBodyEditor**, accanto ai comandi dell'editor: `Genera con IA`. **Non** nella vista di sola lettura, **non** nei menu UDA/corso.

### 6.2 Dialog configurazione
1. **Profilo**: Economy / Quality.
2. **Profondità**: Sintetica / Completa / Approfondita.
3. **Indicazioni**: opzionali, ≤ 500, trim, nessun troncamento silenzioso.
4. **Contesto (sola lettura)**: titolo, sottotitolo, concetti chiave, obiettivi, presenza/assenza di contenuto attuale.
5. **Riepilogo stima**: token input/output, costo massimo, profilo, avviso sul comportamento della bozza.

### 6.3 Contesto inviato
Entro limiti chiusi: metadati lezione; corpo Markdown attualmente nell'editor; indicazioni docente; eventuale contesto minimo dell'UDA **già caricato** se realmente disponibile senza nuove query. **Nessuna nuova lettura** solo per arricchire il prompt.

### 6.4 Semantica
- Editor vuoto → genera una nuova bozza.
- Editor con contenuto → il modello produce una **nuova versione completa** usando il testo corrente come contesto; l'interfaccia avverte chiaramente che la bozza **sostituirà** il testo nell'editor; **non** salvata automaticamente.

Copy vincolante: **«La bozza generata sostituirà il testo nell'editor. La lezione non verrà salvata finché non premi Salva.»**

### 6.5 Risultato
Anteprima Markdown + **costo reale**; `Usa questa bozza` · `Annulla`.

`Usa questa bozza`: sostituisce **esclusivamente** il draft locale del MarkdownBodyEditor; marca l'editor **dirty**; **non** chiama il service di salvataggio; **non** aggiorna Storage/Firestore/publicLessons; il docente modifica liberamente; il normale `Salva` esegue poi il flusso canonico esistente; dirty guard e `Annulla` continuano a funzionare.

### 6.6 Output lezione
Il provider restituisce **esclusivamente** corpo Markdown: nessun front matter, nessuno script, nessun metadato tecnico, nessun path, nessun ID Firestore/Storage.

Validazioni: stringa non vuota; UTF-8 valido; dimensione entro `MAX_LESSON_CONTENT_BYTES`; **nessun front matter** (YAML `--- … ---` iniziale) — vietato e rifiutato; Markdown renderizzabile; struttura coerente con titolo/concetti/obiettivi; **nessun salvataggio se output invalido**.

**Strategia di sicurezza su Markdown/HTML (verificabile, non una falsa garanzia regex).** La sicurezza **non** si basa su una promessa di «nessun HTML» ottenuta via regex assoluta — un filtro regex sull'HTML è notoriamente aggirabile. La difesa è a più livelli:
1. la **sanitizzazione già esistente nel renderer** (DOMPurify, `MarkdownRenderer`) resta il gate autoritativo a render-time e **non** viene modificata;
2. il **prompt vieta** esplicitamente HTML raw e front matter;
3. il **validator rifiuta** costrutti esplicitamente non ammessi (front matter YAML, blocchi `<script>`/`<style>`, tag noti pericolosi) come segnale di output non conforme → `output_invalid`, senza dichiarare copertura assoluta.

La bozza è comunque sempre renderizzata attraverso il renderer sanitizzato esistente, quindi la difesa finale contro XSS resta quella già in produzione, invariata.

---

## 6bis. Operazione 3 — Mappa concettuale (CONCEPT-MAP-01, implementato)

Contratto di prodotto e interfaccia: [`mappa-concettuale-roadmap.md`](mappa-concettuale-roadmap.md).
Qui si registra soltanto ciò che riguarda la generazione IA.

### 6bis.1 Struttura decisa dal server, non dal prompt

Il provider **non** produce il documento. Restituisce uno Structured Output
strict a tre campi — `outlineMarkdown`, `summaryMarkdown`, `diagram` — e il
server compone il Markdown canonico aggiungendo intestazioni, la fence del
diagramma e l'avvertenza, che è una **costante SchoolForge** e non un campo
dello schema.

Un prompt può chiedere quattro sezioni nell'ordine giusto; non può garantirle.
Così presenza e sequenza delle quattro parti sono proprietà del codice.

### 6bis.2 Contratto dei tre campi (fail-closed, nessun aggiustamento)

Comune ai tre campi: niente fence ```` ``` ````, front matter, heading ATX o
Setext, HTML (tag reali, commenti, doctype, CDATA), spazi iniziali o finali. Gli
spazi esterni sono **rifiutati esplicitamente** invece di essere normalizzati:
il documento composto deve restare riconoscibile byte per byte dal validator del
replay. Il controllo HTML è deliberatamente non generico su `<`, così un
confronto come «a < b» non diventa markup.

- `outlineMarkdown` — elenco Markdown annidato: ogni riga non vuota è una voce
  (`-`, `*`, `+`, indentazione libera), almeno una voce, nessuna prosa fuori
  elenco;
- `summaryMarkdown` — prosa: nessuna riga puntata, nemmeno parziale (un elenco
  qui duplicherebbe l'ossatura);
- `diagram` — albero a caratteri, ogni riga entro **80 code point** (i caratteri
  di disegno non contano doppio).

Nessun troncamento, nessuna rimozione, nessun riempimento: un output non
conforme è rifiutato per intero.

### 6bis.3 Documento persistito e replay

Il run persiste `{ conceptMapMarkdown }` — il **documento composto**, mai i tre
campi grezzi: è quello che CONCEPT-MAP-02 salverà e proietterà, quindi è quello
che il replay deve restituire.

La validazione in lettura non si accontenta di «stringa non vuota entro il cap».
Verifica: oggetto con **esattamente una chiave**; quattro parti presenti una sola
volta e nell'ordine canonico; **una sola** fence, correttamente chiusa;
avvertenza esatta; nessun contenuto dopo di essa oltre la newline finale; e le
tre sezioni estratte devono soddisfare gli stessi contratti dei campi generati.

L'oracolo finale è l'uguaglianza: se il documento non è byte per byte ciò che il
compositore avrebbe prodotto dalle sue stesse sezioni, non è canonico. Il replay
**non ricompone**: restituisce il Markdown persistito identico.

### 6bis.4 Versione del prompt

`AI_CONCEPT_MAP_PROMPT_VERSION` è **separata** da `AI_CONTENT_PROMPT_VERSION`,
che resta congelata nei benchmark di pool e lezione: un ritocco alla mappa non
deve invalidare misure che non la riguardano.

**Non è ancora persistita nel documento run** e non è usata per replay, audit o
confronto: esiste come costante, e nessun consumatore la legge. Cablarla adesso
avrebbe significato toccare il contratto del run senza un motivo. Va dichiarata
operativa solo quando un consumatore esisterà davvero.

---

## 7. Cost model (esempi indicativi, non garanzie)

Basato **esclusivamente** sui listini server-side già presenti (`aiCorrectionCost.PRICE_LISTS`). La **preview runtime resta l'unica stima autorevole**; i valori qui sono **esempi**.

Listini (µUSD per 1M token): **economy** = `gpt-5.4-nano` → input 200_000, output 1_250_000; **quality** = `gpt-5.6-luna` → input 1_000_000, output 6_000_000.

Grandezze separate: input stimato; output massimo; costo realistico stimato (`ceil`); prenotazione prudenziale; costo effettivo (`nearest`); massimo tentativi (=2, cioè 1 + 1 retry).

### 7.1 Pool — esempio (materiale lezione ~4k token input, 20 domande, output ~3k token)
- **Economy**: input ≈ 4000×0,20/M + output ≈ 3000×1,25/M ≈ **0,0008 + 0,00375 = ~0,0046 USD** (≈ 4_550 µUSD).
- **Quality**: 4000×1,00/M + 3000×6,00/M ≈ **0,004 + 0,018 = ~0,022 USD** (≈ 22_000 µUSD).

### 7.2 Lezione — esempio (contesto ~2k token input, profondità Completa, output ~3,5k token)
- **Economy**: 2000×0,20/M + 3500×1,25/M ≈ **0,0004 + 0,004375 = ~0,0048 USD** (≈ 4_775 µUSD).
- **Quality**: 2000×1,00/M + 3500×6,00/M ≈ **0,002 + 0,021 = ~0,023 USD** (≈ 23_000 µUSD).

Tutti gli esempi restano **ordini di grandezza sotto** il cap per operazione (250_000 µUSD). Il cap resta la soglia autoritativa.

### 7.3 Soglie di stop (fail-closed)
- operazione oltre limite token;
- output previsto oltre limite dimensionale (`output_too_large`);
- costo stimato oltre limite per-operazione (`operation_budget_exceeded`);
- budget mensile/giornaliero insufficiente (`budget_exceeded` / `daily_budget_exceeded`);
- configurazione assente/incoerente (`provider_config_invalid` / `feature_disabled`);
- modello/listino non mappato (`provider_config_invalid`).

---

## 8. Letture/scritture Firebase — prima e dopo

- **Zero costo passivo**; **zero** listener/polling; nessuna nuova query nell'apertura ordinaria di corso/lezione/pool.
- **Preview**: letture config/limiti già previste (una `get` puntuale di `settings/aiConfig` + budget ledger in sola lettura), **nessuna** chiamata provider, **nessuna** prenotazione.
- **Generate**: 1 callable + transazioni budget (`reserve`→`reconcile`) + scrittura/aggiornamento di **un** documento `aiContentRuns` (con lease). Una chiamata provider (retry ≤ 1).
- **Risultato temporaneo**: un documento con **TTL 24h**.
- **Applicazione pool**: normale write canonica esistente (`poolEditorService`), invariata.
- **Applicazione lezione**: **zero write** finché il docente non preme il normale `Salva` (flusso canonico invariato).

**Conferma costi/applicazione (congelata):**
- zero costo passivo;
- **preview senza chiamata provider**;
- **una sola chiamata provider** per generazione (retry ≤ 1);
- **nessun autosave** automatico dell'output;
- **pool** applicato **tramite servizio canonico** (`poolEditorService`) dopo conferma;
- **lezione** inserita **soltanto nel draft locale dirty** e salvata **separatamente** dal docente col `Salva` canonico.

### 8.1 Error codes (congelati per AIGEN-01)
Riuso dei codici esistenti (`unauthenticated`, `not_owner`, `feature_disabled`, `provider_config_invalid`, `invalid_input`, `limit_exceeded`, `operation_budget_exceeded`, `daily_budget_exceeded`, `budget_exceeded`, `budget_unavailable`) **estesi** con codici AIGEN dedicati:
- `content_too_large` — input oltre i cap §3.4/§6.6;
- `output_invalid` — output provider non conforme allo schema/validazioni;
- `output_too_large` — output oltre il cap dimensionale;
- `run_conflict` — replay con `inputHash` diverso sullo stesso `requestId` (mappato a `invalid_input` verso il client se si preferisce non esporlo).

`batch_limit_exceeded`/`submissionIds` **non** si applicano ai contenuti.

---

## 9. Prototipi statici

Due file HTML standalone, senza dipendenze/rete/build, coerenti con lo stile SchoolForge attuale:

- `documentazione/prototipi/ai-pool-generator.html`
- `documentazione/prototipi/ai-lesson-generator.html`

Contenuti e stati rappresentati sono elencati nella sezione «Prototipi» del task e verificati in `documentazione/evidenze/aigen-00-review.md`. I prototipi sono **mock statici**: nessuna chiamata reale, nessun costo, nessuna API key.

---

## 10. Pacchetti successivi e Gate GAIGEN

| Pacchetto | Scope | Dipendenze | Criterio di uscita |
|---|---|---|---|
| **AIGEN-00** | Questo documento + prototipi + cost model + sicurezza. Nessun codice runtime. | — | PR draft aperta; format/diff/node-check verdi; nessun file applicativo toccato. |
| **AIGEN-01** ✅ | Core server condiviso (`aiContentCore`/`aiContentEngine`), callable `aiContentPreview`/`aiContentGenerate`, `aiContentRuns` + lease/idempotenza/TTL, integrazione budget, schemi Structured Output, prompt builder. **Nessuna UI.** | AIGEN-00 | **Implementato** — Functions verdi (payload, ordine fail-closed, cost/budget, idempotenza/replay/takeover, output validation, prompt injection, lost-lease), Rules `aiContentRuns` server-only con emulator test; provider reale disabilitato dal kill switch; nessun deploy. Smoke DEV + TTL policy pendenti. |
| **AIGEN-02** ✅ | UI + applicazione generazione **pool** (dialog, preview, editor proposte, `Aggiungi/Crea pool` via service canonico). | AIGEN-01 | **Implementato** — client tipizzato `aiContentClient` (payload chiuso, stessa `requestId` preview/generate, error mapping sanitizzato); dialog `AiPoolGenerationDialog` (config→stima→conferma→generazione→revisione editabile→applicazione, il dialog non si chiude fra stima e generazione); mapper puro `aiPoolMapper` (ID `ia-<n>` deterministici non collidenti, opzioni `a/b/c`, `maxCharacters` default 2000, `maxPoints===difficolta`, no `peso`) → `parsePool` autorevole; pulsanti «Genera con IA» accanto a «Crea pool» e nella toolbar del pool; applicazione via `savePool` canonico (append su pool esistente senza toccare le domande attuali). Test web verdi; nessun autosave IA; nessuna nuova Function/Rules/indice; nessuna chiamata OpenAI nei test. Smoke DEV pendente. |
| **AIGEN-03** ✅ | UI + applicazione generazione **lezione** (pulsante nel MarkdownBodyEditor, dialog, `Usa questa bozza` → draft dirty, salvataggio canonico). | AIGEN-01 | **Implementato** — client lezione in `aiContentClient` (payload chiuso `kind:'lesson'`, stessa `requestId` preview/generate), dialog `AiLessonGenerationDialog` (config→stima→conferma→generazione→anteprima Markdown→«Usa questa bozza»), validatore fail-closed `aiLessonDraft` (kind/body/front-matter/dimensione via `assertLessonContentSize`), pulsante «Genera con IA» nel `MarkdownBodyEditor` **solo in modifica**; «Usa questa bozza» sostituisce solo il draft locale (dirty, nessuna write). Anteprima via `MarkdownRenderer` (DOMPurify). Test web verdi; nessun salvataggio automatico; dirty guard/Annulla e sanitizzazione invariati; nessuna nuova Function/Rules/indice/schema; nessuna chiamata OpenAI nei test. Smoke DEV pendente. |
| **LESSON-MANUAL-02** 📐 | Protocollo qualitativo del prompt lezione attuale: 6 scenari congelati, rubrica 15×0–4, blocker, review docente e attribuzione prompt/renderer/metadati/variabilità. | AIGEN-03, AIGEN-CONTEXT-01, LESSON-MANUAL-01 | **Progettato; verdetto NON DISPONIBILE.** Nessun campione, chiamata provider o costo in questa fase. Esecuzione reale solo dopo stima e autorizzazione esplicita. |
| **LESSON-MANUAL-03** ✅ | Runner locale del primo lotto qualitativo: dataset/payload fail-closed, piano costi `economy`, esecuzione protetta, output Markdown originali e report gitignored. | LESSON-MANUAL-02 | **Implementato; solo dry-run eseguito.** 6 chiamate, ≤12 tentativi, stima 78.698 µUSD, tetto 169.910 µUSD; zero secret/rete/costo. Esecuzione reale richiede nuova autorizzazione. |
| **Gate GAIGEN** | Rollout DEV, smoke owner/costi/sicurezza. | AIGEN-01/02/03 | Smoke DEV desktop/mobile/Brave; kill switch verificato; budget rispettato; nessun dato sensibile persistito; nessun fallback silenzioso; conferma manuale del responsabile. |

**AIGEN-01 non inizia in questa PR.**

### 10.1 Scope preciso di AIGEN-01
Solo Functions (`functions/src/`) + Rules per `aiContentRuns`:
1. `aiContentCore.ts` — payload chiuso discriminato, validazioni input/dimensioni, error codes, riuso `parseModelProfileField`.
2. `aiContentEngine.ts` — ordine fail-closed (§2.3), lease/idempotenza su `aiContentRuns`, integrazione `reserve`/`reconcile`, output validation, finalizzazione.
3. `aiContentProvider.ts` / schema Structured Output pool+lezione — riuso transport Responses API, 1 retry.
4. `aiContentPrompt.ts` — `poolGenerationPrompt`/`lessonGenerationPrompt` con gerarchia e delimitazione.
5. Callable `aiContentPreview`/`aiContentGenerate` in `index.ts`.
6. `firestore.rules`: `aiContentRuns` lettura/scrittura client **negata** (server-only), + TTL policy documentata.
Nessuna UI, nessun autosave, nessun dominio correzione toccato.

---

## 11. Rischi residui

- **Deriva di costo del profilo quality** (Luna ×5 rispetto a nano): mitigata da cap per-operazione, preview autorevole e budget mensile; nessun aumento automatico.
- **Qualità/allucinazioni**: il contratto vieta nozioni inventate e richiede fondatezza sul testo; resta rischio didattico → l'output è **sempre** una proposta rivista dal docente prima dell'applicazione.
- **Prompt injection dal Markdown**: mitigata da gerarchia, delimitazione, Structured Output e validazione post; da verificare con fixture reali in AIGEN-01.
- **Enum error codes**: da estendere senza rompere i consumatori esistenti (gap §1.4).
- **TTL differito**: un run resta fino a 24h+ (cleanup non immediato); accettato, documentato.
