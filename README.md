# SchoolForge

Repository didattico personale Markdown-first per un solo docente. Le lezioni e i pool di domande sono la conoscenza canonica; SchoolForge li usa per presentare contenuti, generare verifiche, raccogliere consegne digitali e supportare la correzione manuale.

## Stato

La baseline documentale v4.0 è completa. Non esiste ancora codice applicativo, configurazione Firebase o pipeline eseguibile. Il primo pacchetto da implementare è `F-01 — Workspace e CI`.

## Principi non negoziabili

- Markdown e asset restano esportabili senza SchoolForge.
- La V1 ha un solo docente e nessun account studente.
- Il sistema non invia email agli studenti; il PDF cartaceo è scaricato direttamente nel browser.
- PDF, export e programma svolto sono generati on-demand nel browser e non conservati dal sistema.
- Cloud Functions usate solo per il token di sessione digitale (M3) e l'AI (M5).
- Il Portale digitale salva uno snapshot sicuro della prova tramite Cloud Function.
- L'AI è opzionale, non genera domande e non usa fonti web.
- Firebase è la piattaforma; costi e componenti restano minimi, con scale-to-zero e avvisi budget.

## Percorso documentale

| Documento | Funzione |
|---|---|
| [Brief](documentazione/brief.md) | Visione, perimetro e decisioni del prodotto. |
| [Requisiti](documentazione/analisi-requisiti.md) | Regole funzionali, qualità e criteri di accettazione. |
| [Architettura](documentazione/architettura.md) | Firebase, SPA unica, Security Rules, dati, flussi tecnici. |
| [Piano di implementazione](documentazione/piano-implementazione.md) | Pacchetti per agenti, dipendenze, gate e attività umane. |
| [Contratto API](documentazione/api-contract.md) | Tipi TypeScript Firestore, Cloud Functions e Security Rules. |
| [Sicurezza](documentazione/sicurezza.md) | Controlli, minacce e checklist per gate. |
| [Strategia di test](documentazione/test-strategy.md) | Evidenze minime per ciascun modulo. |
| [Glossario](documentazione/glossario.md) | Vocabolario condiviso. |
| [Diagrammi](documentazione/diagrammi) | Flussi e componenti. |

## Moduli di delivery

1. **M1 — Repository didattico**: programmi, UDA, lezioni, pool, rendering, export ZIP, programma svolto (PDF + Markdown).
2. **M2 — Verifiche e cartaceo**: configurazione, classi, PDF browser, download docente e studente, lock email.
3. **M3 — Portale digitale**: snapshot via Cloud Function, token sessione, bozza, consegna strutturata.
4. **M4 — Correzione ed export**: punteggi, percentuali, rettifiche, export in PDF/Markdown/CSV.
5. **M5 — Correzione AI**: proposte assistite, opt-in automatico, anomalie stilistiche.

Il progetto può fermarsi dopo ogni modulo mantenendo un prodotto utile.

## Architettura in sintesi

```
SPA unica (Firebase Hosting)
├── /teacher/*       — docente autenticato, scrittura diretta Firestore + Storage
└── /exam/:token     — portale pubblico, canale cartaceo (PDF browser) e digitale

Cloud Functions:
└── startDigitalAttempt  — M3: snapshot con soluzioni private + cookie sessione
└── AI endpoints         — M5: AiGateway con chiave in Secret Manager

PDF generati nel browser (@react-pdf/renderer) — nessun server coinvolto
```

## Firebase ed esercizio

Il Docente possiede progetto e billing Firebase. Firestore, Storage e Functions usano Milano `europe-west8` dove supportato. Backup giornaliero, conservazione minima 30 giorni, RPO 24 ore e restore best-effort sono definiti in C-01.

## Prossimo passo

Completare H-01 e H-02 del piano: creare i progetti Firebase `dev` e `prod`, abilitare billing Blaze e configurare le risorse dati nella regione prevista. In parallelo un agente può iniziare F-01, senza deploy o segreti di produzione.
