# POOL-TUNE-03 — review reale dell'holdout Quality

Stato: **PASS; Gate GPOOL-QUALITY superato per il profilo `quality`.**

## Sessione revisionata

- directory locale:
  `functions/lib/pool-tune-00-holdout-2026-08-11T13-47-10-489Z`;
- dataset: `pool-tune-00-dataset-v1`;
- rubrica: `pool-tune-00-rubric-v1`;
- prompt congelato: `pool-tune-02-candidate-a-v1`;
- profilo: `quality` (`gpt-5.6-luna`);
- stato del checkpoint: `complete`;
- campioni validi: 4/4;
- output rifiutati: 0;
- chiamate effettive: 4;
- costo effettivo: **79.859 µUSD (0,079859 USD)**;
- stima nominale del dry-run: 124.437 µUSD;
- tetto prudenziale autorizzato: 392.964 µUSD.

Gli output sono rimasti locali. Nessun dato è stato scritto su Firestore o
Storage. La review non ha eseguito nuove chiamate al provider.

## Metodo

I quattro holdout non erano stati usati per scegliere il profilo o modificare
il candidato. Dopo il congelamento del prompt, la review ha letto per ciascuno
scenario la fonte congelata e poi il pool generato. Sono state controllate
individualmente:

- 15/15 soluzioni delle domande aperte;
- 21/21 chiavi delle domande chiuse e i relativi distrattori;
- copertura dei target privati del dataset;
- correttezza di formule, procedimenti, unità e relazioni causali;
- autonomia delle domande e assenza di riferimenti alla posizione nella
  lezione;
- varietà di scenario e operazione cognitiva;
- difficoltà e dimensione della risposta;
- assenza delle sequenze `\\n`, `\\r` e `\\t` letterali.

## Punteggi

Abbreviazioni: `F` fedeltà, `C` copertura, `A` chiarezza/autonomia, `P`
profondità, `D` difficoltà, `SA` soluzioni aperte, `DC` domande chiuse, `V`
varietà, `R` ragionamento/applicazione, `U` utilità formativa.

| Scenario | F | C | A | P | D | SA | DC | V | R | U | Media | Blocker | Verdetto |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| PT00-09 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4,00 | 0 | PASS |
| PT00-10 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4,00 | 0 | PASS |
| PT00-11 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 4 | 4 | 3,90 | 0 | PASS |
| PT00-12 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4,00 | 0 | PASS |

Totale: **159/160**, media **3,975/4**. Fedeltà media: **4/4**.
Qualità delle soluzioni aperte: **4/4**. Ogni dimensione è almeno 3/4.

Il solo 3/4 non richiede una correzione: in `PT00-11` due domande usano il
caso del carbonato di calcio, ma una richiede di svolgere il calcolo
stechiometrico e l'altra di diagnosticare e correggere un procedimento errato.
Condividono i dati, non l'operazione cognitiva, e non sono una duplicazione
sostanziale.

## Review per scenario

### PT00-09 — normalizzazione di una base di dati

Coperti dipendenze funzionali, chiave candidata, prima, seconda e terza forma
normale e decomposizione. Le soluzioni identificano correttamente la chiave
composta `(M, C)`, le dipendenze parziali e la catena transitiva
`C → D → ND/DIP`; motivano le anomalie e costruiscono lo schema finale. Le sei
chiavi chiuse sono corrette e univoche.

### PT00-10 — affidabilità nel trasporto

Coperti numero di sequenza, ACK, timeout, ritrasmissione e riordinamento. Le
aperte ricostruiscono correttamente la perdita di un segmento e distinguono le
responsabilità di TCP da quelle di IP. Corretti anche gli ACK cumulativi e la
gestione dei duplicati: sei chiavi chiuse su sei.

### PT00-11 — problema stechiometrico

Coperti equazione bilanciata, mole, massa molare, rapporto stechiometrico e
controllo dimensionale. I procedimenti portano correttamente da 25,0 g di
`CaCO3` a circa 11,0 g di `CO2` e da 15,0 g di etanolo a circa 28,7 g di
`CO2` e 17,6 g di acqua. Passaggi, unità, condizioni della resa teorica e
controllo di plausibilità sono espliciti. Quattro chiavi chiuse corrette.

### PT00-12 — sistemi e retroazione

Coperti sistema, variabile, feedback positivo e negativo ed equilibrio
dinamico. Le aperte costruiscono catene causali e non confondono «positivo» con
«benefico»: quattro legami inversi nella catena sulla fiducia producono
correttamente un feedback positivo. Cinque chiavi chiuse corrette.

## Risultato complessivo

Il candidato ha prodotto, fra tuning e holdout:

- 12/12 pool validi;
- 98 domande: 40 aperte e 58 chiuse;
- 40/40 soluzioni aperte corrette;
- 58/58 chiavi chiuse corrette;
- zero blocker;
- 477/480 punti, media 3,975/4;
- costo reale complessivo **216.073 µUSD (0,216073 USD)**.

Le soglie del Gate sono tutte superate: validità 100%, zero blocker, ogni
dimensione almeno 3/4, media superiore a 3,4 e medie di fedeltà e soluzioni
aperte pari a 4/4.

## Decisione e confine operativo

**GPOOL-QUALITY è PASS esclusivamente per la combinazione
`pool-tune-02-candidate-a-v1` + profilo `quality`.** L'holdout resta congelato e
non viene riusato per ritoccare questo candidato.

Il profilo `economy` non è qualificato: nel profile probe ha fallito 4/4
scenari e non è stato rieseguito sul candidato A. Il Gate non modifica da solo
il profilo runtime, l'interfaccia o il rollout. Un'eventuale scelta di rendere
Quality predefinito o obbligatorio e il deploy DEV sono un pacchetto operativo
separato, esplicito e reversibile.
