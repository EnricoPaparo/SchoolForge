# HARD-02A — Audit accessibilità end-to-end V1 (docente + studente)

**Data:** 15 luglio 2026 · **Ambito:** finding **HARD-F08** (nessun audit a11y formale).
**Natura:** audit **di verifica**, prevalentemente statico. Nessuna nuova funzionalità, nessun redesign, nessuna implementazione di HARD-F06. Nessuna modifica a codice applicativo in questa fase (nessun P0/P1 trovato che lo richiedesse).

## 1. Ambiente e metodo

- **Metodo:** revisione statica del codice sorgente (`apps/web/src`, componenti `.tsx` + CSS module + `index.css`) e dei test esistenti (`__tests__`), con verifica mirata delle primitive di accessibilità (ruoli ARIA, nomi accessibili, gestione focus, tastiera, landmark, media query).
- **Strumenti riusati:** suite Vitest + Testing-library già presente (query `getByRole`, test tastiera/Escape esistenti); nessuna nuova dipendenza aggiunta (nessun axe-core: non introdotto per non aggiungere dipendenze senza necessità dimostrata — vedi §6 limiti).
- **Limite di ambiente:** **nessun browser interattivo, screen reader o strumento di contrasto/zoom reale** era disponibile in questa sessione. Contrasto, zoom 200%, reflow a 320 CSS px, resa dello screen reader, orientamento mobile reale e comportamento fullscreen sono valutati **solo staticamente** (token colore, `:focus-visible`, media query, markup) e vanno confermati con verifica manuale su DEV (vedi §6).

**Legenda evidenza:** **[auto]** coperto da test automatico esistente · **[statico]** verificato per lettura del codice · **[da confermare]** non verificabile senza browser/AT in questa sessione.

## 2. Fondamenta a11y verificate (trasversali)

| Aspetto | Esito | Evidenza |
|---|---|---|
| Landmark semantici | ✅ [statico] | `<main>` (RoleGate, OwnerSetup, TeacherShell:220), `<header>` + `<nav aria-label>` (TeacherShell:101-104, CourseWorkspace:1189-1236) |
| Focus visibile | ✅ [statico] | `index.css:194` `button:focus-visible` + ring; `index.css:260-267` focus ring su input/textarea/select; token `--color-focus-ring` |
| `prefers-reduced-motion` | ✅ [statico] | `index.css:71`, `DidatticaView.module.css:159`, `StudentDidatticaView.module.css:86` |
| Tabs ARIA + tastiera | ✅ [auto] | `role="tablist"/"tab"/"tabpanel"` + `aria-selected` + `aria-controls` + roving tabindex + frecce/Home/End (CourseWorkspace:2258-2359, StudentsView:491; test `CourseWorkspace.test:717`, `StudentsView.test:146`) |
| Tabelle semantiche | ✅ [statico] | `<thead>`/`<th>` (AttentionEventsDialog:152-157, CourseWorkspace:1977-1985) |
| Nomi accessibili pulsanti icon-only | ✅ [statico] | `aria-label` diffuso (20 file); CourseWorkspace 20 occorrenze; icone decorative con testo/label |
| Immagini | ✅ [statico] | logo `alt="SchoolForge"`; avatar profilo `alt="" aria-hidden="true"` (decorativo, nome mostrato come testo) — TeacherShell:188-191, StudentShell:228-231 |
| Errori annunciabili | ✅ [statico] | messaggi d'errore con `role="alert"` in dialog/form/exam (workspaceDialogs, OnlineExamView:338/528) |
| Menu contestuali: Escape + restore focus | ✅ [auto] | CourseWorkspace:550-552; test `CourseWorkspace.test:782` «closes contextual menus with Escape … and restores trigger focus» |

## 3. Matrice dei flussi verificati

