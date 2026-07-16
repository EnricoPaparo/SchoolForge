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
| Didattica studente read-only (SDUX) | ✅ libreria corsi + workspace corso/UDA/lezione su sole proiezioni pubbliche; modalità verifica e flussi DEV verificati |
| Repository Editor (RE) | ✅ funzionante — crea/modifica/riordina/elimina (con blocco protetto) UDA e lezioni, export ZIP coerente e reimportabile |
| Question Editor (QE) — sezione "Domande" | ✅ funzionante — crea/modifica/elimina pool e domande Markdown-first, questionIndex coerente, picker aggiornato |
| Portale digitale con consegna online (M3-full) | ✅ completato — avvio online, bozza, consegna immutabile, modalità verifica, monitor docente; Gate G5 superato |
| Correzione e export risultati (M4) | ✅ completato — correzione/restituzione, ciclo di vita, Registro Correzioni, export CSV ed export PDF (M4-00→M4-04); Markdown rinviato; **Gate G6 superato** (vedi `documentazione/evidenze/g6-m4-checklist-finale.md`) |
| Hardening finale V1 | ✅ **Gate GHARD superato** — 0 P0/P1, P2 risolti, residui P3 accettati |
| Correzione assistita da IA (M5) | 🟡 **M5-00 progettato + M5-01/M5-02 implementati** (motore server-side `onCall` in modalità mock: scoring chiuse deterministico, aperte via `MockAiGrader`, idempotenza; 0 token, nessuna chiamata esterna) — vedi `documentazione/m5-ai-assisted-roadmap.md`; M5-03→M5-05 non ancora avviati |

**Stato:** Repository Editor (RE-00 → RE-07), Question Editor (QE-00 → QE-05) e M3-full sono completi e stabili per uso DEV/manuale; Gate G5 superato per M3-full. Vedi `documentazione/repository-editor-roadmap.md`, `documentazione/question-editor-roadmap.md`, `documentazione/m3-full-roadmap.md` e `documentazione/evidenze/g5-m3-full-checklist-finale.md`.

**Compatibilità Storage / Brave (SGW in corso).** Il **Repository Storage Gateway same-origin** (`/api/repository/*` → Hosting rewrite → Cloud Function → Admin SDK → Storage) è implementato e verificato su DEV per operazioni singole, pool, editing Markdown ed eliminazione programmi (SGW-01/02A). SGW-02B porta nel gateway export ZIP, backfill e caricamento batch dei pool; resta solo l'upload dell'import ZIP diretto fino a SGW-02C. Contratto e stato in `documentazione/storage-gateway-roadmap.md`.
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
| [Didattica (DUX)](documentazione/didattica-ux-roadmap.md) | Redesign UX del workspace docente: Didattica ha assorbito Corsi/Lezioni/Domande, Classi è ora una scheda di Studenti, Verifiche usa la creazione inline e la shell adotta header unico, Template restaurato e aurora sobria. **DUX-00→10A completati; Gate GDUX superato (PASS)** — vedi [evidenze/gdux-checklist-finale.md](documentazione/evidenze/gdux-checklist-finale.md). |
| [Didattica studente (SDUX)](documentazione/student-didattica-ux-roadmap.md) | Versione read-only della Didattica su proiezioni pubbliche: implementata e verificata su DEV, inclusa Modalità verifica. |
| [Gate GHARD](documentazione/evidenze/ghard-checklist-finale.md) | Chiusura hardening V1: finding, evidenze automatiche/manuali, rischi residui accettati e confine PROD. |

## Moduli di delivery

