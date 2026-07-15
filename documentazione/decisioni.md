# SchoolForge — Registro delle decisioni

**Versione:** 1.3
**Stato:** indice piatto di tutte le decisioni di prodotto, requisiti e architettura
**Input vincolanti:** `brief.md`, `analisi-requisiti.md`, `architettura.md`

---

## 1. Scopo

Questa tabella raccoglie in un unico punto tutte le decisioni prese nei documenti di baseline. Ogni decisione mantiene la propria autorità nel documento di origine; qui se ne fornisce sintesi e stato corrente.

Legenda stato:

- ✅ **Chiusa** — decisione applicata alla baseline corrente (V1, inclusa M3-lite).
- ⏳ **V2** — decisione spostata alla roadmap futura (V2); non blocca la V1.
- ⏳ **Rinviata (M3-full)** — decisione che resta specifica valida ma si applica solo a M3-full (verifiche online con tentativi e consegna), fase successiva a M3-lite; non blocca M3-lite.

---

## 2. Decisioni di requisito (analisi-requisiti)

| ID | Titolo | Stato | Documento | Sintesi decisione |
|---|---|---|---|---|
| D-01 | Identità studente non verificata e limite digitale (M3-full, specifica rinviata) | ⏳ Rinviata (M3-full) | analisi-requisiti.md | Superata per M3-lite da D-11/D-12 (Google Auth). Lo studente dichiarerebbe nome e cognome (auto-dichiarati, non verificati); un eventuale canale di consegna online M3-full consentirebbe un tentativo per verifica e nome+cognome normalizzati. |
| D-02 | Indipendenza da Google Workspace | ✅ Chiusa | analisi-requisiti.md | Firebase Authentication gestisce l'accesso docente senza Google Workspace for Education. |
| D-03 | Nessun versioning del repository | ✅ Chiusa | analisi-requisiti.md | Import isolati con un solo `activeImportId` visibile; configurazione pubblicata e snapshot della consegna immutabili; non si versiona l'intero repository. |
| D-04 | Nessuna generazione AI di domande | ✅ Chiusa | analisi-requisiti.md | I pool Markdown sono l'unica fonte; l'AI resta confinata alla correzione (V2). |
| D-05 | Nessun invio email agli studenti | ✅ Chiusa | analisi-requisiti.md | Il canale cartaceo genera il PDF nel browser; nessun provider email. |
| D-06 | PDF ed export generati nel browser | ✅ Chiusa | analisi-requisiti.md | `@react-pdf/renderer` nel client; nessuna Cloud Function per i documenti. |
| D-07 | Classi come lista configurabile | ✅ Chiusa | analisi-requisiti.md | Lista classi gestita dal docente, usata in verifiche e portale. |
| D-08 | C-01 formalizzata | ✅ Chiusa | analisi-requisiti.md | Firebase, dati in `europe-west8` (target UE, regione storicamente decisa), RPO best-effort con export manuale, RTO best-effort. *(Nota HARD-F02: su DEV Storage/Function reali sono in `us-central1`; il target UE resta valido per PROD — vedi `evidenze/hard-01c-region-matrix.md`.)* |
| D-09 | Kit di avvio e dashboard di prontezza | ✅ Chiusa | brief.md, analisi-requisiti.md | M1 include template scaricabili e dashboard su validità, pool e domande eleggibili; nessun editor o generazione contenuti. |
| D-10 | Il Portale digitale (M3) è diviso in M3-lite e M3-full | ✅ Chiusa | brief.md, analisi-requisiti.md | M3-lite è il portale studente autenticato Google, read-only (Lezioni + Verifiche, solo download PDF studente). M3-full è la consegna online con tentativi, lock, gateway server-side e viene rinviata a una fase successiva. M3-lite precede M3-full nella roadmap. |
| D-11 | Studenti autenticati con Google, nessun account custom | ✅ Chiusa | brief.md, analisi-requisiti.md | Da M3-lite gli studenti accedono con Firebase Authentication provider Google, sia con account Google personali sia con Google Workspace for Education. Nessuna registrazione interna, nessuna email inviata dal sistema, nessun account SchoolForge separato. Sostituisce l'impostazione precedente di nome+cognome autodichiarati e link pubblico anonimo per l'accesso in lettura di M3-lite; il modello autodichiarato/anonimo resta descritto solo come specifica di M3-full, non ancora deciso se sarà mantenuto. |
| D-12 | Risoluzione del ruolo utente | ✅ Chiusa | architettura.md, analisi-requisiti.md | Un utente Google autenticato con `uid == ownerUid` entra nel portale docente (TeacherShell). Ogni altro utente Google autenticato entra nel portale studente (StudentShell) in sola lettura. Non esiste accesso anonimo in M3-lite. Il mapping classi/studenti è implementato nel portale studenti; l'allowlist di dominio Google resta una possibile estensione futura. |
| D-13 | Visibilità delle verifiche separata dallo stato | ✅ Chiusa | analisi-requisiti.md, architettura.md | Ogni verifica ha uno stato (`bozza`/`attiva`/`chiusa`/`archiviata`) e un campo `visibility` (`hidden`/`public`) indipendente. All'attivazione `visibility` parte da `hidden`; il docente può pubblicare/nascondere una verifica attiva più volte. Solo le verifiche `attiva` + `public` sono visibili nel portale studente. |
| D-14 | Repository Editor come prossima fase | ✅ Chiusa | repository-editor-roadmap.md, analisi-requisiti.md | Dopo M3-lite, il prossimo sviluppo utile è un editor minimale Markdown-first per creare/modificare/eliminare/riordinare UDA e lezioni, inclusi front matter e corpo Markdown. Restano esclusi editor WYSIWYG complesso, pool editor iniziale, AI, Cloud Functions e consegna online. |

