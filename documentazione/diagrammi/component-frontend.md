# SchoolForge — Architettura frontend

```mermaid
flowchart TB
    subgraph SPA["SPA — Firebase Hosting"]
      subgraph T["Sezione docente /teacher/*"]
        Login["Sessione docente (Firebase Auth)"]
        Repo["Repository: programmi, UDA, lezioni"]
        Verify["Configurazione verifiche e classi"]
        Correct["Correzione ed export"]
      end
      subgraph P["/exam/:token — pubblica"]
        Entry["Link verifica e dati dichiarati"]
        Paper["Canale cartaceo\n(PDF download diretto)"]
        Digital["Canale digitale\n(svolgimento, bozza, consegna)"]
      end
      Pdf["VerificaPdfRenderer\n(@react-pdf/renderer)\nmode=teacher | student"]
    end

    T -->|"Firebase ID token + Security Rules"| FS["Firestore"]
    T -->|"Security Rules"| CS["Cloud Storage\nMarkdown, asset"]
    Digital -->|"startDigitalAttempt"| CF["Cloud Function\n(solo M3 e M5/V2)"]
    CF --> FS
    CF -. "M5/V2" .-> AI["AiGateway"]
    Paper -->|"mode=student"| Pdf
    Verify -->|"mode=teacher"| Pdf
    Correct -->|"mode=teacher"| Pdf
```

## Regole

- La SPA è un'unica applicazione con code splitting per le due sezioni.
- La sezione docente usa Firebase Authentication; il Portale non ha login studente.
- La sezione docente scrive direttamente su Firestore e Storage entro le Security Rules; nessuna Cloud Function per import, verifiche, correzione o export.
- `startDigitalAttempt` è l'unica Cloud Function nei Moduli 1–4: crea il participant lock per nome+cognome, genera il token di sessione server-side, registra il log di accesso (nome+IP) e lo snapshot con soluzioni private.
- Esiste un unico componente PDF, `VerificaPdfRenderer`, con prop `mode="teacher" | "student"`: in modalità `student` nasconde le soluzioni. È usato sia dal docente (download e correzione) sia dal canale cartaceo studente.
- I PDF (verifica docente, verifica studente cartaceo, programma svolto, export) sono generati nel browser con `@react-pdf/renderer`; nessun PDF passa per il server.
- Il Portale riceve solo la proiezione dello snapshot senza soluzioni, audit, log accessi o correzioni.