1. **M1 — Repository didattico** ✅: programmi, UDA, lezioni, pool, rendering, export ZIP, programma svolto (PDF + Markdown).
2. **M2 — Verifiche e cartaceo** ✅: configurazione, classi, selezione domande, attivazione, PDF studente browser-side.
3. **M3-lite — Portale studente (Google, read-only)** ✅: login Google (personale o Workspace for Education), risoluzione ruolo docente/studente, StudentShell con sezioni Lezioni e Verifiche filtrate per classe, approvazione studenti, download del solo PDF studente per le verifiche `active`+`public`. Nessuna Cloud Function, nessun account custom, nessuna consegna online.
4. **RE — Repository Editor** ✅: creare/modificare/eliminare/riordinare UDA e lezioni, inclusi front matter e corpo Markdown, senza AI e senza CMS complesso; export ZIP coerente e reimportabile.
5. **QE — Question Editor (sezione "Domande")** ✅: crea, modifica ed elimina domande e pool Markdown-first (`.pool.md`) direttamente dal portale, aggiornando `questionIndex` su Firestore senza reimport ZIP. Vedi [question-editor-roadmap.md](documentazione/question-editor-roadmap.md).
6. **M3-full — Verifiche online e consegne studenti** ✅: avvio online, bozza, consegna immutabile, codice consegna e monitor docente; sessione obbligatoria, modalità verifica per classe e protezione effettiva delle lezioni. Gate G5 superato. Vedi [m3-full-roadmap.md](documentazione/m3-full-roadmap.md) e [evidenze/g5-m3-full-checklist-finale.md](documentazione/evidenze/g5-m3-full-checklist-finale.md).
7. **M4 — Correzione ed export** ✅ *(dipende da M3-full, completato)*: correzione manuale, restituzione studente, ciclo di vita, Registro Correzioni, export CSV ed export PDF (M4-00→M4-04, Markdown rinviato). **Gate G6 superato** — vedi [evidenze/g6-m4-checklist-finale.md](documentazione/evidenze/g6-m4-checklist-finale.md).
8. **M5 — Correzione assistita da IA** *(M5-00 progettato; implementazione non avviata)*: unica azione batch «Correggi con IA» che pre-compila come **bozza** le `evaluations` di correzioni `in_progress` (chiuse deterministiche a 0 token, aperte assistite con una richiesta per consegna); nessuna correzione automatica, nessuna restituzione automatica. Contratto e cost model in [documentazione/m5-ai-assisted-roadmap.md](documentazione/m5-ai-assisted-roadmap.md).
9. **Didattica (DUX)** ✅ *(DUX-00→10A implementati; Gate GDUX superato)*: workspace docente unico che ha assorbito Corsi, Lezioni e Domande riusando service e dati RE/QE; include libreria corsi, editor contenuti/pool, organizzazione, filtri e UI responsive. Gate GDUX superato — vedi [evidenze/gdux-checklist-finale.md](documentazione/evidenze/gdux-checklist-finale.md). Vedi [didattica-ux-roadmap.md](documentazione/didattica-ux-roadmap.md).
10. **Didattica studente (SDUX)** ✅: libreria corsi e consultazione corso/UDA/lezione in sola lettura, senza componenti/service docente, pool o Storage; Modalità verifica e flussi DEV verificati.

V1 comprende M1, M2, M3-lite, RE, QE e M3-full (tutti implementati, Gate G5 superato per M3-full). M4 è completato: correzione/restituzione, ciclo di vita, Registro Correzioni, export CSV ed export PDF (M4-00→M4-04, Markdown rinviato); **Gate G6 superato**. Il progetto può fermarsi dopo ogni modulo mantenendo un prodotto utile. M5 (correzione assistita da IA) è progettato a livello M5-00 e ha **M5-01+M5-02 implementati** (motore gateway mock: scoring, valutazione aperte via mock, idempotenza); M5-03→M5-05 non ancora avviati. Didattica DUX-00→10A è implementata e il Gate GDUX è superato (PASS).

## Architettura in sintesi

```
SPA unica (Firebase Hosting)
├── /teacher/*  — docente autenticato (ownerUid), Firestore diretto + Storage via gateway SGW
│                 (import ZIP ancora diretto fino a SGW-02C)
└── /student/*  — studente autenticato Google
                  M3-lite: lezioni e verifiche read-only, PDF studente browser-side
                  M3-full [completato]: avvio online, bozza, consegna immutabile

Canale cartaceo: PDF generato nel browser dal docente (M2, implementato).
Consegna online: scritture client dirette con Security Rules (M3-full, no Cloud Functions).

Cloud Functions: una Function HTTPS scale-to-zero per il gateway SGW; AI resta riservata a M5/V2.

PDF generati nel browser (@react-pdf/renderer) — nessun server coinvolto, nessuna persistenza
```

## Firebase ed esercizio

