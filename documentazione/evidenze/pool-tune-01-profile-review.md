# POOL-TUNE-01 — review del profile probe

> **Esecuzione reale completata l'11 agosto 2026.** Quattro scenari `tuning`
> eseguiti con input identico sui profili `economy` e `quality`, prompt
> `aigen-prompt-01-pool-v1`. Sette pool validi e un output rifiutato; nessuna
> scrittura Firestore o Storage.

## Decisione

Il profilo scelto per il tuning è **`quality`**. La decisione non promuove il
profilo nel runtime e non approva il prompt corrente: stabilisce soltanto quale
modello usare in `POOL-TUNE-02`.

- `economy` fallisce tutti e quattro gli scenari: un output è strutturalmente
  invalido e gli altri tre contengono soluzioni chiuse errate;
- `quality` produce quattro pool strutturalmente validi, con tutte
  le 17 soluzioni chiuse corrette e tutte le 13 soluzioni aperte corrette e
  sostenute dalle fonti;
- il prompt corrente su `quality` non supera ancora le soglie: `PT00-01`
  duplica sostanzialmente lo stesso caso e `PT00-07` scrive sequenze `\\n`
  letterali al posto di vere interruzioni di riga.

Il passaggio successivo è quindi un candidato di prompt **Quality-only** che
corregga questi difetti misurati, senza cambiare dataset, payload, schema,
validazione, cap o profilo runtime.

## Costi

I quattro campioni `quality` hanno un costo effettivo noto complessivo di
**68.259 µUSD (0,068259 USD)**, media **17.064,75 µUSD** per pool.

I tre campioni `economy` con usage conservato costano **12.093 µUSD
(0,012093 USD)**, media **4.031 µUSD**. Il quarto campione è un checkpoint
legacy con billing risk e costo non ricostruibile: il totale Economy resta
`null`. Sui soli campioni noti la media Quality è circa **4,23 volte** quella
Economy, ma non è un rapporto fra totali completi.

Il maggior costo non compensa un'imprecisione marginale: evita chiavi di
risposta sbagliate che renderebbero didatticamente dannoso il pool.

## Economy — blocker puntuali

| Scenario | Evidenza | Verdetto |
|---|---|---|
| `PT00-01` | Output respinto: «La soluzione deve riferirsi alle opzioni fornite». Raw output e usage non disponibili nel checkpoint v1. | `REVISIONE_SOSTANZIALE` |
| `PT00-02` | Domanda singola sull'effetto della subnet mask: risposta corretta indice `0`, salvata `1`. | `REVISIONE_SOSTANZIALE` |
| `PT00-04` | Domanda singola sul principio di equivalenza: risposta corretta indice `0`, salvata `1`. | `REVISIONE_SOSTANZIALE` |
| `PT00-07` | Quattro chiavi errate: attese `[2]`, `[1]`, `[0,1,2]`, `[0,1,2]`; prodotte `[3]`, `[2]`, `[1,2,3]`, `[1,2,3]`. | `REVISIONE_SOSTANZIALE` |

Il pattern è coerente con una numerazione delle opzioni da 1 invece che da 0.
Non è dimostrabile sul raw mancante di `PT00-01`, ma è presente in tutte le
domande chiuse dei tre campioni revisionabili per cui sposta la soluzione.
Economy non è quindi un candidato accettabile per il tuning del prompt corrente.

## Quality — rubrica 10 × 0–4

Abbreviazioni: `Fed` fedeltà, `Cop` copertura, `Chi` chiarezza/autonomia, `Pro`
profondità, `Dif` difficoltà, `Ape` soluzioni aperte, `Chiu` domande chiuse,
`Var` varietà, `Rag` ragionamento/applicazione, `For` utilità formativa.

| Scenario | Fed | Cop | Chi | Pro | Dif | Ape | Chiu | Var | Rag | For | Totale | Verdetto |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| `PT00-01` | 4 | 4 | 4 | 3 | 4 | 4 | 4 | 2 | 3 | 4 | 36/40 | `REVISIONE_LOCALE` |
| `PT00-02` | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 40/40 | `PASS` |
| `PT00-04` | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 40/40 | `PASS` |
| `PT00-07` | 4 | 4 | 2 | 4 | 4 | 4 | 4 | 3 | 4 | 3 | 36/40 | `REVISIONE_LOCALE` |

Media complessiva: **3,8/4**. La media non nasconde i fallimenti: una dimensione
sotto 3 e un blocker impediscono il PASS del prompt corrente.

### `PT00-01` — teoria introduttiva

Copre nodo, collegamento, protocollo e risorsa condivisa e applica le definizioni
a casi quotidiani. Le soluzioni sono corrette. La domanda aperta sul tablet che
usa una stampante e la domanda multipla finale riutilizzano però lo stesso
scenario e la stessa operazione cognitiva quasi senza aggiungere informazione:
è una duplicazione sostanziale e porta `Var` a 2.

### `PT00-02` — diagnosi IPv4

Copertura completa di indirizzo, mask, gateway, DNS e verifica progressiva. Il
caso diagnostico richiesto dal docente è presente, i sintomi sono collegati ai
parametri corretti e tutte le chiavi e i distrattori sono coerenti con la fonte.

### `PT00-04` — matematica svolta

Le quattro aperte mostrano trasformazioni, motivazione, controllo dei segni e
verifica per sostituzione. Sono presenti equazione determinata, identità e caso
impossibile. Tutte le soluzioni chiuse sono univoche e corrette.

### `PT00-07` — debugging

Copre `for`, `range`, indice, stato e off-by-one; include almeno due esercizi di
debugging con traccia completa e distingue correttamente errori sintattici,
runtime e logici. In quattro domande/soluzioni il testo contiene però i due
caratteri letterali `\\` e `n` invece di vere interruzioni di riga: il codice è
semanticamente comprensibile ma viene mostrato male nell'editor, quindi `Chi`
scende a 2 e il pool richiede una correzione locale.

## Vincoli misurati per il candidato

Il candidato di `POOL-TUNE-02` deve intervenire soltanto sul prompt del pool e
deve includere almeno:

1. indici delle opzioni dichiarati **zero-based**: prima opzione `0`, ultima
   `numero_opzioni - 1`;
2. audit finale di ogni chiave: ogni indice selezionato deve puntare a
   un'opzione vera, ogni indice non selezionato a una falsa; singola esattamente
   una corretta, multipla almeno due corrette e almeno una errata;
3. vere interruzioni di riga nei testi e nel codice; vietate le sequenze
   letterali `\\n`, `\\r` e `\\t` come sostituti della formattazione;
4. matrice interna di copertura e varietà: non riutilizzare lo stesso scenario
   e la stessa operazione cognitiva in domande diverse, neppure cambiando tipo;
5. conservazione dei requisiti già riusciti: autonomia dalla lezione, soluzioni
   aperte formative e passo-passo quando necessario, difficoltà calibrata e
   domande-trabocchetto ammesse.

## Prossimo gate

`POOL-TUNE-01` è concluso con **profilo selezionato: Quality**. Restano aperti:

1. implementazione e review statica del candidato prompt;
2. dry-run degli otto scenari `tuning` Quality con tetto economico;
3. nuova autorizzazione esplicita per le otto chiamate reali;
4. review completa con le stesse soglie;
5. soltanto dopo un PASS, congelamento e holdout.

Questa review non autorizza nuove chiamate OpenAI, modifiche runtime o deploy.
