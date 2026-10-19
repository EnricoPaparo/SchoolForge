# Generazione completa: efficienza e ripresa — 19 ottobre 2026

Base: `90cf91a`; branch `improve/content-generation-efficiency`. Scope approvato:
sei interventi, generazione rigorosamente in serie, deploy DEV mirato dopo review
indipendente e CI verde. Nessun cambio di modelli, listini, tetti, retry, policy
cache, ordine dei prompt o valutazione didattica. Nessun provider reale, secret,
spesa o deploy PROD da parte dell'implementatore.

## Comportamento

- Il contesto della pratica conserva capacità, metodi, prerequisiti, coverage e
  attività. Deduplica dati ripetuti e include gli stem quando rientrano nei
  50.000 byte UTF-8. Per stem molto grandi usa una rappresentazione deterministica
  di capacità/metodi/stadi/conteggi; se anche i significati essenziali eccedono
  il limite, fallisce esplicitamente prima della chiamata pool. Non trasmette
  soluzioni o hint. La lezione separata resta la fonte autorevole.
- I revisori lezione/mappa possono restituire campi null o vuoti per unchanged.
  Il server ricostruisce il candidato byte per byte; improved richiede contenuto
  completo. Output canonico persistito e risposta client restano completi.
  Parsing legacy, audit, resoconti, hash e provenienza conservano la compatibilità.
- Le fasi della mappa verificano fonte, identità e montaggio prima/dopo gli await
  e il salvataggio, compreso il revisore. Nessuna nuova conferma intermedia.
- Il checkpoint v1 aggiunge snapshot opzionali generati/revisionati per mappa e
  pool. Retry di review/save riusa il candidato; reload mantiene IDs stabili.
  Il salvataggio segna il completamento soltanto dopo successo. I dati ripristinati
  sono whitelisted, limitati e verificati per kind, quantità, livello e profilo;
  coverage validata, resoconti transienti esclusi. Il limite 700.000 byte per stato
  copre due output pool da 200.000 byte con coverage. Browser storage indisponibile
  conserva lo stato in memoria; con checkpoint precedente gli stessi IDs permettono
  replay server, senza promettere ripresa persistente quando lo storage è disabilitato.
  Il contesto pool esatto è ora persistito prima della preview. Per checkpoint
  precedenti privi di snapshot mappa/pool, il marker legacy conserva la precedente
  rappresentazione byte per byte e gli stessi hash/IDs. Se il vecchio contesto
  oltrepassava 50 KB (prima veniva omesso), la ripresa fallisce esplicitamente:
  occorre scartarla e avviare manualmente una nuova generazione, senza cambiare
  silenziosamente request ID o avviare nuova spesa.
  L'incertezza di costo resta sticky dopo una risposta generate persa; errori della
  sola preview non la introducono. I checkpoint legacy v1 restano leggibili.
- Rimossi i soli rami UI confirm/review irraggiungibili della generazione completa,
  conservando retry effettivi ed editor standalone.
- Un payload immutabile viene costruito una volta per operazione e condiviso da
  prenotazione e invio, anche per la proposta visuale. Evento separato
  `aiContentPerformance`: kind, profilo, token input/output, durata totale provider (incluso eventuale backoff),
  tentativi, cache token osservati dell'ultimo tentativo, status provider e review.
  Numeri bounded/nullable; nessun prompt, contenuto, identificativo, PII o errore
  grezzo. Il log terminale generico mantiene il proprio contratto. Cache non
  disponibile è null; non viene dedotta da costo o token totali.

## Verifiche

Test mirati coprono contesto Unicode/dedup/fallback/fail esplicito, protocollo
unchanged/legacy/improved, hash/provenienza/replay canonico, payload condiviso,
metadati nullable/privacy, checkpoint/counts/livello e guardie fonte/unmount.
Test componenti verificano retry save mappa/pool senza rigenerazione.

QA browser indipendente, solo mock locale: 9 esercitazioni e revisione ON;
errore revisore mappa, reload/ripresa; errore revisore pool, secondo reload/ripresa;
riepilogo finale con 9 esercitazioni private, 10 domande, 0 immagini. Una chiamata
per ogni generatore, due soltanto per ciascun revisore fallito; 8 request ID unici
stabili su 10 invocazioni. Payload preview/generate identici, fonte canonica,
nessuna pubblicazione della pratica, costo sconosciuto conservato e console vuota.
La QA non dimostra qualità didattica o risparmio monetario con provider reale.

Gate completi e CI: registrati nella PR sullo SHA finale. Review/merge e deploy
restano all'orchestratore. Target DEV: `aiContentPreview`, `aiContentGenerate`,
`aiContentPromptExport`, `aiVisualPlanAuthorize` e hosting. Smoke successivo mirato
alla generazione e ripresa. Rollback: revert del commit e stessi target DEV;
checkpoint opzionali v1 ignorati dal codice precedente. Il rollback può richiedere
un riavvio esplicito dei lavori in corso, perché il codice precedente non conosce
il contesto fissato dal marker; non garantisce replay attraverso il downgrade.
Nessuna migrazione dati.