| # | Flusso | Componente | Esito a11y | Evidenza |
|---|---|---|---|---|
| 1 | Login Google | `LoginPage`, `auth.tsx` | ✅ pulsante reale, logo con alt | [statico] |
| 2 | Navigazione header docente | `TeacherShell` | ✅ `<nav aria-label>`, `aria-current`, selettore mobile, Escape su dropdown (`:75`) | [statico] |
| 3 | Didattica desktop/mobile | `DidatticaView` | ✅ card come `<button>`/`<a>` reali, reduced-motion | [statico] |
| 4 | Sidebar drill-down corso/UDA/lezione | `CourseWorkspace` | ✅ `<nav aria-label="Struttura corso">`, mobile drill-down, `useIsMobile` | [statico] |
| 5 | Editor metadati/Markdown/domande | `CourseWorkspace`, `lessonEditors`, `QuestionPoolEditor` | ✅ tabs ARIA, textarea etichettate; ⚠ vedi P2-01 (dialog) e P3-01 (aria-invalid) | [auto]+[statico] |
| 6 | Studenti / Classi | `StudentsView`, `ClassesTab` | ✅ tablist tastiera (test), conferme di rimozione | [auto] |
| 7 | Verifiche + picker domande + conferme | `VerificationsView`, `QuestionPicker` | ✅ dialog con Escape/close/backdrop (test `VerificationsView.test:2497`) | [auto] |
| 8 | Svolgimento verifica online | `OnlineExamView` | ✅ `<section aria-label>`, `<nav>` navigatore domande, `role="radiogroup"`, `aria-pressed` flag, `aria-label` risposte | [statico] |
| 9 | Consegna | `OnlineExamView` (conferma) | ✅ `role="alertdialog" aria-label` + `role="alert"` errori | [statico] |
| 10 | Monitor consegne | `VerificationsView`/monitor | ✅ tabella semantica, stato caricamento | [statico] |
| 11 | Workspace di correzione | `CorrectionWorkspace` | ✅ form/tabelle etichettate; ⚠ P3-01 (associazione errore↔campo) | [statico] |
| 12 | Restituzione + consultazione studente | `StudentCorrectionView`, `correctionReturns` | ✅ struttura heading/landmark | [statico] |
| 13 | Template | `TemplateKitView` | ✅ griglia, SVG locali, card reali | [statico] |
| 14 | Modalità verifica / fullscreen | `OnlineExamView`, `examDeterrence` | ✅ fullscreen best-effort, non blocca la tastiera; ⚠ resa reale [da confermare] | [statico] |
| 15 | Dialog condivisi (Conferma/Nuovo/Import/UDA/Lezione/Classi/Info) | `workspaceDialogs` (`DialogShell`) | ⚠ **P2-01**: no Escape, no focus trap, no restore | [statico] |

## 4. Finding

Classificazione: **P0** blocco totale/rischio grave · **P1** flusso essenziale non accessibile · **P2** barriera significativa con workaround · **P3** polish.

### P0 — nessuno
### P1 — nessuno
> Tutti i flussi essenziali sono operabili da tastiera: focus visibile, landmark, tabs con frecce, dialog con autofocus e pulsanti raggiungibili, exam view completamente etichettata.

### P2

**P2-01 — Il dialog condiviso `DialogShell` non gestisce Escape, focus trap e ripristino del focus.**
- **File/componente:** `apps/web/src/features/teacher/workspaceDialogs.tsx:17-40` (`DialogShell`), usato da `ConfirmDialog`, `TitleDialog`, `NewCourseDialog`, `ImportDialog`, `ImportIntoCourseDialog`, `UdaMetadataDialog`, `NewUdaDialog`, `NewLessonDialog`, `ClassesDialog`, `ProgramInfoDialog`.
- **Problema:** `DialogShell` imposta correttamente `role="dialog"`, `aria-modal="true"`, `aria-label` e mette a fuoco il primo campo (`autoFocus`), ma **non** intercetta `Escape`, **non** confina il focus dentro il modale (Tab può raggiungere il contenuto dietro) e **non** ripristina il focus sul trigger alla chiusura. Incoerenza interna: `AttentionEventsDialog.tsx:88-110` implementa invece trap + Escape completi, e i dialog di `VerificationsView` hanno il test di Escape (`VerificationsView.test:2497`).
- **Riproduzione:** apri un dialog Didattica (es. «Elimina corso» / «Nuova UDA»); premi **Esc** → non si chiude; premi **Tab** ripetutamente → il focus esce dietro il backdrop invece di ciclare tra i controlli del dialog.
- **Impatto:** barriera per utenti solo-tastiera/screen reader (WCAG 2.1.2 No Keyboard Trap è rispettato, ma 2.4.3 Focus Order e la best practice APG «modal» no). **Workaround esistente:** l'`autoFocus` porta dentro il dialog, il pulsante «Annulla» è raggiungibile con Tab e il click sul backdrop (mouse) chiude → non è un blocco totale, da qui P2.
- **Correzione minima suggerita (HARD-02A-FIX, non applicata qui):** aggiungere in `DialogShell` un `useEffect` con handler `Escape → onCancel`, un focus trap (ciclo Tab/Shift+Tab tra i focusable) e il ripristino del focus sull'elemento attivo precedente — riusando il pattern già presente in `AttentionEventsDialog`. Un solo punto centrale copre tutti i dialog. Test mirato: Escape chiude, Tab cicla, focus ripristinato.

