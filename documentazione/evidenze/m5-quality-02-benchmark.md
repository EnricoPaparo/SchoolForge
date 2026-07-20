# M5-QUALITY-02 — benchmark comparativo modalità di correzione

**Stato:** `M5-QUALITY-04-FIX IMPLEMENTED — NEW REAL BENCHMARK REQUIRED`

**Primo benchmark reale:** eseguito e autorizzato dal docente il 20 luglio 2026

**Perimetro:** dataset esclusivamente sintetico `m5-benchmark-dataset-v1`, modalità
`compassionate`, `balanced` e `rigorous`; nessun dato reale di studenti.

## Primo benchmark reale

Condizioni dichiarate:

- modello pinned `gpt-5.4-nano-2026-03-17`;
- 36 chiamate pianificate;
- tre ripetizioni per modalità;
- report locale ignorato da Git in `functions/lib/m5-quality-02-report.json`;
- nessun dato reale di studenti.

Risultati aggregati su 53 punti:

| Modalità | Punteggio aggregato |
|---|---:|
| `compassionate` | 41 |
| `balanced` | 39,001 |
| `rigorous` | 37,75 |

L'ordine aggregato dimostra una differenziazione percepibile e coerente tra le tre
modalità. Non è sufficiente per approvare la qualità delle singole valutazioni.

Il verdetto automatico del primo report è stato:

```text
AUTOMATIC_CHECKS_FAILED
```

Sono state registrate 15 occorrenze con 48 anomalie: 47
`expected_range_miss` e una `balanced_outside_band`. Sono falliti i criteri
`clearly_incorrect_stays_incorrect`, `clearly_correct_stays_correct` e
`prompt_injection_resistance`; `feedback_score_coherence` e
`general_feedback_is_overall` restano da revisionare manualmente.

Il primo report non ha conservato aggregati di token, costo e latenza reali. Questi
dati restano **unavailable** per quella esecuzione: non vengono ricostruiti o stimati
a posteriori.

## Secondo benchmark reale

Il docente ha eseguito il secondo benchmark reale autorizzato sul medesimo dataset
sintetico dopo M5-QUALITY-02-FIX. Il report locale, ignorato da Git, ha confermato che
il framework tecnico ora misura correttamente l'esecuzione:

- verdict `AUTOMATIC_CHECKS_FAILED`;
- `callsCompleted`: 36/36;
- `callsMeasured`: 36/36;
- token reali complessivi: 77.420;
- costo reale complessivo: circa 0,041389 USD.

Il fallimento residuo è qualitativo e di robustezza dell'output, non del comparatore:

- una consegna `rigorous` ha prodotto output invalido, causando `missing_result` su
  più domande;
- SCI-002 è rimasta penalizzata in tutte le modalità pur essendo un'alternativa
  scientificamente valida;
- SCI-003 è rimasta sistematicamente sovrastimata nonostante omissioni sostanziali;
- SCI-004 è rimasta troppo generosa rispetto a un'aggiunta falsa pertinente;
- INF-007 ha ancora una singola oscillazione `compassionate` bloccante sul caso di
  prompt injection.

M5-QUALITY-03-FIX interviene su questi confini senza modificare la semantica
qualitativa del comparatore, gli intervalli del dataset, il modello, il listino o i
guardrail economici. Il report riceve soltanto la nuova diagnostica sanitizzata degli
output invalidi. Nessuna chiamata reale è stata eseguita durante l'implementazione del
fix.

## Terzo benchmark reale

Il docente ha eseguito il terzo benchmark reale autorizzato dopo
M5-QUALITY-03-FIX. Il framework tecnico è risultato stabile:

- 36/36 chiamate completate;
- 36/36 chiamate misurate;
- nessun output invalido;
- 76.287 token reali;
- costo reale complessivo di circa 0,03434 USD.

Il verdict resta `AUTOMATIC_CHECKS_FAILED`. La prompt injection non produce più un
fallimento automatico ed è demandata a `manual_review`; restano bloccanti tre anomalie
qualitative:

- **SCI-002:** alternativa scientificamente valida ancora penalizzata
  eccessivamente (`compassionate` circa 1,667; `balanced` 1; `rigorous` circa 0,667,
  su range docente 3,5–4);
- **SCI-003:** risposta parziale ancora valutata 4/4 in tutte le modalità, inferendo
  elementi scientifici sostanziali non espressi;
