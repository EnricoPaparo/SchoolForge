# SchoolForge

Repository didattico personale Markdown-first per un solo docente. Le lezioni e i pool di domande sono la conoscenza canonica; SchoolForge li usa per presentare contenuti, generare verifiche e produrre il PDF cartaceo dello studente direttamente nel browser.

## Stato

**MVP docente cartaceo — implementato, funzionante in locale con emulatori Firebase.**

Il flusso completo è operativo e testato (197 test automatici + smoke test manuale):

| Capacità | Stato |
|---|---|
| Import ZIP didattico (UDA / lezioni / pool domande) | ✅ funzionante |
| Programma svolto (PDF + Markdown, on-demand nel browser) | ✅ funzionante |
| Export ZIP repository | ✅ funzionante |
| Classi docente | ✅ funzionante |
| Verifiche: creazione draft, selezione domande, attivazione | ✅ funzionante |
| PDF studente senza soluzioni (generato nel browser) | ✅ funzionante |
| Dashboard prontezza repository | ✅ funzionante |
| Portale digitale studenti (M3) | ❌ non implementato |
| Correzione e export risultati (M4) | ❌ non implementato |
| Correzione AI (M5) | ❌ fuori scope V1 |

**Prossimo passo:** deploy controllato su ambiente `dev` Firebase reale (richiede H-01/H-02 — azione del Docente).
Vedi [documentazione/mvp-docente-cartaceo.md](documentazione/mvp-docente-cartaceo.md) per la guida operativa.

## Principi non negoziabili

- Markdown e asset restano esportabili senza SchoolForge.
- La V1 ha un solo docente e nessun account studente.
- Il sistema non invia email agli studenti; il PDF cartaceo è scaricato direttamente nel browser.
- PDF, export e programma svolto sono generati on-demand nel browser e non conservati dal sistema.
- Lo studente dichiara nome e cognome (non verificati); ogni accesso digitale è tracciato con nome+IP+timestamp+user-agent (Report Accessi).
- Il write path del Portale digitale usa un piccolo gateway Cloud Functions: avvio, ripresa, bozza e consegna sono autorizzati lato server tramite cookie di sessione.
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

## Moduli di delivery

1. **M1 — Repository didattico** ✅: programmi, UDA, lezioni, pool, rendering, export ZIP, programma svolto (PDF + Markdown).
2. **M2 — Verifiche e cartaceo** ✅: configurazione, classi, selezione domande, attivazione, PDF studente browser-side.
3. **M3 — Portale digitale** ❌: snapshot via Cloud Function, lock nome+cognome, token sessione, log nome+IP, bozza, consegna strutturata.
4. **M4 — Correzione ed export** ❌: punteggi, percentuali, rettifiche, export PDF/Markdown/CSV.
5. **M5 — Correzione AI** *(fuori scope V1 / pianificato per V2)*: proposte assistite, approvazione massiva, correzione automatica opt-in.

La V1 comprende i moduli M1–M4 e può fermarsi dopo ogni modulo mantenendo un prodotto utile. M5 è rinviato alla V2.

## Architettura in sintesi

```
SPA unica (Firebase Hosting)
├── /teacher/*   — docente autenticato, scrittura diretta Firestore + Storage
└── /exam/:token — portale pubblico, canale cartaceo (PDF browser) e digitale [M3, non implementato]

Cloud Functions [M3, non implementate]:
├── startDigitalAttempt
└── continueDigitalAttempt

PDF generati nel browser (jsPDF) — nessun server coinvolto, nessuna persistenza
```

## Firebase ed esercizio

Il Docente possiede progetto e billing Firebase. Firestore, Storage e Functions usano Milano `europe-west8` dove supportato. I Markdown e gli asset in Cloud Storage sono portabili e protetti dalla ridondanza nativa di Storage; Firestore è esportabile on-demand dalle impostazioni. RPO V1: best-effort (export manuale del Docente), RTO non garantito. Vedi C-01.

## Prossimo passo

**UX/Product Polish** — il deploy DEV è attivo (https://schoolforge-dev.web.app, DEV SMOKE PASS). La fase successiva migliora usabilità e coerenza visiva senza aggiungere macro-feature. Vedi [documentazione/ux-product-roadmap.md](documentazione/ux-product-roadmap.md) per la roadmap UX-01–UX-06.
