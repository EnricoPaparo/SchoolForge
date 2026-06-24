# SchoolForge — Confini frontend

```mermaid
flowchart TB
    subgraph T["Teacher web — Firebase Hosting"]
      Login["Sessione docente"]
      Repo["Repository: programmi, UDA, lezioni"]
      Verify["Configurazione verifiche"]
      Correct["Correzione ed export"]
    end
    subgraph P["Exam portal — Firebase Hosting"]
      Public["Link verifica e dati dichiarati"]
      Paper["Canale cartaceo"]
      Digital["Svolgimento, bozza, consegna"]
    end
    T -->|"Firebase ID token"| API["Cloud Functions"]
    P -->|"Token verifica / token tentativo"| API
    API --> FS["Firestore"]
    API --> CS["Cloud Storage"]
```

## Regole

- Il Teacher web usa Firebase Authentication; il Portale non ha login studente.
- Entrambe le app chiamano il backend per dati di dominio: niente scritture Firestore dirette dal client.
- Il Portale riceve soltanto una proiezione dello snapshot senza soluzioni, audit o correzioni.
- Tema, responsività e accessibilità appartengono a entrambe le app; fullscreen e deterrenza appartengono solo al Portale.
