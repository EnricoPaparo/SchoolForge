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
| Contratto pool V2 (POOL-SIMPLE) | ✅ `schoolforge-pool/v2` unico, difficoltà intera 1–5, `maxPoints === difficolta`, nessun `peso`; **Gate GPOOL superato (PASS)** — vedi [`gpool-checklist-finale.md`](documentazione/evidenze/gpool-checklist-finale.md) |
| Portale digitale con consegna online (M3-full) | ✅ completato — avvio online, bozza, consegna immutabile, modalità verifica, monitor docente; Gate G5 superato |
| Correzione e export risultati (M4) | ✅ completato — correzione/restituzione, ciclo di vita, Registro Correzioni, export CSV ed export PDF (M4-00→M4-04); Markdown rinviato; **Gate G6 superato** (vedi `documentazione/evidenze/g6-m4-checklist-finale.md`) |
| Hardening finale V1 | ✅ **Gate GHARD superato** — 0 P0/P1, P2 risolti, residui P3 accettati |
| Correzione assistita da IA (M5) | 🟢 **Completata — Gate G7 PASS.** OpenAI `gpt-5.6-luna` approvato e operativo su DEV dietro kill switch, guardrail economici e privacy-minimal run v2; nano resta rollback esplicito. [Evidenze finali](documentazione/evidenze/g7-m5-checklist-finale.md). |

**Stato:** Repository Editor (RE-00 → RE-07), Question Editor (QE-00 → QE-05) e M3-full sono completi e stabili per uso DEV/manuale; Gate G5 superato per M3-full. Vedi `documentazione/repository-editor-roadmap.md`, `documentazione/question-editor-roadmap.md`, `documentazione/m3-full-roadmap.md` e `documentazione/evidenze/g5-m3-full-checklist-finale.md`.

**Compatibilità Storage / Brave (SGW).** Il **Repository Storage Gateway
same-origin** (`/api/repository/*` → Hosting rewrite → Cloud Function → Admin
SDK → Storage) copre operazioni singole, pool, editing Markdown, eliminazione,
export/backfill/verifiche e import ZIP batch. Il runtime web non esegue più
operazioni dati dirette contro Firebase Storage. Contratto e stato in
`documentazione/storage-gateway-roadmap.md`.
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
| [Gate GPOOL](documentazione/evidenze/gpool-checklist-finale.md) | Chiusura del rollout pool V2 end-to-end: evidenze automatiche, conferme DEV dichiarate e limiti residui. |

## Moduli di delivery

1. **M1 — Repository didattico** ✅: programmi, UDA, lezioni, pool, rendering, export ZIP, programma svolto (PDF + Markdown).
2. **M2 — Verifiche e cartaceo** ✅: configurazione, classi, selezione domande, attivazione, PDF studente browser-side.
3. **M3-lite — Portale studente (Google, read-only)** ✅: login Google (personale o Workspace for Education), risoluzione ruolo docente/studente, StudentShell con sezioni Lezioni e Verifiche filtrate per classe, approvazione studenti, download del solo PDF studente per le verifiche `active`+`public`. Nessuna Cloud Function, nessun account custom, nessuna consegna online.
4. **RE — Repository Editor** ✅: creare/modificare/eliminare/riordinare UDA e lezioni, inclusi front matter e corpo Markdown, senza AI e senza CMS complesso; export ZIP coerente e reimportabile.
5. **QE — Question Editor (sezione "Domande")** ✅: crea, modifica ed elimina domande e pool Markdown-first (`.pool.md`) direttamente dal portale, aggiornando `questionIndex` su Firestore senza reimport ZIP. Vedi [question-editor-roadmap.md](documentazione/question-editor-roadmap.md).
6. **M3-full — Verifiche online e consegne studenti** ✅: avvio online, bozza, consegna immutabile, codice consegna e monitor docente; sessione obbligatoria, modalità verifica per classe e protezione effettiva delle lezioni. Gate G5 superato. Vedi [m3-full-roadmap.md](documentazione/m3-full-roadmap.md) e [evidenze/g5-m3-full-checklist-finale.md](documentazione/evidenze/g5-m3-full-checklist-finale.md).
7. **M4 — Correzione ed export** ✅ *(dipende da M3-full, completato)*: correzione manuale, restituzione studente, ciclo di vita, Registro Correzioni, export CSV ed export PDF (M4-00→M4-04, Markdown rinviato). **Gate G6 superato** — vedi [evidenze/g6-m4-checklist-finale.md](documentazione/evidenze/g6-m4-checklist-finale.md).
8. **M5 — Correzione assistita da IA** *(completato; Gate G7 PASS)*: unica azione batch «Correggi con IA» che pre-compila come **bozza** le `evaluations` di correzioni `in_progress` (chiuse deterministiche a 0 token, aperte assistite con una richiesta per consegna); nessuna correzione automatica, nessuna restituzione automatica. Contratto e cost model in [documentazione/m5-ai-assisted-roadmap.md](documentazione/m5-ai-assisted-roadmap.md).
9. **Didattica (DUX)** ✅ *(DUX-00→10A implementati; Gate GDUX superato)*: workspace docente unico che ha assorbito Corsi, Lezioni e Domande riusando service e dati RE/QE; include libreria corsi, editor contenuti/pool, organizzazione, filtri e UI responsive. Gate GDUX superato — vedi [evidenze/gdux-checklist-finale.md](documentazione/evidenze/gdux-checklist-finale.md). Vedi [didattica-ux-roadmap.md](documentazione/didattica-ux-roadmap.md).
10. **Didattica studente (SDUX)** ✅: libreria corsi e consultazione corso/UDA/lezione in sola lettura, senza componenti/service docente, pool o Storage; Modalità verifica e flussi DEV verificati.