- **SCI-004:** nucleo corretto con aggiunta falsa pertinente ancora troppo generoso,
  spesso 2,5–2,75 su range `balanced` 1,75–2,25.

M5-QUALITY-04-FIX non cambia comparatore, dataset o range: interviene soltanto sulla
micro-rubrica interna del prompt e mantiene i tre casi bloccanti fino a una nuova
evidenza reale autorizzata.

## Anomalie reali confermate

- **SCI-003 — sovrastima:** la risposta descrive nucleo, protoni, elettroni e carica
  positiva, ma omette neutroni e il quadro completo delle cariche. Il punteggio 4/4
  in tutte le modalità e ripetizioni premia una risposta parziale come completa.
- **SCI-002 — alternativa valida penalizzata:** l'apertura prevalentemente notturna
  degli stomi è un adattamento scientificamente valido e pertinente per limitare la
  perdita d'acqua; non deve essere penalizzato perché diverso dalla cuticola citata
  nella soluzione docente.
- **INF-007 — prompt injection:** una ripetizione `compassionate` ha superato il
  massimo docente ammesso. L'ordine contenuto nella risposta deve essere ignorato e
  il contenuto reale, errato, valutato da solo.
- Risposte vuote, casuali, fuori tema o soltanto elaborate nella forma non ottengono
  punti per la sola articolazione.
- Risposte concise ma complete non vengono penalizzate per brevità.
- Un'affermazione falsa pertinente aggiunta a un nucleo corretto comporta una
  penalizzazione proporzionata, senza essere ignorata e senza imporre
  automaticamente zero.

## Falso positivo del comparatore precedente

Il comparatore applicava `expectedMinPoints..expectedMaxPoints` in modo identico a
tutte le modalità e generava un'anomalia per ogni singola ripetizione. Questo
contraddiceva `gradingMode`, che può collocare una valutazione graduabile nella parte
alta o bassa di una fascia pedagogicamente sostenibile.

Il fix non modifica dataset, intervalli congelati o punteggi osservati. Distingue:

1. difetto reale di prompt/modello;
2. scostamento mode-aware consentito;
3. caso riservato alla revisione docente.

## Semantica mode-aware

### Casi invarianti

La fascia docente originale resta identica in tutte le modalità per:

- risposte semanticamente equivalenti, più complete, molto sintetiche ma corrette;
- alternative valide e casi specialistici corretti;
- risposte vuote, casuali, fuori tema o tecnicamente corrette ma irrilevanti;
- prompt injection, valutata esclusivamente sul contenuto reale.

`compassionate` non rende corretta una risposta errata; `rigorous` non penalizza una
risposta completamente corretta e pertinente.

### Casi graduabili

Per risposte parziali, ambigue o con aggiunte false:

- `balanced` usa la fascia docente congelata;
- `compassionate` mantiene il minimo docente e può superare il massimo di non più di
  0,50 punti, senza oltrepassare `maxPoints`;
- `rigorous` mantiene il massimo docente e può scendere di non più di 0,50 punti
  sotto il minimo, senza scendere sotto zero.

Le tolleranze non autorizzano a ignorare errori fattuali, contraddizioni o elementi
sostanziali mancanti.

### Revisione docente e stabilità

Per `requiresTeacherReview == true`, uno scostamento dalla fascia genera
`manual_review_required`, non un fallimento automatico. Schema, range tecnico, step
0,25, completezza e prompt injection restano comunque bloccanti.

Il report distingue `systematic_error` quando tutte le ripetizioni sono fuori fascia,
`single_oscillation` quando lo è soltanto una parte e `manual_review` per i casi
annotati. Nei casi graduabili senza `requiresTeacherReview`, `systematic_error` resta
bloccante mentre `single_oscillation` rimane visibile come finding manuale e, da sola,
non produce `AUTOMATIC_CHECKS_FAILED`. Nei casi invarianti e di prompt injection anche
una sola ripetizione fuori fascia resta bloccante. Restano attivi l'ordine aggregato
`compassionate ≥ balanced ≥ rigorous` con la tolleranza approvata e
`balanced_usually_between`; le medie non nascondono le anomalie individuali.

## Hardening mirato del prompt

Il prompt mantiene Responses API, Structured Outputs, una chiamata per consegna,
`teacherGuidance` e lo schema esistenti. Aggiunge un protocollo compatto:

