# LESSON-TUNE-02 — confronto candidato A

> **Esecuzione reale completata il 4 agosto 2026.** Otto scenari `tuning`,
> profilo `economy`, modello `gpt-5.4-nano-2026-03-17`, prompt
> `lesson-tune-01-candidate-a-v1`. Costo: 35.026 µUSD (0,035026 USD), senza
> billing risk e senza scritture Firestore/Storage. Holdout non eseguiti.

## Esito sintetico

Il candidato A migliora nettamente la compatibilità editoriale ma **non può
essere congelato**: due esercizi centrali contengono errori concettuali e
producono `FAIL`. Restano inoltre riferimenti a lezioni precedenti/successive,
refusi e attività teoriche oltre il limite richiesto. Verdetto complessivo:
**REVISIONE_SOSTANZIALE**.

| Scenario | Cor | Com | Chi | Pro | Dep | Dif | Con | Obi | Per | Gui | Ese | Sol | Mar | Den | Sic | Totale | Verdetto |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| LM02-01 | 3 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 3 | 3 | 4 | 56 | PASS |
| LM02-02 | 2 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 1 | 2 | 3 | 2 | 4 | 50 | FAIL |
| LM02-03 | 2 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 2 | 4 | 3 | 3 | 3 | 3 | 4 | 52 | PASS_CON_RISERVE |
| LM02-04 | 1 | 4 | 3 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 2 | 2 | 2 | 2 | 4 | 48 | FAIL |
| LT01-07 | 3 | 4 | 3 | 4 | 4 | 4 | 4 | 4 | 2 | 4 | 4 | 4 | 3 | 3 | 4 | 54 | PASS_CON_RISERVE |
| LT01-08 | 3 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 2 | 4 | 4 | 4 | 3 | 3 | 4 | 55 | PASS_CON_RISERVE |
| LT01-09 | 3 | 4 | 3 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 2 | 3 | 4 | 55 | PASS_CON_RISERVE |
| LT01-10 | 2 | 4 | 3 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 2 | 4 | 3 | 2 | 4 | 52 | PASS_CON_RISERVE |

## Miglioramenti dimostrati

- **LaTeX:** 0 occorrenze in 8/8, contro due lezioni centrali degradate nella
  baseline; equazioni e formule sono ora leggibili col renderer attuale.
- **Corpo-only:** zero H1 duplicati in tutti i campioni.
- **Separatori:** zero `---` in sei campioni; la baseline ne conteneva 9–13 in
  ogni output.
- **Sintesi:** LM02-01 scende da 1.794 a 1.450 token mantenendo la copertura e
  raggiunge `PASS`.
- **Precisione:** LT01-08 elimina la spiegazione ambigua della bilancia e rende
  massa/peso/formula leggibili; LT01-10 distingue più esplicitamente esperienza
  personale ed evidenza generale.

Costo totale: 35.026 µUSD contro 33.237 µUSD della baseline (+1.789 µUSD,
circa +5,4%). L'aumento dell'input è compensato dal prezzo contenuto del profilo
economy; non giustifica però l'accettazione di output disciplinarmente errati.

## Blocker e difetti residui

### LM02-02 — esercizio diagnostico errato

Nel Caso 1 la maschera `/16` viene proposta come spiegazione del mancato
raggiungimento del gateway `192.168.1.1`. Con IP `192.168.1.50/16`, quel gateway
è comunque considerato locale: la causa indicata non spiega tutti i sintomi.
È un esercizio centrale con soluzione causale errata, quindi blocker.

### LM02-04 — trasformazione equivalente presentata come errore

La catena `x − 4 = 2 → x − 8 = −2 → x = 6`, ottenuta sottraendo 4 e poi
aggiungendo 8 a entrambi i membri, è perfettamente equivalente. Il testo la
definisce invece «catena sbagliata». Questo insegna un criterio falso sui
principi di equivalenza ed è un blocker. Inoltre un callout `SOLUTION` è vuoto
perché il corpo successivo non è blockquotato.

### Difetti ricorrenti non bloccanti

- LM02-03, LT01-07 e LT01-08 citano esplicitamente lezione precedente,
  successive o contenuti «in seguito», nonostante il divieto già presente.
- LT01-07 mantiene il termine non standard «inferenzione».
- LT01-09 contiene «mentre tracciai» e conserva nove separatori orizzontali.
- LT01-10 usa ancora un resoconto costruito («in una prova in classe alcuni
  studenti…») come evidenza nel mini-testo e propone tre attività separate in
  una lezione teorica; compare anche il refuso `immers[i]`.
- I callout sono spesso usati per quasi ogni definizione o esempio: validi ma
  non sempre selettivi.

## Decisione sul candidato B

Il candidato B `lesson-tune-01-candidate-b-v1` rafforza regole generali, senza
citare discipline o casi del dataset:

1. ogni diagnosi deve spiegare tutti i sintomi e non può dichiarare unica una
   causa non esclusiva;
2. ogni presunto errore deve essere verificato come realmente scorretto e non
   come trasformazione equivalente alternativa;
3. ogni esercizio viene ricalcolato dai dati originali prima dell'output;
4. un caso ipotetico non può diventare evidenza reale per una conclusione
   generale;
5. una lezione teorica può avere una sola sezione di attività con massimo due
   domande risolte;
6. riferimenti a lezioni precedenti/successive e separatori `---` vengono
   rimossi nel controllo finale.

Modello, listino, payload, token cap, sicurezza, budget e persistenza restano
invariati. Test e dry-run del candidato B sono verdi: 8 chiamate pianificate,
massimo 16 tentativi, stima 94.084 µUSD e tetto prudenziale 215.978 µUSD. Il
dry-run non ha letto la chiave e non ha contattato il provider. Una nuova
generazione reale richiederà un'altra autorizzazione. Gli holdout restano
intatti.
