# Didattica e studio — contratto DEV, ottobre 2026

Base: `113f757`. Scope approvato: allineamento lezione/pool, pratica progressiva,
legame pratica/verifica, struttura comune, lezioni autonome, pool equilibrati.

## Architettura e incrementi

1. Rafforzare generazione e revisione pool con verifica del procedimento rispetto
   al testo. Audit esplicito dei pool esistenti, proposta senza salvataggio automatico.
2. Contratto didattico additivo ancorato al corpo finale; riferimenti testuali
   verificabili, invalidazione al cambiamento. Criteri disciplinari nelle lezioni.
3. Esercitazioni generate dal gateway contenuti esistente, preparate dal docente,
   modificabili e pubblicabili. Esempio svolto, guidato, autonomo; trasferimento
   solo quando supportato. Aiuti progressivi e risposte locali alla sessione.
4. Pratica approvata come riferimento subordinato alla lezione per il pool;
   riepilogo docente della copertura e dei controlli.

## Invarianti

- Nessuna modifica a punti=difficoltà, correzione IA, mappe, ripasso o fonti esterne.
- Provider reale solo nel collaudo sintetico autorizzato, tetto aggregato 12 tentativi/$5; stima e accounting esistenti.
- Pool sempre privato. Pratica studente subordinata ad accesso lezione, pubblicazione,
  corpo corrente e blocco verifica. Nessuna persistenza delle risposte personali.
- Legacy senza pratica continua a funzionare. Nessuna migrazione.
- Unico writer; review indipendente e CI prima di merge e DEV dell'orchestratore.

## Gate e copertura

- [x] Allineamento cognitivo anche generazione normale e audit esplicito.
- [x] Contratto didattico e invalidazione.
- [x] Generazione, modifica, pubblicazione e ritiro pratica docente.
- [x] Pratica studente con aiuti, confronto aperte e controllo chiuse.
- [x] Legame pratica/pool e riepilogo docente.
- [x] Prompt disciplinari e regressioni.
- [x] Gate completi baseline e gate proporzionati dei fix (dettaglio sotto).
- [ ] Review indipendente, CI e deploy DEV mirato con smoke (orchestratore).

## Implementazione e confini di prodotto

- Il gateway esistente `aiContentPreview`/`aiContentGenerate` gestisce `pool`
  con `purpose: practice`; nessuna nuova Function e nessuna chiamata per risposta.
  Preview, hash di input, lease, prenotazione, settlement e replay restano comuni.
- La struttura didattica si ricava su richiesta dal corpo effettivo disponibile,
  anche per lezioni manuali/legacy. Distingue gli obiettivi pianificati preparati,
  parziali e non sviluppati; ogni capacità allenata ha prerequisiti, metodo e
  citazione esatta. Non nasce dai soli metadati. Non è generata automaticamente
  per ogni salvataggio di lezione, che non provoca nuove chiamate/costi.
- Il docente trova il percorso nella scheda Domande, sceglie 3/6/9 attività e
  indicazioni facoltative, stima, genera, modifica consegne/aiuti/soluzioni/opzioni,
  verifica anteprima e approva. Ogni capacità allenata richiede almeno esempio,
  guidato e autonomo. Non si promette di esercitare tutti gli obiettivi in tre attività.
- Il contenuto privato vive in `LessonDoc.studyPractice`. Solo l'approvazione
  pubblica `publicLessonPractice/{publicLessonId}`. Salva bozza e ritiro eliminano
  la copia pubblica; l'identità deriva dal documento tecnico e dalla proiezione.
- Il documento pubblico dedicato ha `ownerUid`, `publicLessonId` e un contratto
  chiuso `practice`: versione, corpo sorgente esatto, piano e attività. Nessun
  pool ID, criterio di voto, risposta studente o metadato tecnico del generatore.
  Bound applicativi: sorgente 200.000 byte + piano/attività 100.000 byte, quindi
  ampiamente sotto 1 MiB. Le Rules aggiungono chiusura envelope/domande, cardinalità,
  limiti di stringhe e uguaglianza esatta del corpo pubblico corrente.