### P3

**P3-01 — Campi form non associati programmaticamente al messaggio d'errore.**
- **File/componente:** `workspaceDialogs.tsx` (form vari), `CorrectionWorkspace`, `VerificationsView` — l'errore è reso con `role="alert"` ma gli `input`/`textarea` non hanno `aria-invalid`/`aria-describedby` che puntino all'errore (`aria-invalid` = 0 occorrenze nel codice).
- **Impatto:** lo screen reader annuncia l'alert quando compare, ma spostandosi sul campo non ne apprende lo stato d'errore. Polish, non barriera.
- **Correzione:** su validazione fallita, marcare il campo `aria-invalid="true"` e `aria-describedby` verso l'`id` del messaggio.

**P3-02 — `<th>` senza `scope` esplicito.**
- **File/componente:** `AttentionEventsDialog.tsx:155-157`, `CourseWorkspace.tsx:1985`.
- **Impatto:** minimo — sono tabelle semplici a intestazione di colonna, dove lo scope colonna è implicito; esplicitare `scope="col"` è più robusto per gli AT.

**P3-03 — Verifiche non automatizzabili staticamente (limite, non difetto confermato).**
- Contrasto colore AA, zoom 200%, reflow 320 CSS px, resa screen reader, orientamento mobile e fullscreen reale non sono stati misurati (nessun browser/AT in sessione). Le fondamenta ci sono (token colore, focus ring, `prefers-reduced-motion`, layout flex/grid responsive già validato in DUX), ma la conferma va fatta manualmente su DEV.

## 5. Cosa è stato realmente verificato e cosa no

- **Verificato [statico/auto]:** presenza e correttezza di ruoli/nomi/landmark/tabs/tabelle/focus ring/reduced-motion; gestione Escape e focus dei **menu contestuali** e dei dialog **AttentionEventsDialog/VerificationsView** (test); etichettatura completa dell'exam view; immagini decorative vs informative.
- **Non verificato [da confermare]:** contrasto reale, zoom 200%, reflow 320px, screen reader (NVDA/VoiceOver), orientamento mobile fisico, resa fullscreen, e la resa effettiva di `prefers-reduced-motion`. Da coprire con uno smoke a11y manuale su DEV (tastiera + AT), non con nuovi test E2E fragili.

## 6. Verdetto

> **READY FOR REMEDIATION.**

Nessun P0/P1: tutti i flussi essenziali docente e studente sono accessibili da tastiera con semantica corretta. Resta **1 finding P2** (dialog condiviso senza Escape/trap/restore) e finding P3 di polish. Non è un **PASS** pulito per via del P2; non è **BLOCKED** perché nessuna barriera impedisce l'uso.

### Perimetro minimo HARD-02A-FIX (proposto, non eseguito)
1. **P2-01:** centralizzare in `DialogShell` Escape-to-close + focus trap + focus restore (riuso del pattern `AttentionEventsDialog`), con un test mirato. Un'unica modifica risolve tutti i dialog Didattica.
2. *(opzionale P3)* `aria-invalid`/`aria-describedby` sui campi in errore; `scope="col"` sulle `<th>`.
3. **Smoke a11y manuale su DEV** (tastiera + screen reader + zoom/reflow) per chiudere i punti [da confermare] del §5.

**Prossimo pacchetto consigliato:** **HARD-02A-FIX** (P2-01, piccolo e centralizzato) seguito da **HARD-02B/F06** (chunking import) e dallo smoke a11y manuale; poi il **Gate GHARD**.
</content>
