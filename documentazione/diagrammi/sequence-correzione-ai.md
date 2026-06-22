# SchoolForge — Sequence: Correzione AI assistita e approvazione massiva

**Versione:** 1.0
**Data:** 22 giugno 2026
**Riferimento:** [Architettura v1.0](../architettura.md), sezione 8.7

---

## Flusso principale: correzione AI assistita per una consegna

```mermaid
sequenceDiagram
    actor D as Docente
    participant W as Web app
    participant CF as Cloud Functions (backend)
    participant GW as AiGateway
    participant AI as Provider AI (esterno)
    participant FS as Firestore

    note over D: Prerequisiti: C-02 risolto, AI configurata, G5-AI superato

    D->>W: apre una consegna da correggere e richiede proposta AI

    W->>D: mostra dati che verranno inviati al provider AI
    note over W,D: lezione fonte, domanda, soluzione, rubrica, risposta (senza dati anagrafici studente)

    D->>W: conferma consenso esplicito (o usa consenso persistente già configurato)
    W->>CF: proposeCorrection({ submissionId, consentGiven: true })

    CF->>FS: legge `submissions/{id}` → risposte dello studente
    CF->>FS: legge `exams/{examId}/items/` → domande, soluzioni, rubriche, maxScore
    CF->>FS: legge `lessons/{lessonId}` → storagePath della lezione fonte

    loop per ogni item della consegna
        CF->>GW: buildContext({ lessonContent, question, solution, rubric, studentResponse })
        note over GW: verifica dimensione contesto; applica template di sistema versioned
        GW->>AI: invia contesto chiuso (senza browser, tool, retrieval)
        AI-->>GW: risposta strutturata { score, reasoning, criteriaApplied }
        GW->>GW: valida risposta (Zod schema): score ≤ maxScore, criteri presenti
        GW-->>CF: proposta validata + AiProvenance (provider, model, templateVersion, contextHash)
    end

    CF->>FS: scrive proposte in `corrections/{submissionId}.itemScores` con status: 'ai_proposed'
    CF->>FS: scrive audit event AI_CORRECTION_PROPOSED (con hash contesto, provider, modello)
    CF-->>W: { proposals: [...] }

    W->>D: mostra proposte AI affiancate alla risposta; punteggio e motivazione per item

    loop per ogni item
        alt Docente approva
            D->>W: approva proposta item N
            W->>CF: updateCorrection({ submissionId, itemCorrections: [{ examItemId, score, ... }] })
            CF->>FS: aggiorna item → status: 'teacher_approved', aggiorna percentuale
        else Docente modifica
            D->>W: modifica punteggio o commento dell'item N
            W->>CF: updateCorrection({ submissionId, itemCorrections: [{ examItemId, score, reason }] })
            CF->>FS: aggiorna item → status: 'teacher_modified', salva valore precedente in audit
        else Docente rifiuta
            D->>W: rifiuta proposta item N
            W->>CF: updateCorrection con score esplicito del docente
            CF->>FS: aggiorna item → status: 'teacher_corrected', proposta AI marcata 'rifiutata'
        end
    end

    CF->>FS: ricalcola percentuale finale quando tutti gli item sono definitivi
```

---

## Flusso approvazione massiva

```mermaid
sequenceDiagram
    actor D as Docente
    participant W as Web app
    participant CF as Cloud Functions (backend)
    participant FS as Firestore

    D->>W: apre pannello "Approva tutte le proposte" per una Verifica o selezione

    W->>CF: bulkApproveCorrections({ examId, confirmation: false })
    note over CF: prima chiamata senza confirmation: restituisce solo il riepilogo
    CF->>FS: legge tutte le correzioni per la verifica
    CF->>CF: filtra le proposte idonee (status: 'ai_proposed', complete, non rifiutate, non già modificate)
    CF-->>W: {
        approved: 8,
        skipped: 2,
        skippedIds: ['sub-3 (proposta incompleta)', 'sub-7 (già modificata dal docente)']
    }

    W->>D: mostra riepilogo: 8 proposte saranno approvate, 2 escluse con motivo

    D->>W: conferma approvazione massiva
    W->>CF: bulkApproveCorrections({ examId, confirmation: true })

    CF->>FS: transazione batch:
    note over CF,FS: per ogni delle 8 proposte idonee:
    CF->>FS: aggiorna `corrections/{submissionId}` → status item: 'teacher_approved'
    CF->>FS: ricalcola percentuale per la consegna
    CF->>FS: scrive audit event CORRECTION_APPROVED per ogni consegna modificata
    CF->>FS: scrive audit event BULK_APPROVE_COMPLETED (con count e lista examItemId)

    CF-->>W: { approved: 8, skipped: 2 }
    W->>D: riepilogo operazione; le 2 escluse rimangono da correggere manualmente
```

---

## Flusso: modalità automatica (solo se G6 superato e feature flag abilitato)

```mermaid
sequenceDiagram
    actor D as Docente
    participant W as Web app
    participant CF as Cloud Functions (backend)
    participant GW as AiGateway
    participant AI as Provider AI
    participant FS as Firestore

    note over D: La modalità automatica è abilitata esplicitamente per questa Verifica

    D->>W: attiva correzione automatica per l'Assegnazione X
    W->>D: mostra avviso: "La correzione sarà applicata automaticamente; resterà modificabile"
    D->>W: conferma esplicita

    W->>CF: proposeCorrection({ submissionId, consentGiven: true, autoApprove: true })
    CF->>GW: (stesso flusso di generazione contesto della modalità assistita)
    GW->>AI: invia contesto
    AI-->>GW: risposta
    GW-->>CF: proposta validata

    CF->>FS: scrive la correzione direttamente con status: 'automatic'
    CF->>FS: ricalcola percentuale
    CF->>FS: scrive audit event AI_AUTO_CORRECTION con flag 'automatic: true'

    CF-->>W: { percentage, correctionStatus: 'complete' }
    W->>D: consegna corretta automaticamente; modificabile in qualsiasi momento

    note over D: Il Docente può sempre sovrascrivere una correzione automatica;
    note over D: la modifica crea un audit con valore precedente e nuovo valore
```

---

## Garanzie del AiGateway

| Garanzia | Meccanismo |
|---|---|
| Solo le lezioni selezionate nel contesto | Il backend costruisce il contesto; il gateway non accetta contesti con lessonIds non selezionati |
| Nessun browsing o retrieval | Il gateway non ha tool esterni configurati; il sistema prompt lo vieta esplicitamente |
| Punteggio ≤ massimo | Validazione Zod del gateway; proposta rifiutata se viola il vincolo |
| Criteri rubrica dichiarati | Validazione schema gateway; proposta marcata 'incompleta' se assenti |
| Provenienza tracciata | Ogni proposta include provider, modelId, templateVersion, contextHash (SHA-256 del contesto) |
| Consenso verificato | Il backend verifica la configurazione del consenso prima di qualsiasi invocazione AI |
| Proposta ≠ decisione | Nessuna proposta AI diventa definitiva senza approvazione docente (eccetto modalità automatica esplicitamente abilitata) |
