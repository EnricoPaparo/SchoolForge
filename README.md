# SchoolForge

Repository didattico personale Markdown-first per un solo docente. Le lezioni e i pool di domande sono la conoscenza canonica; SchoolForge li usa per presentare contenuti, generare verifiche e produrre il PDF cartaceo dello studente direttamente nel browser.

## Stato

**MVP docente cartaceo + Portale studente M3-lite + Repository Editor — implementati, funzionanti sia in locale con emulatori Firebase sia su Firebase DEV (https://schoolforge-dev.web.app).**

Il flusso completo è operativo e testato (suite automatica estesa + smoke test manuale + checklist DEV):

| Capacità | Stato |
|---|---|
| Import ZIP didattico (UDA / lezioni / pool domande) | ✅ funzionante |
| Programma svolto (PDF + Markdown, on-demand nel browser) | ✅ funzionante |
| Export ZIP repository | ✅ funzionante |
| Classi docente | ✅ funzionante |
| Verifiche: creazione draft, selezione domande, attivazione | ✅ funzionante |
| PDF studente senza soluzioni (generato nel browser) | ✅ funzionante |
| Dashboard prontezza repository | ✅ funzionante |
| Portale studente Google, read-only (M3-lite) | ✅ funzionante — login Google, StudentShell, Lezioni e Verifiche filtrate per classe, approvazione studenti, PDF verifica studente |
| Repository Editor (RE) | ✅ funzionante — crea/modifica/riordina/elimina (con blocco protetto) UDA e lezioni, export ZIP coerente e reimportabile |
| Question Editor (QE) — sezione "Domande" | ✅ funzionante — crea/modifica/elimina pool e domande Markdown-first, questionIndex coerente, picker aggiornato |
| Portale digitale con consegna online (M3-full) | ✅ completato — avvio online, bozza, consegna immutabile, modalità verifica, monitor docente; Gate G5 superato |
| Correzione e export risultati (M4) | 🚧 in corso — contratto, service/Rules, workspace docente di correzione e lettura studente della correzione restituita (M4-00→M4-02B) completati; Registro Correzioni ed export (M4-03) non ancora implementati |
| Correzione AI (M5) | ❌ fuori scope V1 |

**Stato:** Repository Editor (RE-00 → RE-07), Question Editor (QE-00 → QE-05) e M3-full sono completi e stabili per uso DEV/manuale; Gate G5 superato per M3-full. Vedi `documentazione/repository-editor-roadmap.md`, `documentazione/question-editor-roadmap.md`, `documentazione/m3-full-roadmap.md` e `documentazione/evidenze/g5-m3-full-checklist-finale.md`.
Vedi [documentazione/mvp-docente-cartaceo.md](documentazione/mvp-docente-cartaceo.md) per la guida operativa.

## Principi non negoziabili

- Markdown e asset restano esportabili senza SchoolForge.
- La V1 ha un solo docente; gli studenti non hanno un account SchoolForge dedicato.
- Il sistema non invia email; da M3-lite gli studenti si autenticano con Google (account personale o Google Workspace for Education), senza registrazione.
- Il PDF cartaceo e il PDF studente di M3-lite sono scaricati direttamente nel browser, senza persistenza.
- PDF, export e programma svolto sono generati on-demand nel browser e non conservati dal sistema.
- Il ruolo utente è risolto confrontando `uid` con `ownerUid`: docente se coincide, studente in sola lettura altrimenti. Nessun accesso anonimo in M3-lite.
- M3-lite non usa Cloud Functions: legge solo proiezioni pubbliche read-only entro Security Rules. M3-full (verifiche online) usa scritture client dirette con Security Rules; non introduce Cloud Functions.
- L'AI (V2) è opzionale, non genera domande e non usa fonti web.
- Firebase è la piattaforma; costi e componenti restano minimi, con scale-to-zero e avvisi budget.

## Percorso documentale

| Documento | Funzione |
|---|---|
| [Indice](documentazione/INDEX.md) | Punto di ingresso e ordine di lettura della documentazione. |
| [Guida operativa MVP](documentazione/mvp-docente-cartaceo.md) | Come avviare e usare l'MVP in locale. |
| [Smoke test MVP](documentazione/evidenze/smoke-mvp-docente-cartaceo.md) | Checklist smoke test ripetibile. |
| [Brief](documentazione/brief.md) | Visione, perimetro e decisioni del prodotto. |
| [Requisiti](documentazione/analisi-requisiti.md) | Regole funzionali, qualità e criteri di accettazione. |
| [Architettura](documentazione/architettura.md) | Firebase, SPA unica, Security Rules, dati, flussi tecnici. |
| [Piano di implementazione](documentazione/piano-implementazione.md) | Pacchetti per agenti, dipendenze, gate e attività umane. |
| [Contratto API](documentazione/api-contract.md) | Tipi TypeScript Firestore, Cloud Functions e Security Rules. |
| [Sicurezza](documentazione/sicurezza.md) | Controlli, minacce e checklist per gate. |
| [Strategia di test](documentazione/test-strategy.md) | Evidenze minime per ciascun modulo. |
| [Toolchain](documentazione/toolchain.md) | Versioni, struttura monorepo, bootstrap, emulatori. |
| [Decisioni](documentazione/decisioni.md) | Registro piatto di tutte le decisioni (D/ADR/C). |
| [Glossario](documentazione/glossario.md) | Vocabolario condiviso. |
| [Diagrammi](documentazione/diagrammi) | Flussi e componenti. |
| [Repository Editor](documentazione/repository-editor-roadmap.md) | Roadmap del Repository Editor (RE-00–RE-07, implementato): editor minimale UDA/lezioni Markdown-first. |
| [Question Editor](documentazione/question-editor-roadmap.md) | Roadmap QE-00–QE-05: editor pool domande Markdown-first, senza reimport ZIP. |
| [M3-full](documentazione/m3-full-roadmap.md) | Specifica M3-full (verifiche online, consegne, monitor e modalità verifica): modello dati, Security Rules, UX, roadmap M3F-00→M3F-11. |
| [Didattica (DUX)](documentazione/didattica-ux-roadmap.md) | Redesign UX approvato del workspace docente: unifica Corsi/Lezioni/Domande, roadmap DUX-00→05 + Gate GDUX. **DUX-00 (specifica + prototipo) completato, nessuna fase implementata nell'app.** |

## Moduli di delivery

1. **M1 — Repository didattico** ✅: programmi, UDA, lezioni, pool, rendering, export ZIP, programma svolto (PDF + Markdown).
2. **M2 — Verifiche e cartaceo** ✅: configurazione, classi, selezione domande, attivazione, PDF studente browser-side.
3. **M3-lite — Portale studente (Google, read-only)** ✅: login Google (personale o Workspace for Education), risoluzione ruolo docente/studente, StudentShell con sezioni Lezioni e Verifiche filtrate per classe, approvazione studenti, download del solo PDF studente per le verifiche `active`+`public`. Nessuna Cloud Function, nessun account custom, nessuna consegna online.
4. **RE — Repository Editor** ✅: creare/modificare/eliminare/riordinare UDA e lezioni, inclusi front matter e corpo Markdown, senza AI e senza CMS complesso; export ZIP coerente e reimportabile.
5. **QE — Question Editor (sezione "Domande")** ✅: crea, modifica ed elimina domande e pool Markdown-first (`.pool.md`) direttamente dal portale, aggiornando `questionIndex` su Firestore senza reimport ZIP. Vedi [question-editor-roadmap.md](documentazione/question-editor-roadmap.md).
6. **M3-full — Verifiche online e consegne studenti** ✅: avvio online, bozza, consegna immutabile, codice consegna e monitor docente; sessione obbligatoria, modalità verifica per classe e protezione effettiva delle lezioni. Gate G5 superato. Vedi [m3-full-roadmap.md](documentazione/m3-full-roadmap.md) e [evidenze/g5-m3-full-checklist-finale.md](documentazione/evidenze/g5-m3-full-checklist-finale.md).
7. **M4 — Correzione ed export** 🚧 *(dipende da M3-full, completato)*: contratto dati, service layer/Security Rules, workspace docente di correzione manuale e lettura studente della correzione restituita (M4-00→M4-02B) completati; punteggi, percentuali e feedback assegnabili, restituibili e consultabili dallo studente. Registro Correzioni ed export PDF/Markdown/CSV (M4-03) non ancora implementati.
8. **M5 — Correzione AI** *(fuori scope V1 / pianificato per V2)*: proposte assistite, approvazione massiva, correzione automatica opt-in.
9. **Didattica (DUX)** 🚧 *(redesign UX approvato, non ancora implementato)*: unifica progressivamente le sezioni Corsi, Lezioni e Domande in un unico workspace docente, riusando gli stessi service/dati di RE/QE. DUX-00 (specifica completa + prototipo statico) è completato; nessuna sezione esistente è stata modificata o rimossa. Vedi [didattica-ux-roadmap.md](documentazione/didattica-ux-roadmap.md).

V1 comprende M1, M2, M3-lite, RE, QE e M3-full (tutti implementati, Gate G5 superato per M3-full). M4 è in corso: contratto, service/Rules, workspace di correzione e lettura studente della correzione restituita (M4-00→M4-02B) completati; Registro Correzioni ed export (M4-03) restano da implementare. Il progetto può fermarsi dopo ogni modulo mantenendo un prodotto utile. M5 è rinviato alla V2. Didattica (DUX) è un redesign UX approvato in fase di specifica (DUX-00 completato), non ancora implementato nell'app.

## Architettura in sintesi

```
SPA unica (Firebase Hosting)
├── /teacher/*  — docente autenticato (ownerUid), scrittura diretta Firestore + Storage
└── /student/*  — studente autenticato Google
                  M3-lite: lezioni e verifiche read-only, PDF studente browser-side
                  M3-full [completato]: avvio online, bozza, consegna immutabile

Canale cartaceo: PDF generato nel browser dal docente (M2, implementato).
Consegna online: scritture client dirette con Security Rules (M3-full, no Cloud Functions).

Cloud Functions: riservate a AI (M5/V2).

PDF generati nel browser (@react-pdf/renderer) — nessun server coinvolto, nessuna persistenza
```

## Firebase ed esercizio

Il Docente possiede progetto e billing Firebase. Firestore, Storage e Functions usano Milano `europe-west8` dove supportato. I Markdown e gli asset in Cloud Storage sono portabili e protetti dalla ridondanza nativa di Storage; Firestore è esportabile on-demand dalle impostazioni. RPO V1: best-effort (export manuale del Docente), RTO non garantito. Vedi C-01.

## Prossimo passo

**Repository Editor (RE) — completato.** Il docente crea, modifica, elimina (con blocco se esistono verifiche collegate) e riordina UDA e lezioni direttamente dal portale, inclusi front matter e corpo Markdown; l'export ZIP resta coerente e reimportabile. Non ci sono fasi RE obbligatorie ulteriori.

**M3-full (portale digitale con consegna online) — completato.** Gate G5 superato con evidenze automatiche e smoke manuale del docente su DEV. Vedi [documentazione/m3-full-roadmap.md](documentazione/m3-full-roadmap.md) e [documentazione/evidenze/g5-m3-full-checklist-finale.md](documentazione/evidenze/g5-m3-full-checklist-finale.md).

**M4 — Correzione ed export — in corso.** Contratto dati, service layer/Security Rules, workspace docente di correzione manuale e lettura studente della correzione restituita (M4-00→M4-02B) sono completati: il docente assegna punteggi/feedback per domanda da un workspace dedicato aperto dalla tabella Consegne online, completa e restituisce la correzione allo studente; lo studente vede la propria correzione restituita (punteggi, feedback ed eventuali soluzioni abilitate) dalla sezione Verifiche, in sola lettura. Registro Correzioni ed export PDF/Markdown/CSV (M4-03) non sono ancora implementati. Concept UX in [documentazione/m4-correzione-ux-concept.md](documentazione/m4-correzione-ux-concept.md). **QE — Question Editor** è già completato; **M5 — Correzione AI** resta rinviato alla V2.

**Didattica (DUX) — DUX-00 completato, redesign non ancora implementato.** Specifica UX completa e prototipo statico standalone per il nuovo workspace docente unificato ("Didattica"), che assorbirà progressivamente Corsi/Lezioni/Domande (Classi confluirà in Studenti). Nessun codice applicativo è stato modificato in questa fase: le sezioni attuali restano invariate e pienamente funzionanti. Vedi [documentazione/didattica-ux-roadmap.md](documentazione/didattica-ux-roadmap.md) e il prototipo [documentazione/prototipi/didattica-workspace.html](documentazione/prototipi/didattica-workspace.html).