---

## 3. Decisioni architetturali (architettura)

| ID | Titolo | Stato | Documento | Sintesi decisione |
|---|---|---|---|---|
| ADR-01 | Firebase come piattaforma | ✅ Chiusa | architettura.md | Piattaforma gestita Firebase di proprietà del Docente. |
| ADR-02 | SPA unica con routing | ✅ Chiusa | architettura.md | Una sola app React con `/teacher/*` (docente) e `/student/*` (studente, M3-lite), entrambe autenticate. Il vecchio `/exam/:token` pubblico anonimo non è mai stato implementato e resta solo specifica di un eventuale M3-full. |
| ADR-03 | Nessuna Cloud Function per M3-lite | ✅ Chiusa | architettura.md | M3-lite legge Firestore/Storage solo con Security Rules, senza Cloud Functions. Le Functions restano riservate ad AI (M5/V2) e a un eventuale gateway M3-full (`startDigitalAttempt`/`continueDigitalAttempt`, specifica rinviata). |
| ADR-04 | Firestore operativo, Storage canonico | ✅ Chiusa | architettura.md | Markdown/asset in Storage; Firestore per stato e dati operativi. |
| ADR-05 | Auth per il docente, Google Auth per lo studente da M3-lite | ✅ Chiusa | architettura.md | `auth.uid == ownerUid` nelle Security Rules e server-side per il docente. Da M3-lite, ogni altro utente Google autenticato (account personale o Google Workspace for Education) è risolto come studente read-only; nessun account studente custom, nessuna email. |
| ADR-06 | M3-full: portale pubblico anonimo, lock partecipante e token sessione (specifica rinviata) | ⏳ Rinviata (M3-full) | architettura.md | Link non enumerabile; lock digitale per verifica e nome+cognome normalizzati; token sessione firmato server-side via cookie sicuro. Resta la specifica dell'eventuale canale M3-full con consegna online; non è la modalità di accesso di M3-lite, che usa Google Auth. |
| ADR-06b | M3-lite: ruolo risolto da Google Auth, nessun link pubblico anonimo | ✅ Chiusa | architettura.md | Il portale studente M3-lite non usa token pubblici né dati autodichiarati: l'accesso richiede login Google e il ruolo è risolto confrontando `uid` con `ownerUid`. |
| ADR-07 | Snapshot pubblicato e al tentativo (M3-full) | ⏳ Rinviata (M3-full) | architettura.md | Snapshot privato di fonti/regole/candidati creato all'attivazione; snapshot con soluzioni private creato all'avvio digitale. Riguarda solo la consegna online di M3-full; M3-lite riusa la proiezione pubblica già introdotta in M2 per il download del PDF studente. |
| ADR-08 | PDF generati nel browser | ✅ Chiusa | architettura.md | Nessun PDF su server o Storage, in nessun canale (cartaceo, M3-lite o M3-full). |
| ADR-09 | Secret Manager solo per IA | ✅ Chiusa | architettura.md | Introdotto solo in M5 (dal pacchetto M5-01) per la chiave API del provider IA, letta unicamente dalla Cloud Function `aiCorrectionRun`. |
| ADR-10 | Export globale da snapshot digitali (M3-full → M4) | ⏳ Rinviata (M3-full) | architettura.md | `Esporta verifiche` legge consegne definitive e snapshot; richiede consegne digitali di M3-full, non prodotte da M3-lite. |
| ADR-11 | Visibilità atomica dell'import | ✅ Chiusa | architettura.md | Storage e indici sono preparati sotto `importId`; una transazione aggiorna `activeImportId` solo a import completo. |
| ADR-12 | Proiezioni read-only per lo studente (M3-lite) | ✅ Chiusa | architettura.md | Lo studente non legge mai i documenti tecnici del docente (`lessons` con `poolPath`, `questionIndex`, `publishedSnapshot`). Legge solo proiezioni pubbliche dedicate senza pool, soluzioni o percorsi tecnici sensibili. |
| ADR-13 | Nessuna Cloud Function per M3-lite | ✅ Chiusa | architettura.md | M3-lite è realizzato con sole Security Rules e letture client Firestore/Storage; non introduce Cloud Functions. Il gateway Cloud Functions resta confinato a un eventuale M3-full e a M5 (V2). |

