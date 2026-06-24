# SchoolForge — Registro delle decisioni

**Versione:** 1.2
**Stato:** indice piatto di tutte le decisioni di prodotto, requisiti e architettura
**Input vincolanti:** `brief.md`, `analisi-requisiti.md`, `architettura.md`

---

## 1. Scopo

Questa tabella raccoglie in un unico punto tutte le decisioni prese nei documenti di baseline. Ogni decisione mantiene la propria autorità nel documento di origine; qui se ne fornisce sintesi e stato corrente.

Legenda stato:

- ✅ **Chiusa** — decisione applicata alla baseline V1.
- ⏳ **V2** — decisione spostata alla roadmap futura (V2); non blocca la V1.

---

## 2. Decisioni di requisito (analisi-requisiti)

| ID | Titolo | Stato | Documento | Sintesi decisione |
|---|---|---|---|---|
| D-01 | Identità studente non verificata e limite digitale | ✅ Chiusa | analisi-requisiti.md | Lo studente dichiara nome e cognome (auto-dichiarati, non verificati); il canale digitale consente un tentativo per verifica e nome+cognome normalizzati. |
| D-02 | Indipendenza da Google Workspace | ✅ Chiusa | analisi-requisiti.md | Firebase Authentication gestisce l'accesso docente senza Google Workspace for Education. |
| D-03 | Nessun versioning del repository | ✅ Chiusa | analisi-requisiti.md | Import isolati con un solo `activeImportId` visibile; configurazione pubblicata e snapshot della consegna immutabili; non si versiona l'intero repository. |
| D-04 | Nessuna generazione AI di domande | ✅ Chiusa | analisi-requisiti.md | I pool Markdown sono l'unica fonte; l'AI resta confinata alla correzione (V2). |
| D-05 | Nessun invio email agli studenti | ✅ Chiusa | analisi-requisiti.md | Il canale cartaceo genera il PDF nel browser; nessun provider email. |
| D-06 | PDF ed export generati nel browser | ✅ Chiusa | analisi-requisiti.md | `@react-pdf/renderer` nel client; nessuna Cloud Function per i documenti. |
| D-07 | Classi come lista configurabile | ✅ Chiusa | analisi-requisiti.md | Lista classi gestita dal docente, usata in verifiche e portale. |
| D-08 | C-01 formalizzata | ✅ Chiusa | analisi-requisiti.md | Firebase, dati in `europe-west8`, RPO best-effort con export manuale, RTO best-effort. |
| D-09 | Kit di avvio e dashboard di prontezza | ✅ Chiusa | brief.md, analisi-requisiti.md | M1 include template scaricabili e dashboard su validità, pool e domande eleggibili; nessun editor o generazione contenuti. |

---

## 3. Decisioni architetturali (architettura)

| ID | Titolo | Stato | Documento | Sintesi decisione |
|---|---|---|---|---|
| ADR-01 | Firebase come piattaforma | ✅ Chiusa | architettura.md | Piattaforma gestita Firebase di proprietà del Docente. |
| ADR-02 | SPA unica con routing | ✅ Chiusa | architettura.md | Una sola app React con `/teacher/*` e `/exam/:token`. |
| ADR-03 | Gateway digitale e AI in Cloud Functions | ✅ Chiusa | architettura.md | M3 usa solo `startDigitalAttempt` e `continueDigitalAttempt`; AI resta in M5/V2. Il Portale non scrive tentativi direttamente. |
| ADR-04 | Firestore operativo, Storage canonico | ✅ Chiusa | architettura.md | Markdown/asset in Storage; Firestore per stato e dati operativi. |
| ADR-05 | Auth per il solo docente | ✅ Chiusa | architettura.md | `auth.uid == ownerUid` nelle Security Rules e server-side. |
| ADR-06 | Portale pubblico, lock partecipante e token sessione | ✅ Chiusa | architettura.md | Link non enumerabile; lock digitale per verifica e nome+cognome normalizzati; token sessione firmato server-side via cookie sicuro. |
| ADR-07 | Snapshot pubblicato e al tentativo | ✅ Chiusa | architettura.md | Snapshot privato di fonti/regole/candidati creato all'attivazione; snapshot con soluzioni private creato all'avvio digitale. |
| ADR-08 | PDF generati nel browser | ✅ Chiusa | architettura.md | Nessun PDF su server o Storage. |
| ADR-09 | Secret Manager solo per AI | ✅ Chiusa | architettura.md | Introdotto solo in M5 (V2) per la chiave API AI. |
| ADR-10 | Export globale da snapshot digitali | ✅ Chiusa | architettura.md | `Esporta verifiche` legge consegne definitive e snapshot. |
| ADR-11 | Visibilità atomica dell'import | ✅ Chiusa | architettura.md | Storage e indici sono preparati sotto `importId`; una transazione aggiorna `activeImportId` solo a import completo. |

---

## 4. Decisioni di esercizio

| ID | Titolo | Stato | Documento | Sintesi decisione |
|---|---|---|---|---|
| C-01 | Provider, regione, backup, RPO/RTO | ✅ Chiusa | brief.md | Firebase su progetto del Docente; dati in `europe-west8`; backup come redundancy Storage nativa più export Firestore manuale on-demand dalle impostazioni; RPO best-effort; RTO best-effort. |
| C-02 | Provider AI e modello di default | ⏳ V2 | brief.md | **Risolta per V2:** OpenAI API (default `gpt-4o-mini`) oppure Anthropic Claude API (default `claude-haiku-4-5-20251001`); il Docente configura la chiave API nelle impostazioni. Applica solo a M5. |
| C-03 | Regola didattica correzione automatica | ⏳ V2 | brief.md | Regola d'uso della modalità automatica AI; decisione rimandata alla V2 insieme a M5. |

---

## 5. Note

- C-02 e C-03 non sono più decisioni bloccanti della V1: appartengono al modulo M5, spostato interamente alla V2. Vedi `piano-implementazione.md`, sezione "V2 — Roadmap futura".
- Ogni decisione modificata in futuro deve aggiornare sia il documento di origine sia questa tabella.
