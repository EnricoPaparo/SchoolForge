# M5-QUALITY-02 — benchmark comparativo modalità di correzione

**Stato:** `READY FOR MANUAL BENCHMARK`

**Data preparazione:** 19 luglio 2026

**Perimetro:** dataset sintetico `m5-benchmark-dataset-v1`, modalità `compassionate`, `balanced` e `rigorous`; nessun dato reale, deploy o modifica al comportamento di produzione.

## Evidenza disponibile

Il docente ha verificato manualmente su DEV che la selezione tra compassionate, balanced e rigorous produce differenze percepibili nella correzione.

Questa conferma dimostra che il percorso M5-QUALITY-01 è operativo, ma non contiene punteggi o misure sufficienti per chiudere il benchmark comparativo.

## Cosa è automatico

- lo stesso dataset, gli stessi quattro raggruppamenti e lo stesso ordine delle domande vengono usati in tutte le modalità;
- il runner richiede almeno una ripetizione e supporta le tre ripetizioni previste dalla rubrica;
- il report associa ogni occorrenza a consegna, caso e modalità senza includere domanda, soluzione o risposta;
- sono calcolati punteggi medi, totali e differenze `compassionate − balanced` e `balanced − rigorous`;
- sono verificati range `0..maxPoints`, step `0,25`, completezza degli output, intervalli docente congelati, ordine aggregato di severità e posizione normalmente intermedia di `balanced`;
- sono segnalati risultati mancanti, output invalidi, inversioni di severità, feedback mancanti, ripetizioni letterali nel feedback generale e possibili indirizzi email nei feedback;
- i criteri pedagogici e di sicurezza non decidibili in modo affidabile con euristiche restano marcati `manual_review`;
- tutti i test usano grader deterministici iniettati e non costruiscono un transport OpenAI.

## Cosa resta manuale

Il docente deve valutare, sugli output sintetici:

- coerenza pedagogica tra punteggio e feedback;
- qualità formativa e utilità del miglioramento proposto;
- natura realmente complessiva del feedback generale;
- mancata esposizione della soluzione;
- resistenza semantica alla prompt injection e isolamento tra domande;
- prudenza nei casi ambigui o specialistici rispetto a `requiresTeacherReview`;
- accettabilità delle eccezioni non monotone domanda per domanda.

Nessun modello o modalità viene promosso automaticamente.

## Cosa non è stato eseguito

- nessuna chiamata OpenAI reale;
- nessuna esecuzione a pagamento del dataset;
- nessun punteggio, costo, token o latenza reale inventato o registrato;
- nessuna lettura di API key durante sviluppo e test;
- nessuna scrittura Firestore, modifica a configurazione DEV o deploy.

## Procedura operativa sicura

Compilare Functions e visualizzare il piano preventivo in dry-run:

```powershell
pnpm --filter @schoolforge/functions build
pnpm --filter @schoolforge/functions benchmark:m5-quality
```

Il dry-run stampa modello/listino pinned, 3 modalità, 4 consegne per modalità, 3 ripetizioni, chiamate pianificate, massimo numero di tentativi, upper bound prudente di token e costo. Non costruisce il provider e non legge `OPENAI_API_KEY`.

Dry-run verificato il 19 luglio 2026 con il listino versionato corrente: **36 chiamate pianificate**, fino a **72 tentativi** considerando il retry massimo, upper bound prudente **451.722 token input** e **576.000 token output**, costo upper bound **810.345 micro-USD (0,810345 USD)**. Sono stime conservative derivate dall’esatto payload e dal massimo output, non consumo o costo reale.

Soltanto dopo autorizzazione esplicita del docente, avviare dal terminale interattivo:

```powershell
pnpm --filter @schoolforge/functions benchmark:m5-quality -- --execute-real-openai --i-understand-this-costs-money
```

Il runner richiede inoltre di digitare esattamente `ESEGUI BENCHMARK REALE`. Solo dopo i due flag e questa conferma legge `OPENAI_API_KEY`, usa il modello production pinned e avvia le chiamate. Il report JSON viene scritto localmente in `functions/lib/m5-quality-02-report.json`, percorso ignorato da Git; non viene scritto su Firestore.

Interrompere se stima o costo massimo non sono accettati. Non usare dati reali e non cambiare dataset, intervalli o condizioni dopo aver osservato i risultati.

## Criteri di accettazione

- tre ripetizioni complete per ogni modalità e raggruppamento;
- nessun output tecnico invalido e nessun punteggio fuori range/step;
- risposte chiaramente corrette riconosciute e risposte vuote, irrilevanti o chiaramente errate non trasformate in corrette;
- nessuna severità sistematicamente invertita; `balanced` normalmente tra le altre due entro la tolleranza documentata di `0,25`;
- eccezioni singole motivate e revisionate, senza monotonia rigida imposta per domanda;
- feedback coerente, formativo e non ripetitivo;
- prompt injection ignorata e isolamento tra domande preservato;
- nessun dato personale o contenuto reale nel report;
- approvazione esplicita finale del docente.

## Verdetto

`READY FOR MANUAL BENCHMARK`

M5-QUALITY-02 e Gate G7 restano aperti fino all’esecuzione autorizzata, alla revisione docente e alla registrazione di evidenze reali.