- Accesso diretto studente subordinato a classe, import attivo, portale, approvazione,
  lezione svolta e assenza modalità verifica. Il cambio corpo/completed è sufficiente
  a revocare l'accesso tramite Rules anche se una vecchia copia resta materialmente
  presente. Il lifecycle server della lezione non deve copiare campi pratica.
- Il salvataggio del corpo e lo svuotamento rimuovono la copia pubblica; lo
  svuotamento rimuove anche la pratica privata. Cancellazioni di lezione/UDA/corso
  includono gli artefatti pubblici. Nessuna migrazione/backfill automatica.
- Lo studente apre il percorso dalla lezione; due listener limitati alla lezione
  aperta svuotano la pratica al cambio/revoca della sorgente o del percorso.
  Chiusura, cambio identità/corpo e aggiornamento pratica azzerano risposte/aiuti.
  Nessun localStorage, documento risposta o IA durante l'esercizio.
- Il pool usa soltanto la pratica effettivamente pubblicata e corrente, subordinata
  alla lezione. Il riepilogo IA esplicita capacità verificate, lacune e ordinali
  avanzati. L'audit di pool esistenti lavora in blocchi fino a 30 con stima totale;
  nessun salvataggio automatico, confronti e applicazione esplicita, ID conservati.
- Quando la fonte non prepara abbastanza richieste il generatore può restituire
  `sourceInsufficient`: il gateway termina senza pool, con errore dedicato e normale
  contabilizzazione del consumo già avvenuto. Mai riempimento di richieste inventate.
- Import/export ZIP e prompt esterni conservano il contratto lezione/pool esistente;
  la pratica resta artefatto applicativo e non viene esportata/importata né approvata
  implicitamente. L'esportazione prompt `purpose: practice` è rifiutata esplicitamente.

## Verifica didattica e limiti

I test automatici dimostrano schema, riferimenti presenti, progressione, isolamento,
idempotenza e comportamento UI. Non dimostrano che una citazione insegni davvero un
metodo o che il giudizio cognitivo del modello sia corretto. Il docente controlla
sempre i materiali prima di pubblicare. Il collaudo reale autorizzato è descritto sotto.
Il manifest `didactic-study-offline-cases-2026-10.json` contiene cinque scenari con
attese docente: definizione while senza tracing, tracing insegnato con caso nuovo,
proporzionalità in nuovo contesto, cronologia senza analisi fonti, interpretazione
letteraria supportata. Le attese offline sono distinte dagli esiti reali sotto.

Smoke locale dell'orchestratore, senza Functions/provider: lo studente apre pratica,
controlla una chiusa, rivela aiuti, confronta un'aperta; chiude/riapre e i dati si
azzerano. Il docente modifica un aiuto, salva bozza, approva, ritira; lo studente
non vede più pratica ritirata. Il seed ha usato ID legacy compatibili col loader
esistente. Prova DOM/interazioni in browser, nessuna QA raster dichiarata.

## Deploy e rollback

Target necessari: Hosting DEV, Firestore Rules e le tre Function contenuti
`aiContentPreview`, `aiContentGenerate`, `aiContentPromptExport`. Nessuna modifica Storage Rules,
indici, segreti o correzione. Il solo revisore pool passa al modello Sol già usato per le lezioni. L'orchestratore ricava dal codice i nomi
export effettivi prima del deploy. Rollback: build/Function/Rules alla release
precedente; i documenti additivi rimangono privati/non leggibili dalla vecchia UI,
senza migrazioni distruttive. PROD resta fuori scope.


## Gate locali e revisione ciclo 1

Al commit `5b36fa7`: unit completi 6.259 test verdi (Functions 2.213,
contratto 58, web 3.988), più regressione mirata della lettura pubblica tardiva.
Rules web: 734 test verdi; integration Functions: 222 test verdi con il solo
override CLI `--testTimeout=15000` per il primo avvio del test upload su Windows.
Il gate locale standard a 5 secondi incontrava quel timeout baseline; la CI
standard Linux sullo stesso `5b36fa7` è verde. Questi gate usano provider simulati.

