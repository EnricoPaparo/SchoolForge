# Gate GVDIF — checklist umana DEV

**Stato:** **PASS** — confermato dal docente su DEV il 15 agosto 2026.

**Ambiente:** `schoolforge-dev`

**Versione verificata:** `main` a `8c1712c` (inclusa la correzione del download
PDF studente per le verifiche differenziate).

**Anomalie bloccanti:** nessuna.

## Preparazione

- Creare due etichette private e assegnarle a due studenti; lasciare un terzo
  studente senza etichetta.
- Preparare una verifica con almeno una domanda comune invariata, una
  sostituzione, una omissione e, facoltativamente, un gruppo VEX disgiunto.
- Attivare soltanto dopo aver controllato il riepilogo dei tre percorsi.

## Verifica docente e studenti

- Ogni studente vede soltanto il proprio insieme e una numerazione continua
  `1…N`; ricaricare e riprendere non cambia l'assegnazione.
- Nessuna schermata, errore, rete o documento leggibile dallo studente espone
  nome/id dell'etichetta, PDP/BES, contatori o motivi della selezione.
- Lo studente non può salvare risposte per order non assegnati.
- La chiusura programmata conserva lo stesso insieme assegnato.

## Correzione ed export

- Aprire la correzione manuale dei tre studenti: domande, massimo e navigatore
  devono coincidere con i rispettivi compiti.
- Eseguire una correzione IA su almeno una risposta aperta differenziata e
  verificare che feedback e punteggio si riferiscano soltanto a quella domanda.
- Restituire e riaprire la review studente: domande e soluzioni devono restare
  isolate e numerate localmente.
- Generare PDF di correzione e CSV registro; quando il docente abilita il PDF
  studente, anche un compito server-resolved deve offrire il download della sola
  assegnazione personale.

## Esito

- [x] PASS docente
- [x] PASS studente etichetta A
- [x] PASS studente etichetta B
- [x] PASS studente senza etichetta
- [x] Nessuna esposizione privacy osservata
- [x] Costi/operazioni coerenti con il modello documentato

Il docente ha confermato esplicitamente che i test operativi sono riusciti e ha
dichiarato superato il gate. Questo PASS chiude VDIF-01→05; non autorizza un
deploy PROD.