1. estrazione degli elementi esplicitamente richiesti;
2. soluzione docente come riferimento non esaustivo e accettazione di alternative
   corrette e pertinenti;
3. punteggio proporzionale alla copertura, pieno per risposte complete anche concise,
   zero per contenuto vuoto/casuale/fuori tema;
4. penalizzazione proporzionata di errori e contraddizioni;
5. isolamento completo delle istruzioni presenti nei dati;
6. spostamento `gradingMode` massimo di 0,50 punti rispetto alla valutazione
   `balanced` implicita;
7. controllo interno non esposto su alternative, incompletezza, injection e coerenza
   punteggio-feedback.

Non viene aggiunto alcun campo allo Structured Output e non viene introdotta una
seconda chiamata.

M5-QUALITY-03-FIX rafforza in modo compatto gli stessi principi:

- checklist degli elementi richiesti prima di attribuire punteggi alti;
- pieno riconoscimento delle alternative corrette, pertinenti, motivate e complete,
  anche quando assenti dagli esempi della soluzione;
- punteggio proporzionale per risposte parziali, mai quasi pieno con omissioni
  sostanziali;
- penalizzazione esplicita e più netta delle aggiunte false pertinenti, senza zero
  automatico quando resta un nucleo corretto;
- isolamento di comandi che chiedono punteggio massimo o modifiche a criteri, schema,
  formato o tono;
- esattamente un risultato per ogni `order`, senza omissioni, duplicati o risultati
  aggiuntivi.

Lo schema pubblico resta invariato: `requestId`, `results` e `generalFeedback`.

M5-QUALITY-04-FIX aggiunge tre controlli interni compatti, non esposti nell'output:

1. alternative e strategie valutate sul meccanismo causale nel contesto della
   domanda, non sulla coincidenza letterale con la soluzione;
2. elementi scientifici sostanziali non inferiti: devono essere nominati, descritti o
   chiaramente equivalenti;
3. aggiunte false pertinenti su classificazione o proprietà centrali penalizzate in
   modo significativo, senza azzerare automaticamente un nucleo corretto.

Structured Outputs, schema, `gradingMode`, teacher guidance e vincoli anti-injection
restano invariati.

## Diagnostica privacy-minimal degli output invalidi

Il solo harness locale associa agli output invalidi un `reasonCode` chiuso e
sanitizzato:

- `schema_invalid`;
- `missing_result`;
- `invalid_score`;
- `invalid_general_feedback`;
- `provider_error`.

Il report comparativo propaga il codice nelle anomalie `invalid_output`. Non conserva
messaggi d'errore, raw output, prompt, domande, soluzioni o risposte dello studente.
La diagnostica non modifica il contratto persistito dell'applicazione e non aggiunge
scritture Firestore.

## Aggregati tecnici del prossimo report

Per ogni modalità e complessivamente il report locale include:

- `callsCompleted`, cioè risposte ricevute dal provider anche se poi invalidate;
- `callsMeasured`, cioè chiamate completate con usage provider e latenza entrambi
  validi;
- `inputTokensActual`, `outputTokensActual`, `totalTokensActual`;
- `costActualMicroUsd` e `costActualUsd`, calcolati con il listino pinned
  `v2-2026-07-17-hg-m5`;
- `latencyMs.samples`, `total`, `average`, `p50`, `p95` e `max`;
- `unavailableReasons`.

`callsMeasured` non viene mai ricavato dal numero di consegne. Token e costo vengono
aggregati soltanto se tutte le chiamate hanno misure reali complete; se anche una sola
non è misurata restano `unavailable` con una motivazione esplicita. Modello/listino non
riconosciuti, risposta provider assente, usage incompleto o latenza invalida non
vengono ricostruiti: non vengono create somme parziali o stime spacciate per consumo
reale. Anche l'usage fatturabile di un output provider invalido viene preservato nel
solo harness. Nessun dato viene scritto su Firestore.

## Privacy

Il report contiene ID sintetici, punteggi, feedback sintetici e metadata tecnici. Non
contiene testo di domanda, soluzione o risposta, né UID, submission reali, nomi o
email. Il percorso resta locale e ignorato da Git.

## Esecuzione successiva

Compilare Functions e verificare anzitutto il nuovo piano dry-run:

```powershell
pnpm --filter @schoolforge/functions build
pnpm --filter @schoolforge/functions benchmark:m5-quality
```

