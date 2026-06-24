# SchoolForge — Sequenza verifica, tentativo e snapshot

```mermaid
sequenceDiagram
    participant D as Docente
    participant B as Cloud Functions
    participant F as Firestore
    participant S as Studente/Portale

    D->>B: activateVerification(confirmation=true)
    B->>F: valida e salva configurazione immutabile
    B-->>D: link pubblico con token casuale

    S->>B: startDigitalAttempt(dati dichiarati)
    B->>F: transazione lock email + tentativo
    B->>B: seleziona domande da pool corrente
    B->>F: salva snapshot privato e token ripresa
    B-->>S: proiezione domande senza soluzioni

    S->>B: saveDraft / submitAttempt
    B->>F: bozza o consegna immutabile + audit
```

L'attivazione non crea uno snapshot globale della verifica. Il solo tentativo digitale salva le domande effettivamente svolte; modifiche future alle lezioni non alterano correzione o export di quel tentativo.
