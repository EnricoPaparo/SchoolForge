# SchoolForge — Architettura di sistema

**Versione:** 4.1
**Data:** 24 giugno 2026
**Stato:** architettura target, pronta per il piano esecutivo
**Input vincolanti:** `brief.md` e `analisi-requisiti.md`
**Destinatari:** implementazione e Docente responsabile operativo

---

## 1. Scopo e perimetro

SchoolForge è un'applicazione web Firebase-first per un solo docente. È composta da una **singola SPA** con due sezioni distinte:

- **Sezione docente** (`/teacher/*`) — autenticata, desktop-first.
- **Sezione portale** (`/exam/:token`) — pubblica, mobile-first, senza login studente.

Firebase Hosting serve la SPA. Firebase Authentication protegge la sezione docente. Cloud Firestore e Cloud Storage gestiscono dati e file. Il piano Blaze è richiesto per Cloud Functions (usate solo per il token di sessione digitale nel Modulo 3 e per l'AI nel Modulo 5) e per il backup. Hosting, Auth, Firestore e Storage scalano a zero e usano le quote incluse per un singolo docente senza costi fissi significativi.

Il progetto non richiede Google Workspace for Education, Google Drive API, account Google per gli studenti o invio di email.

### 1.1 Localizzazione

Cloud Firestore, Cloud Storage e Cloud Functions v2 sono configurati in Milano `europe-west8`. Firebase Hosting usa una CDN globale; Firebase Authentication ha proprie caratteristiche di localizzazione. L'architettura non dichiara che ogni richiesta avvenga esclusivamente in Italia.

### 1.2 Esito atteso

L'implementazione deve consentire al docente di:

1. accedere con Firebase Authentication senza dipendenza da Google Workspace;
2. caricare, validare, consultare ed esportare Markdown, pool e asset;
3. attivare verifiche (aprire il link), con configurazione sempre modificabile dal docente;
4. distribuire PDF della verifica — download diretto per il docente o per lo studente nel canale cartaceo;
5. raccogliere svolgimenti digitali con snapshot sicuro;
6. correggere consegne digitali ed esportarle in PDF, Markdown e CSV;
7. usare facoltativamente l'AI solo per la correzione nel Modulo 5.

---

## 2. Principi architetturali

| Principio | Decisione concreta |
|---|---|
| Markdown-first | Markdown e asset originali vivono in Cloud Storage; Firestore contiene indice, stati e dati operativi. |
| SPA unica | Una sola applicazione con routing `/teacher/*` e `/exam/:token`; nessun deployment separato per il portale. |
| Client autorevole con regole | Il client docente scrive direttamente su Firestore e Storage entro i limiti delle Security Rules; solo le operazioni che richiedono un segreto server-side (token di sessione, AI) passano da Cloud Functions. |
| Single-docente | Un solo `ownerUid` Firebase è autorizzato nella sezione docente; nessun tenant, delega o ruolo aggiuntivo. |
| Studente senza account | Il portale usa un link non enumerabile; lo studente dichiara nome e cognome (non verificati) e ogni accesso è tracciato con nome+IP+timestamp+user-agent. Il tentativo digitale è limitato da un lock per verifica e nome+cognome normalizzati. |
| PDF e documenti effimeri | PDF, export (PDF/Markdown/CSV) e programma svolto sono generati on-demand nel browser con `@react-pdf/renderer` e non scritti su Firestore o Cloud Storage. |
| Snapshot al tentativo digitale | La configurazione della verifica resta sempre modificabile dal docente; l'unico elemento immutabile è lo snapshot di un tentativo digitale, creato con soluzioni private dalla Cloud Function al momento dell'avvio. |
| AI opzionale | Disabilitata per default, non genera domande, dipende da Cloud Functions solo nel Modulo 5 (fuori scope V1 / pianificato per V2). |
| Disciplina di costo | Nessuna risorsa sempre attiva; scale-to-zero, quota incluse, avvisi budget. Cloud Functions usate solo dove strettamente necessario. |

---

## 3. Decisioni architetturali

### ADR-01 — Firebase come piattaforma gestita

**Decisione.** SchoolForge usa Firebase come piattaforma applicativa. Il progetto Firebase, il billing e gli accessi amministrativi sono di proprietà del Docente.

**Motivazione.** Per una V1 single-docente Firebase riduce il lavoro di provisioning: hosting HTTPS, autenticazione, database, object storage, funzioni, emulatori e osservabilità sono integrati. Firestore è sufficiente ai flussi previsti, incluso il lock concorrente per nome+cognome del tentativo digitale e il log di accesso nome+IP tramite transazioni.

**Conseguenza.** La portabilità richiesta riguarda Markdown, asset e dati operativi in formato standard; non richiede eseguire SchoolForge su un secondo cloud senza migrazione.

### ADR-02 — SPA unica con routing

**Decisione.** Una sola applicazione React su Firebase Hosting, con routing `/teacher/*` (autenticata) e `/exam/:token` (pubblica). Code splitting per mantenere il bundle del portale leggero.

**Motivazione.** Due app separate richiedono due pipeline CI/CD, due configurazioni Hosting e duplicazione del codice condiviso (es. tipi, componenti UI). Con un singolo deployment il costo operativo è inferiore e la manutenzione è più semplice. La separazione di sicurezza è garantita dalle Security Rules e dal controllo `ownerUid`, non dalla separazione fisica dei deployment.

### ADR-03 — Cloud Functions solo per sessione digitale e AI

**Decisione.** Le Cloud Functions sono usate esclusivamente per:
- `startDigitalAttempt` (M3): crea il participant lock per verifica+nome/cognome, tentativo, snapshot con soluzioni private, voce di log accesso (nome+IP+user-agent+timestamp) e token opaco di sessione.
- Modulo AI (M5/V2): chiama il provider AI con contesto chiuso e registra l'audit.

Tutte le altre operazioni (import, stati verifica, correzione, export) usano Firebase SDK direttamente dal client con Security Rules.

**Motivazione.** Le Cloud Functions sono necessarie solo quando un segreto server-side è indispensabile: il token di sessione studente (cookie HttpOnly, firmato server-side) e la chiave API AI. Per tutto il resto, Firestore Security Rules garantisce l'autorizzazione senza overhead di Function.

**Conseguenza.** Il costo Cloud Functions è trascurabile per un singolo docente. Le Security Rules devono essere progettate con cura; i test Emulator Suite sono obbligatori.

### ADR-04 — Firestore operativo, Cloud Storage canonico

**Decisione.** Cloud Storage conserva Markdown originali e asset. Cloud Firestore conserva metadati, indici, configurazioni, tentativi, snapshot digitali, correzioni e audit.

**Motivazione.** I file sono la conoscenza del docente; Firestore serve a rendere disponibili operazioni, ricerca e integrità senza diventare la fonte dei contenuti didattici.

### ADR-05 — Firebase Authentication per il solo docente

**Decisione.** La sezione docente usa Firebase Authentication. Il client verifica che `auth.uid == ownerUid` nelle Security Rules per ogni scrittura sensibile; la Cloud Function `startDigitalAttempt` fa la stessa verifica server-side.

**Motivazione.** L'app deve proteggere un unico proprietario senza imporre il tipo di account di scuola.

### ADR-06 — Portale pubblico e token di sessione

**Decisione.** Il link pubblico contiene un token casuale ad alta entropia associato a una verifica attiva. Lo studente dichiara nome e cognome; `startDigitalAttempt` crea in transazione un participant lock per verifica+nome/cognome normalizzati, il tentativo, lo snapshot e il log di accesso (nome+IP+user-agent+timestamp), poi restituisce un token opaco di ripresa come cookie sicuro.

**Motivazione.** Il token di sessione deve essere firmato server-side per impedire forgery. Il cookie HttpOnly/Secure/SameSite garantisce che il token non sia leggibile da JavaScript. Questa è l'unica operazione che richiede la Function.

### ADR-07 — Snapshot al tentativo, immutabilità alla consegna

**Decisione.** L'attivazione apre il link ma non congela la configurazione, che resta sempre modificabile dal docente. All'avvio di un tentativo digitale la Function seleziona le domande dalle fonti e dalla configurazione correnti, salva lo snapshot con soluzioni private in Firestore e restituisce al client solo la proiezione senza soluzioni. Lo snapshot di quel tentativo è immutabile dal momento dell'avvio.

**Motivazione.** Correzione ed export lavorano sullo snapshot dell'istanza svolta, indipendentemente da modifiche successive alla configurazione o alle lezioni. Principio: la configurazione della verifica è sempre modificabile; lo snapshot di un tentativo è immutabile dal momento dell'avvio.

### ADR-08 — PDF e documenti generati nel browser

**Decisione.** Tutti i PDF (verifica docente, verifica studente cartaceo, programma svolto, export verifiche, Registro Correzioni) e gli altri formati di export (Markdown, CSV) sono generati nel browser con `@react-pdf/renderer` o equivalente. Nessun file generato viene scritto su Cloud Storage o Firestore.

**Motivazione.** Eliminare la generazione PDF server-side rimuove la necessità di Cloud Functions per questo scopo, abbatte i costi e semplifica l'architettura. Il browser moderno è in grado di generare PDF di qualità professionale senza infrastruttura server.

### ADR-09 — Secret Manager solo per M5

**Decisione.** Secret Manager non è usato nei Moduli 1–4. Viene introdotto in M5 esclusivamente per la chiave API del provider AI.

**Motivazione.** Senza invio email e senza operazioni server-side che richiedano credenziali esterne nei primi quattro moduli, Secret Manager non ha giustificazione fino all'AI (M5/V2).

### ADR-10 — Export globale da snapshot digitali

**Decisione.** `Esporta verifiche` legge tutte le consegne digitali definitive non annullate o eliminate e i relativi snapshot in Firestore. Il client produce PDF, Markdown o CSV nel browser e lo scarica senza persistenza.

**Motivazione.** L'archivio didattico esportato non dipende da Markdown correnti, pool, lezioni eliminate o Drive API.

---

## 4. Architettura logica

```mermaid
flowchart LR
    D["Docente autenticato"] --> SPA["SPA — Firebase Hosting\n/teacher/* e /exam/:token"]
    S["Studente anonimo"] --> SPA

    SPA -->|"ownerUid"| A["Firebase Authentication"]
    SPA -->|"Security Rules"| F["Cloud Firestore\nstati e dati operativi"]
    SPA -->|"Security Rules"| CS["Cloud Storage\nMarkdown, asset"]
    SPA -->|"startDigitalAttempt\nM5 AI"| CF["Cloud Functions v2\n(solo M3 + M5)"]

    CF --> F
    CF -. "Modulo 5" .-> AI["AiGateway\nprovider AI"]

    SPA --> PDF["@react-pdf/renderer\nnel browser"]
    PDF --> DL["Download\nnessuna persistenza"]
```

[→ Componenti frontend](diagrammi/component-frontend.md)

### 4.1 Confini di responsabilità

| Componente | Responsabilità | Non deve fare |
|---|---|---|
| SPA — sezione docente | UI, validazione locale lesson-contract, rendering Markdown sicuro, scritture Firestore/Storage entro le regole, generazione PDF/CSV/Markdown nel browser. | Esporre soluzioni, chiamare AI direttamente, bypassare Security Rules. |
| SPA — sezione portale | Link pubblico, dati dichiarati, `startDigitalAttempt` call, bozza, svolgimento, consegna, deterrenza. | Esporre soluzioni, correzioni, dati di altri tentativi. |
| Cloud Functions | `startDigitalAttempt`: participant lock nome+cognome, snapshot con soluzioni private, log accesso, token sessione. M5/V2: chiamate AI con contesto chiuso e audit. | Generare PDF, inviare email, applicare stati verifica, scrivere Markdown. |
| Cloud Firestore | Stato operativo, indici, tentativi, snapshot digitali, log accessi, correzioni, audit. | Diventare fonte canonica delle lezioni o archiviare PDF. |
| Cloud Storage | Markdown, asset. | Conservare PDF o export didattici. |
| AiGateway (M5/V2) | Correzione con contesto chiuso e audit. | Generare domande, usare web, eseguire azioni irreversibili. |

---

## 5. Architettura fisica e ambienti

| Livello | Servizio | Configurazione |
|---|---|---|
| Applicazione web | Firebase Hosting | SPA TypeScript, HTTPS, code splitting `/teacher` e `/exam`. |
| Identità docente | Firebase Authentication | Provider configurabile; `ownerUid` verificato nelle Security Rules. |
| Backend (limitato) | Cloud Functions v2 | TypeScript, `europe-west8`, solo `startDigitalAttempt` e modulo AI. |
| Dati operativi | Cloud Firestore Native | Database in `europe-west8` (Milano). |
| File | Cloud Storage | Bucket privato in `europe-west8`, versioning per backup. |
| Segreti | Secret Manager | Solo da M5 (V2): chiave API provider AI. |
| Osservabilità | Cloud Logging e Error Reporting | Log strutturati senza risposte o PDF. |

| Ambiente | Progetto Firebase | Dati |
|---|---|---|
| `dev` | Progetto separato + Emulator Suite | Solo fixture sintetiche. |
| `test` | Emulatori controllati | Dati di collaudo isolati. |
| `prod` | Progetto Firebase del Docente | Dati reali, regione Milano, export Firestore manuale disponibile. |

`dev`, `test` e `prod` non condividono utenti, database, bucket o token.

---

## 6. Dati e persistenza

### 6.1 Cloud Storage

```text
repository/current/{programId}/{udaId}/uda-XX-titolo.md
repository/current/{programId}/{udaId}/lezione-XXX-titolo.md
repository/current/{programId}/{udaId}/lezione-XXX-titolo.pool.md
repository/current/{programId}/{udaId}/assets/{relative-path}
```

Non esistono staging, export temporanei o PDF in Cloud Storage. Il client docente scrive direttamente in `repository/current` entro le Security Rules. Una lifecycle policy gestisce le versioni per il periodo di backup.

Il `questionIndex` è riallineato esclusivamente tramite re-import tramite l'interfaccia. Modifiche dirette ai file in Cloud Storage senza re-import non sono supportate e lasciano l'indice desincronizzato. In caso di desincronizzazione, re-importare le lezioni interessate.

### 6.2 Cloud Firestore

[→ Diagramma ER](diagrammi/er-model.md)

| Collezione | Dati principali | Regola |
|---|---|---|
| `settings/owner` | `ownerUid`, feature flag, lista classi | Unico proprietario V1. |
| `programs`, `udas`, `lessons` | identificatori, titoli, percorsi Storage, validazione e ordine | Firestore è indice, non fonte Markdown. |
| `questionIndex` | `lessonId`, `questionRef`, tipo, difficoltà, peso, validità | Derivato dal pool valido. |
| `verifications` | configurazione modificabile, fonti, stato, token pubblico hashato, classi, `downloadCount` (contatore cartaceo opzionale) | Stati `bozza`, `attiva` (aperta), `chiusa`, `archiviata`. Config sempre modificabile dal docente. |
| `verifications/{id}/participantLocks/{participantKeyHash}` | hash di nome+cognome normalizzati, tentativo, timestamp | Un lock per verifica e coppia dichiarata; creato solo dalla Function. |
| `deliveryAttempts` | verifica, dati dichiarati (`declaredName`, `declaredIp`, `userAgent`), stato, timestamp | Solo canale digitale: `in_corso/consegnato`. Il canale cartaceo non crea tentativi. |
| `deliveryAttempts/{id}/accessLog` | nome dichiarato, IP, user-agent, timestamp | Audit trail dei soli tentativi digitali; scritto via Function, letto dal Report Accessi del docente. |
| `deliveryAttempts/{id}/snapshot/items` | domanda, opzioni, soluzione privata, punteggio massimo, origine | Solo per tentativo digitale; creato dalla Cloud Function. |
| `deliveryAttempts/{id}/answers` | risposta, stato bozza/consegnata, timestamp | Immutabile dopo consegna. |
| `corrections`, `correctionEvents` | punteggi, commenti, percentuale, origine, rettifiche | Eventi append-only. |
| `auditEvents` | attore, azione, oggetto, esito, motivazione, timestamp | Nessuna risposta completa nei log. |

### 6.3 Transazioni obbligatorie

| Evento | Garanzia |
|---|---|
| Attivazione verifica | Transazione client Firestore SDK: valida configurazione, passa `bozza → attiva` (apre il link) e scrive audit. La config resta modificabile dopo l'attivazione. |
| Download cartaceo | Nessun record di tentativo né voce `accessLog`. Opzionale: incremento atomico di `downloadCount` sul documento `verifications`. Nessun lock, nessun dato personale. |
| Avvio digitale | Cloud Function: transazione Firestore — verifica assenza participant lock, crea lock, tentativo, snapshot con soluzioni private, log accesso e token sessione. |
| Salvataggio bozza | Client scrive su `answers` del tentativo autorizzato dal token di sessione; nessuna nuova selezione domande. |
| Consegna | Transazione client: `in_corso → consegnato`, snapshot/risposte immutabili, audit. |
| Rettifica | Evento append-only con precedente/nuovo valore; percentuale ricalcolata. |
| Eliminazione consegna | Rimuove dati personali, risposte e correzioni; preserva audit non identificativo. |

---

## 7. Flussi applicativi

### 7.1 Import lezioni

[→ Sequenza import lezione](diagrammi/sequence-import-lezione.md)

1. Il docente seleziona file o cartella nella SPA.
2. La SPA esegue il parser `lesson-contract` localmente e mostra errori strutturati prima di scrivere.
3. Il docente conferma: la SPA scrive Markdown e asset direttamente in `repository/current` su Cloud Storage entro le Security Rules.
4. La SPA aggiorna `lessons`, `udas` e `questionIndex` in Firestore.
5. L'audit viene scritto in `auditEvents`.

### 7.2 Attivazione verifica

1. Il docente configura fonti, tipi, difficoltà, minimi, varianti, classi. La configurazione resta modificabile anche dopo l'attivazione.
2. La SPA interroga `questionIndex` e valida disponibilità localmente.
3. La SPA esegue una transazione Firestore: crea token pubblico, apre il link (stato `attiva`), scrive audit.

### 7.3 Canale cartaceo

[→ Sequenza pubblicazione verifica](diagrammi/sequence-pubblicazione-verifica.md)

```mermaid
sequenceDiagram
    participant S as Studente
    participant SPA as SPA — portale
    participant F as Firestore

    S->>SPA: apre link e sceglie canale cartaceo
    SPA->>SPA: genera PDF nel browser (@react-pdf/renderer)
    SPA-->>S: download PDF diretto
    opt contatore opzionale
        SPA->>F: incrementa downloadCount (atomico, nessun dato personale)
    end
```

Il canale cartaceo è puramente fisico: nessun record di tentativo, nessun log di accesso. Al più un contatore atomico `downloadCount` sul documento della verifica.

### 7.4 Canale digitale e snapshot

```mermaid
sequenceDiagram
    participant S as Studente
    participant SPA as SPA — portale
    participant CF as Cloud Function
    participant F as Firestore

    S->>SPA: apre link e sceglie canale digitale
    S->>SPA: inserisce nome, cognome, classe
    SPA->>CF: startDigitalAttempt(token, dati)
    CF->>F: transazione — participant lock nome+cognome, tentativo, snapshot con soluzioni private, accessLog (nome+IP), token sessione
    CF-->>SPA: proiezione domande senza soluzioni + cookie sessione
    SPA-->>S: mostra domande

    loop autosave
        S->>SPA: risponde
        SPA->>F: saveDraft (bozza)
    end

    S->>SPA: Consegna
    SPA->>F: transazione — in_corso → consegnato, immutabile, audit
```

### 7.5 Correzione ed export globale

1. Il docente consulta le consegne digitali, filtra per verifica/stato/classe.
2. Assegna punteggi e commenti; la SPA calcola percentuale e scrive in Firestore.
3. Il docente apre il popup `Registro Correzioni`: la SPA mostra la tabella nome/cognome/punteggio/percentuale/data e, su richiesta, ne genera nel browser l'export PDF o CSV senza persistenza.
4. Il docente avvia `Esporta verifiche`: la SPA legge tutte le consegne definitive e i relativi snapshot.
5. La SPA genera nel browser il documento nel formato scelto (PDF, Markdown o CSV) e avvia il download.
6. Il docente carica il file manualmente nel Drive dell'istituto; nessuna chiamata Drive dall'applicazione.

---

## 8. API Firestore e Cloud Function

### 8.1 Scritture client dirette (Security Rules)

| Area | Operazioni client |
|---|---|
| Repository | Scrivi/elimina Markdown e asset in `repository/current`; aggiorna `lessons`, `udas`, `questionIndex`, `programs`. |
| Verifiche | Crea/modifica bozza; transazione attivazione/chiusura/archiviazione; scrivi `auditEvents`. |
| Canale cartaceo | Nessuna scrittura di tentativo o `accessLog`. Solo, in opzione, incremento atomico di `downloadCount` su `verifications`. |
| Correzione | Scrivi `corrections`, `correctionEvents`, elimina consegna. |

### 8.2 Cloud Functions

| Funzione | Attore | Scopo |
|---|---|---|
| `startDigitalAttempt` | SPA portale | Transazione Firestore — participant lock nome+cognome, tentativo, snapshot con soluzioni private, accessLog, token sessione. |
| `proposeCorrection` (M5/V2) | SPA docente | Invia contesto chiuso ad AiGateway, salva proposta e audit. |
| `approveCorrection` (M5/V2) | SPA docente | Applica proposta al record di correzione. |
| `bulkApproveCorrections` (M5/V2) | SPA docente | Approva batch di proposte con riepilogo esclusioni. |
| `enableAutomaticCorrection` (M5/V2) | SPA docente | Opt-in per verifica, richiede C-03 e conferma. |

[→ Sequenza correzione AI (V2)](diagrammi/sequence-correzione-ai.md)

Tutti gli endpoint richiedono Firebase ID token valido ad eccezione di `startDigitalAttempt` che accetta solo il token pubblico della verifica.

Le Security Rules negano accesso diretto del client a `snapshot/items` con soluzioni private, correzioni e audit; questi percorsi sono leggibili solo dalla Function o dall'`ownerUid`.

---

## 9. Sicurezza, backup e osservabilità

### 9.1 Controlli essenziali

- `ownerUid` verificato nelle Security Rules per ogni scrittura nella sezione docente.
- Il token pubblico verifica non è enumerabile (UUID v4 hashato).
- Il token di sessione digitale è un cookie `Secure`, `HttpOnly`, `SameSite=Strict`, a vita limitata; il valore in Firestore è solo l'hash.
- Il client portale non può leggere soluzioni, correzioni, audit, log di accesso o dati di altri tentativi (Security Rules).
- Il participant lock del tentativo digitale usa verifica e nome+cognome normalizzati; ogni accesso è registrato con nome dichiarato, IP, user-agent e timestamp (Report Accessi).
- Il renderer Markdown applica sanitizzazione/whitelist; i pool non sono resi visibili nel percorso di fruizione.
- Risposte, punteggi e dati personali non sono inseriti nei log tecnici.
- La chiave API AI (V2) vive in Secret Manager e non raggiunge browser, Firestore, Markdown o repository Git.

### 9.2 Backup

| Oggetto | Protezione |
|---|---|
| Cloud Firestore | Export manuale on-demand avviato dal docente dalla pagina impostazioni; nessuno scheduler o cron. |
| Cloud Storage | Markdown e asset portabili, protetti dalla ridondanza nativa di Storage; nessun job di backup dedicato. |
| Codice | Repository Git; i segreti non sono inclusi. |
| Dati esportabili | Export repository (ZIP), export verifiche (PDF/MD/CSV) disponibili in ogni momento. |

RPO V1: best-effort, export manuale dal docente, RTO non garantito in V1. Il Docente controlla export e billing.

### 9.3 Osservabilità

Ogni Cloud Function registra `requestId`, azione, esito e durata. Error Reporting segnala fallimenti di import, tentativo digitale, consegna e AI. Nessun log contiene testo delle risposte o dati personali non necessari.

---

## 10. Struttura del codice e test

Vedi `toolchain.md` per versioni, comandi di bootstrap e porte emulatori. Struttura del monorepo pnpm:

```text
SchoolForge/
├─ apps/
│  └─ web/                       # SPA unica (React + Vite) — /teacher/* e /exam/:token
│     └─ src/
│        ├─ contracts/lesson.ts  # riesporta gli schemi da packages/lesson-contract
│        ├─ types/               # firestore.ts, functions.ts
│        ├─ components/pdf/       # VerificaPdfRenderer.tsx (mode teacher|student)
│        ├─ features/            # repository, verifiche, portale, correzione, export
│        └─ lib/                 # firebase client
├─ functions/
│  └─ src/
│     ├─ index.ts                # entry point
│     ├─ startDigitalAttempt.ts
│     └─ ai/                     # M5/V2: AiGateway e endpoint AI
├─ packages/
│  └─ lesson-contract/           # package interno del workspace (NON pubblicato su npm)
│     └─ src/index.ts            # schemi Zod, parser e validatore pool v1
├─ firestore.rules
├─ storage.rules
├─ firestore.indexes.json
├─ firebase.json
├─ pnpm-workspace.yaml
└─ package.json
```

`lesson-contract` è referenziato da `apps/web` e `functions/` via workspace reference (`workspace:*`); non viene mai pubblicato sul registry npm.

| Livello | Evidenza minima |
|---|---|
| Unit | Parser pool, selezione domande, punteggi, stati, renderer export. |
| Integration | Emulator Suite: Security Rules, participant lock digitale, log accesso, import Storage, snapshot digitale. |
| End-to-end | Login docente, import, attivazione, download cartaceo, svolgimento digitale, correzione, export. |
| Sicurezza | Soluzioni non esposte al portale, owner diverso rifiutato, token scaduto/già usato rifiutato, Security Rules default-deny. |
| Continuità | Prova documentata di export Firestore manuale e portabilità Markdown/asset secondo C-01. |
| AI (M5/V2) | Contesto chiuso, nessun web, audit, blocco senza feature flag/C-03. |

---

## 11. Tracciabilità e criteri di accettazione

| Requisito | Meccanismo |
|---|---|
| Markdown indipendente | Cloud Storage originali, parser condiviso, export ZIP. |
| Docente senza vincolo Workspace | Firebase Authentication configurabile, `ownerUid` nelle Security Rules. |
| Studenti senza account | Link pubblico, dati dichiarati, token sessione; nessuna registrazione. |
| Lock partecipante e audit | Un solo tentativo digitale per verifica e nome+cognome normalizzati; log nome+IP+user-agent+timestamp nel Report Accessi. |
| PDF non conservato | Generazione browser, nessuna scrittura su Firestore/Storage. |
| Snapshot digitale | Creato dalla Function al tentativo; immutabile alla consegna. |
| Export verifiche | Tutte le consegne definitive dai snapshot, senza dipendenza dal Markdown corrente. |
| AI opzionale (V2) | AiGateway isolato, feature flag; C-02 risolta per la V2. |

L'implementazione è conforme solo se dimostra che:

1. solo il `ownerUid` configurato scrive dati applicativi privati;
2. Firestore, Storage e Functions usano Milano `europe-west8` ove supportato;
3. Markdown e asset restano esportabili e leggibili fuori da SchoolForge;
4. il portale non espone soluzioni e non richiede account studente;
5. il participant lock impedisce un secondo tentativo digitale per la stessa verifica e nome+cognome, e ogni accesso è registrato con nome+IP+timestamp;
6. PDF e documenti di export sono creati senza persistenza;
7. uno snapshot digitale è immutabile dopo la consegna;
8. `Esporta verifiche` include tutte e sole le consegne definitive dai relativi snapshot;
9. l'export manuale Firestore e la portabilità Markdown/asset sono documentati (RPO best-effort);
10. l'AI (V2) non genera domande e resta estranea ai moduli manuali.

---

## Appendice A — Decisioni residue (V2)

C-02 e C-03 riguardano il Modulo 5 (AI), spostato interamente alla V2; non bloccano la V1. Vedi `decisioni.md`.

| ID | Decisione | Stato |
|---|---|---|
| C-02 | Provider AI e modello di default. | Risolta (V2): OpenAI `gpt-4o-mini` o Anthropic Claude `claude-haiku-4-5-20251001`, chiave configurata dal docente. |
| C-03 | Regola didattica per correzione automatica. | Rinviata alla V2. |
