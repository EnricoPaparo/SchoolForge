# SchoolForge — Sequenza correzione AI

```mermaid
sequenceDiagram
    participant D as Docente
    participant B as Cloud Functions
    participant F as Firestore
    participant A as AiGateway/provider

    D->>B: proposeCorrection(item)
    B->>F: legge snapshot, risposta e nota docente
    B->>B: verifica C-02, feature flag e contesto chiuso
    B->>A: domanda + soluzione + risposta + lezione
    A-->>B: proposta
    B->>F: salva proposta e audit
    B-->>D: mostra proposta assistita

    D->>B: approve / modify / reject
    B->>F: aggiorna correzione e audit
```

La modalità automatica è un flusso separato: richiede C-03, opt-in della verifica e conserva gli stessi dati di audit. AiGateway non riceve web, retrieval, tool o permessi di modifica su verifiche e contenuti.
