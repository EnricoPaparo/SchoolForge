# SchoolForge — Architettura dei componenti frontend

**Versione:** 1.0
**Data:** 22 giugno 2026
**Riferimento:** [Architettura v1.0](../architettura.md), sezioni 4 e 6

---

## Vista macro: aree funzionali della SPA

```mermaid
flowchart TD
    Entry["App entry point\n(routing, auth guard, error boundary)"]

    Entry --> Auth["Auth\n(login, logout, session)"]
    Entry --> Repo["Repository\n(programmi, UDA, lezioni)"]
    Entry --> Exam["Verifiche\n(composizione, pubblicazione, PDF)"]
    Entry --> Archive["Archivio\n(classi, studenti, consegne)"]
    Entry --> Correction["Correzione\n(punteggi, percentuali, AI)"]
    Entry --> Settings["Impostazioni\n(integrazioni, configurazione)"]

    Repo --> LessonView["Rendering lezione\n(Markdown sanificato)"]
    Exam --> ExamCompose["Composizione verifica"]
    Exam --> ExamPublish["Revisione e pubblicazione"]
    Archive --> AssignmentMgmt["Gestione assegnazioni"]
    Archive --> SubmissionList["Storico consegne"]
    Correction --> ManualCorrection["Correzione manuale"]
    Correction --> AiCorrection["Correzione AI assistita\n(solo se abilitata)"]
```

---

## Struttura dei componenti per area

### Auth

```mermaid
flowchart TD
    AuthRoot["AuthProvider\n(contesto sessione globale)"]
    AuthRoot --> LoginPage["LoginPage\n(Google Sign-In button)"]
    AuthRoot --> AuthGuard["AuthGuard\n(wrapper per route protette)"]
    AuthRoot --> SessionBanner["SessionBanner\n(nome docente, logout)"]
```

### Repository

```mermaid
flowchart TD
    RepositoryPage["RepositoryPage\n(lista programmi)"]
    RepositoryPage --> ProgramList["ProgramList\n(accordion UDA)"]
    ProgramList --> UdaSection["UdaSection\n(lista lezioni)"]
    UdaSection --> LessonRow["LessonRow\n(stato, azioni rapide)"]

    RepositoryPage --> ImportFlow["ImportFlow\n(wizard multi-step)"]
    ImportFlow --> FilePicker["FilePicker\n(file/cartella)"]
    ImportFlow --> ImportPreview["ImportPreview\n(piano con errori e conflitti)"]
    ImportFlow --> ImportConfirm["ImportConfirm\n(selezione e conferma)"]

    UdaSection --> LessonDetail["LessonDetail\n(rendering + azioni)"]
    LessonDetail --> MarkdownRenderer["MarkdownRenderer\n(DOMPurify + highlight)"]
    LessonDetail --> SelfCheckQuestions["SelfCheckQuestions\n(solo kind: self_check)"]
    LessonDetail --> ValidationErrors["ValidationErrors\n(errori con riga)"]
```

**Note sui componenti di rendering:**
- `MarkdownRenderer` è responsabile della sanitizzazione. Non riceve mai dati `assessment` dal backend; la separazione è a livello di modello API, non di CSS.
- `SelfCheckQuestions` renderizza esclusivamente domande con `kind: self_check`. Se il backend restituisce erroneamente un blocco `assessment`, il componente lo ignora per design (filtro esplicito sul campo `kind`).

---

### Verifiche

```mermaid
flowchart TD
    ExamListPage["ExamListPage\n(lista verifiche con stato)"]
    ExamListPage --> ExamCard["ExamCard\n(stato, azioni contestuali)"]
    ExamListPage --> NewExamButton["NewExam entry point"]

    NewExamButton --> CorpusSelector["CorpusSelector\n(UDA + Lezioni)"]
    CorpusSelector --> ConfigurationForm["ConfigurationForm\n(quantità, tipo, difficoltà)"]
    ConfigurationForm --> CompositionEditor["CompositionEditor\n(drag&drop, approvazione domande)"]
    CompositionEditor --> QuestionCard["QuestionCard\n(preview, soluzione, rubrica inline)"]
    CompositionEditor --> ShortfallWarning["ShortfallWarning\n(fabbisogno non coperto)"]

    CompositionEditor --> PublishPanel["PublishPanel\n(completeness check + conferma)"]
    PublishPanel --> PublishConfirmDialog["PublishConfirmDialog\n(destructive action pattern)"]

    ExamCard --> PdfExportPanel["PdfExportPanel\n(tipo: prova/soluzione/rubrica)"]
    ExamCard --> DriveLink["DriveLinkRecorder\n(URL manuale)"]
    ExamCard --> FormsPanel["GoogleFormsPanel\n(crea Form, link, importa)"]
```

---

### Archivio

