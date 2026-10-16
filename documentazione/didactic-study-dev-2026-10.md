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
- Nessun provider reale durante lo sviluppo; stima e accounting del gateway invariati.
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
- [ ] Format, lint, typecheck, test, build, rules, diff check.
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
sempre i materiali prima di pubblicare. Nessun provider reale è stato eseguito.
Il manifest `didactic-study-offline-cases-2026-10.json` contiene cinque scenari con
attese docente: definizione while senza tracing, tracing insegnato con caso nuovo,
proporzionalità in nuovo contesto, cronologia senza analisi fonti, interpretazione
letteraria supportata. Il confronto reale prima/dopo resta pending fino a specifica
autorizzazione di provider e budget.

Smoke locale dell'orchestratore, senza Functions/provider: lo studente apre pratica,
controlla una chiusa, rivela aiuti, confronta un'aperta; chiude/riapre e i dati si
azzerano. Il docente modifica un aiuto, salva bozza, approva, ritira; lo studente
non vede più pratica ritirata. Il seed ha usato ID legacy compatibili col loader
esistente. Prova DOM/interazioni in browser, nessuna QA raster dichiarata.

## Deploy e rollback

Target necessari: Hosting DEV, Firestore Rules e le tre Function contenuti
`aiContentPreview`, `aiContentGenerate`, `aiContentPromptExport`. Nessuna modifica Storage Rules,
indici, segreti, provider o correzione. L'orchestratore ricava dal codice i nomi
export effettivi prima del deploy. Rollback: build/Function/Rules alla release
precedente; i documenti additivi rimangono privati/non leggibili dalla vecchia UI,
senza migrazioni distruttive. PROD resta fuori scope.

