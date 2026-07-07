# SchoolForge — Indice della documentazione

## Stato MVP

**M1 + M2 completati. Deploy DEV attivo: https://schoolforge-dev.web.app**

Il flusso docente cartaceo è funzionante sia in locale (emulatori Firebase) che su Firebase DEV.
Vedi [mvp-docente-cartaceo.md](mvp-docente-cartaceo.md) per avviare l'ambiente locale e [evidenze/smoke-dev-deploy.md](evidenze/smoke-dev-deploy.md) per lo smoke test DEV.

**Prossima fase:** UX/Product Polish — vedi [ux-product-roadmap.md](ux-product-roadmap.md) per la roadmap (UX-01 → UX-06).

## Per iniziare

SchoolForge è un repository didattico Markdown-first per un solo docente. Se è la prima volta, parti dal [brief](brief.md) per capire problema, visione e perimetro, poi consulta il [glossario](glossario.md) per il vocabolario condiviso (verifica, tentativo, pool, canale cartaceo/digitale, lock nome+cognome). Tutta la documentazione è in italiano e la baseline è la versione 4.1.

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
| [mvp-docente-cartaceo.md](mvp-docente-cartaceo.md) | Guida operativa MVP in locale. | Per avviare e usare l'MVP oggi. |
| [ux-product-roadmap.md](ux-product-roadmap.md) | Roadmap UX/Product Polish (UX-01–06). | Per pianificare e implementare il polish UI. |

## Evidenze

- [evidenze/G2-M1.md](evidenze/G2-M1.md) — gate G2: evidenze milestone M1.
- [evidenze/smoke-mvp-docente-cartaceo.md](evidenze/smoke-mvp-docente-cartaceo.md) — smoke test MVP docente cartaceo (M1+M2, emulatori locali).
- [evidenze/smoke-dev-deploy.md](evidenze/smoke-dev-deploy.md) — smoke test deploy DEV su Firebase reale. **DEV SMOKE PASS.**

## Diagrammi

- [er-model.md](diagrammi/er-model.md) — modello dati Firestore.
- [component-frontend.md](diagrammi/component-frontend.md) — architettura frontend della SPA.
- [sequence-import-lezione.md](diagrammi/sequence-import-lezione.md) — sequenza di import didattico.
- [sequence-pubblicazione-verifica.md](diagrammi/sequence-pubblicazione-verifica.md) — canale cartaceo e digitale.
- [sequence-correzione-ai.md](diagrammi/sequence-correzione-ai.md) — correzione AI (Modulo 5, V2).
