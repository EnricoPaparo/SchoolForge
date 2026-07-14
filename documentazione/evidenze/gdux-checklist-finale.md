# Gate GDUX — Refactor Didattica/UX: checklist finale di chiusura

**Data:** 15 luglio 2026
**Ambito:** DUX-00 → DUX-10A (incl. 04A–D e 05A–C, 06A–C, 07A–B, 08, 09, 10A). Ultimo fix incluso: PR #174 (uniformità spaziature verticali Didattica/Verifiche, merge `a479e69`).
**Verdetto:** **Gate GDUX superato (PASS).**

Questo documento consolida le evidenze già prodotte — automatiche (CI/test) e manuali (giro finale del docente su DEV) — senza introdurre nuove funzionalità né toccare codice. Richiama `didattica-ux-roadmap.md` (§22 acceptance, §23 roadmap) e la matrice di parità `dux-04d-matrice-parita.md`; non li sostituisce.

## Legenda

- **Automatica** — evidenza da test automatici (unit/integration) verdi in CI, riproducibile con il comando indicato.
- **Manuale DEV** — confermata dal docente nel **giro manuale finale su DEV** (funzionale e grafico). Il docente ha dichiarato corretti i test funzionali e grafici eseguiti; non vengono qui attribuiti browser, device o casi specifici non documentati.
- **Limite residuo** — aspetto reale ma non bloccante, dichiarato esplicitamente.

## Matrice delle evidenze — punti di verifica GDUX

| # | Punto di verifica | Categoria | Evidenza |
|---|---|---|---|
| 1 | Libreria Didattica, filtri e card corsi | Automatica + Manuale DEV | `DidatticaView` (card library + filtro per titolo, metriche di §6) e `courseLibrary` (derivazione conteggi client-side, nessuna nuova query). |
| 2 | Workspace corso → UDA → lezione | Automatica + Manuale DEV | `CourseWorkspace` (75 test): selezione corso/UDA/lezione, sidebar unica, schede Contenuto/Domande/Informazioni. |
| 3 | Navigazione desktop e mobile | Automatica + Manuale DEV | `CourseWorkspace` (hook `useIsMobile`, drill-down mobile un livello per volta, back di un livello); `TeacherShell` (header a riga singola DUX-05C, selettore sezione mobile). |
| 4 | Visualizzazione e modifica di metadati e Markdown | Automatica + Manuale DEV | `CourseWorkspace` (editor contenuto Markdown con anteprima, form metadata lezione/UDA/corso); riuso dei service Repository Editor. |
| 5 | Creazione, eliminazione e riordino di UDA/lezioni | Automatica + Manuale DEV | `CourseWorkspace` (nuova UDA/lezione, eliminazione con guard verifiche, modalità Organizza con frecce ↑/↓ via `reorderUda`/`reorderLesson`). |
| 6 | Editor pool/domande integrato | Automatica + Manuale DEV | `CourseWorkspace` scheda Domande (`QuestionPoolEditor` contestualizzato alla lezione); indicatore pool valido/assente/non valido con etichetta testuale oltre al colore. |
| 7 | Separazione e sicurezza docente/studente | Automatica | `TeacherShell.test` (nav consolidata, **nessuna** voce legacy Corsi/Lezioni/Domande — DUX-04D); nessun componente Didattica importato da `StudentShell` (roadmap §19); Rules invariate. |
| 8 | Didattica studente in sola lettura, pool mai esposti | Automatica + Manuale DEV | `StudentDidatticaView.test`: libreria/workspace da sola `publicLessons`, **nessuna azione docente o pool**, proiezione legacy senza contenuto dichiarata non disponibile senza mai leggere Storage. Vedi anche `evidenze/sdux-02-checklist-dev.md`. |
| 9 | Modalità verifica inibisce la Didattica agli studenti interessati | Automatica + Manuale DEV (G5) | `StudentShell.test`: attivazione → nasconde «Didattica» e smonta `StudentDidatticaView`; disattivazione → ripristino senza nuovo login; classe non coinvolta resta autorizzata. |
| 10 | Classi integrate nella sezione Studenti | Automatica + Manuale DEV | `StudentsView.test` (tab Studenti/Classi, inserimento classe inline, contatore studenti derivato client-side, CRUD preservato). |
| 11 | Verifiche e Template nella UI definitiva | Automatica + Manuale DEV | `VerificationsView`/`TemplateKitView` (tabella + creazione inline + feedback «Salva bozza» persistente; Template griglia 4/2/1, SVG locali). |
| 12 | Assenza delle vecchie viste legacy Corsi/Lezioni/Domande | Automatica | Componenti `ProgramsView`/`LessonsView`/`DomandeView`/`ClassesView`/`ImportZipModal` rimossi dal codice; `TeacherShell.test` «no longer exposes the legacy Corsi/Lezioni/Domande nav (DUX-04D)». |
| 13 | Responsive/mobile senza overflow critici | Automatica + Manuale DEV | `CourseWorkspace`/`TeacherShell`/`StudentsView` (tab a piena larghezza, tabella Verifiche scorribile, sidebar senza overflow orizzontale); giro mobile del docente su DEV. |
| 14 | Coerenza spaziature e componenti condivisi | Automatica + Manuale DEV | Componente riga lezione condiviso, dialog/editor condivisi (`workspaceDialogs`/`lessonEditors`); ultimo fix #174 uniforma le spaziature verticali Didattica/Verifiche, confermato nel giro finale del docente. |

