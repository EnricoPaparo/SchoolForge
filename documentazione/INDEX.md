# SchoolForge — Indice della documentazione

## Stato MVP

**M1 + M2 + M3-lite + RE + QE + M3-full completati. Deploy DEV attivo: https://schoolforge-dev.web.app**

Il flusso docente cartaceo, il portale studente, il Repository Editor e il portale digitale con consegna online (M3-full) sono implementati e completi: sessione obbligatoria, modalità verifica per classe e Gate G5 sono superati — vedi [evidenze/g5-m3-full-checklist-finale.md](evidenze/g5-m3-full-checklist-finale.md). M4 (correzione) è completato: correzione/restituzione, ciclo di vita, Registro Correzioni, export CSV ed export PDF (M4-00→M4-04, Markdown rinviato); **Gate G6 superato** (vedi [evidenze/g6-m4-checklist-finale.md](evidenze/g6-m4-checklist-finale.md)). **M5 (correzione assistita da IA): M5-00 progettato + M5-01 implementato** (gateway `onCall` in modalità mock: owner-only, feature flag, 0 token, nessuna scrittura — [m5-ai-assisted-roadmap.md](m5-ai-assisted-roadmap.md)); M5-02→M5-05 non avviati.
Vedi [mvp-docente-cartaceo.md](mvp-docente-cartaceo.md) per avviare l'ambiente locale e [evidenze/smoke-dev-deploy.md](evidenze/smoke-dev-deploy.md) per lo smoke test DEV.

**Didattica (DUX) — implementazione DUX-01–10A completata.** Didattica ha assorbito Corsi/Lezioni/Domande dopo il **Gate di parità PASS** (vedi [evidenze/dux-04d-matrice-parita.md](evidenze/dux-04d-matrice-parita.md)); Classi è una scheda di Studenti, Verifiche è uniformata e metadata corso/anno sono modificabili. **Gate GDUX superato (PASS)** — vedi [evidenze/gdux-checklist-finale.md](evidenze/gdux-checklist-finale.md) e [didattica-ux-roadmap.md](didattica-ux-roadmap.md).

**Hardening finale (HARD) — completato.** **Gate GHARD superato (PASS, 15/07/2026):** 0 P0/P1, i P2 F01/F02/F03 risolti, fix accessibilità P2 e import resiliente F06 completati; residui P3 accettati con soglie esplicite. Evidenze finali in [evidenze/ghard-checklist-finale.md](evidenze/ghard-checklist-finale.md). HARD-03 resta condizionato a misure reali e non blocca la V1. Il PASS non autorizza provisioning o deploy PROD.

**Didattica studente (SDUX) — completata.** Libreria corsi e workspace corso/UDA/lezione read-only su sole proiezioni pubbliche; nessun componente/service docente, pool o accesso Storage. SDUX-02 e Modalità verifica confermati su DEV — vedi [student-didattica-ux-roadmap.md](student-didattica-ux-roadmap.md).

**Repository Editor (RE-00 → RE-07) completato** — vedi [repository-editor-roadmap.md](repository-editor-roadmap.md) per la roadmap e [evidenze/repository-editor-checklist-manuale.md](evidenze/repository-editor-checklist-manuale.md) per la checklist manuale DEV. Nessuna fase RE obbligatoria successiva.

**Question Editor (QE-00 → QE-05, sezione "Domande") completato** — vedi [question-editor-roadmap.md](question-editor-roadmap.md): editor pool domande Markdown-first, serializzatore YAML, service layer Storage + Firestore, sidebar Corso→UDA→Lezione e form domanda inline.

