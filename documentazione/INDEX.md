# SchoolForge — Indice della documentazione

## Stato MVP

**M1 + M2 + M3-lite + RE + QE + M3-full completati. Deploy DEV attivo: https://schoolforge-dev.web.app**

Il flusso docente cartaceo, il portale studente, il Repository Editor e il portale digitale con consegna online (M3-full) sono implementati e completi: sessione obbligatoria, modalità verifica per classe e Gate G5 sono superati — vedi [evidenze/g5-m3-full-checklist-finale.md](evidenze/g5-m3-full-checklist-finale.md). M4 (correzione) è in corso: contratto, service/Rules, workspace docente di correzione e lettura studente della correzione restituita (M4-00→M4-02B) completati; Registro Correzioni ed export (M4-03) non ancora implementati. M5 (AI) non è implementato.
Vedi [mvp-docente-cartaceo.md](mvp-docente-cartaceo.md) per avviare l'ambiente locale e [evidenze/smoke-dev-deploy.md](evidenze/smoke-dev-deploy.md) per lo smoke test DEV.

**Didattica (DUX) — implementazione DUX-01–07A completata.** Didattica ha assorbito Corsi/Lezioni/Domande dopo il **Gate di parità PASS** (vedi [evidenze/dux-04d-matrice-parita.md](evidenze/dux-04d-matrice-parita.md)); Classi è una scheda di Studenti, Verifiche è uniformata e il polish responsive finale è applicato. Restano DUX-07B e Gate GDUX — vedi [didattica-ux-roadmap.md](didattica-ux-roadmap.md).

**Repository Editor (RE-00 → RE-07) completato** — vedi [repository-editor-roadmap.md](repository-editor-roadmap.md) per la roadmap e [evidenze/repository-editor-checklist-manuale.md](evidenze/repository-editor-checklist-manuale.md) per la checklist manuale DEV. Nessuna fase RE obbligatoria successiva.

**Question Editor (QE-00 → QE-05, sezione "Domande") completato** — vedi [question-editor-roadmap.md](question-editor-roadmap.md): editor pool domande Markdown-first, serializzatore YAML, service layer Storage + Firestore, sidebar Corso→UDA→Lezione e form domanda inline.

**M3-full (verifiche online e consegne studenti) è completato** — M3F-00→M3F-11C completati, Gate G5 superato; vedi [m3-full-roadmap.md](m3-full-roadmap.md) per sessione obbligatoria, modalità verifica per classe, protezione lezioni e hardening costi, e [evidenze/g5-m3-full-checklist-finale.md](evidenze/g5-m3-full-checklist-finale.md) per la checklist finale del gate. M4 dipende da M3-full (ora completato) ed è in corso: M4-00 (contratto), M4-01 (service/Rules), M4-02 (workspace docente di correzione) e M4-02B (lettura studente della correzione restituita) sono completati; M4-03 (Registro Correzioni ed export) non ancora implementato.

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
| [repository-editor-roadmap.md](repository-editor-roadmap.md) | Roadmap Repository Editor (RE-00–RE-07, implementato). | Per consultare decisioni tecniche e scope dell'editor UDA/lezioni. |
| [question-editor-roadmap.md](question-editor-roadmap.md) | Roadmap Question Editor (QE-00–QE-05, completato): editor pool domande Markdown-first, senza reimport ZIP. | Per consultare contratto, decisioni e implementazione della sezione "Domande". |
| [m3-full-roadmap.md](m3-full-roadmap.md) | Specifica M3-full: verifiche online, consegne, monitor, sessione obbligatoria e modalità verifica. Roadmap M3F-00–M3F-11C, completata — Gate G5 superato. | Per consultare il modello dati/Rules di M3-full o lo stato del Gate G5. |
| [didattica-ux-roadmap.md](didattica-ux-roadmap.md) | Specifica UX del redesign "Didattica" (DUX-00–07 + Gate GDUX). **DUX-01–07A completati: viste legacy rimosse, Classi assorbita in Studenti, Verifiche uniformata e polish responsive applicato; DUX-07B e Gate GDUX pendenti.** | Per consultare architettura informativa, invarianti di sicurezza/costo e prossimi passi. |

## Evidenze

- [evidenze/G2-M1.md](evidenze/G2-M1.md) — gate G2: evidenze milestone M1.
- [evidenze/smoke-mvp-docente-cartaceo.md](evidenze/smoke-mvp-docente-cartaceo.md) — smoke test MVP docente cartaceo (M1+M2, emulatori locali).
- [evidenze/smoke-dev-deploy.md](evidenze/smoke-dev-deploy.md) — smoke test deploy DEV su Firebase reale. **DEV SMOKE PASS.**
- [evidenze/g4-lite-checklist-manuale.md](evidenze/g4-lite-checklist-manuale.md) — checklist manuale dei 6 criteri minimi della gate G4-lite (M3-lite).
- [evidenze/checklist-dev-post-hardening.md](evidenze/checklist-dev-post-hardening.md) — checklist manuale DEV completa (docente + studente) post-hardening delle Storage Rules.
- [evidenze/repository-editor-checklist-manuale.md](evidenze/repository-editor-checklist-manuale.md) — checklist manuale DEV del Repository Editor (RE-07): creazione, modifica, riordino, eliminazione protetta, export/reimport ZIP, vista studente.
- [evidenze/v1-checklist-finale.md](evidenze/v1-checklist-finale.md) — checklist finale di stabilizzazione V1: sintesi delle checklist di area, giro rapido sulle 6 aree UI principali, incoerenze documentali corrette e backlog residuo.
- [evidenze/g5-m3-full-checklist-finale.md](evidenze/g5-m3-full-checklist-finale.md) — checklist finale del Gate G5 (M3-full): evidenze automatiche e conferme manuali DEV per i 26 criteri minimi, limiti residui, verdetto.

## Diagrammi

- [er-model.md](diagrammi/er-model.md) — modello dati Firestore.
- [component-frontend.md](diagrammi/component-frontend.md) — architettura frontend della SPA.
- [sequence-import-lezione.md](diagrammi/sequence-import-lezione.md) — sequenza di import didattico.
- [sequence-pubblicazione-verifica.md](diagrammi/sequence-pubblicazione-verifica.md) — canale cartaceo, Portale studente M3-lite e note storiche sul canale digitale; la specifica M3-full corrente è in [m3-full-roadmap.md](m3-full-roadmap.md).
- [sequence-correzione-ai.md](diagrammi/sequence-correzione-ai.md) — correzione AI (Modulo 5, V2).
- [m4-correzione-ux-concept.md](m4-correzione-ux-concept.md) — concept approvato per lista consegne, workspace di correzione e restituzione studente del Modulo 4.
