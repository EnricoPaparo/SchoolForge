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

    S->>SPA: sceglie canale cartaceo, inserisce nome e cognome
    SPA->>SPA: genera PDF nel browser (VerificaPdfRenderer mode=student)
    SPA->>F: scrive deliveryAttempt + accessLog (nome, IP, user-agent, timestamp)
    SPA-->>S: download PDF diretto
```

Il canale cartaceo non usa lock né email: lo studente scarica il PDF e l'accesso viene registrato a fini di audit. Più download sono ammessi.

## Canale digitale

```mermaid
sequenceDiagram
    participant S as Studente
    participant SPA as SPA portale
    participant CF as Cloud Function
    participant F as Firestore

    S->>SPA: sceglie canale digitale, inserisce nome e cognome
    SPA->>CF: startDigitalAttempt(verificationToken, dati)
    CF->>F: transazione — brucia token mono-uso, crea tentativo, snapshot con soluzioni private, accessLog (nome, IP, user-agent, timestamp)
    alt token non ancora usato
        CF-->>SPA: proiezione domande senza soluzioni + Set-Cookie: resumeToken (HttpOnly/Secure)
        loop autosave
            S->>SPA: risponde a domanda
            SPA->>F: saveDraft (answers)
        end
        S->>SPA: Consegna
        SPA->>F: runTransaction — in_corso → consegnato, immutabile, audit
        SPA-->>S: conferma consegna
    else token già bruciato
        CF-->>SPA: errore TOKEN_ALREADY_USED
        SPA-->>S: "Questa prova è già stata avviata da questo link."
    end
```

## Note

- Nel canale cartaceo il PDF è generato interamente nel browser; il server non è coinvolto nella produzione del documento.
- Non esiste più alcun lock email: l'unicità della consegna digitale è garantita dal token mono-uso del tentativo, bruciato alla prima chiamata `startDigitalAttempt`.
- Ogni accesso (cartaceo e digitale) registra nome dichiarato, IP, user-agent e timestamp in `accessLog`; il docente li consulta nel Report Accessi. Sono dati auto-dichiarati, non prove d'identità.
- Lo snapshot digitale con soluzioni private è creato dalla Cloud Function e mai esposto al client portale.
