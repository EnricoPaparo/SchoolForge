# SchoolForge

Repository didattico personale **Markdown-first** per un docente. SchoolForge centralizza lezioni, verifiche, archiviazione e future correzioni assistite, mantenendo la conoscenza didattica indipendente dalla piattaforma.

## Stato del progetto

La baseline di progetto è definita: brief, requisiti, architettura e piano di implementazione sono disponibili nel repository. L'implementazione applicativa non è ancora iniziata; il prossimo incremento è la **Fase 1 — Corsi, UDA e Lezioni**.

## Obiettivo

Le lezioni Markdown sono la fonte canonica della conoscenza del docente. Da esse il sistema deve poter derivare:

- rendering delle lezioni;
- verifiche, soluzioni e rubriche;
- PDF e Google Forms;
- archiviazione di prove e consegne;
- correzione manuale e, successivamente, AI assistita.

SchoolForge non è un LMS, un registro elettronico o un portale studenti.

## Principi fondamentali

- **Markdown-first:** file e asset rimangono leggibili, esportabili e utilizzabili fuori dall'applicazione.
- **Knowledge-first:** il sistema organizza e consuma la conoscenza; non ne diventa proprietario esclusivo.
- **AI optional:** i percorsi manuali funzionano senza provider AI.
- **Incrementale:** ogni fase rilascia un prodotto funzionante per il docente.
- **Single-docente:** nella V1 accede solo il docente tramite Google Workspace for Education; gli studenti non hanno un account SchoolForge.

## Documentazione

Leggere i documenti in questo ordine:

| Documento | Contenuto |
|---|---|
| [Brief](documentazione/brief.md) | Visione, problema, vincoli e perimetro iniziale. |
| [Analisi dei requisiti](documentazione/analisi-requisiti.md) | Requisiti funzionali/non funzionali, regole di dominio e criteri di accettazione. |
| [Architettura](documentazione/architettura.md) | Architettura target Firebase/Google Cloud, modello dati, sicurezza e integrazioni. |
| [Piano di implementazione](documentazione/piano-implementazione.md) | Workflow esecutivo, dipendenze, lavoro parallelo, gate e test. |

## Roadmap di delivery

| Fase | Prodotto rilasciato |
|---|---|
| 1. Corsi, UDA e Lezioni | Il docente autenticato crea Corsi/Programmi e UDA, carica, consulta ed esporta lezioni Markdown con asset. |
| 2. Generazione Verifiche | Il docente compone, pubblica ed esporta una verifica immutabile in PDF, con soluzione e rubrica. |
| 3. Archiviazione Verifiche | Il docente gestisce classi/studenti, assegnazioni, consegne e storico delle prove da correggere. |
| 4. Correzione Verifiche | Il docente assegna punteggi e percentuali con audit; AI assistita e automatica sono estensioni autorizzate separatamente. |

Google Forms, roster Google Education e AI sono integrazioni opzionali: non bloccano il percorso manuale delle prime fasi.

## Architettura target

La soluzione prevista è un monolite modulare serverless su Firebase/Google Cloud:

- web app TypeScript su Firebase Hosting;
- Firebase Authentication con Google Workspace for Education;
- Cloud Functions per logica di business, PDF e integrazioni;
- Cloud Firestore per metadati, verifiche, consegne, correzioni e audit;
- Cloud Storage per Markdown, asset e staging di importazione;
- Google Drive del docente per il caricamento manuale dei PDF archiviabili.

L'AI è isolata dietro un gateway e resta disabilitata finché non saranno approvati provider, consenso e regole di automazione.

## Struttura del repository

```text
documentazione/
├─ brief.md
├─ analisi-requisiti.md
├─ architettura.md
└─ piano-implementazione.md
```

## Prossimo passo

Avviare la Fase 1 seguendo il backlog iniziale del piano di implementazione: ambiente Firebase `dev`, autenticazione del docente, contratto Lesson Markdown, Corsi/UDA e importazione validata delle lezioni.
