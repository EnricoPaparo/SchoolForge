# Gate G6 — M4 (Correzione ed export): checklist finale di chiusura

**Data:** 15 luglio 2026
**Ambito:** M4-00, M4-01, M4-02, M4-02B, M4-LIFE-01, M4-LIFE-02, M4-MON-01, M4-03A, M4-03B e l'integrazione finale M4-04. Ultimi fix inclusi: PR #170 (completamento senza falso errore, merge `1e81cdc`) e PR #173 (rifinitura parità studente/correzioni + larghezze colonne PDF, merge `9ec72f6`). La PR #173 è una rifinitura UI/PDF (CSS di `StudentCorrectionView`/`CorrectionWorkspace`/`VerificationsView` e larghezze/`wrap` delle colonne del PDF): non cambia le colonne, i campi esportati né le categorie di evidenza qui elencate; i test mirati M4 restano verdi e coprono anche la modifica al renderer PDF.
**Verdetto:** **Gate G6 superato.**

Questo documento consolida le evidenze già prodotte — automatiche (CI/test) e manuali (smoke DEV del docente) — senza introdurre nuove funzionalità né nuove misurazioni. Richiama `m4-correzione-ux-concept.md` (concept e §10 decisioni) e non lo sostituisce.

## Legenda

- **Automatica** — evidenza da test automatici (unit/integration/Rules Emulator) verdi in CI, riproducibile con i comandi indicati.
- **Manuale DEV** — confermata manualmente dal docente su Firebase DEV. In questo gate **solo quattro flussi** sono stati dichiarati confermati manualmente (vedi §Conferme manuali DEV); nessun'altra conferma manuale è stata inventata.
- **Fuori scope** — esplicitamente escluso da M4 (vedi §Fuori scope).

## Conferme manuali DEV dichiarate dal docente

Il docente ha confermato manualmente su DEV **esclusivamente** questi flussi:

1. **Salvataggio della correzione** funzionante.
2. **Completamento della correzione** funzionante.
3. **PDF del riepilogo** funzionante.
4. **CSV del riepilogo** funzionante.

Tutti gli altri flussi elencati sotto poggiano su **evidenza automatica**; non sono stati dichiarati come confermati manualmente e non vengono qui presentati come tali.

## Matrice delle evidenze — flusso M4

| # | Flusso | Categoria | Evidenza |
|---|---|---|---|
| 1 | Consegna studente (prerequisito M3-full) | Automatica + Manuale DEV (G5) | Path deterministico `submissions/{verificationId}_{studentUid}`, consegna atomica + receipt; test `submissionsService`/Rules M3F-03 e `StudentVerificationsView`. Già coperto e superato dal Gate G5. |
| 2 | Apertura della correzione docente | Automatica | `openOrLoadCorrection` idempotente (crea una sola `corrections/{id}` da `publishedProjection`, mai dal pool); test `correctionsService` + `correctionWorkspaceLoader` + `CorrectionWorkspace`. |
| 3 | Salvataggio parziale | **Automatica + Manuale DEV** | `saveCorrection` (validazione, normalizzazione, no-op se invariato, un solo `updateDoc` al primo giro); test `correctionsService`/`CorrectionWorkspace` + integrazione emulatore `m4-correction-save.integration.rules`. **Confermato manualmente su DEV.** |
| 4 | Punteggi a incrementi di 0,25 | Automatica | `correctionContract` (`isQuarterPointStep`, `normalizeQuestionPoints`, `parseQuestionPointsInput` virgola/punto, range `[0,maxPoints]`); test dedicati + stepper in `CorrectionWorkspace`. |
| 5 | Domande aperte, chiuse singole e multiple | Automatica | Rendering risposta/soluzione per i tre tipi in `CorrectionWorkspace`; mappers snapshot. |
| 6 | Soluzioni multiple complete | Automatica | `chiusa_multipla` conserva l'array completo lungo `pool → snapshot → loader → UI`; test `verificationSnapshotMappers` + `CorrectionWorkspace` (tutte le corrette marcate, sezione Soluzione completa). |
| 7 | Completamento | **Automatica + Manuale DEV** | `completeCorrection` (rifiuta mappa incompleta), gate UI; test `correctionsService`/`CorrectionWorkspace` + fix PR #170 (nessun falso errore al completamento). **Confermato manualmente su DEV.** |
| 8 | Riapertura e rettifica | Automatica | `reopenCorrection` (incrementa `reopenCount`, evento `reopened`); rettifica dopo riapertura → evento `scoreAdjusted` con delta minimale; test `correctionsService` + Rules M4-01. |
| 9 | Restituzione | Automatica | `returnCorrection` (`completed → returned`, proiezione `correctionReturns` autosufficiente, `points` sempre `number`); test `correctionsService` + Rules M4-01. |
| 10 | Visibilità studente e visibilità soluzioni | Automatica | `setReturnVisibleToStudent`/`setSolutionsVisible` (guard `status == 'returned'`, `correctAnswer` aggiunto/rimosso fisicamente); test `correctionsService` + Rules M4-01. |
| 11 | Lettura della correzione lato studente | Automatica | `studentCorrectionReturnsService` (sola query `correctionReturns` propria, mai `corrections`) + `StudentCorrectionView`; Rules: lettura solo se `studentUid` proprio **e** `visibleToStudent == true`. |
| 12 | Eliminazione sicura della consegna | Automatica | `deleteSubmissionData` (dipendenti prima, submission+receipt per ultimi, idempotente, chunk ≤400, audit non identificativo); test `deleteSubmissionData` + Rules Emulator `m4-life-02-delete` (owner/studente/cross-owner). |
| 13 | Blocco eliminazione verifica con consegne | Automatica | Guard applicativo `deleteVerification` (`where verificationId== limit(1)`, nessuna scrittura se esiste una submission); test `verificationsService`. |
| 14 | Registro Correzioni | **Automatica + Manuale DEV (via export)** | La tabella Consegne online è il Registro (nessuna popup/tabella duplicata); test `VerificationsView`. Consultazione confermata indirettamente dal docente tramite gli export PDF/CSV funzionanti. |
| 15 | Ordinamento tabella | Automatica | `submissionMonitorSort` (ordinamento stabile, mancanti in fondo, entrambe le direzioni, in memoria) + integrazione `VerificationsView`. |
| 16 | Export CSV | **Automatica + Manuale DEV** | `correctionRegisterExport` (UTF-8/BOM, `;`, decimali IT, escaping, protezione formula, solo campi non sensibili) + handler `VerificationsView` (righe correnti, nessuna nuova lettura). **Confermato manualmente su DEV.** |
| 17 | Export PDF | **Automatica + Manuale DEV** | `correctionRegisterPdf` (A4 landscape, jsPDF via import dinamico, stesse righe ordinate, intestazione+conteggi, tabella multipagina con header ripetuto e footer, punteggi in formato IT, `—` per mancanti, zero righe valido) + handler `VerificationsView`. **Confermato manualmente su DEV.** |