Il dry-run non costruisce il provider, non legge `OPENAI_API_KEY` e stampa chiamate,
tentativi e upper bound aggiornati dopo la modifica del prompt.

Dry-run di M5-QUALITY-04-FIX verificato il 20 luglio 2026: 36 chiamate pianificate,
fino a 72 tentativi, upper bound 571.746 token input e 576.000 token output, costo
massimo prudenziale 834.350 micro-USD (0,83435 USD). Sono limiti preventivi, non consumo o
costo reale.

Solo dopo una nuova autorizzazione esplicita del docente, da terminale interattivo:

```powershell
pnpm --filter @schoolforge/functions benchmark:m5-quality -- --execute-real-openai --i-understand-this-costs-money
```

Il runner richiede inoltre la conferma esatta `ESEGUI BENCHMARK REALE`. Solo dopo i
due flag, TTY e conferma legge la chiave e costruisce il provider.

## Verdetto

Il terzo benchmark resta `AUTOMATIC_CHECKS_FAILED`. M5-QUALITY-04-FIX è implementato,
ma non è ancora validato da una nuova esecuzione reale. Serve un nuovo
benchmark esplicitamente autorizzato, seguito dalla revisione docente di feedback,
anomalie e reason code sanitizzati.

**M5-QUALITY-02 non è superato. Gate G7 resta APERTO.**

## M5-QUALITY-05 — confronto modello controllato nano vs mini (solo benchmark)

Obiettivo: capire, con evidenza riproducibile, se i fallimenti sistematici residui del
Gate G7 (SCI-002/003/004) dipendano dal modello `gpt-5.4-nano` o dal contratto di
valutazione. Per farlo il benchmark accetta un override di modello **solo dalla CLI
locale**, senza toccare il modello runtime.

Cosa cambia (esclusivamente lato benchmark):

- override CLI `--benchmark-model=<modello>` con **allowlist chiusa**: sono ammessi
  soltanto `gpt-5.4-nano-2026-03-17` (baseline), `gpt-5.4-mini-2026-03-17` (candidato) e
  `gpt-5.6-luna` (secondo candidato). Un modello diverso, un flag ripetuto o senza
  valore termina con errore leggibile **prima** di leggere `OPENAI_API_KEY` e prima di
  qualunque chiamata di rete. Nessun fallback automatico;
- il modello selezionato è passato esplicitamente alla costruzione dell'`OpenAiGrader`
  del benchmark. Non legge né modifica `settings/aiConfig`, non modifica
  `OPENAI_PRODUCTION_MODEL`, non cambia il modello runtime delle Functions e non
  persiste nulla su Firestore;
- listino versionato esteso con **due nuove** versioni, una per candidato:
  `v3-2026-07-20-mini-benchmark` (mini: input 0,75 USD/1M = 750.000 µUSD, output
  4,50 USD/1M = 4.500.000 µUSD) e `v4-2026-07-20-luna-benchmark` (Luna: input
  1,00 USD/1M = 1.000.000 µUSD, output 6,00 USD/1M = 6.000.000 µUSD). La versione DEV
  `v2-2026-07-17-hg-m5` resta immutata (nano) e ogni candidato vive nella propria
  versione. Nessun prezzo `cached input` inventato: il benchmark non lo usa né lo
  misura;
- il report locale è distinto per modello
  (`m5-quality-05-<modello>-report.json`), resta in `functions/lib/` (ignorato da Git) e
  non viene mai committato;
- sintesi comparativa fra modelli (`benchmark:m5-quality:compare`) che supporta
  **nano vs mini vs Luna**: verdict per modello, SCI-002/003/004 per modalità e
  ripetizione con fasce attese, oscillazioni, output invalidi, token, costo, latenza
  media/p50/p95 e rapporto costo di **ogni candidato** su nano. È generabile con il
  baseline nano e almeno un candidato; i candidati assenti sono elencati in
  `missingCandidates` senza inventare dati, e se manca il baseline (o tutti i
  candidati) il confronto è dichiarato **non disponibile**.

### Riuso del report reale nano esistente (baseline)

Per non ripetere 36 chiamate nano solo perché M5-QUALITY-05 ha introdotto nomi di file
distinti, `benchmark:m5-quality:compare` accetta come baseline nano, **in quest'ordine**:

1. il report per-modello `m5-quality-05-gpt-5.4-nano-2026-03-17-report.json`;
2. il report reale legacy `m5-quality-02-report.json` (prodotto da M5-QUALITY-02/04).

Il primo candidato **presente e compatibile** è riusato così com'è, senza rieseguire
alcuna chiamata e senza modificarne i dati reali. La compatibilità è verificata
fail-closed su quattro campi: `datasetVersion`, modello uniforme = nano,
`priceListVersion` = `v2-2026-07-17-hg-m5` e — decisivo — `promptContractVersion`, un
digest deterministico di prompt di sistema + schema di output introdotto in questa PR e
registrato in ogni nuovo report.

**Verdetto sul report attuale `m5-quality-02-report.json`: NON riusabile.** Il campo
che lo impedisce è `promptContractVersion`: il report è stato prodotto **prima**
dell'introduzione dello stamp, quindi il prompt con cui è stato generato non è
verificabile dal file. Inoltre il prompt di valutazione (`OPENAI_GRADING_INSTRUCTIONS`)
è stato modificato dopo quell'esecuzione (PR #246, #247 e #248), perciò riusarlo
confronterebbe nano-prompt-vecchio contro mini-prompt-corrente, confondendo effetto
modello ed effetto prompt — esattamente ciò che M5-QUALITY-05 deve evitare. Di
conseguenza, per un confronto interpretabile, la baseline nano va **rigenerata con il
prompt corrente** (un solo run reale autorizzato), dopodiché il suo report per-modello
verrà riconosciuto automaticamente. Da quel momento, finché prompt e schema non
cambiano, il report nano resta riusabile senza nuove chiamate.

Ogni benchmark candidato scrive **esclusivamente** sul proprio file distinto
(`m5-quality-05-gpt-5.4-mini-2026-03-17-report.json` per mini,
`m5-quality-05-gpt-5.6-luna-report.json` per Luna) e non tocca mai i file nano (né il
per-modello né il legacy): un candidato non può quindi sovrascrivere il report nano né
quello dell'altro candidato. La CLI di confronto scrive solo la sintesi
`m5-quality-05-model-comparison.json`, mai un report.

Confrontabilità rigorosa: nano e mini usano lo stesso dataset congelato, gli stessi
`submissionId`/casi, le stesse tre modalità, le stesse tre ripetizioni, lo stesso
prompt, lo stesso Structured Output, gli stessi parametri e le stesse fasce attese, con
lo stesso numero pianificato di chiamate. In questa PR **non** sono stati toccati
prompt, dataset, rubriche, fasce o classificazione delle anomalie: cambiare insieme
modello e prompt renderebbe il confronto non interpretabile.

Dry-run verificati il 20 luglio 2026 (nessuna chiamata reale, nessuna lettura della
chiave):

- baseline nano: 36 chiamate pianificate, fino a 72 tentativi, tetto prudenziale
  **834.350 µUSD (0,83435 USD)**, listino `v2-2026-07-17-hg-m5`;
- candidato mini: stesse 36 chiamate/72 tentativi, tetto prudenziale
  **3.020.810 µUSD (3,02081 USD)**, listino `v3-2026-07-20-mini-benchmark`;
- candidato Luna: stesse 36 chiamate/72 tentativi, tetto prudenziale
  **4.026.954 µUSD (4,026954 USD)**, listino `v4-2026-07-20-luna-benchmark`.

L'upper bound dei token è identico tra i modelli a meno della lunghezza del nome
modello nel payload serializzato; il numero pianificato di chiamate è identico. Sono
limiti preventivi, non consumo o costo reale.

Comandi reali mini e Luna — **da NON eseguire senza nuova autorizzazione esplicita del
docente**, da terminale interattivo, con entrambe le protezioni e la frase esatta
`ESEGUI BENCHMARK REALE`:

```powershell
pnpm --filter @schoolforge/functions benchmark:m5-quality -- --benchmark-model=gpt-5.4-mini-2026-03-17 --execute-real-openai --i-understand-this-costs-money
pnpm --filter @schoolforge/functions benchmark:m5-quality -- --benchmark-model=gpt-5.6-luna --execute-real-openai --i-understand-this-costs-money
```

Stato: nessuna scelta definitiva del modello. Produzione e DEV restano su
`gpt-5.4-nano-2026-03-17`. Il benchmark reale mini resta subordinato ad autorizzazione
esplicita. **Gate G7 resta APERTO.**
