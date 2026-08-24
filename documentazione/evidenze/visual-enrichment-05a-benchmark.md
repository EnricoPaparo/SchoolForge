# VISUAL-ENRICHMENT-05A — infrastruttura benchmark e rollout DEV

> **Stato:** infrastruttura e tuning completati. Il primo holdout reale (holdout
> A) del 24 agosto 2026 **non ha superato il gate**: ha individuato una
> divergenza fra il contratto della proposta e quello dell'immagine e una
> astensione ancora troppo permissiva sui contenuti discorsivi. Le quattro fonti
> A sono archiviate e non saranno mai riutilizzate come validazione indipendente.
> Il candidato `visual-proposal-01-v4` chiude entrambi i difetti e un nuovo
> holdout B indipendente è congelato nel dataset v2. Rollout DEV non eseguito;
> Gate GVISUAL **PENDING**.

## Primo tuning reale — blocker rilevato

L'esecuzione autorizzata sugli otto scenari tuning ha terminato in
`awaiting_review` senza errori infrastrutturali, ma non costituisce un PASS:

- 8 proposte testuali elaborate;
- 7 proposte `image` rifiutate fail-closed perché `subject` superava il limite
  autorevole di 400 caratteri (valori osservati: 450–738);
- 1 proposta `none` valida, con relativa fase immagine `skipped_none`;
- 0 chiamate al provider immagini;
- costo testuale effettivo conoscibile: 41.127 micro-USD ($0,041127);
- zero scritture Firestore o Storage.

La causa era precisa: il limite viveva nel validator, ma non era comunicato né
nel prompt né nelle descrizioni dello Structured Output. Il modello riceveva
«descrizione autosufficiente» senza un budget e produceva descrizioni troppo
lunghe; il validator le respingeva correttamente prima della fase immagine.

La correzione candidata `visual-proposal-01-v2` mantiene il limite fail-closed,
lo deriva dalla stessa costante nel prompt e nelle descrizioni dello schema,
chiede un obiettivo operativo di 240–320 caratteri e impedisce al `subject` di
diventare un riassunto della lezione. I checkpoint registrano ora anche la
versione del prompt e la sessione passa a `visual-enrichment-05a-session-v2`:
un report della v1 non è riprendibile come se fosse stato prodotto dalla v2.
Serve un nuovo tuning reale prima dell'holdout.

## Secondo tuning reale — blocker qualitativo dell'immagine

La sessione v2 ha dimostrato che la correzione della proposta funziona, ma non
ha superato il gate umano:

- 8/8 proposte valide, senza output rifiutati;
- 6 esiti `image` e 2 esiti `none` (`VE05A-05` e `VE05A-06`);
- 6/6 WebP tecnicamente validi, 1024×1024, qualità 82, per 421.570 byte totali
  (circa 70 KB medi, massimo 119.066 byte);
- costo reale conoscibile: 83.388 micro-USD ($0,083388), di cui 38.603 per le
  proposte e 44.785 per le immagini;
- zero scritture Firestore o Storage.

La review visuale ha rilevato difetti concreti: un'etichetta del vulcano
puntava alla colata invece che al cono; alcune frecce del ciclo dell'acqua e
della rete alimentare erano ambigue o dedotte; soprattutto l'immagine sulla
sicurezza in laboratorio inventava la sostanza «ACIDO CLORIDRICO» e
l'istruzione «avvisa e pulisci subito», assenti dalla lezione. L'asset sulle
fonti storiche era invece valido benché il dataset si aspettasse prudenzialmente
`none`: questo non è da solo un errore, ma conferma che l'astensione va giudicata
insieme all'utilità reale.

Il candidato successivo conserva `visual-proposal-01-v2` e introduce il prompt
immagine `schoolforge-sketch-prompt/v2`. Il subject diventa esaustivo: oggetti,
sostanze, azioni, istruzioni, relazioni e frecce non nominate devono essere
omessi. Le sole parole che il provider può scrivere sono estratte dal server
dalle frasi racchiuse fra caporali `«…»` nel subject, con massimo 8 etichette
distinte da 40 code point; una ripetizione esatta viene deduplicata e una forma
ambigua fallisce prima del provider. La
versione entra nella config chiusa del run, quindi un run prodotto col prompt
precedente non è un replay compatibile. Serve un nuovo tuning completo; lo
split holdout resta sigillato fino alla sua review.

## Terzo tuning reale — immagini approvate, ancora non chiusa

La sessione con `visual-proposal-01-v2` e `schoolforge-sketch-prompt/v2` ha
confermato la correzione del grounding:

- 8 proposte elaborate: 6 immagini, 1 astensione valida e 1 proposta rifiutata;
- 6/6 WebP tecnicamente validi e visivamente leggibili;
- nessun testo, oggetto, azione o collegamento estraneo al `subject` approvato;
- costo reale conoscibile: 100.221 micro-USD ($0,100221);
- zero scritture Firestore o Storage.

La review umana considera riuscite le sei immagini: ciclo dell'acqua, vulcano,
ecosistema, massa/peso, libertà/responsabilità e fonti storiche. L'astensione
sul grafico numerico è appropriata. L'unico rifiuto (`VE05A-07`) non riguarda
il contenuto della proposta: il provider ha restituito
`## Prima dell'attività` invece del valore sorgente `Prima dell'attività`.
Il validator relazionale ha bloccato correttamente la persistenza, ma il prompt
lasciava ancora rappresentabile nello schema una stringa arbitraria.

Il candidato `visual-proposal-01-v3` chiude ora `anchorHeadingText` con un
`enum` request-specific degli H2/H3 realmente ancorabili. I valori sono esatti,
senza marcatori Markdown, deduplicati e limitati allo stesso cap del validator;
se la lezione non possiede alcun heading valido, lo schema ammette soltanto
`decision: 'none'`. Il controllo relazionale runtime resta come difesa in
profondità. Serve un ultimo tuning completo prima di aprire lo split holdout.

