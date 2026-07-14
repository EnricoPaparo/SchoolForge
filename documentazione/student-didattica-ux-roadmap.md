# SDUX — Didattica studente

**Stato:** SDUX-01 implementato; SDUX-02 (smoke DEV responsive e Gate sicurezza/Modalità verifica) da completare.

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

## SDUX-02 — Prossimo gate

1. Smoke DEV desktop e mobile con uno studente reale.
2. Attivazione Modalità verifica mentre una lezione è aperta: contenuto smontato e Didattica rimossa.
3. Disattivazione Modalità verifica: Didattica nuovamente disponibile senza nuovo login.
4. Verifica manuale di corsi di classe diversa, studente bloccato/pending e portale disabilitato.
5. Gate finale con evidenze UI + Rules, senza ampliare dati o permessi.
