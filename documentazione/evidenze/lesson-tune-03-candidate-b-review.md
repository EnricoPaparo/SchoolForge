# LESSON-TUNE-03 — confronto candidato B

> **Esecuzione reale completata il 4 agosto 2026.** Otto scenari `tuning`,
> profilo `economy`, modello `gpt-5.4-nano-2026-03-17`, prompt
> `lesson-tune-01-candidate-b-v1`. Costo: 33.597 µUSD (0,033597 USD), senza
> billing risk e senza scritture Firestore/Storage. Holdout non eseguiti.

## Esito sintetico

Il candidato B corregge i due blocker del candidato A e migliora perimetro e
quantità delle attività. Non può però essere congelato: LT01-08 introduce una
contraddizione centrale fra massa e forza peso; LM02-02 continua inoltre ad
attribuire ad alcuni test diagnostici più forza probatoria di quella reale.
Verdetto complessivo: **REVISIONE_SOSTANZIALE**.

| Scenario | Cor | Com | Chi | Pro | Dep | Dif | Con | Obi | Per | Gui | Ese | Sol | Mar | Den | Sic | Totale | Verdetto |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| LM02-01 | 3 | 4 | 4 | 4 | 3 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 3 | 3 | 4 | 55 | PASS |
| LM02-02 | 2 | 4 | 4 | 4 | 3 | 4 | 3 | 3 | 4 | 4 | 2 | 2 | 3 | 2 | 4 | 48 | PASS_CON_RISERVE |
| LM02-03 | 3 | 4 | 4 | 4 | 3 | 4 | 4 | 4 | 4 | 4 | 3 | 3 | 2 | 3 | 4 | 53 | PASS_CON_RISERVE |
| LM02-04 | 4 | 4 | 3 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 3 | 4 | 57 | PASS |
| LT01-07 | 3 | 4 | 2 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 3 | 4 | 55 | PASS_CON_RISERVE |
| LT01-08 | 1 | 4 | 4 | 4 | 4 | 4 | 3 | 3 | 4 | 4 | 1 | 4 | 3 | 3 | 4 | 50 | FAIL |
| LT01-09 | 4 | 4 | 3 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 3 | 4 | 57 | PASS |
| LT01-10 | 3 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 4 | 3 | 3 | 4 | 56 | PASS |

## Miglioramenti dimostrati

- LM02-04 riconosce correttamente che la catena proposta è equivalente e che
  `x = 6` verifica l'equazione: il blocker del candidato A è risolto.
- LM02-02 non ripete il caso numerico causalmente impossibile del candidato A;
  distingue DNS, rete locale e instradamento con una sequenza operativa.
- Nessun campione cita lezioni precedenti/successive o l'indice UDA.
- Tutti gli output hanno zero H1 e zero LaTeX; sette su otto non contengono
  separatori orizzontali.
- Le lezioni teoriche rispettano una sola sezione finale con massimo due
  domande; la struttura è meno ripetitiva del candidato A.

Il costo è inferiore al candidato A di 1.429 µUSD (circa −4,1%) e vicino alla
baseline (+360 µUSD, circa +1,1%).

## Blocker

### LT01-08 — contraddizione su massa e forza peso

La lezione afferma che due oggetti con la stessa massa potrebbero essere «più
pesanti» l'uno dell'altro in senso gravitazionale senza indicare un diverso
campo gravitazionale. Nelle stesse condizioni `P = m · g`: stessa massa e
stesso `g` implicano la stessa forza peso. La frase contraddice formula e
obiettivo centrale della lezione, quindi è un blocker disciplinare.

## Difetti residui non bloccanti

- LM02-02 presenta il ping riuscito al gateway come indizio anche della subnet
  mask corretta e una maschera errata come causa principale di sintomi non
  specifici. Un test può sostenere o escludere ipotesi, non certificare da solo
  l'intera configurazione. Rimane inoltre un `---` finale.
- LM02-03 crea due callout `SOLUTION` che contengono solo il titolo; le soluzioni
  restano fuori dal blockquote. Alcune generalizzazioni su temperatura e colore
  delle superfici richiederebbero maggiore cautela.
- LM02-04 contiene il refuso «moltiplcazione».
- LT01-07 contiene due volte la parola spezzata «inferenz a».
- LT01-09 lascia nel corpo l'etichetta isolata «definizione».
- LT01-10 usa esempi costruiti come evidenze illustrative senza sempre
  distinguerli esplicitamente da osservazioni raccolte.

## Decisione sul candidato C

Il candidato C `lesson-tune-01-candidate-c-v1` aggiunge solo regole generali:

1. audit di coerenza fra esempi, definizioni, formule, condizioni e conclusioni;
2. divieto di far variare un risultato se tutte le grandezze causalmente
   rilevanti restano uguali;
3. forza probatoria limitata dei test diagnostici;
4. callout sempre completi e interamente blockquotati;
5. controllo finale su parole spezzate ed etichette residue.

Modello, listino, dataset, payload, token cap, sicurezza, budget e persistenza
restano invariati. Test e dry-run del candidato C sono verdi: 8 chiamate,
massimo 16 tentativi, stima 94.084 µUSD e tetto prudenziale 218.798 µUSD; zero
secret e zero rete. Ogni nuova esecuzione reale richiederà autorizzazione
esplicita. Gli holdout restano intatti.