## Quarto tuning reale — qualità approvata e nanofix deterministico

La sessione con `visual-proposal-01-v3` e `schoolforge-sketch-prompt/v2` ha
prodotto 8/8 proposte strutturalmente valide. Cinque immagini sono risultate
tecnicamente valide e visivamente approvate; due esiti `decision: 'none'` erano
appropriati. Il costo reale conoscibile è stato 96.645 micro-USD ($0,096645),
senza scritture Firestore o Storage.

L'unico esito non completato (`VE05A-06`) è fallito prima del provider e a costo
zero: il subject conteneva due occorrenze esatte di `«Libertà»`, mentre il
validator trattava erroneamente la ripetizione come un ampliamento
dell'allowlist. La policy `schoolforge-sketch-prompt/v3` usa ora una semantica
di insieme: le ripetizioni esatte sono deduplicate, il limite di 8 vale sulle
stringhe distinte e il subject resta byte per byte invariato. Il vocabolario
autorizzato non si amplia.

La correzione è deterministica e coperta da test, incluso il limite di otto
etichette distinte ripetute. Lo stesso scenario aveva già prodotto e superato
la review visuale nel tuning precedente: non serve ripetere un'altra batteria
completa a pagamento. Dopo il merge di questo nanofix lo split tuning è
considerato superato e può aprirsi lo split holdout sigillato.

## Primo holdout reale (A) — gate non superato

L'holdout A è stato aperto una sola volta sul candidato allora congelato
(`visual-proposal-01-v3` + `schoolforge-sketch-prompt/v3`). Non costituisce un
PASS:

- `VE05A-09`: proposta valida, immagine fermata in `pre_invocation`; nessuna
  chiamata immagini e nessun rischio di fatturazione;
- `VE05A-10`: proposta e WebP validi; immagine 1024×1024, 31.068 byte,
  SHA-256 `fca9b7577e40dfaab004850a88cb6f79c33726ac1533a2a872bc6ff09519ed92`,
  approvata nella review visuale;
- `VE05A-11`: proposta `image` formalmente valida ma non consumabile: conteneva
  11 etichette distinte fra caporali, oltre il massimo di 8 imposto dalla fase
  immagine; lo scenario discorsivo si attendeva inoltre `none`;
- `VE05A-12`: astensione valida e appropriata.

Il costo reale conoscibile è 33.556 micro-USD ($0,033556). Il vecchio report
esponeva `totalActualCostMicroUsd: null` perché classificava erroneamente il
fallimento certamente precedente al provider come costo ignoto; il runner ora
registra per `pre_invocation` zero token e costo zero, mantenendo `null` soltanto
quando esiste davvero un rischio di fatturazione.

La correzione non viene valutata di nuovo sugli stessi quattro casi come se
fossero ancora ciechi. Le sorgenti originali A sono conservate byte per byte in
[`visual-enrichment-05a-holdout-a-sources/`](visual-enrichment-05a-holdout-a-sources/)
e i loro hash storici sono congelati dai test. Il candidato
`visual-proposal-01-v4`:

1. applica nella fase proposta lo stesso contratto delle etichette usato dalla
   fase immagine — massimo 8 distinte, massimo 40 code point, caporali bilanciate
   e duplicati esatti deduplicati;
2. chiede esplicitamente `decision: none` quando l'immagine trasformerebbe un
   ragionamento discorsivo o astratto in sole caselle, frecce ed etichette senza
   aggiungere informazione.

Il dataset v2 contiene un holdout B nuovo e indipendente. Solo il risultato di B
può decidere il gate qualitativo del candidato v4.

## Dataset congelato

Il dataset `visual-enrichment-05a-dataset-v2` contiene dodici lezioni sintetiche
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
| VE05A-09 | holdout B | meccanismo: forbici come due leve | image |
| VE05A-10 | holdout B | struttura informativa: incapsulamento di rete | image |
| VE05A-11 | holdout B | scelta discorsiva: registro linguistico | none |
| VE05A-12 | holdout B | metodo testuale: citazione responsabile | none |

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

Esecuzione reale, ammessa soltanto nella fase VE-05 con autorizzazione esplicita:

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
durata per fase. Un rischio di fatturazione reale rende il totale `null`, senza
inventarlo. Un esito `pre_invocation`, che dimostra invece che il provider non è
stato raggiunto, registra zero token e costo zero.

Il dry-run Node 22 di VE-05A calcola, dal listino runtime congelato, questa
matrice (micro-USD; tra parentesi USD):

| Split | Chiamate max | Tentativi max | Stima | Tetto prenotabile |
|---|---:|---:|---:|---:|
| tuning | 16 | 32 | 228.638 ($0,228638) | 698.702 ($0,698702) |
| holdout B | 8 | 16 | 114.456 ($0,114456) | 350.514 ($0,350514) |

I tetti sono ricalcolati sui prompt effettivi: la proposta v4 comunica limiti,
astensione e allowlist condivisa; il prompt immagine v3 applica grounding e la
stessa semantica di insieme. Il tetto della
proposta è 435.582 micro-USD per il tuning e 218.954 per l'holdout B; quello
dell'immagine è rispettivamente 263.120 e 131.560 micro-USD.

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

Qualità reale del candidato `visual-proposal-01-v4` sul nuovo holdout B,
none-rate indipendente, layout shift e intero rollout DEV. L'holdout A ha
fermato correttamente il rollout; nessun benchmark ha eseguito scritture
Firebase, modifiche PROD o deploy. VE-05 resta aperto e GVISUAL resta PENDING.
