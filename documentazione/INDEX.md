# SchoolForge — Indice della documentazione

## Per iniziare

SchoolForge è un repository didattico Markdown-first per un solo docente. Se è la prima volta, parti dal [brief](brief.md) per capire problema, visione e perimetro, poi consulta il [glossario](glossario.md) per il vocabolario condiviso (verifica, tentativo, pool, canale cartaceo/digitale, token mono-uso). Tutta la documentazione è in italiano e la baseline è la versione 4.0.

## Ordine di lettura consigliato

1. [brief.md](brief.md) — visione, perimetro, decisioni di prodotto.
2. [glossario.md](glossario.md) — termini del dominio.
3. [decisioni.md](decisioni.md) — registro piatto di tutte le decisioni (D/ADR/C).
4. [analisi-requisiti.md](analisi-requisiti.md) — requisiti funzionali, regole e criteri di accettazione.
5. [architettura.md](architettura.md) — Firebase, SPA unica, Security Rules, dati e flussi.
6. [api-contract.md](api-contract.md) — tipi TypeScript Firestore, Cloud Functions, Security Rules.
7. [sicurezza.md](sicurezza.md) — minacce, controlli e checklist ai gate.
8. [test-strategy.md](test-strategy.md) — livelli di test ed evidenze per modulo.
9. [toolchain.md](toolchain.md) — versioni, monorepo, bootstrap, emulatori.
10. [piano-implementazione.md](piano-implementazione.md) — pacchetti per agenti, dipendenze, gate.

## Per sviluppare un modulo

Parti da [piano-implementazione.md](piano-implementazione.md) per la specifica del pacchetto (scope, file, dipendenze, evidenze DoD). Passa poi a [api-contract.md](api-contract.md) per i tipi e i contratti delle Cloud Functions, e infine a [test-strategy.md](test-strategy.md) per sapere cosa testare e con quali fixture. La V1 copre i moduli M1–M4; M5 (Correzione AI) è rinviato alla V2.

## File di riferimento rapido

| File | Scopo | Quando usarlo |
|---|---|---|
| [brief.md](brief.md) | Fonte di verità su visione e perimetro. | Per capire il "perché" di una scelta. |
| [glossario.md](glossario.md) | Vocabolario canonico. | Per usare il termine corretto. |
| [decisioni.md](decisioni.md) | Indice di tutte le decisioni. | Per verificare lo stato di una decisione. |
| [analisi-requisiti.md](analisi-requisiti.md) | Requisiti verificabili (FR/BR/NFR/AC). | Per i criteri di accettazione. |
| [architettura.md](architettura.md) | Architettura target e flussi. | Per i confini tecnici e gli ADR. |
| [api-contract.md](api-contract.md) | Tipi e contratti. | Durante l'implementazione. |
| [sicurezza.md](sicurezza.md) | Controlli e checklist gate. | Per Security Rules e gate. |
| [test-strategy.md](test-strategy.md) | Strategia e fixture di test. | Per scrivere i test del pacchetto. |
| [toolchain.md](toolchain.md) | Versioni e setup. | Per avviare l'ambiente. |
| [piano-implementazione.md](piano-implementazione.md) | Pacchetti e gate. | Per sapere cosa implementare. |
| [ux-patterns.md](ux-patterns.md) | Pattern di stato della SPA. | Per la UI docente e portale. |

## Diagrammi

- [er-model.md](diagrammi/er-model.md) — modello dati Firestore.
- [component-frontend.md](diagrammi/component-frontend.md) — architettura frontend della SPA.
- [sequence-import-lezione.md](diagrammi/sequence-import-lezione.md) — sequenza di import didattico.
- [sequence-pubblicazione-verifica.md](diagrammi/sequence-pubblicazione-verifica.md) — canale cartaceo e digitale.
- [sequence-correzione-ai.md](diagrammi/sequence-correzione-ai.md) — correzione AI (Modulo 5, V2).
