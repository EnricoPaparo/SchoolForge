# SchoolForge — Sequence: Pubblicazione ed esportazione di una Verifica

**Versione:** 1.0
**Data:** 22 giugno 2026
**Riferimento:** [Architettura v1.0](../architettura.md), sezione 8.4

---

## Flusso completo: composizione → pubblicazione → PDF

```mermaid
sequenceDiagram
    actor D as Docente
    participant W as Web app
    participant CF as Cloud Functions (backend)
    participant FS as Firestore

    D->>W: avvia nuova verifica, seleziona UDA e/o Lezioni
    W->>CF: createExamDraft({ sourceLessonIds, sourceUdaIds, configuration })
    CF->>FS: legge questionIndex filtrando per tipo/difficoltà
    CF->>CF: deduplica lezioni, verifica disponibilità corpus
    CF->>FS: crea documento `exams/{examId}` con status: 'bozza'
    CF->>FS: scrive audit event EXAM_DRAFT_CREATED
    CF-->>W: { examId, availableQuestions, shortfall? }

    W->>D: mostra domande disponibili e fabbisogno non coperto (se presente)

    D->>W: seleziona e approva le domande, aggiunge soluzioni/rubriche mancanti
    W->>CF: composeExam({ examId, items: [...] })
    CF->>CF: verifica che ogni item abbia prompt, tipo, maxScore
    CF->>FS: aggiorna `exams/{examId}` con la composizione corrente
    CF-->>W: { status: 'in_revisione', completenessCheck }

    W->>D: mostra anteprima della verifica con check di completezza

    alt la verifica è completa (nessun item mancante)
        D->>W: clicca "Pubblica" e conferma esplicita
        W->>CF: publishExam({ examId, confirmation: true })

        note over CF,FS: Transazione Firestore
        CF->>FS: legge `exams/{examId}` e verifica stato 'pronta'
        CF->>CF: verifica completezza: soluzioni, rubriche, maxScore per ogni item
        CF->>FS: crea documenti in `exams/{examId}/items/{itemId}` per ogni domanda
        CF->>FS: aggiorna `exams/{examId}` → status: 'pubblicata', publishedAt
        CF->>FS: scrive audit event EXAM_PUBLISHED

        CF-->>W: { examId, publishedAt }
        W->>D: verifica pubblicata; contenuto ora immutabile

    else la verifica non è completa
        CF-->>W: { code: 'PRECONDITION_FAILED', details: { missingSolutions, missingRubrics } }
        W->>D: mostra item incompleti; pubblica bloccata fino a completamento
    end

    D->>W: richiede PDF della prova
    W->>CF: generatePdf({ examId, type: 'exam' })
    CF->>FS: legge snapshot da `exams/{examId}/items/` (non dal Markdown corrente)
    CF->>CF: genera PDF dalla rappresentazione snapshot
    CF->>FS: crea documento `artifacts/{artifactId}` con hash e metadati
    CF-->>W: { artifactId, downloadUrl }
    W->>D: download PDF prova (senza soluzioni)

    D->>W: richiede PDF soluzione
    W->>CF: generatePdf({ examId, type: 'solution' })
    CF->>FS: legge stesso snapshot
    CF->>CF: genera PDF con soluzioni e chiavi
    CF-->>W: { artifactId, downloadUrl }
    W->>D: download PDF soluzione

    D-->>D: carica manualmente i PDF su Google Drive istituzionale
    D->>W: registra link Drive
    W->>CF: recordDriveArtifact({ examId, type: 'exam_pdf', driveUrl, driveFileId })
    CF->>FS: aggiorna `artifacts/{artifactId}` con driveUrl e driveFileId
    CF-->>W: { artifactId }
```

---

## Flusso alternativo: sostituzione Lezione dopo pubblicazione

```mermaid
sequenceDiagram
    actor D as Docente
    participant W as Web app
    participant CF as Cloud Functions (backend)
    participant SR as Cloud Storage (repository/current)
    participant FS as Firestore

    note over D: La Verifica V1 è già pubblicata
    D->>W: sostituisce la Lezione L1 (fonte di V1) con una nuova versione

    W->>CF: replaceLesson({ lessonId: 'L1', importId, confirmation: true })
    CF->>SR: sovrascrive repository/current/lessons/L1/source.md
    CF->>FS: aggiorna `lessons/L1` e `questionIndex`

    note over FS: exams/V1/items/* NON vengono toccati

    CF-->>W: { lessonId: 'L1', validationStatus: 'valid' }
    W->>D: repository aggiornato; la Verifica V1 è invariata

    D->>W: apre la Verifica V1 pubblicata
    W->>CF: richiede dati Verifica V1
    CF->>FS: legge `exams/V1` e `exams/V1/items/*`
    note over CF: I dati letti sono lo snapshot, non il Markdown corrente
    CF-->>W: contenuto originale della Verifica al momento della pubblicazione
    W->>D: visualizza la Verifica V1 con le domande originali (non modificate)
```

---

## Garanzia di immutabilità

Lo snapshot in `exams/{examId}/items/` viene creato **una sola volta**, al momento della pubblicazione, in una transazione Firestore atomica. Dopo la pubblicazione:

| Operazione | Effetto sullo snapshot |
|---|---|
| Sostituzione della Lezione fonte | Nessuno |
| Eliminazione della Lezione fonte | Nessuno |
| Modifica del `questionIndex` | Nessuno |
| Tentativo di modifica dell'exam item tramite API | Rifiutato con `PRECONDITION_FAILED` |
| Rollback del codice applicativo | Lo snapshot rimane in Firestore; nessun re-processing |

L'unico modo di "modificare" una verifica pubblicata è creare una nuova verifica.
