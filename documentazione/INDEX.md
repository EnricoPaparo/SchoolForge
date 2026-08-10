# SchoolForge — Indice della documentazione

## Stato MVP

**M1 + M2 + M3-lite + RE + QE + M3-full completati. Deploy DEV attivo: https://schoolforge-dev.web.app**

Il flusso docente cartaceo, il portale studente, il Repository Editor e il portale digitale con consegna online (M3-full) sono implementati e completi: sessione obbligatoria, modalità verifica per classe e Gate G5 sono superati — vedi [evidenze/g5-m3-full-checklist-finale.md](evidenze/g5-m3-full-checklist-finale.md). M4 (correzione) è completato e **Gate G6 è superato** ([evidenze](evidenze/g6-m4-checklist-finale.md)). **M5 — Correzione assistita con IA è COMPLETATO e Gate G7 è PASS**: `gpt-5.6-luna` è approvato per DEV, con nano come rollback esplicito; vedi [checklist finale G7](evidenze/g7-m5-checklist-finale.md) e [roadmap M5](m5-ai-assisted-roadmap.md).
Vedi [mvp-docente-cartaceo.md](mvp-docente-cartaceo.md) per avviare l'ambiente locale e [evidenze/smoke-dev-deploy.md](evidenze/smoke-dev-deploy.md) per lo smoke test DEV.

**Didattica (DUX) — implementazione DUX-01–10A completata.** Didattica ha assorbito Corsi/Lezioni/Domande dopo il **Gate di parità PASS** (vedi [evidenze/dux-04d-matrice-parita.md](evidenze/dux-04d-matrice-parita.md)); Classi è una scheda di Studenti, Verifiche è uniformata e metadata corso/anno sono modificabili. **Gate GDUX superato (PASS)** — vedi [evidenze/gdux-checklist-finale.md](evidenze/gdux-checklist-finale.md) e [didattica-ux-roadmap.md](didattica-ux-roadmap.md).

**Appunti personali dello studente (ANNOT) — completato.** ANNOT-01/02/03A/03B implementati e mergiati; identità canonica lezione = `publicLessonId`; costo di una read indice per corso/sessione e read nota solo all'apertura, senza listener/polling. **Gate GANNOT superato (PASS)** — vedi [evidenze/gannot-checklist-finale.md](evidenze/gannot-checklist-finale.md) e [student-notes-contract.md](student-notes-contract.md).

**Teacher Workflow Upgrades (TWU) — completato.** TWU-01→04B,
CHUNK-RECOVERY-01 e CORR-PDF-01 sono implementati, distribuiti e verificati su
DEV; Importa UDA ed export archivistico per studente hanno superato lo smoke
desktop/mobile/Brave. **Gate GTWU superato (PASS)** — vedi
[evidenze/gtwu-checklist-finale.md](evidenze/gtwu-checklist-finale.md).

**STRUCTURE-IMPORT — progettato, non implementato.** Importazione append-only
di UDA e lezioni **senza contenuto**, tramite due file YAML versionati e le
azioni contestuali già presenti in Didattica. Include una fase separata per
usare nel prompt le competenze/obiettivi UDA senza nuove letture. Contratto e
roadmap in [structure-metadata-import-roadmap.md](structure-metadata-import-roadmap.md).

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
11. [evoluzioni-apprendimento-roadmap.md](evoluzioni-apprendimento-roadmap.md) — roadmap approvata post-polish: calibrazione IA, pool senza peso, appunti, varianti equivalenti e boost grafico.
12. [vex-contract.md](vex-contract.md) — VEX varianti equivalenti: contratto, builder assistito docente, assegnazione server-side idempotente, svolgimento, correzione/IA/restituzione sulla variante. VEX-01A→02C implementati e distribuiti su DEV; **Gate GVEX PASS**. Prototipo builder: [prototipi/vex-builder.html](prototipi/vex-builder.html).
13. [teacher-workflow-upgrades-roadmap.md](teacher-workflow-upgrades-roadmap.md) — TWU: rifiniture e miglioramenti del flusso docente. TWU-01→04B, CORR-PDF-01 e recovery chunk completati; contratto Importa UDA in [uda-import-contract.md](uda-import-contract.md), export archivistico in [correction-archive-export-contract.md](correction-archive-export-contract.md). **Gate GTWU PASS** — [evidenze](evidenze/gtwu-checklist-finale.md).
14. [structure-metadata-import-roadmap.md](structure-metadata-import-roadmap.md) — importazione strutturale append-only: UDA e lezioni con soli metadati, nessun contenuto/pool/IA durante l'import.
15. [lesson-quality-depth-roadmap.md](lesson-quality-depth-roadmap.md) — profondità delle lezioni generate: i concetti chiave dicono che cosa trattare, non quanto scrivere. Diagnosi misurata, candidato E in produzione, limiti di spesa. **Gate GLESSON aperto.**
16. [verifiche-differenziate-roadmap.md](verifiche-differenziate-roadmap.md) — esiti per lezione (sola lettura, derivazione pura) e verifiche differenziate per etichetta. Progettazione conclusa, nessuna riga implementata.
17. [mappa-concettuale-roadmap.md](mappa-concettuale-roadmap.md) — mappa concettuale della lezione: output IA strutturato e composto dal server, Markdown modificabile, diagramma a caratteri e proiezione studente presente solo a lezione svolta. **CONCEPT-MAP-01, 02 e 03 implementati** (core e backend IA; persistenza, proiezione condizionale e Rules; interfaccia docente e studente, editor con anteprima, rimozione di `lessonPdf` morto). **Rollout DEV e gate umano ancora aperti**: nessun deploy, nessuna generazione OpenAI reale.

