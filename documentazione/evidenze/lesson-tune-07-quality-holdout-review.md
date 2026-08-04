# LESSON-TUNE-07 — review holdout quality del candidato D

> **Esecuzione reale unica completata il 4 agosto 2026.** Quattro scenari
> `holdout`, profilo `quality`, modello `gpt-5.6-luna`, prompt congelato
> `lesson-tune-01-candidate-d-v1`. Gli output holdout non sono stati e non
> saranno usati per modificare il prompt.

## Integrità dell'esecuzione e costo

Il report locale usa dataset `lesson-tune-01-combined-v1`, rubrica
`lesson-manual-02-rubric-v1`, split esplicito `holdout`, modello
`gpt-5.6-luna` e listino `v5-2026-07-20-luna-dev`. Sono presenti tutti e
quattro i Markdown originali previsti (`LM02-05`, `LM02-06`, `LT01-11`,
`LT01-12`). Nessun campione segnala `priorBillingRisk`.

| Scenario | Input token | Output token | Costo µUSD |
|---|---:|---:|---:|
| LM02-05 | 2.930 | 6.164 | 39.914 |
| LM02-06 | 2.927 | 3.628 | 24.695 |
| LT01-11 | 2.878 | 4.567 | 30.280 |
| LT01-12 | 2.876 | 4.538 | 30.104 |
| **Totale effettivo** | **11.611** | **18.897** | **124.993** |

Il costo effettivo è quindi **124.993 µUSD (0,124993 USD)**, inferiore alla
stima di 328.037 µUSD e al tetto prudenziale autorizzato di 741.080 µUSD.
Nessun dato è stato scritto su Firestore o Storage.

## Esito sintetico

Tutti i quattro scenari holdout sono **PASS**, senza blocker disciplinari,
pedagogici, di perimetro UDA o di sicurezza. Insieme agli otto scenari tuning
quality già valutati, il candidato D ottiene **12/12 PASS** sul dataset
congelato. Il verdetto finale sul prompt per il profilo `quality` è quindi
**PROMPT_INVARIATO**.

| Scenario | Cor | Com | Chi | Pro | Dep | Dif | Con | Obi | Per | Gui | Ese | Sol | Mar | Den | Sic | Totale | Verdetto |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| LM02-05 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 60 | PASS |
| LM02-06 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 4 | 4 | 59 | PASS |
| LT01-11 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 60 | PASS |
| LT01-12 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 60 | PASS |

## Evidenze per scenario

### LM02-05 — normalizzazione fino alla 3NF

Il caso unitario attraversa realmente 1NF, 2NF e 3NF. Dichiara prima le
assunzioni del dominio, ricava le dipendenze funzionali, dimostra perché
`(M, C)` è chiave candidata e motiva ogni decomposizione. Le anomalie di
inserimento, aggiornamento e cancellazione sono collegate agli schemi prima e
dopo la normalizzazione. La distinzione fra dipendenza parziale e transitiva è
corretta; lo schema finale conserva le dipendenze principali e usa
coerentemente chiavi primarie ed esterne. Non anticipa progettazione fisica o
indici. Le due autoverifiche richiedono ragionamento sul caso e hanno soluzioni
complete.

### LM02-06 — affidabilità TCP

Numeri di sequenza e ACK sono spiegati correttamente a livello di byte. Il
caso `1000–1199`, perdita di `1200–1399`, arrivo fuori ordine di
`1400–1599`, ACK cumulativo fermo a `1200`, ritrasmissione e successivo
`ACK = 1600` è coerente in ogni passaggio. La lezione separa nettamente
affidabilità end-to-end TCP e instradamento IP; richiama le porte solo quanto
serve e non sviluppa controllo di flusso, congestione o protocolli
applicativi. La nota sugli ACK duplicati è delimitata come ottimizzazione del
recupero e non diventa una lezione sul controllo della congestione.

L'unico difetto osservabile è editoriale: due tabelle contengono una riga
isolata `|` dopo l'ultima riga valida. Il contenuto resta integro e leggibile,
ma la struttura Markdown non è perfettamente sobria; per questo `Mar = 3`.
È un'imperfezione isolata e non giustifica una modifica del prompt congelato.

### LT01-11 — problema stechiometrico

La catena massa → moli → rapporto molare → moli → massa è motivata anche
dimensionalmente. Entrambi i problemi richiesti sono completi: decomposizione
del carbonato di calcio e combustione dell'etanolo. Equazioni, masse molari,
rapporti, cifre significative e risultati sono corretti; i controlli di
plausibilità spiegano sia la conservazione della massa sia il contributo
dell'ossigeno alla massa complessiva dei prodotti. Gli errori tipici sono
collegati al metodo, non soltanto elencati. Il reagente limitante non viene
sviluppato: l'ossigeno in eccesso è dichiarato esclusivamente come ipotesi
necessaria del problema.

### LT01-12 — feedback nei sistemi

La lezione distingue correttamente segno del feedback e valore desiderabile
dell'esito. Introduce sistema, variabile, circuito, legami diretti/inversi ed
equilibrio dinamico prima di applicarli. Gli esempi biologici, ambientali e
organizzativi sono causalmente espliciti, dichiarano condizioni e limiti e
mostrano sia amplificazione sia compensazione. Il metodo finale obbliga a
chiudere il circuito, evitando di scambiare una catena aperta per un feedback.
Le attività trasferiscono il ragionamento a casi nuovi. Il tema dei ritardi,
riservato alla lezione successiva, non viene sviluppato.

## Difetti residui e attribuzione

- Nessun difetto pedagogico ricorrente controllabile dal prompt.
- Un solo difetto Markdown isolato in `LM02-06`; attribuzione:
  **variabilità del modello/provider**, non problema sistemico del prompt.
- Le lezioni `in_depth` sono necessariamente lunghe ma mantengono densità e
  progressione; non emerge riempitivo ripetitivo.
- Non sono state eseguite nuove chiamate per confermare o correggere alcun
  dettaglio, in rispetto del vincolo holdout.

## Decisione finale

Il candidato `lesson-tune-01-candidate-d-v1` con profilo `quality` è
**accettato sul benchmark congelato**: tuning 8/8 PASS, holdout 4/4 PASS,
totale 12/12 PASS. Non si prepara un candidato E e il prompt D resta
immutato.

Questa decisione chiude il gate qualitativo tecnico del prompt, ma non abilita
automaticamente il modello in produzione. Restano separati il controllo
visivo/disciplinare del docente sui quattro originali nelle viste reali e la
decisione operativa di rollout, budget e kill switch del Gate GAIGEN.