V1 comprende M1, M2, M3-lite, RE, QE e M3-full (tutti implementati, Gate G5 superato per M3-full). M4 è completato: correzione/restituzione, ciclo di vita, Registro Correzioni, export CSV ed export PDF (M4-00→M4-04, Markdown rinviato); **Gate G6 superato**. Il progetto può fermarsi dopo ogni modulo mantenendo un prodotto utile. M5 (correzione assistita da IA) è completato e **Gate G7 è PASS**: Luna è il modello DEV approvato, nano il rollback esplicito. Didattica DUX-00→10A è implementata e il Gate GDUX è superato (PASS).

## Architettura in sintesi

```
SPA unica (Firebase Hosting)
├── /teacher/*  — docente autenticato (ownerUid), Firestore diretto + Storage via gateway SGW
└── /student/*  — studente autenticato Google
                  M3-lite: lezioni e verifiche read-only, PDF studente browser-side
                  M3-full [completato]: avvio online, bozza, consegna immutabile

Canale cartaceo: PDF generato nel browser dal docente (M2, implementato).
Consegna online: scritture client dirette con Security Rules (M3-full, no Cloud Functions).

Cloud Functions: gateway SGW, runtime IA, varianti e chiusura programmata; tutte
scale-to-zero (`minInstances: 0`).

PDF generati nel browser (@react-pdf/renderer) — nessun server coinvolto, nessuna persistenza
```

## Firebase ed esercizio

Il Docente possiede progetto e billing Firebase. **Regioni:** DEV usa
Firestore `europe-west8` e Storage/Function gateway `us-central1`; PROD è
operativo con i servizi principali in `europe-west8` e la coda di chiusura
forzata in `europe-west3`. Nessun dato DEV è stato migrato. Stato attuale in
[`documentazione/evidenze/prod-rollout-01.md`](documentazione/evidenze/prod-rollout-01.md);
la matrice HARD-01C resta lo snapshot storico precedente al provisioning. RPO
V1: best-effort (export manuale), RTO non garantito. Vedi C-01.

## Prossimo passo

**Repository Editor (RE) — completato.** Il docente crea, modifica, elimina (con blocco se esistono verifiche collegate) e riordina UDA e lezioni direttamente dal portale, inclusi front matter e corpo Markdown; l'export ZIP resta coerente e reimportabile. Non ci sono fasi RE obbligatorie ulteriori.

**M3-full (portale digitale con consegna online) — completato.** Gate G5 superato con evidenze automatiche e smoke manuale del docente su DEV. Vedi [documentazione/m3-full-roadmap.md](documentazione/m3-full-roadmap.md) e [documentazione/evidenze/g5-m3-full-checklist-finale.md](documentazione/evidenze/g5-m3-full-checklist-finale.md).

**M4 — Correzione ed export — completato (Gate G6 superato).** Il docente corregge, completa e restituisce; lo studente consulta la propria restituzione. La tabella Consegne online è il Registro Correzioni ed esporta CSV e PDF interamente nel browser (M4-00→M4-04; Markdown rinviato). Concept UX in [documentazione/m4-correzione-ux-concept.md](documentazione/m4-correzione-ux-concept.md); evidenze del gate in [documentazione/evidenze/g6-m4-checklist-finale.md](documentazione/evidenze/g6-m4-checklist-finale.md). **M5 — Correzione assistita da IA — completato (Gate G7 PASS).** Il modello DEV approvato è `gpt-5.6-luna`; `gpt-5.4-nano-2026-03-17` resta rollback esplicito. Benchmark, revisione docente e rollout sono consolidati nella [checklist finale G7](documentazione/evidenze/g7-m5-checklist-finale.md). G8/automazione completa resta fuori scope V1.

**Didattica (DUX) — DUX-00→10A implementati.** Il workspace docente unificato ha sostituito Corsi/Lezioni/Domande; Classi è stata assorbita in Studenti, Verifiche è stata uniformata e la shell finale usa header unico responsive, Template a griglia e aurora statica. Sono inclusi editing coordinato dei metadata corso/anno e stabilità finale di azioni, tabelle ed export. **Gate GDUX superato (PASS)** — vedi [documentazione/evidenze/gdux-checklist-finale.md](documentazione/evidenze/gdux-checklist-finale.md). Vedi [documentazione/didattica-ux-roadmap.md](documentazione/didattica-ux-roadmap.md) e il prototipo [documentazione/prototipi/didattica-workspace.html](documentazione/prototipi/didattica-workspace.html).

**Hardening V1 — completato.** Gate GHARD superato: operatività/costi, regioni, security header, accessibilità e import resiliente verificati; residui P3 accettati con soglie. **HARD-NODE-01** aggiorna in modo controllato Functions a Node.js 22 e gli SDK Firebase server-side; il rollout DEV resta un passo separato post-merge.
