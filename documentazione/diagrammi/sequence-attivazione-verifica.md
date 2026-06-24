# SchoolForge — Sequence: Attivazione di una Verifica e PDF docente

**Versione:** 2.0
**Data:** 24 giugno 2026
**Riferimento:** [Architettura v2.0](../architettura.md), sezioni 9.3 e 9.4

In v2.0 una Verifica passa da `bozza` ad `attiva` una sola volta; all'attivazione il backend congela lo snapshot in `exams/{examId}/items`. Il PDF docente è generato on-demand e **mai conservato**. Non esistono PDF di soluzione/rubrica né registrazione di artefatti su Drive.

---

## Flusso completo: composizione → attivazione → PDF docente

```mermaid
sequenceDiagram
    actor D as Docente
    participant W as Web app
    participant CF as Cloud Functions (backend)
    participant FS as Firestore

    D->>W: avvia nuova verifica, seleziona UDA e/o Lezioni
    W->>CF: createExamDraft({ sourceLessonIds, sourceUdaIds, configuration })
    CF->>FS: legge questionIndex filtrando per tipo/difficoltà/peso
    CF->>CF: deduplica lezioni, verifica disponibilità corpus e minimi
    CF->>FS: crea documento `exams/{examId}` con status: 'bozza'
    CF->>FS: scrive audit event EXAM_DRAFT_CREATED
    CF-->>W: { examId, availableQuestions, shortfall? }

    W->>D: mostra domande disponibili e fabbisogno non coperto (se presente)

    D->>W: seleziona e approva le domande dal pool
    W->>CF: composeExam({ examId, items: [...] })
    CF->>CF: verifica che ogni item abbia testo, tipo, soluzione, punteggio max
    CF->>FS: aggiorna `exams/{examId}` con la composizione corrente
    CF-->>W: { status: 'bozza', completenessCheck }

    W->>D: mostra anteprima con check di completezza

    alt la verifica è completa
        D->>W: clicca "Attiva" e conferma esplicita
        W->>CF: activateExam({ examId, confirmation: true })

        note over CF,FS: Transazione Firestore
        CF->>CF: verifica completezza (soluzioni, punteggi max, almeno una domanda)
        CF->>FS: crea `exams/{examId}/items/{itemId}` per ogni domanda (snapshot)
        CF->>FS: aggiorna `exams/{examId}` → status: 'attiva', activatedAt
        CF->>FS: se variante 'tutte_uguali', fissa il seed
        CF->>FS: scrive audit event EXAM_ACTIVATED

        CF-->>W: { examId, activatedAt }
        W->>D: verifica attiva; contenuto ora immutabile; link Portale disponibile

    else la verifica non è completa
        CF-->>W: { code: 'PRECONDITION_FAILED', details: { missingSolutions, missingMaxScores } }
        W->>D: mostra item incompleti; attivazione bloccata fino a completamento
    end

    D->>W: richiede PDF docente
    W->>CF: generatePdfDocente({ examId })
    CF->>FS: legge snapshot da `exams/{examId}/items/` (non dal Markdown corrente)
    CF->>CF: genera PDF on-demand (intestazione vuota compilabile, no data, no soluzioni)
    CF-->>W: stream PDF (base64)
    note over CF: nessuna scrittura su Storage; nessun record burned creato per il docente
    W->>D: download PDF docente
```

---

## Flusso alternativo: sostituzione Lezione dopo l'attivazione

```mermaid
sequenceDiagram
    actor D as Docente
    participant W as Web app
    participant CF as Cloud Functions (backend)
    participant SR as Cloud Storage (repository/current)
    participant FS as Firestore

    note over D: La Verifica V1 è già attiva
    D->>W: sostituisce la Lezione L1 (fonte di V1) con una nuova versione

    W->>CF: replaceLesson({ lessonId: 'L1', importId, confirmation: true })
    CF->>SR: sovrascrive i file correnti della Lezione L1
    CF->>FS: aggiorna `lessons/L1` e `questionIndex`

    note over FS: exams/V1/items/* NON vengono toccati

    CF-->>W: { lessonId: 'L1', validationStatus: 'valid' }
    W->>D: repository aggiornato; la Verifica V1 è invariata

    D->>W: apre la Verifica V1 attiva
    W->>CF: richiede dati Verifica V1
    CF->>FS: legge `exams/V1` e `exams/V1/items/*` (snapshot, non il Markdown corrente)
    CF-->>W: contenuto originale della Verifica al momento dell'attivazione
    W->>D: visualizza le domande originali (non modificate)
```

---

## Garanzia di immutabilità

Lo snapshot in `exams/{examId}/items/` viene creato **una sola volta**, all'attivazione, in una transazione Firestore atomica. Dopo l'attivazione:

| Operazione | Effetto sullo snapshot |
|---|---|
| Sostituzione della Lezione fonte | Nessuno |
| Eliminazione della Lezione fonte | Nessuno |
| Modifica del `questionIndex` | Nessuno |
| Tentativo di modifica dell'item tramite API | Rifiutato con `PRECONDITION_FAILED` |
| Rollback del codice applicativo | Lo snapshot rimane in Firestore; nessun re-processing |

L'unico modo di "modificare" una verifica attiva è crearne una nuova.
