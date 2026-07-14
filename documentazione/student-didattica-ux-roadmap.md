# SDUX — Didattica studente

**Stato:** SDUX-01 implementato; **SDUX-02 hardening automatico completato** (preflight import, parità responsive verificata via codice/test, copertura Rules confermata, checklist DEV predisposta). **Gate manuale DEV ancora da confermare dal docente** — vedi [evidenze/sdux-02-checklist-dev.md](evidenze/sdux-02-checklist-dev.md).

## Obiettivo

Offrire allo studente la stessa architettura visiva della Didattica docente — libreria corsi, workspace corso, UDA e lezioni — senza riusare il workspace operativo del docente e senza esporre alcuna capacità di modifica o dato tecnico.

## Confine di sicurezza

- `StudentDidatticaView` dipende esclusivamente da `studentLessonsService`, `programs` autorizzati e `publicLessons`.
- Non importa componenti o service docente, Firebase Storage, sotto-collezioni `imports/**`, `lessons`, `questionIndex` o pool.
- L'assenza dei pulsanti è solo UX: Firestore e Storage Rules restano la fonte dell'autorizzazione.
- Uno studente può leggere solo se autenticato, approvato, con portale attivo e classe compatibile.
- `programs` e `publicLessons` sono sempre non scrivibili dallo studente; `repository/{ownerUid}/**` è owner-only.
- Modalità verifica nega in Rules sia i `programs` sia le `publicLessons` della classe coinvolta; il listener della shell smonta immediatamente la Didattica già aperta.

## SDUX-01 — Implementato

- voce di navigazione `Didattica` al posto della vecchia `Lezioni`;
- libreria corsi a card con ricerca e conteggi UDA/lezioni derivati in memoria;
- workspace read-only corso → UDA → lezione;
- UDA inizialmente tutte collassate;
- contenuto Markdown e metadata didattici della lezione dalla sola proiezione pubblica;
- navigazione mobile a livelli con ritorno esplicito;
- nessuna scheda Domande, azione CRUD, import/export, riordino o accesso Storage;
- renderer Markdown spostato fra i componenti condivisi, così il portale studente non importa codice docente.

## SDUX-02 — Hardening automatico completato; Gate manuale DEV pendente

**Hardening automatico (completato in questa fase, senza modifiche a codice/Rules):**

- **Preflight import**: confermato che `StudentDidatticaView`, `StudentShell` e
  `studentLessonsService` usano **solo** il modello pubblico autorizzato
  (`students/{uid}`, `programs` filtrati per classe, `publicLessons`) e non
  importano alcun servizio docente, Repository Editor, pool/`questionIndex`,
  Firebase Storage, import/export o operazioni create/update/delete/reorder.
- **Parità responsive** verificata via codice/test: desktop con sidebar
  struttura; mobile con navigazione progressiva (sidebar nascosta, back
  coerenti, titoli a capo, nessuno scroll orizzontale). Nessun difetto concreto
  da correggere (nessun redesign).
- **Modalità verifica** verificata via test `StudentShell`: attivazione →
  smonta `StudentDidatticaView` e passa a Verifiche; classe non coinvolta resta
  autorizzata; disattivazione → Didattica di nuovo disponibile senza nuovo login.
- **Copertura Rules** confermata (nessun gap, Rules invariate): lettura
  pubblica solo per approvato+classe compatibile; pending/blocked/senza-classe,
  classe incompatibile e programma senza `classIds` negati; update/delete/create
  su `programs` negati; sotto-collezioni tecniche (`imports/**`,
  `questionIndex`) e pool negati; Storage repository owner-only; query
  manipolate durante Modalità verifica negate; classe non coinvolta ancora
  autorizzata.

**Gate manuale DEV (da confermare dal docente):** eseguire
[evidenze/sdux-02-checklist-dev.md](evidenze/sdux-02-checklist-dev.md) —
desktop, mobile, attivazione/disattivazione Modalità verifica, e controllo
DevTools per assenza di richieste Storage/pool.