**M3-full (verifiche online e consegne studenti) è completato** — M3F-00→M3F-11C completati, Gate G5 superato; vedi [m3-full-roadmap.md](m3-full-roadmap.md) per sessione obbligatoria, modalità verifica per classe, protezione lezioni e hardening costi, e [evidenze/g5-m3-full-checklist-finale.md](evidenze/g5-m3-full-checklist-finale.md) per la checklist finale del gate. M4 dipende da M3-full ed è completato: M4-00→M4-04, incluso Registro Correzioni, export CSV ed export PDF (Markdown rinviato per assenza di caso d'uso); **Gate G6 superato** — vedi [evidenze/g6-m4-checklist-finale.md](evidenze/g6-m4-checklist-finale.md).

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

Parti da [piano-implementazione.md](piano-implementazione.md) per la specifica del pacchetto (scope, file, dipendenze, evidenze DoD). Passa poi a [api-contract.md](api-contract.md) per i tipi e i contratti delle Cloud Functions, e infine a [test-strategy.md](test-strategy.md) per sapere cosa testare e con quali fixture. La V1 copre i moduli M1–M4. **M5 (correzione assistita da IA)** è progettato a livello **M5-00** e ha **M5-01 implementato** (gateway `onCall` in modalità mock deterministica: 0 token, nessuna scrittura) — [m5-ai-assisted-roadmap.md](m5-ai-assisted-roadmap.md); M5-02→M5-05 (Gate G7) non ancora avviati.

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
| [storage-gateway-roadmap.md](storage-gateway-roadmap.md) | Contratto e roadmap del **Repository Storage Gateway** same-origin (SGW-00–03). **SGW-01/02A verificati su DEV; SGW-02B batch-read implementato nel codice; restano SGW-02C import e SGW-03.** | Per capire il gateway, l'ultimo accesso Storage diretto e i prossimi passi. |
| [didattica-ux-roadmap.md](didattica-ux-roadmap.md) | Specifica UX del redesign "Didattica" (DUX-00–10A + Gate GDUX). **DUX-01–10A completati; Gate GDUX superato (PASS)** — vedi [evidenze/gdux-checklist-finale.md](evidenze/gdux-checklist-finale.md). | Per consultare architettura informativa, invarianti di sicurezza/costo e prossimo Gate. |
| [m5-ai-assisted-roadmap.md](m5-ai-assisted-roadmap.md) | **M5-00** — contratto, UX batch («Correggi con IA»), sicurezza, privacy, cost model e roadmap M5-00→M5-05 della correzione assistita da IA. **Solo progettazione**; implementazione non avviata. Supera la vecchia roadmap M5-A..E. | Per consultare il contratto IA/gateway, i limiti di costo e gli Human Gate aperti. |

## Evidenze

- [evidenze/G2-M1.md](evidenze/G2-M1.md) — gate G2: evidenze milestone M1.
- [evidenze/smoke-mvp-docente-cartaceo.md](evidenze/smoke-mvp-docente-cartaceo.md) — smoke test MVP docente cartaceo (M1+M2, emulatori locali).
- [evidenze/smoke-dev-deploy.md](evidenze/smoke-dev-deploy.md) — smoke test deploy DEV su Firebase reale. **DEV SMOKE PASS.**
- [evidenze/g4-lite-checklist-manuale.md](evidenze/g4-lite-checklist-manuale.md) — checklist manuale dei 6 criteri minimi della gate G4-lite (M3-lite).
- [evidenze/checklist-dev-post-hardening.md](evidenze/checklist-dev-post-hardening.md) — checklist manuale DEV completa (docente + studente) post-hardening delle Storage Rules.
- [evidenze/repository-editor-checklist-manuale.md](evidenze/repository-editor-checklist-manuale.md) — checklist manuale DEV del Repository Editor (RE-07): creazione, modifica, riordino, eliminazione protetta, export/reimport ZIP, vista studente.
- [evidenze/v1-checklist-finale.md](evidenze/v1-checklist-finale.md) — checklist finale di stabilizzazione V1: sintesi delle checklist di area, giro rapido sulle 6 aree UI principali, incoerenze documentali corrette e backlog residuo.
- [evidenze/g5-m3-full-checklist-finale.md](evidenze/g5-m3-full-checklist-finale.md) — checklist finale del Gate G5 (M3-full): evidenze automatiche e conferme manuali DEV per i 26 criteri minimi, limiti residui, verdetto.
- [evidenze/g6-m4-checklist-finale.md](evidenze/g6-m4-checklist-finale.md) — checklist finale del Gate G6 (M4 — Correzione ed export): matrice evidenze automatiche vs conferme manuali DEV (salvataggio/completamento/PDF/CSV), limiti residui, smoke consigliato non bloccante, fuori scope, verdetto **superato**.
- [evidenze/gdux-checklist-finale.md](evidenze/gdux-checklist-finale.md) — checklist finale del Gate GDUX (refactor Didattica/UX): matrice 14 punti di verifica, conferme manuali DEV, limiti residui, verdetto **superato (PASS)**.
- [hardening-audit-v1.md](hardening-audit-v1.md) — audit e remediation hardening V1; **Gate GHARD PASS**.
- [runbook-operativo-v1.md](runbook-operativo-v1.md) — **HARD-01A**: runbook operativo V1 per il singolo docente — ambienti DEV/PROD, deploy, rollback, budget e controllo costi, backup/export, ripristino, incidenti (owner/costi/dati), checklist mensile.
- [evidenze/hard-01a-human-gate.md](evidenze/hard-01a-human-gate.md) — **HARD-01A** Human Gate: checklist delle azioni manuali del docente (budget alert DEV, politiche backup, rollback/incidente letti). **PASS il 15/07/2026; HARD-F01 risolto.**
- [evidenze/hard-01b-dev-smoke.md](evidenze/hard-01b-dev-smoke.md) — **HARD-01B** smoke DEV: verifica su DEV dei security header/CSP e della cache di Hosting (evidenze HTTP reali + conferma manuale del docente sui flussi applicativi). **12/12 PASS (15/07/2026); HARD-F03 RESOLVED.**
- [evidenze/hard-01c-region-matrix.md](evidenze/hard-01c-region-matrix.md) — matrice regioni DEV/PROD e target PROD `europe-west8`; HARD-F02 **RESOLVED**.
- [evidenze/hard-01c-human-gate.md](evidenze/hard-01c-human-gate.md) — Human Gate regioni/residenza dati: **PASS**.
- [evidenze/ghard-checklist-finale.md](evidenze/ghard-checklist-finale.md) — checklist finale **Gate GHARD PASS**, evidenze e rischi residui accettati.
- [evidenze/hard-02a-a11y-audit.md](evidenze/hard-02a-a11y-audit.md) — **HARD-02A** audit accessibilità end-to-end V1 (docente+studente): ambiente/metodo, matrice flussi, finding P0/P1/P2/P3, verdetto **READY FOR REMEDIATION**; P2-01 RESOLVED (HARD-02A-FIX) + smoke DEV manuale PASS.
- [hard-02b-import-chunking-design.md](hard-02b-import-chunking-design.md) — **HARD-02B-00** progettazione del chunking resiliente dell'import ZIP (F06): conteggio mutazioni, rischio, alternative A–D, soluzione raccomandata (ID `publicLessons` import-scoped + query su `activeImportId`), protocollo staging→switch→cleanup, macchina a stati, contratto e matrice test. Solo design, nessuna implementazione.

## Diagrammi

- [er-model.md](diagrammi/er-model.md) — modello dati Firestore.
- [component-frontend.md](diagrammi/component-frontend.md) — architettura frontend della SPA.
- [sequence-import-lezione.md](diagrammi/sequence-import-lezione.md) — sequenza di import didattico.
- [sequence-pubblicazione-verifica.md](diagrammi/sequence-pubblicazione-verifica.md) — canale cartaceo, Portale studente M3-lite e note storiche sul canale digitale; la specifica M3-full corrente è in [m3-full-roadmap.md](m3-full-roadmap.md).
- [sequence-correzione-ai.md](diagrammi/sequence-correzione-ai.md) — correzione AI (Modulo 5, V2).
- [m4-correzione-ux-concept.md](m4-correzione-ux-concept.md) — concept approvato per lista consegne, workspace di correzione e restituzione studente del Modulo 4.
