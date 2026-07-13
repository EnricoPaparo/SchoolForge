# DUX-04D — Matrice di parità funzionale (Gate)

Confronto controllo-per-controllo tra le tre viste legacy (**Corsi** =
`ProgramsView`, **Lezioni** = `LessonsView`, **Domande** = `DomandeView`) e la
loro collocazione dentro **Didattica** (`DidatticaView` + `CourseWorkspace` +
componenti condivisi). Ogni riga è verificata contro i service realmente
importati (via `rg`), non per deduzione.

**Verdetto Gate: PASS** — ogni funzionalità è *coperta* o *intenzionalmente
ritirata con motivazione*; l'unico gap (backfill `publicLessons`) è stato
colmato spostando il trigger dentro Didattica (vedi §Backfill).

Legenda stato: ✅ coperta · 🅫 intenzionalmente ritirata · ⛔ gap bloccante.

## Corsi (`ProgramsView`)

| Azione | Service/helper | Sostituto in Didattica | Test | Stato |
|---|---|---|---|---|
| Crea corso | `createProgram` | `DidatticaView` → "+ Nuovo corso" (`TitleDialog`) | `DidatticaView.test` "creates a course and refreshes" | ✅ |
| Rinomina corso | `updateProgramTitle` | `CourseWorkspace` toolbar → "Modifica titolo" | `CourseWorkspace.test` "renames the course and patches the card" | ✅ |
| Import iniziale (nuovo corso da ZIP) | `createProgram`+`importRepository`+`readZipFile` | `DidatticaView` → "Importa ZIP" | `DidatticaView.test` "imports a new course from ZIP" | ✅ |
| Reimport (ZIP in corso esistente) | `importRepository`+`readZipFile` | `CourseWorkspace` → "Importa ZIP" (`ImportIntoCourseDialog`) | `CourseWorkspace.test` "imports a ZIP into the course and patches only that course" | ✅ |
| Export ZIP | `exportZip` | `CourseWorkspace` menu → "Esporta ZIP" | (handler riuso; `exportZip.test` copre il service) | ✅ |
| Programma svolto MD | `generateMarkdown`+`downloadMarkdown` | `CourseWorkspace` menu → "Programma svolto (MD)" | `programmaSvolto.test` (service) | ✅ |
| Programma svolto PDF | `generateMarkdown`+`downloadPdf` | `CourseWorkspace` menu → "Programma svolto (PDF)" | `programmaSvolto.test` (service) | ✅ |
| Classi assegnate | `listClasses`+`setProgramClassIds` | `CourseWorkspace` menu → "Classi assegnate" (`ClassesDialog`) | `CourseWorkspace.test` "classes dialog preselected / save preserves / edit updates" | ✅ |
| Informazioni programma | `getImportMeta` | `CourseWorkspace` menu → "Informazioni" (`ProgramInfoDialog`) | riuso `ProgramInfoDialog`; contatori in `CourseWorkspace.test` | ✅ |
| Eliminazione corso | `deleteProgram` | `CourseWorkspace` menu → "Elimina corso" (`ConfirmDialog`) | `CourseWorkspace.test` "deletes the course and notifies the parent" | ✅ |
| Visualizzazione UDA/lezioni | `listUdas`+`listLessons` | `CourseWorkspace` sidebar + tabelle overview | `CourseWorkspace.test` "loads UDA and lessons once / course overview / UDA overview" | ✅ |
| Modifica metadata UDA | `updateUdaMetadata` | `CourseWorkspace` UDA menu → "Modifica metadata" (`UdaMetadataDialog`) | `CourseWorkspace.test` "edits UDA metadata and updates the tree" | ✅ |
| Creazione UDA | `createUda` | `CourseWorkspace` → "+ Nuova UDA" (`NewUdaDialog`) | `CourseWorkspace.test` "creates a new UDA and shows it in the sidebar" | ✅ |
| Eliminazione UDA | `deleteUda` (+guard) | `CourseWorkspace` UDA menu → "Elimina UDA" | `CourseWorkspace.test` "deletes an authorized UDA / blocked by verifications" | ✅ |
| Stato svolta (toggle) | `setLessonCompleted` | `CourseWorkspace` toolbar lezione → "Segna svolta" | `CourseWorkspace.test` "toggles completion with one write" | ✅ |
| Guardie verifiche collegate | `RepositoryDeleteBlockedError` | Dialog blocker UDA/lezione | `CourseWorkspace.test` "blocked by verifications" (UDA e lezione) | ✅ |

## Lezioni (`LessonsView`)

