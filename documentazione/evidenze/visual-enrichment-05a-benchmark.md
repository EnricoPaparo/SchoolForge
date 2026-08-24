# VISUAL-ENRICHMENT-05A — infrastruttura benchmark e rollout DEV

> **Stato:** infrastruttura implementata; benchmark reale e rollout DEV non
> eseguiti; Gate GVISUAL **PENDING**. Questa evidenza non contiene immagini
> generate né un verdetto qualitativo.

## Dataset congelato

Il dataset `visual-enrichment-05a-dataset-v1` contiene dodici lezioni sintetiche
complete, prive di dati studente: otto tuning e quattro holdout. Il loader
pretende ordine, cardinalità, proprietà esatte e SHA-256 dei byte UTF-8 di ogni
sorgente. Lo split tuning riceve soltanto gli otto oggetti tuning; il codice di
tuning non può ottenere i quattro holdout senza scegliere esplicitamente lo
split `holdout`.

| ID | Split | Categoria | Esito atteso |
|---|---|---|---|
| VE05A-01 | tuning | processo sequenziale: ciclo dell'acqua | image |
| VE05A-02 | tuning | struttura fisica: vulcano | image |
| VE05A-03 | tuning | relazioni: ecosistema di stagno | image |
| VE05A-04 | tuning | confronto: massa e peso | image |
| VE05A-05 | tuning | dati: temperature | image |
| VE05A-06 | tuning | argomento astratto: libertà e responsabilità | image oppure none, da motivare |
| VE05A-07 | tuning | testo normativo: laboratorio | none |
| VE05A-08 | tuning | testo autosufficiente: fonti storiche | none |
| VE05A-09 | holdout | struttura meccanica: serratura | image |
| VE05A-10 | holdout | processo spaziale: ombra | image |
| VE05A-11 | holdout | argomento discorsivo: compromesso | none |
| VE05A-12 | holdout | testo descrittivo: personaggio | none |

Dataset e sorgenti sono in
[`visual-enrichment-05a-dataset.json`](visual-enrichment-05a-dataset.json) e
[`visual-enrichment-05a-sources/`](visual-enrichment-05a-sources/). Gli hash
sono nel dataset e vengono ricalcolati prima di costruire una richiesta.

## Rubrica 0–4

Ogni dimensione riceve un intero da 0 a 4, con nota obbligatoria sotto 4.

**Proposta (6):** decisione image/none appropriata; utilità didattica
dichiarata; concetto realmente visualizzabile; posizione; caption e alt text;
subject sicuro e preciso.

**Immagine (10):** correttezza concettuale; utilità aggiuntiva; chiarezza;
gerarchia/leggibilità; stile SchoolForge Sketch; assenza di decorazione;
assenza di testo minuscolo, illeggibile o inventato; caption coerente;
accessibilità dell'alt text; posizione adeguata.

Il report macchina termina in `awaiting_review`, con `verdict: null`: senza i
punteggi umani completi non può dichiarare PASS. Un tasso di `none` uguale a
zero è sospetto per costruzione e impedisce PASS.

## Blocker

Un solo blocker impedisce PASS: errore concettuale; relazione falsa o
assolutizzata; testo inventato; etichette illeggibili; figura decorativa;
contenuto estraneo; immagine che sostituisce spiegazioni indispensabili;
contenuto unsafe o subject invalido; asset oltre 204.800 byte; MIME/hash/
dimensioni incoerenti; layout shift visibile; heading errato; `decision:image`
sistematica sugli scenari deliberatamente non visuali.

## Runner e cost model

Il runner usa direttamente richiesta/prompt/Structured Output/parser
`visual_proposal`, `ContentProvider`, `ImageProvider`, preset/listino
`AI_VISUAL_SERVER_CONFIG`, `estimateContentCost`, `estimateVisualCost` e
`normalizeVisualWebp`. Non contiene Firebase Admin, non chiama callable e non
ha porte Firestore o Storage.

Dry-run predefinito, senza chiave e senza rete:

```sh
pnpm --filter @schoolforge/functions build
pnpm --filter @schoolforge/functions benchmark:visual-quality
pnpm --filter @schoolforge/functions benchmark:visual-quality -- --benchmark-split=holdout
```

Esecuzione reale futura, vietata in VE-05A:

```sh
pnpm --filter @schoolforge/functions benchmark:visual-quality -- \
  --execute-real-openai --i-understand-this-costs-money --benchmark-split=tuning
```