Il fix aggregato del ciclo 1 conserva difficoltà e punti originali nell'audit
pool, comprese domande aperte e chiuse, con ID e limiti risposta invariati.
Alla riapertura l'editor pratica rilegge il documento privato dal server, senza
usare il tree del corso come sorgente della bozza: una lettura puntuale aggiuntiva
per apertura, nessun refetch del corso. Modifiche e salvataggio restano bloccati
finché la lettura non riesce. Regressioni coprono nuova bozza e pratica esistente
modificata, entrambe riaperte con lo snapshot del corso ancora precedente.
Al fix `db1cc63`: 127 test web mirati, format/lint/typecheck/build e diff check verdi.
La CI e review del prossimo SHA con il fix semantico restano da eseguire; non si
assume un esito precedente come prova del nuovo SHA.

## Collaudo IA reale autorizzato e fix semantico

Autorizzazione umana esplicita: materiali sintetici, massimo 12 tentativi e $5
aggregati, chiave DEV solo in memoria. Manifest, ledger e risultati sono fuori Git
in `%TEMP%/schoolforge-study-real-smoke`; nessun dato studente. SDK e runner senza
retry; prima di ogni tentativo fence persistente e prenotazione conservativa.

Le prime otto prove hanno prodotto blocchi coerenti sulle due fonti premature,
soluzioni corrette sui metodi insegnati, pratica e pool riferito alla pratica.
Le prove 9 e 10 hanno invece dimostrato un difetto del revisore `gpt-5.6-luna`:
tracing mantenuto senza metodo insegnato, anche dopo una prima regola esplicita.
Il collaudo si e fermato dopo ciascun difetto; nessun Quality holdout eseguito.

Il fix finale usa SOLO per `pool_review` il modello/listino Quality gia adottato
per `lesson_review`: `gpt-6.1-sol` / `v12-2026-09-29-gpt61-sol-standard`.
Il costo e la stima seguono il resolver esistente; l'audit puo quindi costare piu
del precedente revisore Luna e resta soggetto ai limiti runtime per operazione.
La mappa conserva il proprio revisore. Versioni `pool_review-v7` e
`pool-alignment-v4` invalidano l'identita delle nuove richieste coerentemente.

Ogni domanda FINALE deve avere evidenza raw: indice completo/in ordine, capacita,
operazione sintetica, stato prepared/missing e citazione esatta della lezione.
Flag mancante, evidenze incomplete, ordine errato o citazione inventata bloccano
l'output; missing o citazione vuota producono `source_insufficient`. Non sono
chain-of-thought. Le evidenze non vengono aggiunte al risultato persistito;
i completed legacy restano leggibili. Non si insegna una procedura assente
nella consegna per rendere applicabile una domanda prematura.

Retest 11: PASS. Il tracing prematuro viene sostituito con comprensione del
significato di while e variabile, citazione pertinente e lacuna sull'obiettivo
output dichiarata. Retest 12: PASS. Il trasferimento prezzo/produzione resta
invariato, sostenuto da `k=y/x` e `y=kx`; risultato 64 pezzi corretto.
Totale definitivo: 12 tentativi, $0,035596, 28.483 token input e 12.228 output,
nessun retry o usage mancante. Il budget residuo non autorizza altri tentativi.

Limiti: singolo campione per caso, fonti brevi sintetiche, nessuna validazione
in classe. La citazione e verificata come appartenenza, non come implicazione
semantica universale. Varieta limitata in alcuni pool e commenti gaps talvolta
su estensioni non richieste: nessuna promessa di copertura curricolare completa
o assenza universale di duplicati. Revisione docente resta necessaria.

Sul fix semantico: test mirati di schema/evidenze/legacy/accounting e resolver,
format/lint/typecheck, 2.218 test Functions completi e build workspace verdi.
Rules e UI non modificate dal fix semantico: valgono i gate precedenti, con CI
completa sul nuovo SHA ancora richiesta. Deploy DEV e smoke restano pending
all'orchestratore, PROD esclusa.
