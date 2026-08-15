# ESITI-01 — conferma umana DEV

**Stato:** **PASS** — confermato dal docente su `schoolforge-dev` il 15 agosto
2026, dopo il deploy della PR #390.

## Perimetro verificato

- l'azione **Esiti** è disponibile sulle verifiche chiuse;
- il dialog si apre e calcola gli esiti senza modificare dati;
- copertura delle correzioni, UDA, lezioni, padronanza, domande e valutazioni
  risultano leggibili e coerenti;
- la resa grafica è approvata dal docente;
- il comportamento complessivo è stato confermato come funzionante.

## Vincoli confermati

- vista owner-only e di sola lettura;
- nessuna etichetta o identità studente nell'output aggregato;
- nessun listener, polling o costo passivo: le letture partono solo aprendo il
  dialog;
- nessuna modifica a Functions, Rules, indici o schema.

## Verdetto

**ESITI-01 è completato, distribuito e validato su DEV.** Il percorso
VDIF + ESITI non ha altre fasi implementative aperte. Questo PASS non autorizza
un deploy PROD.
