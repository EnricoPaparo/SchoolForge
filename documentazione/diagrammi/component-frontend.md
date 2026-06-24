# SchoolForge — Architettura frontend

```mermaid
flowchart TB
    subgraph SPA["SPA — Firebase Hosting"]
      subgraph T["Sezione docente /teacher/*"]
        Login["Sessione docente (Firebase Auth)"]
        Repo["Repository: programmi, UDA, lezioni"]
        Verify["Configurazione verifiche e classi"]
        Correct["Correzione ed export"]
        PdfTeacher["PdfRenderer docente\n(@react-pdf/renderer)"]
      end
      subgraph P["/exam/:token — pubblica"]
        Entry["Link verifica e dati dichiarati"]
        Paper["Canale cartaceo\n(PDF download diretto)"]
        Digital["Canale digitale\n(svolgimento, bozza, consegna)"]
        PdfStudent["PdfRenderer studente\n(@react-pdf/renderer)"]
      end
    end

    T -->|"Firebase ID token + Security Rules"| FS["Firestore"]
    T -->|"Security Rules"| CS["Cloud Storage\nMarkdown, asset"]
    Digital -->|"startDigitalAttempt"| CF["Cloud Function\n(solo M3 e M5)"]
    CF --> FS
    CF -. "M5" .-> AI["AiGateway"]
    Paper --> PdfStudent
    Correct --> PdfTeacher
```

## Regole

- La SPA è un'unica applicazione con code splitting per le due sezioni.
- La sezione docente usa Firebase Authentication; il Portale non ha login studente.
- La sezione docente scrive direttamente su Firestore e Storage entro le Security Rules; nessuna Cloud Function per import, verifiche, correzione o export.
- `startDigitalAttempt` è l'unica Cloud Function nei Moduli 1–4: genera il token di sessione server-side e lo snapshot con soluzioni private.
- I PDF (docente, studente cartaceo, programma svolto, export) sono generati nel browser con `@react-pdf/renderer`; nessun PDF passa per il server.
- Il Portale riceve solo la proiezione dello snapshot senza soluzioni, audit o correzioni.
