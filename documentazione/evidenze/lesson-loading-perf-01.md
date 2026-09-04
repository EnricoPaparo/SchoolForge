# LESSON-LOADING-PERF-01 — caricamento e rendering lezioni

Data: 4 settembre 2026. Issue: #457. Base: `e1362256627f067756b8d16abcf16d0db3f3a8ac`.

## Intervento

- Cache docente esclusivamente in memoria del workspace: massimo 8 lezioni,
  LRU, TTL 60 secondi dalla risposta (le letture non estendono la scadenza).
- Riapertura fresca sincrona, senza lampeggio del caricamento; richieste in
  corso per la stessa lezione condivise. Nessun prefetch, timer, listener,
  storage persistente o servizio aggiuntivo.
- Cambio uid/corso/import rimonta la sessione e distrugge contenuti, bozze e
  cache. L'unmount invalida le richieste; risposte precedenti non popolano
  nuovamente una cache invalidata.
- Invalidazione conservativa a ogni modifica dell'albero locale, retry ed
  errore. Operazioni corso/UDA/lezione eseguite con `withBusy`, salvataggi del
  corpo (manuale o generazione completa), metadati e pulizia sospendono la
  memorizzazione delle letture sovrapposte e invalidano prima/dopo la scrittura.
- Le risposte anteriori al salvataggio non sovrascrivono il corpo nuovo. Se
  una lezione viene riaperta mentre il suo salvataggio è in corso, la lettura
  interrotta viene riavviata dopo la conclusione (anche in errore), usando il
  contesto aggiornato: nessun pannello vuoto né vecchi metadati ripristinati.
- Errori Firestore continuano a propagare senza fallback Storage. Il fallback
  legacy avviene soltanto dopo una proiezione letta con successo ma inutilizzabile.
- `LessonManualBody` esegue soltanto il ramo necessario: Markdown senza figure,
  oppure posizionamento multi-figura. La memoizzazione dipende dal Markdown e
  dalla firma JSON delle ancore ordinate, non da byte, didascalie, stato o
  identità degli array. Anche il controllo delle ancore nella vista docente è
  memoizzato sul solo corpo. Nessuna modifica ai sanificatori o ai posizionatori.

Studente: modello di lettura per corso e protezioni class/import/appunti
invariati; beneficia dello stesso renderer. Nessuna modifica a backend, schema,
Rules o dipendenze. Nessuna chiamata IA applicativa reale o scrittura cloud.

## Benchmark riproducibile indipendente

L'orchestratore ha confrontato la checkout base immutata con il worktree
implementato usando Chrome reale headless, componenti reali e porte di lettura
locali sostituite con fixture. Corpo: **4.573 byte**; latenza sintetica delle
letture docente: **350 ms**. Tempo di navigazione misurato dal click alla
presenza del corpo nel DOM più `requestAnimationFrame`, non dal polling del test.

| Scenario | Prima | Dopo |
| --- | --- | --- |
| Prima apertura docente | circa 380 ms | circa 390 ms |
| Riapertura fresca docente | 372,4 ms | 14,3 ms |
| Letture testo docente A/B/A | 3 | 2 |
| Letture testo mobile A/A | 2 | 1 |
| Cambio lezione studente già caricata | circa 12 ms | circa 12 ms |
| Renderer: 101 render, 100 aggiornamenti sole figure, sanificazioni | 505 | 3 |
| Stesso renderer: chiamate lexer incluse ricorsive | 5.050 | 25 |
| Stesso renderer: tempo cumulato | 586,3 ms | 20,5 ms |
| Mediana aggiornamento sole figure | 5,5 ms | 0,1 ms |

Desktop e mobile 390 px superati, nessun errore JavaScript o accesso a dati
cloud nel benchmark. Cinque snapshot DOM (senza figure, singola, multipla,
ancore mancanti e duplicate con payload XSS) hanno hash **esattamente identici**
alla baseline; il payload non è eseguito. Ordine, deduplicazione, avvisi,
frammenti sanificati e layout conservati.

Artifact riproducibili fuori dal repository nella directory temporanea del task:
`benchmark-before.log`, `benchmark-after.log` e harness `perf-*`.

**Limiti:** queste non sono misurazioni su una sessione autenticata DEV reale.
La prima lettura fredda resta dominata dalla rete; non è migliorata. Nessuna
stima monetaria o percentuale generale di risparmio. Modifiche da altri client
possono restare nella cache fino a 60 secondi; riaprire il workspace la elimina.

## Verifiche dell'implementatore

- Build `lesson-contract`, typecheck e lint web: PASS.
- 13 suite mirate docente/studente/appunti/renderer: 276 test PASS.
- Dopo gli ultimi due test (pulizia e risposta tardiva cambio identità), nuova
  esecuzione `CourseWorkspace`: 110 test PASS. Totale copertura mirata: 278 test.
- Test dedicati: TTL al confine, LRU, coalescing, retry/errori, revisioni di
  cache, scritture concorrenti, riapertura durante metadati riusciti/falliti,
  salvataggio corpo, pulizia e isolamento uid/corso/import.
- Benchmark e snapshot indipendenti: PASS, come sopra.

Full gate, CI, review indipendente (massimo quattro cicli), PR/merge e deploy
DEV hosting con smoke sono a carico dell'orchestratore e registrati nella issue/PR.
PROD esclusa. Il gate finale è la prova umana con account reali in DEV.