**Comandi di riproduzione dell'evidenza automatica:**

```
pnpm --filter @schoolforge/web exec vitest run \
  src/features/repository/corrections/ \
  src/features/repository/verifications/__tests__/deleteSubmissionData.test.ts \
  src/features/repository/verifications/__tests__/submissionMonitorSort.test.ts \
  src/features/repository/verifications/__tests__/verificationsService.test.ts \
  src/features/teacher/__tests__/CorrectionWorkspace.test.tsx \
  src/features/teacher/__tests__/VerificationsView.test.tsx \
  src/features/student/__tests__/StudentCorrectionView.test.tsx \
  src/features/student/__tests__/studentCorrectionReturnsService.test.ts
# → 321 test verdi (12 file)
pnpm test:rules   # include m4-01-corrections, m4-life-02-delete, m4-correction-save integration
```

## Limiti residui

- **Copertura manuale DEV parziale.** Solo salvataggio, completamento, PDF e CSV sono stati confermati manualmente. Riapertura, rettifica, restituzione, visibilità/soluzioni, lettura studente ed eliminazione consegna poggiano su evidenza automatica (unit + Rules Emulator) e **non** su smoke manuale. Sono ben coperti dai test; uno smoke manuale su DEV di questi flussi è **consigliato ma non bloccante** per il gate (vedi §Smoke manuale consigliato).
- **Test Rules richiede l'emulatore** (`pnpm test:rules`, occasionalmente un test di import va in timeout sotto carico CI: flaky infrastrutturale, non un difetto M4 — rerun verde).
- **Numeri decimali PDF/CSV**: formato italiano con virgola; nessun raggruppamento migliaia (voluto).

## Smoke manuale consigliato (non bloccante)

Flussi coperti da test ma non ancora confermati manualmente su DEV — utili come verifica futura, **non** richiesti per G6:

1. Riapri una correzione completata → torna «In correzione»; la restituzione eventuale si nasconde subito allo studente.
2. Restituisci una correzione completata → lo studente vede il risultato; attiva «Mostra soluzioni» → compaiono; disattiva → spariscono.
3. Elimina una consegna su verifica **chiusa** con conferma → riga rimossa; tentata eliminazione della verifica con consegne → bloccata.

## Fuori scope (esplicitamente escluso da M4 / rinviato)

- **Export Markdown**: rinviato perché duplicativo e privo di un caso d'uso concreto (CSV per elaborare i dati, PDF per consultazione/stampa). H-04 risolta di conseguenza.
- **Correzione assistita da AI e correzione automatica (M5)**: **non implementate**, rinviate alla V2 (gate G7/G8 — vedi §Numerazione gate in `piano-implementazione.md`).
- **Azioni batch** su più correzioni (es. «mostra soluzioni a tutta la classe»): fuori scope M4-01.
- **Registro Correzioni come popup separata / voto elettronico**: deliberatamente non implementati (la tabella Consegne online è il Registro).

## Verdetto

Ogni punto del flusso M4 ha **evidenza automatica** verde; i quattro flussi core dichiarati sono **confermati manualmente su DEV**. Non emergono gap reali. **M4-04 completato, Gate G6 (M4 — Correzione ed export) superato.** M5/AI resta **non implementato**.