| Azione | Service/helper | Sostituto in Didattica | Test | Stato |
|---|---|---|---|---|
| Caricamento contenuto | `fetchLessonContent`+`parseLessonMetadata` | `CourseWorkspace` scheda Contenuto | `CourseWorkspace.test` "loads the lesson Markdown on demand" | ✅ |
| PDF lezione | `downloadLessonPdf` | `CourseWorkspace` toolbar → "Scarica PDF" | `CourseWorkspace.test` "downloads the PDF reusing the already-loaded content" | ✅ |
| Modifica corpo Markdown | `updateLessonMarkdownBody` | scheda Contenuto → "Modifica contenuto" (`MarkdownBodyEditor`) | `CourseWorkspace.test` "saves content via updateLessonMarkdownBody" | ✅ |
| Modifica front matter (metadata) | `updateLessonMetadata` | scheda Informazioni → "Modifica informazioni" (`LessonMetadataForm`) | `CourseWorkspace.test` "saves metadata via updateLessonMetadata without touching the body" | ✅ |
| Creazione UDA | `createUda` | come Corsi (sopra) | `CourseWorkspace.test` "creates a new UDA" | ✅ |
| Eliminazione UDA | `deleteUda` (+guard) | come Corsi (sopra) | `CourseWorkspace.test` "deletes an authorized UDA / blocked" | ✅ |
| Creazione lezione | `createLesson` | `CourseWorkspace` → "+ Nuova lezione" (`NewLessonDialog`) | `CourseWorkspace.test` "creates a lesson, updates the tree locally" | ✅ |
| Eliminazione lezione | `deleteLesson` (+guard) | toolbar lezione → ⋯ "Elimina lezione" | `CourseWorkspace.test` "deletes an authorized lesson / blocked" | ✅ |
| Riordino UDA | `reorderUda` | modalità Organizza (livello corso) | `CourseWorkspace.test` "reorders UDAs down via reorderUda" | ✅ |
| Riordino lezioni | `reorderLesson` | modalità Organizza (livello UDA) | `CourseWorkspace.test` "reorders lessons only within the UDA" | ✅ |
| Stato svolta | `setLessonCompleted` | toolbar lezione → "Segna svolta" | `CourseWorkspace.test` "toggles completion" | ✅ |
| Backfill/migrazione `publicLessons` | `isPublicLessonsMigrationComplete`+`backfillPublicLessonsContent` | `DidatticaView` → avviso di manutenzione discreto (owner-only) | `DidatticaView.test` "publicLessons migration notice + run" | ✅ (gap colmato) |
| Gestione errori e blocker | `RepositoryDeleteBlockedError` + messaggi | Dialog blocker + errori inline editor/reorder | `CourseWorkspace.test` (blocked, errore reorder, errore contenuto) | ✅ |

## Domande (`DomandeView`)

Tutte le operazioni pool sono realizzate da `QuestionPoolEditor`, estratto e
condiviso con la vista legacy durante DUX-03. Dopo la rimozione di
`DomandeView`, il componente è montato unicamente dalla scheda Domande di
`CourseWorkspace`: la logica resta identica e ha un solo punto di manutenzione
in Didattica.

| Azione | Service/helper | Sostituto in Didattica | Test | Stato |
|---|---|---|---|---|
| Pool assente | `loadPool` → absent | scheda Domande → "Crea pool" | `QuestionPoolEditor.test` "absent state with create action" | ✅ |
| Pool valido/non valido | `loadPool`+`parsePool` | scheda Domande | `QuestionPoolEditor.test` (load once) + `QuestionPoolEditor` deep test | ✅ |
| Creazione pool | `savePool` (da template) | "Crea pool" | deep test (create/save) | ✅ |
| Eliminazione pool | `deletePool` (+guard) | "Elimina pool" | deep test "delete pool / blockers" | ✅ |
| Editor YAML | `parsePool`+`serializePool`+`savePool` | "Modifica YAML" | deep test "YAML editor save flow" | ✅ |
| Creazione/modifica/eliminazione domanda | `savePool` | form domanda | deep test "add/edit/delete question" | ✅ |
| Validazione | `validateDraft`+`parsePool` | messaggi UX inline | deep test "UX validation messages" | ✅ |
| Guardie verifiche | `PoolDeleteBlockedError` | blocker list | deep test "blockers list" | ✅ |
| Aggiornamento `questionCount`/`poolStatus` | `onPoolCountChange` | patch albero/card in `CourseWorkspace` | `CourseWorkspace.test` "updates the domande counter locally" | ✅ |

## Backfill `publicLessons` (M3F-08) — decisione

**Perché esiste**: migrazione one-shot owner-only che riempie il campo
`content` nelle proiezioni `publicLessons` create *prima* di M3F-08 (quando il
campo non esisteva). La visibilità del trigger è decisa da una singola lettura
di `settings/publicLessonsMigration` (`isPublicLessonsMigrationComplete`), mai
scansionando ogni documento a ogni mount. Ogni percorso di scrittura *dopo*
M3F-08 mantiene `content` sincronizzato.

**È ancora necessario?** Sì finché il marker non è impostato: un owner con
proiezioni legacy prive di `content` romperebbe il rendering studente. Non è
sostituito da altro flusso.

**Può essere ritirato?** No, non silenziosamente: non possiamo sapere se questo
owner ha già eseguito la migrazione.

**Decisione**: **spostato**, non ritirato — riproposto come **azione
amministrativa discreta dentro Didattica** (avviso nella libreria, visibile
solo quando `isPublicLessonsMigrationComplete` è `false`), riusando gli stessi
service `isPublicLessonsMigrationComplete`/`backfillPublicLessonsContent` senza
duplicare logica. A migrazione conclusa il marker si imposta e l'avviso
operativo sparisce, come avveniva nella precedente `LessonsView`; il riepilogo
dell'esecuzione resta visibile nella sessione corrente.

## Componenti/UI ritirati con la rimozione

| Elemento | Stato | Motivazione |
|---|---|---|
| `ProgramsView` (albero Corsi minimale, pannelli espansi) | 🅫 | UI duplicata; ogni azione ha sostituto in Didattica (sopra). |
| `LessonsView` (terzo albero, editor inline) | 🅫 | UI duplicata; editor spostati in `lessonEditors`. |
| `DomandeView` (quarto albero) | 🅫 | Guscio attorno a `QuestionPoolEditor` (conservato). |
| `ImportZipModal` | 🅫 | Usato solo da `ProgramsView`; sostituito da `ImportIntoCourseDialog`. |
| Toolbar/tab a icone dei pannelli legacy | 🅫 | Sostituite dai menu contestuali `⋯` in Didattica. |
