# SchoolForge — Sequenza canale cartaceo e canale digitale

## Canale cartaceo

```mermaid
sequenceDiagram
    participant S as Studente
    participant SPA as SPA portale
    participant F as Firestore

    S->>SPA: apre link verifica
    SPA->>F: legge verifica (proiezione pubblica)
    F-->>SPA: titolo, canali disponibili

    S->>SPA: sceglie canale cartaceo, inserisce dati
    SPA->>F: runTransaction — verifica lock, crea recipientLock + deliveryAttempt
    alt email libera
        F-->>SPA: transazione ok
        SPA->>SPA: seleziona domande da questionIndex
        SPA->>SPA: genera PDF nel browser (@react-pdf/renderer)
        SPA-->>S: download PDF diretto
    else email già usata
        F-->>SPA: lock esistente
        SPA-->>S: errore "recapito già utilizzato"
    end
```

## Canale digitale

```mermaid
sequenceDiagram
    participant S as Studente
    participant SPA as SPA portale
    participant CF as Cloud Function
    participant F as Firestore

    S->>SPA: sceglie canale digitale, inserisce dati
    SPA->>CF: startDigitalAttempt(verificationToken, dati)
    CF->>F: transazione — lock, tentativo, snapshot con soluzioni private
    CF-->>SPA: proiezione domande senza soluzioni + Set-Cookie: resumeToken (HttpOnly/Secure)

    loop autosave
        S->>SPA: risponde a domanda
        SPA->>F: saveDraft (answers)
    end

    S->>SPA: Consegna
    SPA->>F: runTransaction — in_corso → consegnato, immutabile, audit
    SPA-->>S: conferma consegna
```

## Note

- Nel canale cartaceo il PDF è generato interamente nel browser; il server non è coinvolto nella produzione del documento.
- Il lock `recipientLocks/{emailHash}` è unico per verifica: cartaceo e digitale condividono la stessa regola di email bruciata.
- Lo snapshot digitale con soluzioni private è creato dalla Cloud Function e mai esposto al client portale.
