# Decisioni di progetto (verbali)

Questa cartella contiene i **verbali delle decisioni** che il brief e l'architettura lasciano esplicitamente aperte (C-01, C-02, C-03) e di ogni altra decisione rilevante presa nel corso del progetto.

Una decisione aperta **non deve essere sostituita da un'assunzione tecnica nascosta**: finché il relativo verbale non è in stato `decisa`, la funzionalità che ne dipende resta bloccata secondo i gate del [piano di implementazione](../piano-implementazione.md).

## Convenzioni

- Un file per decisione: `C-01-region-backup.md`, `C-02-provider-ai.md`, ecc.
- Ogni verbale segue il [template](template.md).
- Stati ammessi: `aperta` → `in_valutazione` → `decisa` (oppure `revocata`).
- Una decisione `decisa` è la fonte di verità per i parametri che fissa; modifiche successive creano una nuova revisione nello stesso file con data e motivazione.

## Indice

| ID | Decisione | Stato | Blocca |
|---|---|---|---|
| [C-01](C-01-region-backup.md) | Regione Firebase, backup, RPO/RTO, responsabile operativo | aperta | go-live M1 (prod) |
| [C-02](C-02-provider-ai.md) | Provider AI, contratto, residenza dati, consenso | aperta | Modulo 5 |
| [C-03](C-03-correzione-automatica.md) | Regola didattica per la correzione automatica | aperta | Modalità automatica (M5) |
| [privacy](privacy-minori.md) | Base giuridica, titolarità, retention dati studenti | aperta | go-live M2 (prod) |
