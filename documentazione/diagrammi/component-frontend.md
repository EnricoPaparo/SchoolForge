# SchoolForge — Architettura dei componenti frontend

**Versione:** 2.0
**Data:** 24 giugno 2026
**Riferimento:** [Architettura v2.0](../architettura.md), sezioni 4, 5 e 6

In v2.0 esistono **due applicazioni frontend separate**, deployate su URL distinti:

- **Web app docente** (`apps/web`) — desktop-first, autenticazione Google Workspace for Education.
- **Portale Verifiche** (`apps/portale`) — mobile-first, autenticazione Google scolastica studente, nessuna route o stato condiviso con la web app.

Non esistono aree Archivio/Classi/roster, integrazioni Google Forms/Drive o pannelli rubrica: sono fuori perimetro v2.

---

## Web app docente — vista macro

```mermaid
flowchart TD
    Entry["App entry point\n(routing, auth guard, error boundary)"]

    Entry --> Auth["Auth\n(login Google Education, sessione)"]
    Entry --> Repo["Repository\n(programmi, UDA, lezioni, pool)"]
    Entry --> Exam["Verifiche\n(composizione, attivazione, PDF docente)"]
    Entry --> Correction["Correzione\n(consegne, punteggi, percentuali)"]
    Entry --> History["Storico\n(studenti, risultati)"]
    Entry --> Settings["Impostazioni\n(owner, feature flag AI)"]

    Repo --> LessonView["Rendering lezione\n(Markdown sanificato, no pool)"]
    Exam --> ExamCompose["Composizione verifica"]
    Exam --> ExamActivate["Attivazione (snapshot immutabile)"]
    Exam --> ProgrammaSvolto["Export programma svolto (.txt)"]
    Correction --> ManualCorrection["Correzione manuale"]
    Correction --> AiCorrection["Correzione AI assistita\n(solo Modulo 5, se abilitata)"]
```

---

## Web app docente — componenti per area

### Auth

```mermaid
flowchart TD
    AuthRoot["AuthProvider\n(contesto sessione globale)"]
    AuthRoot --> LoginPage["LoginPage\n(Google Sign-In, dominio Education)"]
    AuthRoot --> AuthGuard["AuthGuard\n(wrapper route protette)"]
    AuthRoot --> SessionBanner["SessionBanner\n(nome docente, logout)"]
```

### Repository

```mermaid
flowchart TD
    RepositoryPage["RepositoryPage\n(lista programmi)"]
    RepositoryPage --> ProgramList["ProgramList\n(accordion UDA)"]
    ProgramList --> UdaSection["UdaSection\n(lista lezioni, flag svolto)"]
    UdaSection --> LessonRow["LessonRow\n(stato validazione, azioni)"]

    RepositoryPage --> ImportFlow["ImportFlow\n(wizard multi-step)"]
    ImportFlow --> FilePicker["FilePicker\n(file/cartella: lesson + pool + asset)"]
    ImportFlow --> ImportPreview["ImportPreview\n(piano: validi, invalidi, conflitti, asset mancanti)"]
    ImportFlow --> ImportConfirm["ImportConfirm\n(selezione e conferma)"]

    UdaSection --> LessonDetail["LessonDetail\n(rendering + azioni)"]
    LessonDetail --> MarkdownRenderer["MarkdownRenderer\n(DOMPurify + highlight)"]
    LessonDetail --> SelfCheckQuestions["SelfCheckQuestions\n(solo kind: self_check)"]
    LessonDetail --> ValidationErrors["ValidationErrors\n(errori con riga)"]
```

**Note sui componenti di rendering:**
- `MarkdownRenderer` riceve dal backend (`getLessonForRendering`) un modello già privo di domande del pool, soluzioni e opzioni corrette: la separazione è a livello di modello API, non di CSS.
- `SelfCheckQuestions` renderizza esclusivamente domande con `kind: self_check`. Le domande del pool (`.pool.md`) non arrivano mai al client di fruizione.

### Verifiche

```mermaid
flowchart TD
    ExamListPage["ExamListPage\n(lista verifiche con stato)"]
    ExamListPage --> ExamCard["ExamCard\n(stato: bozza/attiva/chiusa/annullata)"]
    ExamListPage --> NewExamButton["NewExam entry point"]

    NewExamButton --> CorpusSelector["CorpusSelector\n(UDA + Lezioni)"]
    CorpusSelector --> ConfigurationForm["ConfigurationForm\n(totale, aperte/chiuse, min difficoltà, variante)"]
    ConfigurationForm --> CompositionEditor["CompositionEditor\n(selezione e approvazione domande dal pool)"]
    CompositionEditor --> QuestionCard["QuestionCard\n(preview, soluzione, punteggio max)"]
    CompositionEditor --> ShortfallWarning["ShortfallWarning\n(fabbisogno non coperto senza AI)"]

    CompositionEditor --> ActivatePanel["ActivatePanel\n(completeness check + conferma)"]
    ActivatePanel --> ActivateConfirmDialog["ActivateConfirmDialog\n(destructive action: snapshot immutabile)"]

    ExamCard --> PdfDocentePanel["PdfDocentePanel\n(download PDF docente, campi vuoti)"]
    ExamCard --> ExamLinkPanel["ExamLinkPanel\n(link al Portale per gli studenti)"]
    ExamCard --> CloseCancelControls["Chiudi / Annulla (con conferma)"]
```

### Correzione

