# Gate GVDIF — checklist umana DEV

**Stato:** PENDING. Nessun rollout o PASS dichiarato.

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
- Generare PDF di correzione e CSV registro; il PDF studente della verifica deve
  restare assente per i compiti server-resolved.

## Esito

- [ ] PASS docente
- [ ] PASS studente etichetta A
- [ ] PASS studente etichetta B
- [ ] PASS studente senza etichetta
- [ ] Nessuna esposizione privacy osservata
- [ ] Costi/operazioni coerenti con il modello documentato

Compilare data, ambiente, commit/deploy e anomalie prima di cambiare lo stato
del Gate GVDIF.
