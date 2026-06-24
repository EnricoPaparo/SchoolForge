# SchoolForge — Sequenza verifica, tentativo e snapshot

```mermaid
sequenceDiagram
    participant D as Docente
    participant B as Cloud Functions
    participant F as Firestore
    participant S as Studente/Portale

    D->>B: activateVerification(confirmation=true)
    B->>F: valida, salva configurazione e snapshot pubblicato immutabili
    B-->>D: link pubblico con token casuale

    S->>B: startDigitalAttempt(dati dichiarati)
    B->>F: transazione lock nome/cognome + tentativo
    B->>B: seleziona domande da snapshot pubblicato
    B->>F: salva snapshot privato e token ripresa
    B-->>S: proiezione domande senza soluzioni

    S->>B: saveDraft / submitAttempt
    B->>F: bozza o consegna immutabile + audit
```

L'attivazione crea uno snapshot pubblicato delle domande eleggibili; il solo tentativo digitale salva inoltre le domande effettivamente svolte. Modifiche future alle lezioni non alterano generazione, correzione o export della verifica già attiva.