Richiede Node 22, stdin/stdout TTY, entrambi i flag e la frase esatta mostrata.
Su sessione nuova tuning è:
`ESEGUI FINO A 16 CHIAMATE VISUALI TUNING REALI`; per holdout:
`ESEGUI FINO A 8 CHIAMATE VISUALI HOLDOUT REALI`. Il numero cala nel resume.
Il massimo è due chiamate per scenario, proposta più immagine; `none` registra
`skipped_none` e non invoca il provider immagini. Il piano stampa stima e tetto
separati per le due fasi; il report registra usage, costo reale conoscibile e
durata per fase. Un rischio di fatturazione precedente rende il totale reale
`null`, senza inventarlo.

Il dry-run Node 22 di VE-05A calcola, dal listino runtime congelato, questa
matrice (micro-USD; tra parentesi USD):

| Split | Chiamate max | Tentativi max | Stima | Tetto prenotabile |
|---|---:|---:|---:|---:|
| tuning | 16 | 32 | 218.318 ($0,218318) | 596.224 ($0,596224) |
| holdout | 8 | 16 | 109.183 ($0,109183) | 298.300 ($0,298300) |

Il preset immagine server-side è `gpt-image-2-2026-04-21`, `1024x1024`, qualità
`low`, un output WebP opaco. Il listino runtime
`openai-gpt-image-2-standard-2026-08-22` usa $5/MTok di testo input e $30/MTok
di immagine output; il preset conta 196 output token ($0,00588) per tentativo.
La proposta Quality e il suo massimo di retry sono conteggiati separatamente.

## Checkpoint e recovery

Prima della rete il runner calcola il lavoro residuo. Dopo ogni risposta
revisionabile scrive atomicamente un report `0600` tramite file temporaneo e
rename sotto `functions/lib/`, directory già ignorata da Git. Conserva raw JSON
invalido della proposta e i byte provider in base64 quando fallisce la
normalizzazione. Errori pre-risposta restano `failed` e non diventano risultati.

Ripresa futura:

```sh
pnpm --filter @schoolforge/functions benchmark:visual-quality -- \
  --execute-real-openai --i-understand-this-costs-money \
  --benchmark-split=tuning --resume-session=/percorso/assoluto/report.json
```

Dataset, rubrica, split e config devono coincidere. Le fasi già checkpointate
non vengono richiamate; una proposta `none` già valida non può produrre una
chiamata immagine al resume. Serve una nuova conferma esatta per il solo
residuo.

Il resume tratta il JSON come `unknown`: forma top-level e record sono chiusi,
la sequenza proposta→immagine è verificata per scenario, una proposta valida è
rivalidata dal proprio output raw contro la sorgente congelata e i WebP validi
sono ricontrollati su base64, MIME, hash, byte, dimensioni e parametri di
normalizzazione. Qualunque divergenza si ferma prima di conferma, secret,
provider o nuova scrittura del checkpoint.

## Smoke layout futuro su DEV

Da eseguire a 1440, 1024, 390 e 320 px sui componenti reali, con rete
controllata per fermare il caricamento dei byte:

1. registrare rettangolo riservato della figura e coordinata Y del primo
   contenuto successivo in pending;
2. completare la risposta e ripetere le misure; differenza ammessa soltanto per
   arrotondamento sub-pixel, da dichiarare;
3. verificare `width`, `height`, rapporto d'aspetto, byteLength, MIME e hash;
4. verificare zero overflow orizzontale, immagine nel viewport, caption e
   placeholder leggibili, target touch almeno 44 px e console pulita;
5. catturare evidenza prima/dopo per docente e studente.

Un movimento visibile del contenuto successivo è blocker anche se i test CSS
sono verdi.

## Checklist rollout DEV — non eseguita

1. configurare TTL su `visualRuns.expireAt` e verificarne la policy;
2. impostare `AI_VISUAL_MODE=openai` e la config budget DEV, mantenendo un
   rollback immediato a `disabled`;
3. verificare che solo `aiVisualGenerate` abbia il binding del secret Firebase
   esistente `OPENAI_API_KEY`;
4. distribuire nell'ordine Functions, Firestore Rules, Storage Rules, Hosting;
5. verificare nomi callable e regione;
6. eseguire preview senza secret binding;
7. generare solo dopo conferma costo;
8. bind, generate, promote e vista docente/studente;
9. smarcare/rimarcare;
10. sostituire, riancorare, rimuovere e abbandonare;
11. esportare ZIP e verificare sidecar JSON/WebP;
12. verificare cleanup staging e TTL;
13. rollback: `AI_VISUAL_MODE=disabled`, senza cancellare o invalidare asset
    approvati.

## Non verificato

Qualità reale delle proposte e immagini, tasso reale di `none`, costi/tempi
provider, layout shift e intero rollout DEV. Nessuna chiamata OpenAI reale,
lettura di secret locale, scrittura Firebase, modifica PROD o deploy è avvenuta
in VE-05A. VE-05 reale resta aperto e GVISUAL resta PENDING.
