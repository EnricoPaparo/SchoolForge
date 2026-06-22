# SchoolForge — Sequence: Importazione lezione o cartella

**Versione:** 1.0
**Data:** 22 giugno 2026
**Riferimento:** [Architettura v1.0](../architettura.md), sezione 8.2

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

    D->>W: seleziona cartella da importare
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
    CF->>CF: parseLessonMarkdown() su ogni .md trovato
    CF->>CF: valida contratto Lesson Markdown v1
    CF->>CF: risolve conflitti, asset mancanti, programId/udaId sconosciuti
    CF-->>W: { validLessons, invalidFiles, conflicts, missingAssets }

    W->>D: mostra piano di import con validi, invalidi, conflitti

    alt il docente conferma tutto o un sottoinsieme valido
        D->>W: conferma con selectedLessonIds
        W->>CF: commitImport({ importId, confirmation: true, selectedLessonIds })
        CF->>F: verifica token (nuova verifica per operazione irreversibile)
        F-->>CF: token valido

        note over CF,SR: Transazione atomica visibile
        CF->>ST: legge Markdown e asset delle lezioni selezionate da staging
        CF->>SR: copia Markdown e asset in repository/current/lessons/{lessonId}/
        CF->>FS: upsert documenti in collezione `lessons` (transazione)
        CF->>FS: aggiorna `questionIndex` (rimuove vecchie, aggiunge nuove domande)
        CF->>FS: scrive audit event IMPORT_COMMITTED
        CF->>ST: elimina prefisso staging/{importId}/

        CF-->>W: { committed: N, skipped: M }
        W->>D: notifica successo con riepilogo

    else il docente annulla
        D->>W: annulla importazione
        W->>CF: (non è richiesta una chiamata esplicita di cancel nella V1)
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
    W->>CF: stageImport({ files: [{ relativePath: "source.md", ... }] })
    CF-->>W: { importId, uploadUrls: [{ signedUrl }] }
    W->>ST: PUT nuovo file .md su URL firmato

    W->>CF: replaceLesson({ lessonId, importId, confirmation: true })
    CF->>CF: verifica che l'id nel front matter corrisponda a lessonId
    CF->>CF: parseLessonMarkdown() e valida
    CF->>SR: sovrascrive repository/current/lessons/{lessonId}/source.md
    CF->>FS: aggiorna documento `lessons/{lessonId}` (status, plainText, validationErrors)
    CF->>FS: aggiorna `questionIndex` (solo per questa lezione)
    CF->>FS: scrive audit event LESSON_REPLACED

    note over FS: exam_items già pubblicati NON vengono toccati

    CF-->>W: { lessonId, validationStatus: 'valid' | 'invalid' }
    W->>D: conferma sostituzione con nuovo stato di validazione
```

---

## Garanzie di atomicità

| Scenario di errore | Comportamento |
|---|---|
| Caricamento interrotto a metà (Storage) | I file non ancora caricati non sono in staging; `commitImport` fallisce perché il manifesto non è completo. Nessuna modifica al repository. |
| Errore durante la copia da staging a repository | La transazione Firestore non viene completata; i file già copiati in Storage vengono rimossi da un job di cleanup. Nessuna Lezione diventa visibile. |
| Errore durante l'aggiornamento Firestore | Rollback della transazione; i file già copiati in Storage vengono rimossi. Stato del repository invariato. |
| Timeout della funzione | L'importazione rimane in `staging` e scade dopo 24 ore. Il Docente deve ripetere l'operazione. |
