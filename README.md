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
| Portale studente Google, read-only (M3-lite) | ❌ non implementato — prossimo modulo, deciso |
| Portale digitale con consegna online (M3-full) | ❌ non implementato — specifica rinviata a dopo M3-lite |
| Correzione e export risultati (M4) | ❌ non implementato — dipende da M3-full |
| Correzione AI (M5) | ❌ fuori scope V1 |

**Prossimo passo:** deploy controllato su ambiente `dev` Firebase reale (richiede H-01/H-02 — azione del Docente); a seguire, M3-lite (portale studente autenticato Google, in sola lettura).
Vedi [documentazione/mvp-docente-cartaceo.md](documentazione/mvp-docente-cartaceo.md) per la guida operativa.

## Principi non negoziabili

- Markdown e asset restano esportabili senza SchoolForge.
- La V1 ha un solo docente; gli studenti non hanno un account SchoolForge dedicato.
- Il sistema non invia email; da M3-lite gli studenti si autenticano con Google (account personale o Google Workspace for Education), senza registrazione.
- Il PDF cartaceo e il PDF studente di M3-lite sono scaricati direttamente nel browser, senza persistenza.
- PDF, export e programma svolto sono generati on-demand nel browser e non conservati dal sistema.
- Il ruolo utente è risolto confrontando `uid` con `ownerUid`: docente se coincide, studente in sola lettura altrimenti. Nessun accesso anonimo in M3-lite.
- M3-lite non usa Cloud Functions: legge solo proiezioni pubbliche read-only entro Security Rules. Un eventuale gateway Cloud Functions per consegna online (avvio, ripresa, bozza, consegna autorizzati lato server) resta specifica rinviata a M3-full.
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
3. **M3-lite — Portale studente (Google, read-only)** ❌ *(prossimo modulo, deciso)*: login Google (personale o Workspace for Education), risoluzione ruolo docente/studente, sezioni Lezioni e Verifiche in sola lettura, download del solo PDF studente per le verifiche `attiva`+`public`. Nessuna Cloud Function, nessun account custom, nessuna consegna online.
4. **M3-full — Portale digitale** ❌ *(specifica rinviata, fase successiva a M3-lite)*: snapshot via Cloud Function, lock nome+cognome, token sessione, log nome+IP, bozza, consegna strutturata.
5. **M4 — Correzione ed export** ❌ *(dipende da M3-full)*: punteggi, percentuali, rettifiche, export PDF/Markdown/CSV.
6. **M5 — Correzione AI** *(fuori scope V1 / pianificato per V2)*: proposte assistite, approvazione massiva, correzione automatica opt-in.

La V1 comprende i moduli M1, M2 e M3-lite come prossimo passo deciso; M3-full e M4 restano pianificati per una fase successiva. Il progetto può fermarsi dopo ogni modulo mantenendo un prodotto utile. M5 è rinviato alla V2.

## Architettura in sintesi

```
SPA unica (Firebase Hosting)
├── /teacher/*  — docente autenticato (ownerUid), scrittura diretta Firestore + Storage
└── /student/*  — studente autenticato Google, sola lettura [M3-lite, non implementato]
                  Lezioni (read-only) + Verifiche (attiva+public, solo download PDF studente)

Canale cartaceo: PDF generato nel browser dal docente (già implementato in M2).

Cloud Functions: nessuna in M3-lite.
Riservate a AI (M5/V2) ed eventuale gateway M3-full [specifica rinviata]:
├── startDigitalAttempt
└── continueDigitalAttempt

PDF generati nel browser (@react-pdf/renderer) — nessun server coinvolto, nessuna persistenza
```

## Firebase ed esercizio

Il Docente possiede progetto e billing Firebase. Firestore, Storage e Functions usano Milano `europe-west8` dove supportato. I Markdown e gli asset in Cloud Storage sono portabili e protetti dalla ridondanza nativa di Storage; Firestore è esportabile on-demand dalle impostazioni. RPO V1: best-effort (export manuale del Docente), RTO non garantito. Vedi C-01.

## Prossimo passo

**UX/Product Polish** — il deploy DEV è attivo (https://schoolforge-dev.web.app, DEV SMOKE PASS). La fase successiva migliora usabilità e coerenza visiva senza aggiungere macro-feature. Vedi [documentazione/ux-product-roadmap.md](documentazione/ux-product-roadmap.md) per la roadmap UX-01–UX-06.