```mermaid
flowchart TD
    CorrectionPage["CorrectionPage\n(contesto: submissionId)"]
    CorrectionPage --> SubmissionHeader["SubmissionHeader\n(studente, verifica, data, canale)"]
    CorrectionPage --> ItemCorrectionList["ItemCorrectionList"]
    ItemCorrectionList --> ItemCorrectionCard["ItemCorrectionCard\n(risposta + soluzione + punteggio max)"]
    ItemCorrectionCard --> ScoreInput["ScoreInput\n(0 ≤ score ≤ maxScore)"]
    ItemCorrectionCard --> CommentInput["CommentInput"]
    ItemCorrectionCard --> AiProposalPanel["AiProposalPanel\n(proposta + motivazione, solo Modulo 5)"]
    AiProposalPanel --> ApproveRejectControls["ApproveRejectControls"]

    CorrectionPage --> PercentageSummary["PercentageSummary\n(live, non_definitiva se incompleto)"]
    CorrectionPage --> AuditTrail["AuditTrail\n(rettifiche con valore precedente)"]
    CorrectionPage --> BulkApprovePanel["BulkApprovePanel\n(solo se AI abilitata e proposte presenti)"]
```

### Storico

```mermaid
flowchart TD
    HistoryPage["HistoryPage\n(tab: Studenti / Verifiche)"]
    HistoryPage --> StudentsTab["StudentsTab"]
    StudentsTab --> StudentList["StudentList\n(lazy, filtri: nome/email/classe)"]
    StudentList --> StudentDetail["StudentDetail\n(storico verifiche e percentuali)"]
    HistoryPage --> ExamResultsTab["ExamResultsTab"]
    ExamResultsTab --> ResultsFilters["ResultsFilters\n(verifica, intervallo date, stato)"]
    ExamResultsTab --> ResultsTable["ResultsTable\n(paginata, indici Firestore)"]
```

---

## Portale Verifiche (studente) — componenti

```mermaid
flowchart TD
    PortaleEntry["Portale entry point\n(URL con examId)"]
    PortaleEntry --> ExamGate["ExamGate\n(getExamPublic: titolo, stato, canali)"]
    ExamGate --> StudentLogin["StudentLogin\n(Google scolastico, dominio Education)"]
    StudentLogin --> AccessForm["AccessForm\n(nome, cognome, email, classe opzionale)"]

    AccessForm --> ChannelChoice["ChannelChoice\n(cartaceo / digitale)"]
    ChannelChoice --> PaperDownload["PaperDownload\n(burnEmailAndGeneratePdf → download)"]
    ChannelChoice --> DigitalAttempt["DigitalAttempt\n(startDigitalAttempt)"]

    DigitalAttempt --> FullscreenShell["FullscreenShell\n(fullscreen obbligatorio, deterrenza)"]
    FullscreenShell --> StickyHeader["StickyHeader\n(nome studente + bottone Consegna)"]
    FullscreenShell --> QuestionSequence["QuestionSequence\n(domande verticali, no soluzioni)"]
    QuestionSequence --> AnswerField["AnswerField\n(textarea / radio / checkbox)"]
    FullscreenShell --> SubmitFlow["SubmitFlow\n(submitAnswers → conferma)"]
```

**Note Portale:**
- Il payload di `startDigitalAttempt` non contiene mai `solution` né `correct_option_ids`.
- `FullscreenShell` rileva l'uscita dal tab e mostra un avviso prominente; il copia-incolla è disabilitato nella UI. Sono misure di **deterrenza**, non garanzie di sicurezza (BR-POR-02).
- Un secondo accesso con la stessa email è bloccato (email bruciata, errore 409) sia sul canale cartaceo sia su quello digitale.

---

## Stato globale e comunicazione (web docente)

```mermaid
flowchart LR
    Store["Zustand store\n(sessione, feature flags)"]
    QueryClient["TanStack Query\n(cache dati Firestore / API)"]
    FirebaseSDK["Firebase SDK\n(Auth, Firestore read-only)"]
    BackendCalls["httpsCallable\n(Cloud Functions)"]

    Store -->|"fornisce featureFlags"| QueryClient
    QueryClient -->|"query (letture)"| FirebaseSDK
    QueryClient -->|"mutations (tutte)"| BackendCalls
```

**Regole di stato:**
1. Lo stato server è derivato dalla cache di TanStack Query, alimentata da letture Firestore e da Cloud Functions. Niente Redux per dati server.
2. **Tutte** le mutazioni (creazione, attivazione verifica, correzione, importazione) passano da Cloud Functions, mai da scrittura diretta Firestore: le Security Rules negano scritture client.
3. Le letture non critiche (programmi, UDA, lezioni, storico) usano l'SDK Firestore con le Security Rules come garanzia.
4. I feature flag sono letti da `getSession` al login e conservati per la durata della sessione.

Il Portale non condivide questo store: ha uno stato locale minimale legato al singolo attempt.

---

## Pattern trasversali UI

### Destructive Action Pattern
Ogni operazione irreversibile (attivazione, eliminazione, conferma import, annullamento, approvazione massiva) usa: pulsante con etichetta chiara → dialog di conferma con conseguenze specifiche e oggetti coinvolti → loading state → feedback di esito.

### Error State Pattern
Gli errori mostrano: **cosa** è successo (oggetto e azione), **perché** (`{ code, message }` dal backend), **cosa fare** (azione correttiva). Nessuno stack trace nell'UI; i codici tecnici solo nel tooltip "Copia per supporto". Il codice `EMAIL_BURNED` produce nel Portale un messaggio esplicito di download già effettuato.

### Empty State Pattern
Le liste vuote mostrano: stato vuoto contestuale, azione primaria disponibile, link alla documentazione se applicabile.
