# POOL-TUNE-02 — review reale del candidato A

Stato: **PASS sul tuning; holdout non ancora eseguito.**

## Sessione revisionata

- directory locale:
  `functions/lib/pool-tune-00-tuning-2026-08-11T08-27-10-536Z`;
- dataset: `pool-tune-00-dataset-v1`;
- rubrica: `pool-tune-00-rubric-v1`;
- prompt: `pool-tune-02-candidate-a-v1`;
- profilo: `quality` (`gpt-5.6-luna`);
- stato del checkpoint: `complete`;
- campioni validi: 8/8;
- output rifiutati: 0;
- chiamate effettive: 8;
- costo effettivo: **136.214 µUSD (0,136214 USD)**;
- stima nominale del dry-run: 216.257 µUSD;
- tetto prudenziale autorizzato: 676.954 µUSD.

Gli output sono rimasti locali. Nessun dato è stato scritto su Firestore o
Storage.

## Metodo

La review ha letto, per ciascuno scenario, prima la fonte congelata e poi il
JSON generato. Sono state controllate individualmente:

- 25/25 soluzioni di domande aperte;
- 37/37 chiavi di domande chiuse, compresi tutti i distrattori;
- copertura dei target privati del dataset;
- autonomia delle domande rispetto alla posizione nella lezione;
- completezza dei procedimenti, unità di misura e verifiche numeriche;
- duplicazioni di scenario e operazione cognitiva;
- calibrazione della difficoltà;
- formattazione, comprese le sequenze `\\n`, `\\r` e `\\t` letterali.

Nessuna nuova chiamata al provider è stata eseguita durante la review.

## Punteggi

Abbreviazioni: `F` fedeltà, `C` copertura, `A` chiarezza/autonomia, `P`
profondità, `D` difficoltà, `SA` soluzioni aperte, `DC` domande chiuse, `V`
varietà, `R` ragionamento/applicazione, `U` utilità formativa.

| Scenario | F | C | A | P | D | SA | DC | V | R | U | Media | Blocker | Verdetto |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| PT00-01 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4,00 | 0 | PASS |
| PT00-02 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4,00 | 0 | PASS |
| PT00-03 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4,00 | 0 | PASS |
| PT00-04 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4,00 | 0 | PASS |
| PT00-05 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4,00 | 0 | PASS |
| PT00-06 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4,00 | 0 | PASS |
| PT00-07 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 4 | 4 | 3,90 | 0 | PASS |
| PT00-08 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 4 | 4 | 3,90 | 0 | PASS |

Totale: **318/320**, media **3,975/4**. Fedeltà media: **4/4**.
Qualità delle soluzioni aperte: **4/4**. Ogni dimensione è almeno 3/4.

I due 3/4 non richiedono una correzione prima dell'uso:

- `PT00-07` riprende i confini di `range` in due esercizi, ma separa il
  debugging completo dalla costruzione e verifica di un intervallo;
- `PT00-08` usa due volte il contesto delle attività pratiche di scienze, ma
  prima fa valutare un'evidenza e poi costruire un'argomentazione completa.

Non sono duplicazioni sostanziali: scenario e operazione cognitiva non
coincidono.

## Review per scenario

### PT00-01 — elementi di una rete

Coperti nodo, collegamento, protocollo e risorsa condivisa. Le aperte chiedono
prima di distinguere ruoli e autorizzazioni, poi di applicare le definizioni a
un caso nuovo. Il vecchio doppione tablet/stampante del profile probe non
ricompare. Quattro chiavi chiuse corrette e univoche.

### PT00-02 — configurazione IPv4

Coperti IPv4, subnet mask, gateway, DNS e diagnosi progressiva. Le soluzioni
collegano ogni parametro al sintomo e non propongono tentativi casuali. Corretta
anche la diagnosi del gateway fuori sottorete e la distinzione fra connettività
IP e risoluzione dei nomi. Cinque chiavi chiuse corrette.

### PT00-03 — trasferimento del calore

Coperti conduzione, convezione, irraggiamento e meccanismi simultanei. Gli
esempi sono sostenuti dalla fonte; pentola, sole e ambiente esterno richiedono
classificazione motivata, non semplice riconoscimento lessicale. Cinque chiavi
chiuse corrette.

### PT00-04 — equazioni di primo grado

Coperti equivalenza, isolamento dell'incognita, verifica ed errori di segno. I
procedimenti portano correttamente a `x = 3`, `x = 11`, identità e impossibilità;
ogni trasformazione è motivata e verificabile. Quattro chiavi chiuse corrette.

### PT00-05 — fonti storiche

Coperti fonte primaria, contesto, punto di vista, attendibilità e inferenza. Il
caso del diario separa osservazione, informazione riferita e generalizzazione;
il rapporto comunale esplicita destinatario, intenzione e limiti. Le soluzioni
non classificano mai una fonte come semplicemente vera o falsa. Cinque chiavi
chiuse corrette.

### PT00-06 — massa e forza peso

Coperti massa, forza peso, gravità, chilogrammo e newton. Corretti `117,6 N`
sulla Terra e `19,6 N` sulla Luna per una massa di 12 kg; unità e significato
sono motivati. La domanda sulla bilancia conserva la condizione della persona
ferma e non trasferisce impropriamente la taratura terrestre alla Luna. Cinque
chiavi chiuse corrette.

### PT00-07 — debugging di un ciclo `for`

Coperti `for`, `range`, indice, stato delle variabili e off-by-one. Corretta la
traccia `2, 3, 4, 5`, la somma errata `14`, la somma attesa `20`, la correzione
`range(2, 7)` e il `NameError` prodotto da `valore` non definito. Le interruzioni
di riga sono reali: zero occorrenze di `\\n`, `\\r` o `\\t` letterali. Quattro
chiavi chiuse corrette.

### PT00-08 — testo argomentativo

Coperti tesi, ragione, evidenza, controargomento e confutazione. Le aperte
passano dalla classificazione alla valutazione prudente dell'evidenza e infine
alla costruzione di una catena completa. La soluzione non trasforma dati
limitati in causalità generale. Cinque chiavi chiuse corrette.

## Esito dei difetti del profile probe

| Difetto misurato | Esito candidato A |
| --- | --- |
| indici 1-based / soluzioni fuori dalle opzioni | risolto: 37/37 chiavi corrette |
| duplicazione dello stesso scenario in `PT00-01` | risolta |
| escape `\\n` letterali in `PT00-07` | risolto: 0 occorrenze |

## Decisione

Il candidato A supera tutte le soglie del tuning:

- validazione strutturale e semantica: 100%;
- blocker: 0;
- minimo per dimensione: 3/4;
- media complessiva: 3,975/4, superiore a 3,4;
- fedeltà e soluzioni aperte: 4/4, superiori a 3,5.

**Il prompt `pool-tune-02-candidate-a-v1` è congelato per l'holdout.** Non si
modifica più prima di misurare i quattro scenari tenuti separati. Questo PASS non
chiude GPOOL-QUALITY e non autorizza automaticamente nuove chiamate, merge o
deploy.
