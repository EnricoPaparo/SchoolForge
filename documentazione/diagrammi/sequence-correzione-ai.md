# SchoolForge — Sequenza correzione AI (Modulo 5 — fuori scope V1 / pianificato per V2)

```mermaid
sequenceDiagram
    participant D as Docente
    participant SPA as SPA docente
    participant CF as Cloud Function
    participant F as Firestore
    participant A as AiGateway/provider

    D->>SPA: richiede proposta AI per un item
    SPA->>CF: proposeCorrection({ attemptId, itemId })
    CF->>F: legge snapshot item (con soluzione), risposta, nota docente
    CF->>CF: verifica C-02, feature flag aiEnabled, contesto chiuso
    CF->>A: testo domanda + soluzione + risposta + lezione + nota
    A-->>CF: proposta (score, comment, explanation)
    CF->>F: salva proposta e auditEvent
    CF-->>SPA: proposta assistita

    D->>SPA: approva / modifica / rifiuta
    SPA->>CF: approveCorrection({ attemptId, itemId, score, comment })
    CF->>F: aggiorna corrections e correctionEvents
    CF-->>SPA: conferma
```

## Note

- La modalità automatica è un flusso separato: richiede C-03, opt-in della verifica e conserva gli stessi dati di audit.
- AiGateway non riceve web, retrieval, tool esterni o permessi di modifica su verifiche e contenuti.
- Secret Manager fornisce la chiave API al runtime della Cloud Function; non raggiunge mai il client.
- `proposeCorrection` richiede Firebase ID token con `ownerUid` verificato server-side.
