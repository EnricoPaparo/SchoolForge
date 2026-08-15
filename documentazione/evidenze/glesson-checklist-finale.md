# Gate GLESSON — checklist finale

**Stato finale:** **PASS — 15 agosto 2026.**

## Verdetto

Il prompt `lesson-depth-01-candidate-e-v1`, profilo `quality`, supera il tuning,
il caso povero, il dataset isovariante e il holdout congelato. Non emerge alcun
blocker disciplinare, pedagogico, di perimetro UDA o di sicurezza.

## Holdout reale candidato E

- dataset: `lesson-tune-01-combined-v1`;
- rubrica: `lesson-manual-02-rubric-v1`;
- split: `holdout`;
- modello: `gpt-5.6-luna`;
- report locale:
  `functions/lib/lesson-tune-01-holdout-2026-08-15T15-15-18-593Z`;
- output originali presenti: `LM02-05`, `LM02-06`, `LT01-11`, `LT01-12`;
- `priorBillingRisk: false` su tutti i campioni;
- costo effettivo del lotto valido: **140.004 µUSD (0,140004 USD)**, contro un
  tetto prudenziale di 925.946 µUSD.

| Scenario | Cor | Com | Chi | Pro | Dep | Dif | Con | Obi | Per | Gui | Ese | Sol | Mar | Den | Sic | Totale | Verdetto |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| LM02-05 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 60 | PASS |
| LM02-06 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 60 | PASS |
| LT01-11 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 4 | 4 | 59 | PASS |
| LT01-12 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 60 | PASS |

### Evidenze osservabili

- **LM02-05:** attraversa 1NF, 2NF e 3NF su un caso unitario; esplicita
  dipendenze, chiave candidata, anomalie e motivazione di ogni decomposizione;
  non anticipa progettazione fisica o indici.
- **LM02-06:** numeri di sequenza e ACK sono corretti a livello di byte; perdita,
  arrivo fuori ordine, timeout e ritrasmissione sono coerenti; IP e TCP restano
  distinti e non vengono sviluppati controllo di congestione o protocolli
  applicativi.
- **LT01-11:** due problemi completi e corretti; catena massa → moli → rapporto
  molare → massa motivata dimensionalmente; controlli di plausibilità ed errori
  tipici; nessuno sviluppo del reagente limitante. Un callout contiene una
  citazione annidata superflua: difetto Markdown isolato, `Mar = 3`.
- **LT01-12:** distingue il segno del feedback dal giudizio buono/cattivo,
  costruisce circuiti causali in contesti biologici, ambientali e organizzativi
  e spiega l'equilibrio dinamico; non sviluppa il tema dei ritardi riservato alla
  lezione successiva.

## Altre condizioni del gate

| Condizione | Esito |
|---|---|
| Candidato E su tuning | PASS: otto scenari valutati senza regressioni sistemiche. |
| Caso povero | PASS: tutti i sei scenari migliorano; il caso `in_depth` torna a essere il più sviluppato. |
| Dataset isovariante | PASS: la lunghezza non cresce meccanicamente col numero di concetti chiave. |
| Perimetro UDA | PASS nel tuning, nel holdout e nelle generazioni reali del docente. |
| Limiti di spesa | PASS: cap condiviso 0,25 USD, budget 1 USD/giorno e 5 USD/mese restano coerenti coi costi misurati. |
| UI | PASS: profondità `Completa` predefinita; descrizioni esplicite e nota sul ruolo di metadati e indicazioni docente. |
| Smoke DEV | PASS: lezioni candidate E generate, lette e salvate dal docente nel flusso reale. |

## Decisioni finali

- **D1:** resta il tetto per operazione condiviso da 0,25 USD; il massimo
  prudenziale del singolo scenario holdout resta sotto il cap.
- **D2:** restano i ceiling 1 USD/giorno e 5 USD/mese; sono abbassabili da
  configurazione, non alzabili senza modifica di codice.
- **D3:** nessun nuovo campo obbligatorio; concetti chiave e obiettivi esistenti
  definiscono il perimetro.
- **D4:** `Completa` resta il default; `Approfondita` è una scelta esplicita, non
  un aumento automatico della spesa.

## Incidente del runner

Una prima esecuzione del 15 agosto ha completato le quattro chiamate ma ha perso
gli output prima della scrittura: il percorso `lib/` era risolto rispetto alla
cartella corrente. Quelle chiamate possono essere state fatturate e non sono
incluse nel costo del report valido. Il runner è stato corretto nel commit
`e517f3c`: ora risolve sempre `functions/lib` da `import.meta.url`; test mirato,
build e dry-run Node 22 sono verdi.

## Verdetto finale

**Gate GLESSON superato (PASS).** Il candidato E è la baseline approvata per la
generazione delle lezioni su DEV. Il PASS non autorizza deploy PROD né modifica
i budget senza una decisione separata.