```mermaid
flowchart TD
    ArchivePage["ArchivePage\n(tab: Classi / Consegne / Storico)"]

    ArchivePage --> ClassTab["ClassTab"]
    ClassTab --> ClassList["ClassList"]
    ClassList --> ClassDetail["ClassDetail\n(lista studenti)"]
    ClassDetail --> StudentForm["StudentForm\n(crea/modifica)"]
    ClassDetail --> RosterImportFlow["RosterImportFlow\n(anteprima + conferma)"]

    ArchivePage --> SubmissionTab["SubmissionTab"]
    SubmissionTab --> AssignmentList["AssignmentList\n(verifica → assegnazione)"]
    AssignmentList --> AssignmentDetail["AssignmentDetail\n(consegne, stati, link Drive)"]
    AssignmentDetail --> SubmissionRow["SubmissionRow\n(studente, stato, link correzione)"]
    AssignmentDetail --> QuarantinePanel["QuarantinePanel\n(risposte non mappabili)"]
    AssignmentDetail --> ManualSubmissionForm["ManualSubmissionForm"]

    ArchivePage --> HistoryTab["HistoryTab"]
    HistoryTab --> HistoryFilters["HistoryFilters\n(programma, classe, studente, date, stato)"]
    HistoryTab --> HistoryTable["HistoryTable\n(paginata)"]
```

---

### Correzione

```mermaid
flowchart TD
    CorrectionPage["CorrectionPage\n(contesto: submissionId)"]
    CorrectionPage --> SubmissionHeader["SubmissionHeader\n(studente, verifica, data)"]
    CorrectionPage --> ItemCorrectionList["ItemCorrectionList"]
    ItemCorrectionList --> ItemCorrectionCard["ItemCorrectionCard\n(risposta + punteggio + rubrica)"]
    ItemCorrectionCard --> ScoreInput["ScoreInput\n(0 ≤ score ≤ maxScore)"]
    ItemCorrectionCard --> CommentInput["CommentInput"]
    ItemCorrectionCard --> AiProposalPanel["AiProposalPanel\n(proposta + motivazione, solo se presente)"]
    AiProposalPanel --> ApproveRejectControls["ApproveRejectControls"]

    CorrectionPage --> PercentageSummary["PercentageSummary\n(live, non_definitiva se incompleto)"]
    CorrectionPage --> AuditTrail["AuditTrail\n(rettifiche con valore precedente)"]
    CorrectionPage --> BulkApprovePanel["BulkApprovePanel\n(solo se AI abilitata e proposte presenti)"]
```

---

## Stato globale e comunicazione

```mermaid
flowchart LR
    Store["Zustand store\n(sessione, feature flags)"]
    QueryClient["TanStack Query\n(cache dati Firestore / API)"]
    FirebaseSDK["Firebase SDK\n(Auth, Firestore, Storage)"]
    BackendCalls["httpsCallable\n(Cloud Functions)"]

    Store -->|"fornisce featureFlags"| AiCorrection
    Store -->|"fornisce ownerUid"| QueryClient
    QueryClient -->|"query + mutations"| FirebaseSDK
    QueryClient -->|"mutations irreversibili"| BackendCalls
    FirebaseSDK -->|"realtime listeners (opzionali)"| QueryClient
```

**Regole di stato:**
1. Lo stato dell'applicazione è derivato dalla cache di TanStack Query alimentata da Firestore e dalle Cloud Functions. Non viene usato Redux o Context React per dati server.
2. Le mutazioni che modificano stato della Verifica, pubblicazione, correzione e importazione passano sempre attraverso le Cloud Functions (non tramite SDK Firestore direttamente).
3. Le letture di dati non critici (lista programmi, UDA, lezioni, storico) possono usare direttamente l'SDK Firestore con le Security Rules come garanzia.
4. I feature flag vengono letti da `getSession` al login e conservati nello Zustand store per la durata della sessione.

---

## Pattern trasversali UI

### Destructive Action Pattern

Ogni operazione irreversibile (pubblicazione, eliminazione, import conferma, correzione massiva) usa sempre questo pattern:

```
1. Pulsante primario con etichetta chiara dell'azione
2. Dialog di conferma con:
   a. Titolo: "Conferma [azione]"
   b. Corpo: conseguenze specifiche (es. "Il contenuto della verifica diventerà immutabile")
   c. Lista degli oggetti coinvolti (se applicabile)
   d. Pulsante "Annulla" (default focus) e pulsante "Conferma [azione]" (rosso o accent)
3. Loading state durante l'operazione
4. Feedback di successo o errore con messaggio specifico
```

### Error State Pattern

Gli errori seguono sempre la struttura:
- **Cosa è successo** (oggetto e azione)
- **Perché** (causa dal backend `{ code, message }`)
- **Cosa fare** (azione correttiva disponibile)

Nessuno stack trace viene mostrato nell'UI. I codici tecnici compaiono solo nel tooltip "Copia per supporto".

### Empty State Pattern

Le liste vuote mostrano sempre:
- Stato vuoto contestuale (es. "Nessuna lezione in questa UDA")
- Azione primaria disponibile (es. "Importa la prima lezione")
- Link alla documentazione (se applicabile)
