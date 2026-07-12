# Gate G5 — M3-full: checklist finale di chiusura

**Data:** 12 luglio 2026
**Ambito:** M3F-00 → M3F-11C, PERF-SEC-01A, PERF-SEC-01B-1 → 01B-4, fix snapshot immutabile `teacherSnapshot.questions` (SEC-02).
**Verdetto:** **Gate G5 superato.**

Questo documento consolida le evidenze già prodotte (automatiche, da CI/test, e manuali, da smoke DEV del docente) senza introdurre nuove funzionalità né nuove misurazioni. Non sostituisce `m3-full-roadmap.md §8` (definizione del gate) né `performance-security-audit.md` (audit prestazioni/costi/sicurezza): li richiama e ne riporta l'esito.

## Legenda

- **Automatica** — evidenza da test automatici (unit/integration/Rules Emulator) verdi in CI, verificabile riproducendo i comandi indicati.
- **Manuale DEV** — confermata manualmente dal docente su ambiente Firebase DEV (https://schoolforge-dev.web.app), non ripetuta in automatico in questa checklist.
- **Non verificato tramite Firebase Console** — l'aspetto esiste a livello di codice/test ma il dato di costo/utilizzo reale in Firebase Console non è stato misurato: limite residuo dichiarato esplicitamente, non un fallimento del gate.
- **Fuori scope** — esplicitamente escluso da M3-full (vedi `m3-full-roadmap.md §9`) o rimandato (M4/M5).

## Criteri minimi

| # | Criterio | Categoria | Evidenza |
|---|---|---|---|
| 1 | Avvio verifica online | Automatica + Manuale DEV | Test `submissionsService`/`OnlineExamView` (avvio bozza su verifica `active`+`onlineEnabled`); confermato manualmente dal docente su DEV. |
| 2 | Submission unica e deterministica | Automatica | Path deterministico `submissions/{verificationId}_{studentUid}`; test Rules M3F-03 (unicità, creazione solo sul path corretto). |
| 3 | Autosave dirty-only 120s | Automatica | Test mirati M3F-11B (`OnlineExamView`): timer 120s, nessuna write su bozza invariata, revision guard. |
| 4 | Eventi soli senza write | Automatica | Test mirati M3F-11B: un evento attenzione da solo resta in memoria, persistito solo al prossimo save dovuto o alla consegna. |
| 5 | Cap 200 client+Rules | Automatica | Test `examDeterrence`/`OnlineExamView` (limite client a 200 voci); `firestore.rules` impone `attentionEvents.size() <= 200` sia su create sia su update; test Rules M3F-03 accetta 200 eventi e rifiuta 201. |
| 6 | Ripresa dopo refresh/login | Automatica + Manuale DEV | Test M3F-06 (`examSessionService`, `StudentShell`): una bozza `draft` forza il rientro nella prova; confermato manualmente dal docente su DEV dopo refresh e nuovo login. |
| 7 | Shell senza navigazione durante la prova | Automatica + Manuale DEV | Test M3F-06 (`StudentShell` non mostra menu/uscita durante sessione attiva); confermato manualmente su DEV. |
| 8 | Fullscreen e rientro fullscreen | Automatica + Manuale DEV | Test M3F-04/M3F-06/M3F-11A (richiesta fullscreen, evento `fullscreen_exit`, pulsante di rientro); confermato manualmente su DEV. |
| 9 | Consegna atomica con receipt | Automatica | Test `submissionsService`/Rules M3F-03: consegna = update submission a `submitted` + create receipt, verificata come operazione atomica lato client (`writeBatch`) e vincolata da Rules. |
| 10 | Submission immutabile | Automatica | Test Rules M3F-03: nessun update consentito quando `status == 'submitted'`, nemmeno dallo stesso studente. |
| 11 | Studente post-consegna vede solo conferma | Automatica | Test Rules M3F-03: lettura della submission negata allo studente dopo `submitted`; lettura consentita solo su `submissionReceipts/{id}`. |
| 12 | Monitor docente | Automatica + Manuale DEV | Test `submissionsMonitorService`/`VerificationsView` (M3F-05/M3F-09): un solo listener `onSnapshot` per verifica selezionata; confermato in tempo reale manualmente su DEV. |
| 13 | Dialog eventi | Automatica | Test `AttentionEventsDialog` (M3F-09/M3F-11C): tabella `Ora | Evento | Dettaglio`, mai `answers`/`flagged`, accessibile (focus trap, Escape, backdrop). |
| 14 | Modalità verifica e blocco lezioni | Automatica + Manuale DEV | Test Rules M3F-07/M3F-08 (`examModeAppliesToClass`, gate su `programs`/`publicLessons`); confermato manualmente su DEV che le lezioni scompaiono per la classe bloccata. |
| 15 | Chiusura verifica | Automatica | Test `verificationsService`/Rules: `closeVerification` nega nuove submission e aggiornamenti bozza; submission già `submitted` resta accessibile in lettura al docente. |
| 16 | Snapshot domande/soluzioni immutabile | Automatica | Test `verificationsService`/`verificationSnapshotMappers` (fix SEC-02): `teacherSnapshot.questions` scritto una sola volta all'attivazione, mai modificabile via Rules successive; `publishedProjection` non contiene mai soluzioni. |
| 17 | PDF active/closed senza Storage per nuove verifiche | Automatica | Test `VerificationsView`/`verificationPdf` (SEC-02): PDF normale e con soluzioni generati da `teacherSnapshot.questions` per le verifiche con snapshot presente, zero letture Storage. |
| 18 | Fallback legacy documentato | Automatica | Test `verificationPdf` per verifiche attivate prima del fix (senza `questions`): fallback esplicito al percorso Storage legacy, nessuna migrazione automatica forzata. |
| 19 | Query e listener hardening | Automatica | Test PERF-SEC-01B-3 (`countPendingStudents` con `getCountFromServer`, guard cancellazione con query mirate `config.programId`/`config.importId`); test M3F-09/11A (un solo listener monitor, indice composito `verifications(ownerUid,status,onlineEnabled)`). |
| 20 | Atomicità parent/proiezione | Automatica | Test PERF-SEC-01B-1 (`setVerificationVisibility`/`closeVerification` via `writeBatch` singolo); M3F-09 (`setVerificationStudentPdfEnabled` atomico). |
| 21 | Pool batching | Automatica | Test PERF-SEC-01B-2 (`savePool` con `writeBatch` in chunk da max 400 mutazioni). |
| 22 | Letture mirate | Automatica | Test PERF-SEC-01B-3 (guard cancellazione con query filtrate invece di scan completo di `verifications`). |
| 23 | Code-splitting per ruolo | Automatica | `pnpm build` (PERF-SEC-01B-4): entry iniziale da 1 194.56 KB a 647.00 KB minificati (-45.8%), da 323.04 KB a 164.65 KB gzip (-49.0%); `TeacherShell`/`StudentShell` `React.lazy` al confine ruolo; jsPDF/html2canvas restano lazy invariati. |
| 24 | Rules Firestore/Storage | Automatica | `pnpm test:rules` (suite Emulator Firestore + Storage) verde sull'ultimo stato di `main` per ogni pacchetto M3F/PERF-SEC che ha toccato Rules (M3F-03, M3F-07, M3F-08, M3F-09). Non rieseguita in questa PR, che non tocca Rules. |
| 25 | Nessun P0 aperto | Automatica | `performance-security-audit.md §6`: nessun finding P0 rilevato dall'audit PERF-SEC-01A; tutti i P1 approvati risolti in PERF-SEC-01B (vedi §"Findings"). |
| 26 | Nessuna Cloud Function necessaria | Automatica (per costruzione) | Tutte le operazioni M3-full (submissions, receipt, monitor, modalità verifica) sono scritture client dirette validate da Security Rules, come da D-M3F-01/§3.3 di `m3-full-roadmap.md`; nessun `functions/` deploy richiesto da M3-full. |

## Limiti residui

- **Costi Firebase reali (Firebase Console) non misurati.** Le stime di `performance-security-audit.md §5` (scenari A/B/C) sono analitiche, basate su conteggio letture/scritture nel codice; non sono state confrontate con i numeri effettivi di Firebase Console durante uno smoke DEV con più studenti simultanei. Limite residuo dichiarato, non un fallimento del gate — nessun'operazione fuori dai limiti gratuiti/Blaze minimi è stata identificata nell'audit.
- **Nessun test multi-browser/multi-device automatizzato.** Lo smoke DEV è stato eseguito manualmente dal docente sul proprio ambiente; non è stata condotta una matrice browser/dispositivo sistematica. Non dichiarato come test eseguito.
- **PERF-01 (storico verifiche) esplicitamente rimandato**, con soglia di rivalutazione documentata in `performance-security-audit.md`, non bloccante per G5 (P2, non P0/P1).
- **PERF-03, PERF-07** (vedi `performance-security-audit.md §6`) non ancora affrontati — P2/P3, non bloccanti per G5 secondo il gate prestazioni/sicurezza definito in `piano-implementazione.md §11`.

## Esito

Tutti i criteri minimi del Gate G5 (`m3-full-roadmap.md §8`) sono coperti da evidenza automatica e/o conferma manuale DEV. Nessun P0 aperto. I finding P1 approvati dell'audit PERF-SEC-01A sono risolti in PERF-SEC-01B-1 → 01B-4. **Gate G5 dichiarato superato.** M3-full è considerato completo; il prossimo modulo pianificato è M4 (non implementato); M5/AI resta rinviato alla V2.
