# LESSON-TUNE-06 — review candidato D su quality

> **Esecuzione reale completata il 4 agosto 2026.** Otto scenari `tuning`,
> profilo `quality`, modello `gpt-5.6-luna`, prompt invariato
> `lesson-tune-01-candidate-d-v1`. Nessuna scrittura Firestore/Storage e nessun
> holdout eseguito.

## Costo e attendibilità contabile

Sette campioni hanno un costo effettivo noto pari complessivamente a
150.771 µUSD (0,150771 USD). `LM02-04` ha `priorBillingRisk: true` e costo
effettivo non determinabile: il totale reale resta quindi `null`, senza
inventare una somma. Il tetto prudenziale dell'intero lotto è 1.070.842 µUSD
(1,070842 USD).

La somma dei soli costi noti è circa 5,11 volte quella dei sette campioni noti
del run economy (29.510 µUSD), ma non è un rapporto fra totali effettivi:
entrambi i lotti hanno un campione con billing risk.

## Esito sintetico

Il confronto controllato isola la capacità del modello: prompt, dataset,
split, payload, token cap e parametri restano invariati. Su `quality`, tutti
gli otto scenari sono `PASS`, senza blocker disciplinari, di perimetro o di
sicurezza. I due errori centrali del run economy — IPv4 (`LM02-02`) e
trasferimento termico (`LM02-03`) — risultano corretti.

Verdetto sul tuning: **PROMPT_INVARIATO** per il profilo `quality`. Il risultato
non autorizza ancora la promozione runtime: i quattro holdout restano
ineseguiti e la conferma disciplinare/visiva del docente resta obbligatoria.

| Scenario | Cor | Com | Chi | Pro | Dep | Dif | Con | Obi | Per | Gui | Ese | Sol | Mar | Den | Sic | Totale | Verdetto |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| LM02-01 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 60 | PASS |
| LM02-02 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 3 | 4 | 58 | PASS |
| LM02-03 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 60 | PASS |
| LM02-04 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 4 | 59 | PASS |
| LT01-07 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 4 | 59 | PASS |
| LT01-08 | 3 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 59 | PASS |
| LT01-09 | 3 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 4 | 4 | 58 | PASS |
| LT01-10 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 4 | 59 | PASS |

## Correzione dei blocker economy

### LM02-02 — IPv4

Il nuovo caso usa una rete coerente `192.168.1.0/24`, distingue correttamente
indirizzo, mask, gateway e DNS e limita la forza probatoria di `ping`,
`traceroute`, `nslookup` e dei test esterni. L'autoverifica usa host
`192.168.10.40/24` e gateway `192.168.20.1`, realmente esterno alla subnet, e
non attribuisce al DNS un guasto non dimostrato. Il blocker è risolto.

### LM02-03 — trasferimento termico

La lezione definisce correttamente direzione del trasferimento, conduzione,
convezione e irraggiamento; separa i diversi tratti del percorso energetico e
tratta casi multi-meccanismo senza ridurli a un'unica etichetta. Gli esempi di
pentola, termosifone e camino sono coerenti. Il blocker è risolto.

## Altri miglioramenti dimostrati

- `LM02-01` rispetta il limite di due autoverifiche teoriche e fornisce entrambe
  le soluzioni.
- `LT01-09` classifica correttamente un nome non definito come errore di
  runtime e l'off-by-one come errore logico.
- `LM02-04` sviluppa equazioni, segni, parentesi, casi particolari e verifiche
  senza LaTeX non supportato.
- `LT01-07` distingue osservazione, inferenza e attendibilità senza sconfinare
  nel confronto sistematico fra fonti.
- `LT01-10` dichiara esplicitamente ipotetiche le evidenze costruite e ne
  delimita la forza probatoria.
- In 8/8 output: zero separatori decorativi, zero HTML, zero front matter e zero
  LaTeX non supportato.

## Difetti residui non bloccanti

- `LM02-02` annida il testo dentro entrambi i callout `SOLUTION`; il contenuto
  resta leggibile, ma la struttura Markdown è meno sobria del necessario.
- `LT01-09` usa una volta «valutazioni prodotte da range» invece di «valori» e
  annida il contenuto del callout `IMPORTANT`.
- `LT01-08` chiude con una formulazione poco limpida sull'«equivalente
  terrestre» della forza peso lunare; il nucleo massa/peso resta corretto.
- Alcune lezioni `complete`/`in_depth` sono lunghe; la densità resta buona, ma
  una verifica visiva docente è necessaria per confermare il carico reale.

Non emerge lo stesso difetto pedagogico minore in almeno due campioni. Queste
imperfezioni non giustificano un candidato E: aggiungere istruzioni al prompt
rischierebbe di peggiorare un contratto che sul profilo quality ha superato
tutti i casi tuning.

## Decisione e prossimo gate

Il candidato D viene congelato per il profilo `quality` sullo split tuning.
Prima di qualunque promozione servono, in ordine:

1. review docente degli otto Markdown originali nelle viste reali;
2. una modifica separata del runner che renda raggiungibile `quality` solo sullo
   split `holdout`, mantenendo l'attuale fail-closed fino al merge;
3. dry-run dei quattro holdout con tetto economico esplicito;
4. nuova autorizzazione economica, distinta da quella già consumata;
5. esecuzione unica dei quattro holdout e verdetto finale senza ritoccare il
   prompt sulla base dei loro contenuti.

Nessuno di questi passaggi è autorizzato da questa review.