Il Docente possiede progetto e billing Firebase. **Regioni:** DEV usa Firestore `europe-west8` e Storage/Function gateway `us-central1` (verificati); il target PROD è `europe-west8` con co-locazione, previa verifica di compatibilità prima del provisioning. Nessun dato DEV sarà migrato. Dettaglio in [`documentazione/evidenze/hard-01c-region-matrix.md`](documentazione/evidenze/hard-01c-region-matrix.md). RPO V1: best-effort (export manuale), RTO non garantito. Vedi C-01.

## Prossimo passo

**Repository Editor (RE) — completato.** Il docente crea, modifica, elimina (con blocco se esistono verifiche collegate) e riordina UDA e lezioni direttamente dal portale, inclusi front matter e corpo Markdown; l'export ZIP resta coerente e reimportabile. Non ci sono fasi RE obbligatorie ulteriori.

**M3-full (portale digitale con consegna online) — completato.** Gate G5 superato con evidenze automatiche e smoke manuale del docente su DEV. Vedi [documentazione/m3-full-roadmap.md](documentazione/m3-full-roadmap.md) e [documentazione/evidenze/g5-m3-full-checklist-finale.md](documentazione/evidenze/g5-m3-full-checklist-finale.md).

**M4 — Correzione ed export — completato (Gate G6 superato).** Il docente corregge, completa e restituisce; lo studente consulta la propria restituzione. La tabella Consegne online è il Registro Correzioni ed esporta CSV e PDF interamente nel browser (M4-00→M4-04; Markdown rinviato). Concept UX in [documentazione/m4-correzione-ux-concept.md](documentazione/m4-correzione-ux-concept.md); evidenze del gate in [documentazione/evidenze/g6-m4-checklist-finale.md](documentazione/evidenze/g6-m4-checklist-finale.md). **M5 — Correzione assistita da IA**: progettazione **M5-00** completata e **M5-01+M5-02 implementati** — motore server-side `onCall` in **modalità mock deterministica** (owner-only, feature flag, preflight reale senza scritture, scoring chiuse deterministico, aperte via `MockAiGrader`, scritture atomiche M4, idempotenza `aiCorrectionRuns`; 0 token, nessuna chiamata esterna), codice in `functions/src/aiCorrectionEngine.ts` + `aiCorrectionGateway*.ts` ([documentazione/m5-ai-assisted-roadmap.md](documentazione/m5-ai-assisted-roadmap.md)). **Nessuna Secret reale**: nessuna chiave del provider è richiesta o configurata; Secret Manager e chiave reale diventano obbligatori solo in **M5-05**. M5-03→M5-05 (Gate G7) non avviati. Provider/modello e budget restano Human Gate aperti (bloccanti per M5-05).

**Didattica (DUX) — DUX-00→10A implementati.** Il workspace docente unificato ha sostituito Corsi/Lezioni/Domande; Classi è stata assorbita in Studenti, Verifiche è stata uniformata e la shell finale usa header unico responsive, Template a griglia e aurora statica. Sono inclusi editing coordinato dei metadata corso/anno e stabilità finale di azioni, tabelle ed export. **Gate GDUX superato (PASS)** — vedi [documentazione/evidenze/gdux-checklist-finale.md](documentazione/evidenze/gdux-checklist-finale.md). Vedi [documentazione/didattica-ux-roadmap.md](documentazione/didattica-ux-roadmap.md) e il prototipo [documentazione/prototipi/didattica-workspace.html](documentazione/prototipi/didattica-workspace.html).

**Hardening V1 — completato.** Gate GHARD superato: operatività/costi, regioni, security header, accessibilità e import resiliente verificati; residui P3 accettati con soglie. **M5-00 completato** (contratto/UX batch/cost model) e **M5-01+M5-02 implementati**: motore server-side `onCall` `aiCorrectionPreview`/`aiCorrectionRun` in **modalità mock deterministica** (owner-only, feature flag `disabled|mock`, preflight reale senza scritture, scoring chiuse deterministico, aperte via `MockAiGrader`, scritture atomiche M4 via Admin SDK, idempotenza `aiCorrectionRuns`; 0 token, nessuna chiamata esterna) — [documentazione/m5-ai-assisted-roadmap.md](documentazione/m5-ai-assisted-roadmap.md). Prossimo sviluppo: **M5-03** (UI batch).