---

## 4. Decisioni di esercizio

| ID | Titolo | Stato | Documento | Sintesi decisione |
|---|---|---|---|---|
| C-01 | Provider, regione, backup, RPO/RTO | ✅ Chiusa | brief.md | Firebase su progetto del Docente; dati in `europe-west8` (target UE deciso storicamente); backup come redundancy Storage nativa più export Firestore manuale on-demand dalle impostazioni; RPO best-effort; RTO best-effort. *(Nota HARD-F02: su DEV Storage/Function sono in `us-central1`, mentre Firestore è stata verificata in `europe-west8`; il target UE resta valido per PROD — `evidenze/hard-01c-region-matrix.md`.)* |
| C-02 | Provider IA e modello | ⏳ **Aperta (Human Gate M5)** | brief.md, m5-ai-assisted-roadmap.md | Contratto **provider-agnostic** (M5-00): provider e modello **non sono fissati**; vanno confermati dal Docente verificando disponibilità e costo attuali sulla documentazione ufficiale, senza adottare come default un modello potenzialmente obsoleto. Comprende anche i tetti di spesa (budget per operazione, budget giornaliero) e la retention dei metadati di audit — HG-M5-1..4. Applica solo a M5. |
| C-03 | Regola didattica correzione automatica | ⏳ Rinviata (G8) | brief.md | Regola d'uso della modalità automatica IA; **fuori** dalla linea M5-00→M5-05 (correzione assistita). Rimandata a un eventuale Gate G8. |

---

## 5. Note

- C-02 e C-03 non sono più decisioni bloccanti della V1: appartengono al modulo M5, spostato interamente alla V2. Vedi `piano-implementazione.md`, sezione "V2 — Roadmap futura".
- Il Modulo 3 (Portale digitale) è diviso in **M3-lite** (portale studente Google, read-only: Lezioni + Verifiche, solo download PDF studente) e **M3-full** (verifiche online con tentativi, consegna, lock, eventuale gateway server-side). M3-lite è il prossimo passo dopo l'MVP docente cartaceo (M1+M2); M3-full segue M3-lite. Il Modulo 4 (Correzione ed export) dipende dalle consegne digitali prodotte da M3-full, non da M3-lite.
- Ogni decisione modificata in futuro deve aggiornare sia il documento di origine sia questa tabella.
