# STUDENT-DIDATTICA-LITE-01 — Didattica studente leggera

Issue #455. Base: `7b291616bdde98e26d34ae7541bd6119f60801cc`.

## Risultato

- Card studente compatte: titolo e «Apri corso», senza contatori o avanzamento.
- La libreria legge soltanto studente/classe e programmi assegnati; non legge
  `publicLessons` per costruire le card.
- Un corso carica la propria proiezione pubblica solo quando viene aperto,
  sempre con filtri `programId` e `activeImportId`. Nessun accesso a import
  privati, pool o Storage per i corpi delle lezioni.
- Contatori e avanzamento restano nel corso aperto e riflettono le lezioni
  caricate, con normalizzatori e filtro scheletri esistenti invariati.
- Cache in memoria del solo ultimo corso, identità uid/classe/corso/import,
  riuso entro 60 secondi. Nessuna persistenza, timer o nuovo listener.
- Focus/visibilità sono accorpati e limitati a un tentativo automatico ogni
  60 secondi; «Aggiorna» permette il refresh esplicito di metadata e corso
  selezionato. Non viene riletta l'intera libreria di contenuti.
- Revoche, cambio account/classe/import e risposte tardive non ripristinano
  dati del contesto precedente. Gli errori di rete transitori non distruggono
  i draft degli appunti; le normali navigazioni conservano il dirty guard.

## Verifica dell'implementatore

Typecheck e lint web, formattazione e diff-check: PASS.
145 test mirati in 9 suite: cache/race, servizio, Didattica, appunti, mappe,
shell studente, controller appunti, contratti mappa e visual.

## Collaudo dell'orchestratore

- Vista studente reale con porte dati sintetiche, viewport 1280/390/320 px:
  card senza metriche, nessuna lettura lezioni iniziale, solo corso selezionato,
  riapertura dalla cache, refresh selettivo, tastiera e assenza overflow: PASS.
- App completa con Auth e Firestore emulati e Rules reali, progetto locale
  `demo-schoolforge`, account studente sintetico approvato: PASS.
- Verificati isolamento fra classi, apertura corso/lezione, avanzamento,
  appunti salvati e riaperti, sostituzione import attivo, riassegnazione classe
  e smontaggio Didattica quando si attiva Modalità verifica.
- Nessun errore JavaScript non gestito negli smoke. Nessun dato cloud usato.
- Gate completi, review indipendente, CI e rilascio sono registrati in #455.

## Confini e rollback

Solo frontend/Hosting DEV. Nessuna modifica Rules, schema, Functions,
dipendenze o dati scolastici; nessuna chiamata IA reale o lettura secret.
PROD escluso. Versione DEV precedente: `5f2e624c671a0ec2`, release
`1788540371988000`. Ripristino dalla cronologia Hosting DEV.

Lo smoke autenticato usa emulatori locali: non attesta un login Google
studente reale su DEV. Dopo il rilascio resta il gate visivo dell'utente.

## Limiti e costo

Il risparmio riguarda l'apertura della libreria e i rientri ripetuti nella
finestra. Aprire un corso legge ancora tutti i documenti della sua proiezione
pubblica: non viene introdotto un indice separato o un nuovo servizio per
scaricare soltanto il corpo della singola lezione. Nessuna stima monetaria
o riduzione percentuale della bolletta è dedotta da questi test.
