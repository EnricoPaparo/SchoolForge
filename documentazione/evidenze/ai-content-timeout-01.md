# AI-CONTENT-TIMEOUT-01

Data: 4 settembre 2026. Ambiente interessato: solo DEV.

## Diagnosi

Subito dopo il deploy Hosting della PR #458, il docente ha segnalato l'errore
generico durante la generazione completa. La PR non conteneva Functions. I log
DEV mostrano alle 18:05 UTC:

- `aiContentPreview` avviata e autenticata correttamente;
- `aiContentGenerate` avviata e autenticata;
- terminazione della richiesta per raggiungimento del timeout massimo.

La configurazione distribuita letta dalla Firebase CLI era `ACTIVE`,
`us-central1`, timeout 60 secondi, 256 MiB, concorrenza 80 e massimo 20 istanze.
Non risultano errori recenti della cache frontend nel percorso callable.

## Correzione

La sola `aiContentGenerate` dichiara ora un timeout massimo di 120 secondi,
allineato alla Function di generazione di uno slot visuale. Preview, memoria,
concorrenza, numero massimo di istanze, modello, listino, budget, idempotenza,
retry e lease non cambiano.

Il timeout non introduce costo fisso: permette a una richiesta già autorizzata
dal docente di terminare invece di essere troncata al secondo 60. Una maggiore
durata riuscita può consumare più runtime e completare la chiamata provider che
prima falliva; per questo l'agente non esegue una generazione reale di prova.

## Verifica e rollback

Il test sorgente impedisce di estendere accidentalmente il timeout alla preview
gratuita. Dopo test, CI e review, il deploy deve essere mirato esclusivamente a
`functions:aiContentGenerate` in `schoolforge-dev`; la configurazione va riletta
come `ACTIVE` e 120 secondi. Il gate funzionale finale è un retry esplicito del
docente, consapevole del possibile costo.

Rollback: distribuire la stessa Function dal commit `1fd97b49` per ripristinare
il timeout di 60 secondi. Nessun dato richiede migrazione.
