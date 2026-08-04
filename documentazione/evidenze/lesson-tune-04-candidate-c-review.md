# LESSON-TUNE-04 — confronto candidato C

> **Esecuzione reale completata il 4 agosto 2026.** Otto scenari `tuning`,
> profilo `economy`, modello `gpt-5.4-nano-2026-03-17`, prompt
> `lesson-tune-01-candidate-c-v1`. Nessuna scrittura Firestore/Storage e nessun
> holdout eseguito.

## Costo e attendibilità contabile

Sette campioni hanno un costo effettivo noto pari complessivamente a
27.618 µUSD. `LT01-09` ha `priorBillingRisk: true` e costo effettivo non
determinabile: il totale reale non va quindi inventato ed è registrato come
`null`. Il tetto prudenziale dell'intero lotto è 218.798 µUSD (0,218798 USD).

## Esito sintetico

Il candidato C elimina la contraddizione fra massa e forza peso del candidato
B, migliora i callout e non presenta regressioni strutturali. Non può però
essere congelato: `LM02-02` contiene un esercizio diagnostico IPv4 le cui
premesse sono reciprocamente incompatibili e costruisce su di esse una
soluzione autorevole. Verdetto complessivo: **REVISIONE_SOSTANZIALE**.

| Scenario | Cor | Com | Chi | Pro | Dep | Dif | Con | Obi | Per | Gui | Ese | Sol | Mar | Den | Sic | Totale | Verdetto |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| LM02-01 | 4 | 4 | 4 | 4 | 3 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 4 | 4 | 4 | 58 | PASS |
| LM02-02 | 1 | 4 | 4 | 4 | 3 | 4 | 2 | 3 | 4 | 4 | 1 | 1 | 4 | 3 | 4 | 46 | FAIL |
| LM02-03 | 3 | 4 | 4 | 4 | 3 | 4 | 4 | 4 | 4 | 4 | 3 | 3 | 4 | 3 | 4 | 55 | PASS_CON_RISERVE |
| LM02-04 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 4 | 59 | PASS |
| LT01-07 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 4 | 59 | PASS |
| LT01-08 | 3 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 4 | 58 | PASS_CON_RISERVE |
| LT01-09 | 2 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 2 | 3 | 4 | 55 | PASS_CON_RISERVE |
| LT01-10 | 3 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 4 | 4 | 3 | 4 | 57 | PASS_CON_RISERVE |

## Blocker

### LM02-02 — premesse IPv4 incompatibili

L'esercizio dichiara contemporaneamente che il gateway corretto è
`10.0.0.1`, che il PC dovrebbe appartenere a una rete `/24` e che gli altri
host sono `10.0.1.x`. Se la rete attesa è `10.0.1.0/24`, `10.0.0.1` non è un
gateway locale valido in quella stessa sottorete. La soluzione attribuisce
invece il problema alla sola maschera `/16` e presenta i test come conferma.
Il caso non è risolvibile coerentemente con tutti i dati forniti: essendo il
nucleo dell'attività diagnostica, è un blocker di correttezza.

## Miglioramenti dimostrati

- `LT01-08` distingue correttamente massa e forza peso e indica la variazione
  di `g` come causa della differenza fra Terra e Luna.
- `LM02-04` ricalcola e verifica correttamente le trasformazioni algebriche.
- Nessun output contiene H1, LaTeX, riferimenti espliciti a lezioni
  precedenti/successive o separatori orizzontali.
- I callout sono completi e la densità è generalmente più controllata.
- `LT01-07` distingue esplicitamente gli esempi costruiti dalle evidenze reali.

## Difetti residui non bloccanti

- `LT01-09` include «usare un nome sbagliato» fra gli errori di sintassi,
  benché un nome non definito produca normalmente un errore runtime
  (`NameError`). Inoltre il secondo marcatore `SOLUTION` è annidato nel primo
  blockquote e non forma un callout indipendente.
- `LT01-08` usa «bilancia» in modo generico dove la spiegazione riguarda in
  realtà gli strumenti che misurano una forza e la convertono in massa.
- `LT01-10` definisce «argomento» come tema della tesi, terminologia troppo
  riduttiva rispetto all'uso logico-retorico del termine; il resto della
  progressione tesi–ragioni–evidenze rimane valido.

## Decisione sul candidato D

Il candidato D `lesson-tune-01-candidate-d-v1` aggiunge soltanto due controlli
generali, applicabili a tutte le discipline:

1. audit di compatibilità delle premesse prima di presentare o risolvere un
   caso; un caso incoerente deve essere corretto o sostituito, non «risolto»;
2. audit terminologico: esempi, etichette e categorie devono soddisfare le
   rispettive definizioni e mantenere lo stesso significato nella lezione.

Modello, listino, dataset, split, payload, profondità, token cap, schema,
sicurezza e persistenza restano invariati. I quattro holdout rimangono intatti.
Ogni esecuzione reale del candidato D richiederà una nuova autorizzazione
esplicita dopo il dry-run.
