# SchoolForge — Sequence: Importazione lezione o cartella

**Versione:** 2.0
**Data:** 24 giugno 2026
**Riferimento:** [Architettura v2.0](../architettura.md), sezione 9.2

In v2.0 una lezione è una coppia di file: `lezione-XXX-titolo.md` (contenuto) e `lezione-XXX-titolo.pool.md` (pool domande, opzionale). L'import valida entrambi tramite `lesson-contract`.

---

## Flusso principale (import cartella con conferma parziale)

```mermaid
sequenceDiagram
    actor D as Docente
    participant W as Web app
    participant F as Firebase Auth
    participant CF as Cloud Functions (backend)
    participant ST as Cloud Storage (staging)
    participant SR as Cloud Storage (repository/current)
    participant FS as Firestore

    D->>W: seleziona cartella da importare (lesson.md, pool.md, UDA.md, asset)
    W->>CF: stageImport({ files: [...metadati...] })
    CF->>F: verifica token Firebase + soggetto Google
    F-->>CF: token valido, owner confermato
    CF->>ST: crea prefisso staging/{importId}/
    CF-->>W: { importId, uploadUrls: [...URL firmati...] }

    loop per ogni file
        W->>ST: PUT file su URL firmato (diretto a Storage)
    end

    W->>CF: previewImport({ importId })
    CF->>ST: legge tutti i file dal prefisso staging/{importId}/
    CF->>CF: parseLessonMarkdown(), parsePoolMarkdown(), parseUda()
    CF->>CF: valida contratto Lesson Markdown v1
    CF->>CF: risolve conflitti, asset mancanti, programId/udaId sconosciuti
    CF-->>W: { validLessons (con hasPool, poolQuestionCount), invalidFiles, conflicts, missingAssets }

    W->>D: mostra piano di import con validi, invalidi, conflitti

    alt il docente conferma tutto o un sottoinsieme valido
        D->>W: conferma con selectedLessonIds
        W->>CF: commitImport({ importId, confirmation: true, selectedLessonIds })
        CF->>F: verifica token (operazione irreversibile)
        F-->>CF: token valido

        note over CF,SR: Transazione atomica visibile
        CF->>ST: legge lesson.md, pool.md e asset delle lezioni selezionate
        CF->>SR: copia in repository/current/{programId}/{udaId}/
        CF->>FS: upsert documenti in `lessons` (transazione)
        CF->>FS: aggiorna `questionIndex` dalle domande dei pool validi
        CF->>FS: scrive audit event IMPORT_COMMITTED
        CF->>ST: elimina prefisso staging/{importId}/

        CF-->>W: { committed: N, skipped: M }
        W->>D: notifica successo con riepilogo

    else il docente annulla
        D->>W: annulla importazione
        note over ST: Il prefisso staging/{importId}/ scade automaticamente dopo 24h
        W->>D: torna alla schermata repository
    end
```

---

## Flusso alternativo: file con errori bloccanti

```mermaid
sequenceDiagram
    actor D as Docente
    participant W as Web app
    participant CF as Cloud Functions (backend)

    W->>CF: previewImport({ importId })
    CF-->>W: { validLessons: [], invalidFiles: [{ path, errors: [{line, message}] }], ... }
    W->>D: mostra errori per file e riga; nessuna lezione importabile

    note over W,D: Il docente corregge i file Markdown localmente e ripete l'import
```

---

## Flusso alternativo: sostituzione singola lezione

```mermaid
sequenceDiagram
    actor D as Docente
    participant W as Web app
    participant CF as Cloud Functions (backend)
    participant ST as Cloud Storage (staging)
    participant SR as Cloud Storage (repository/current)
    participant FS as Firestore

    D->>W: seleziona "Sostituisci" su una lezione esistente
    W->>CF: stageImport({ files: [{ relativePath: "lezione-001.md" }, { relativePath: "lezione-001.pool.md" }] })
    CF-->>W: { importId, uploadUrls }
    W->>ST: PUT nuovi file su URL firmato

    W->>CF: replaceLesson({ lessonId, importId, confirmation: true })
    CF->>CF: verifica che l'id nel front matter corrisponda a lessonId
    CF->>CF: parseLessonMarkdown() + parsePoolMarkdown() e valida
    CF->>SR: sovrascrive i file correnti della lezione
    CF->>FS: aggiorna `lessons/{lessonId}` (status, plainText, validationErrors, poolPath)
    CF->>FS: aggiorna `questionIndex` (solo per questa lezione)
    CF->>FS: scrive audit event LESSON_REPLACED

    note over FS: exams/{id}/items già attivati NON vengono toccati

    CF-->>W: { lessonId, validationStatus: 'valid' | 'invalid' }
    W->>D: conferma sostituzione con nuovo stato di validazione
```

---

## Garanzie di atomicità

| Scenario di errore | Comportamento |
|---|---|
| Caricamento interrotto a metà (Storage) | I file non caricati non sono in staging; `commitImport` fallisce perché il manifesto non è completo. Nessuna modifica al repository. |
| Errore durante la copia da staging a repository | La transazione Firestore non si completa; i file già copiati vengono rimossi da un job di cleanup. Nessuna Lezione diventa visibile. |
| Errore durante l'aggiornamento Firestore | Rollback della transazione; file copiati rimossi. Stato del repository invariato. |
| Timeout della funzione | L'importazione resta in `staging` e scade dopo 24 ore. Il Docente ripete l'operazione. |