**Comando di riproduzione dell'evidenza automatica:**

```
pnpm --filter @schoolforge/web exec vitest run \
  src/features/teacher/__tests__/DidatticaView.test.tsx \
  src/features/teacher/__tests__/CourseWorkspace.test.tsx \
  src/features/teacher/__tests__/TeacherShell.test.tsx \
  src/features/teacher/__tests__/StudentsView.test.tsx \
  src/features/teacher/__tests__/TemplateKitView.test.tsx \
  src/features/student/__tests__/StudentDidatticaView.test.tsx \
  src/features/student/__tests__/StudentShell.test.tsx \
  src/features/repository/programs/__tests__/courseLibrary.test.ts \
  src/features/repository/programs/__tests__/udaTitle.test.ts
# → 182 test verdi (9 file)
```

## Conferme manuali DEV realmente utilizzate

Il docente ha **completato il giro manuale finale su DEV** dichiarando corretti i test **funzionali e grafici** eseguiti, incluso l'ultimo fix sulle spaziature verticali Didattica/Verifiche. Questa è l'unica conferma manuale citata: non sono attribuiti browser, dispositivi o casi di prova specifici oltre a quanto dichiarato.

## Acceptance criteria del Gate (roadmap §22) — esito

- Ogni funzionalità di Corsi/Lezioni/Domande/Classi raggiungibile da Didattica+Studenti → **soddisfatto** (Gate di parità DUX-04D PASS, `dux-04d-matrice-parita.md`; Classi in Studenti DUX-05A).
- Nessuna Security Rule più permissiva rispetto alla baseline pre-DUX → **soddisfatto** (nessuna modifica a `firestore.rules`/`storage.rules` in tutta la roadmap DUX).
- Nessun nuovo documento Firestore «statistiche/riepilogo» → **soddisfatto** (conteggi derivati client-side).
- Nessuna regressione nei test automatici RE/QE/M3-full/M4 → **soddisfatto** (suite verdi in CI).
- `TeacherShell` non espone più le voci legacy → **soddisfatto**.
- Coerenza desktop/mobile e controlli navigabili semanticamente → **soddisfatto** (`CourseWorkspace`/`TeacherShell` test; `<button>`/`<a>` reali, nessun controllo annidato).

## Limiti residui

- **Copertura mobile/costi via strumenti esterni.** Il responsive è coperto da test di componente e dal giro manuale del docente; non è stata prodotta una matrice browser/device formale né una misura dei costi reali su Firebase Console (non necessaria: DUX non aggiunge letture/scritture/listener — roadmap §20).
- **Accessibilità**: contrasto AA e ruoli ARIA sono progettati e in parte testati; un audit accessibilità end-to-end formale non è parte di questo gate.

## Verdetto

Tutti i 14 punti di verifica hanno **evidenza automatica** verde (182 test, 9 file) e il **giro manuale finale del docente su DEV** è stato dichiarato corretto (funzionale e grafico). Gli acceptance criteria della roadmap §22 sono soddisfatti. Nessun gap bloccante. **Gate GDUX superato (PASS).**

## Prossimo passo — HARD-00

Con GDUX superato si chiude l'ultimo refactor UX; M1–M4 e i Gate G5/G6 sono già superati. **HARD-00** avvia la fase di **hardening finale pre-V1** (ambito da definire): audit trasversale di prestazioni/costi reali su Firebase Console, verifica accessibilità end-to-end, matrice smoke manuale desktop/mobile consolidata e allineamento documentale finale. Non introduce nuove funzionalità.