## Per sviluppare un modulo

Parti da [piano-implementazione.md](piano-implementazione.md) per la specifica del pacchetto (scope, file, dipendenze, evidenze DoD). Passa poi a [api-contract.md](api-contract.md) per i tipi e i contratti delle Cloud Functions, e infine a [test-strategy.md](test-strategy.md) per sapere cosa testare e con quali fixture. La V1 include M5 completato con Gate G7 PASS; la [checklist finale](evidenze/g7-m5-checklist-finale.md) distingue evidenze automatiche, conferme manuali e limiti residui.

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
| [structure-metadata-import-roadmap.md](structure-metadata-import-roadmap.md) | Contratto e roadmap STRUCTURE-IMPORT: file YAML di sole UDA/lezioni metadata, append atomico, UI nei menu Azioni e fase contesto IA UDA. | Per implementare la preparazione massiva degli scheletri didattici senza contenuti. |
| [m3-full-roadmap.md](m3-full-roadmap.md) | Specifica M3-full: verifiche online, consegne, monitor, sessione obbligatoria e modalità verifica. Roadmap M3F-00–M3F-11C, completata — Gate G5 superato. | Per consultare il modello dati/Rules di M3-full o lo stato del Gate G5. |
| [storage-gateway-roadmap.md](storage-gateway-roadmap.md) | Contratto e roadmap del **Repository Storage Gateway** same-origin (SGW-00–03). **SGW-01/02A verificati su DEV; SGW-02B batch-read implementato nel codice; restano SGW-02C import e SGW-03.** | Per capire il gateway, l'ultimo accesso Storage diretto e i prossimi passi. |
| [didattica-ux-roadmap.md](didattica-ux-roadmap.md) | Specifica UX del redesign "Didattica" (DUX-00–10A + Gate GDUX). **DUX-01–10A completati; Gate GDUX superato (PASS)** — vedi [evidenze/gdux-checklist-finale.md](evidenze/gdux-checklist-finale.md). | Per consultare architettura informativa, invarianti di sicurezza/costo e prossimo Gate. |
| [m5-ai-assisted-roadmap.md](m5-ai-assisted-roadmap.md) | Roadmap M5-00→M5-08: modulo completato, provider Luna operativo su DEV e **Gate G7 PASS**. | Per consultare contratto IA/gateway, privacy, limiti costo, benchmark e rollout controllato. |
| [correction-archive-export-contract.md](correction-archive-export-contract.md) | Contratto `CORR-PDF-01` e `CHUNK-RECOVERY-01`: un PDF distinto per ogni studente selezionato, ZIP solo come contenitore multiplo, contenuti/privacy/costi e recovery dei moduli PDF obsoleti. | Per implementare l'export scolastico delle correzioni e rendere affidabili i download PDF dopo i deploy. |
| [evidenze/g7-m5-checklist-finale.md](evidenze/g7-m5-checklist-finale.md) | Evidenza finale M5: matrice automatica/manuale, benchmark Luna, rollout, limiti e verdetto G7. | Per verificare la chiusura formale di M5 e Gate G7. |
| [evidenze/hard-node-01-runtime-upgrade.md](evidenze/hard-node-01-runtime-upgrade.md) | Upgrade controllato delle Cloud Functions a Node.js 22 e SDK Firebase server-side correnti; deploy DEV escluso. | Per audit breaking change, verifiche e piano di rollout/rollback HARD-NODE-01. |
| [evoluzioni-apprendimento-roadmap.md](evoluzioni-apprendimento-roadmap.md) | Decisioni e stato per SPINNER-FIX, M5-QUALITY, POOL-SIMPLE, ANNOT, VEX e VISUAL-BOOST. **POOL-SIMPLE-01/02 completati; Gate GPOOL superato (PASS).** | Fonte di verità per le evoluzioni successive a UI-POLISH-01 e i relativi gate. |

## Evidenze

- [evidenze/hg-m5-human-gate.md](evidenze/hg-m5-human-gate.md) — approvazione HG-M5-1/2/3/4 del 17 luglio 2026: modello/listino pinned, ceiling costi e retention; non autorizza provider, secret, TTL o deploy.
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
- [evidenze/gpool-checklist-finale.md](evidenze/gpool-checklist-finale.md) — checklist finale del contratto pool V2: parser/template, import/editor, index/snapshot, svolgimento, correzione, restituzione ed export; evidenze automatiche e conferme DEV dichiarate, verdetto **Gate GPOOL PASS**.
- [evidenze/gvex-human-gate.md](evidenze/gvex-human-gate.md) — checklist finale post-rollout VEX-03A/VEX-02C su DEV: builder, assegnazione multi-studente, idempotenza, isolamento, consegna, correzione/IA/restituzione ed export. **Gate GVEX PASS**.
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
