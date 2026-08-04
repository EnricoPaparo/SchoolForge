# LESSON-TUNE-05 — confronto candidato D

> **Esecuzione reale completata il 4 agosto 2026.** Otto scenari `tuning`,
> profilo `economy`, modello `gpt-5.4-nano-2026-03-17`, prompt
> `lesson-tune-01-candidate-d-v1`. Nessuna scrittura Firestore/Storage e nessun
> holdout eseguito.

## Costo e attendibilità contabile

Sette campioni hanno un costo effettivo noto pari complessivamente a
29.510 µUSD. `LM02-04` ha `priorBillingRisk: true` e costo effettivo non
determinabile: il totale reale è quindi `null`, non una somma inventata. Il
tetto prudenziale dell'intero lotto è 221.610 µUSD (0,221610 USD).

## Esito sintetico

Il candidato D conserva i miglioramenti su algebra, massa/peso, analisi delle
fonti e argomentazione, ma non rende affidabile il profilo `economy`. Il caso
IPv4 resta scientificamente falso nonostante l'audit esplicito delle premesse;
il caso sul trasferimento termico introduce inoltre una seconda soluzione
centrale errata/incompleta. Verdetto: **REVISIONE_SOSTANZIALE**.

| Scenario | Cor | Com | Chi | Pro | Dep | Dif | Con | Obi | Per | Gui | Ese | Sol | Mar | Den | Sic | Totale | Verdetto |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| LM02-01 | 4 | 4 | 4 | 4 | 3 | 4 | 4 | 4 | 4 | 4 | 4 | 1 | 4 | 4 | 4 | 56 | PASS_CON_RISERVE |
| LM02-02 | 1 | 4 | 4 | 4 | 3 | 4 | 2 | 3 | 4 | 4 | 1 | 1 | 1 | 2 | 4 | 42 | FAIL |
| LM02-03 | 1 | 4 | 4 | 4 | 3 | 4 | 3 | 3 | 4 | 4 | 2 | 1 | 4 | 3 | 4 | 48 | FAIL |
| LM02-04 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 4 | 59 | PASS |
| LT01-07 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 4 | 59 | PASS |
| LT01-08 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 4 | 59 | PASS |
| LT01-09 | 2 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 4 | 57 | PASS_CON_RISERVE |
| LT01-10 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 2 | 3 | 4 | 57 | PASS_CON_RISERVE |

## Blocker

### LM02-02 — la `/23` non produce il guasto dichiarato

L'autoverifica usa host `192.168.10.50`, mask `255.255.254.0` (`/23`), gateway
`192.168.10.1` e risorsa locale `192.168.10.60`. Tutti appartengono alla rete
`192.168.10.0/23`: host e gateway restano locali e direttamente raggiungibili.
La soluzione sostiene invece che il gateway potrebbe non essere considerato
locale e prevede timeout causati dalla mask. È un nesso causale falso nel
nucleo dell'esercizio. Lo stesso output reintroduce inoltre otto separatori
`---`, nonostante il divieto esplicito del contratto.

### LM02-03 — scambio termico del frigorifero

L'autoverifica parla di un frigorifero che «perde guadagno termico» e indica
l'irraggiamento come spiegazione dello scambio quando l'aria è ferma, senza
riconoscere il trasferimento per conduzione attraverso pareti e isolamento.
Presenta inoltre l'interno del frigorifero come possibile «corpo caldo», mentre
nel caso ordinario il calore entra dall'ambiente più caldo verso l'interno più
freddo. La soluzione non identifica correttamente direzione e meccanismi del
caso richiesto.

## Difetti residui non bloccanti

- `LM02-01` chiude con due domande senza soluzione, in contrasto con il
  contratto che ammette nella lezione teorica solo autoverifiche risolte.
- `LT01-09` colloca ancora un «nome di variabile inesistente (in certi casi)»
  tra gli errori di sintassi; in Python un nome non definito produce
  normalmente `NameError` durante l'esecuzione.
- `LM02-04` contiene il refuso «parenti» al posto di «parentesi».
- `LT01-10` inserisce il secondo marcatore `SOLUTION` nello stesso blockquote
  del primo: il contenuto resta leggibile, ma non genera due callout distinti.

## Decisione: confronto di capacità, non candidato E

Il prompt contiene già controlli espliciti su premesse, formule, causalità,
terminologia e ricalcolo. Aggiungere nuove istruzioni rischia di diluire
ulteriormente l'attenzione senza risolvere il limite osservato. Il prossimo
esperimento mantiene **identici** prompt D, dataset, split, payload e token cap,
variando soltanto il profilo server-side da `economy` a `quality` (Luna).

Il confronto quality è ammesso esclusivamente sullo split `tuning`; gli holdout
restano irraggiungibili da quel profilo. Ogni esecuzione reale richiede una
nuova autorizzazione esplicita dopo il dry-run.
