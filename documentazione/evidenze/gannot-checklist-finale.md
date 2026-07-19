# Gate GANNOT — checklist finale (appunti personali dello studente)

**Verdetto: Gate GANNOT — PASS.**
**Data:** 19 luglio 2026.
**Perimetro:** appunti personali dello studente sulle lezioni (ANNOT-01 → ANNOT-03B).
**Natura del documento:** solo evidenze. Nessuna nuova funzionalità, nessuna modifica a
codice applicativo, Rules, indici, schema, dipendenze o configurazione Firebase, nessun
deploy introdotto da questa chiusura.

## 1. Stato dei pacchetti

| Pacchetto | Stato | Contenuto |
|---|---|---|
| ANNOT-01 | ✅ implementato/mergiato | Contratto `StudentLessonNoteDoc`, service Firestore, Security Rules owner-student-only, test unitari + Emulator. |
| ANNOT-02 | ✅ implementato/mergiato | UI: comando `Appunti`, controller/cache `useLessonNotes`, pannello desktop post-it + vista mobile, salvataggio manuale/blur/debounce 15 s, dirty guard. |
| ANNOT-03A | ✅ implementato/mergiato | Rifinitura UX (Salva esplicito, `Ctrl/Cmd+S`, stati leggibili, comando struttura desktop). |
| ANNOT-03B | ✅ implementato/mergiato + **pubblicato su DEV** (Hosting + Firestore Rules) | Indice per corso, bootstrap controllato, batch atomici nota+indice, indicatore «matita» persistente, post-it RGBA 90%. |

L'identità canonica della lezione è **`publicLessonId`** (l'id del documento
`publicLessons`): `PublicLessonDoc` non possiede un campo `lessonId` proprio. Il contratto
non duplica alcuna identità non verificabile dalle Rules (vedi
`student-notes-contract.md` §4).

## 2. Matrice finale delle evidenze

Legenda evidenza: **A** = evidenza automatica (test); **M** = conferma manuale su DEV
realmente disponibile; **—** = non applicabile/non dichiarata.

| # | Criterio | Evidenza automatica (A) | Conferma manuale DEV (M) | Limite residuo |
|---|---|---|---|---|
| 1 | Lettura e modifica dei soli appunti personali | `annot-01-lesson-notes.rules.test.ts` (matrice: owner student read/create/update/delete permessi); `studentLessonNotesService.test.ts` (load/update path deterministico) | Esperienza finale verificata visivamente su DEV | — |
| 2 | Docente impossibilitato a leggere gli appunti | `annot-01-…rules.test.ts` «denies the teacher/owner every operation» e «denies … the teacher every index access» | Verifica visiva DEV (nessun accesso docente) | — |
| 3 | Isolamento tra studenti | `annot-01-…rules.test.ts` «denies another student …» (nota e indice) | — | — |
| 4 | Accesso vincolato a classe, programma e import attivo | `annot-01-…rules.test.ts` (classe non assegnata / import non attivo / programma o publicLesson mancante negati) via `canAccessLessonForNotes`/`canAccessProgramForNotes` | Import/classe provati su DEV | — |
| 5 | Blocco completo durante Modalità verifica | `annot-01-…rules.test.ts` (Modalità verifica globale e per classe negano nota, indice e query di bootstrap); a livello UI la Didattica è smontata da `StudentShell` (`m3f-07-exam-mode.rules.test.ts`) | Modalità verifica provata su DEV | — |
| 6 | Salvataggio manuale e autosave senza scritture inutili | `useLessonNotes.test.tsx` (no-op quando invariato; never-persisted vuoto non scrive; debounce 15 s; blur; pulsante) | Salvataggio provato su DEV | — |
| 7 | Dirty guard | `LessonNotesPanel.test.tsx` (Escape su draft sporco apre la conferma); `StudentDidatticaView.notes.test.tsx` (conferma su cambio navigazione) | — | Cambio sezione `StudentShell`/logout smontano la vista senza conferma (documentato in `student-notes-contract.md`) |
| 8 | Creazione/eliminazione nota e indice in batch atomico | `studentLessonNotesService.test.ts` («atomically writes the note and adds its id to the course index»; delete rimuove nota e id dall'indice nello stesso batch) | — | — |
| 9 | Update di una nota esistente senza scrittura superflua dell'indice | `studentLessonNotesService.test.ts` (`updateStudentLessonNote` = un solo `updateDoc`, nessun batch/indice) | — | — |
| 10 | Indice caricato una sola volta per corso/sessione | `StudentDidatticaView.notes.test.tsx` («loads the per-course index once and reuses it when the course is reopened») | — | — |
| 11 | Bootstrap legacy filtrato e autorizzato dalle Rules | `annot-01-…rules.test.ts` («allows the exact filtered query used by the legacy index bootstrap»); `studentLessonNotesService.test.ts` (bootstrap una tantum) | Fix query Rules del bootstrap legacy verificato: suite Rules verde **476/476** | — |
| 12 | Query non filtrata negata | `annot-01-…rules.test.ts` («denies the same student a query/list over students/{uid}/lessonNotes») | — | — |
| 13 | Indicatore persistente dopo salvataggio e rimosso dopo eliminazione | `StudentDidatticaView.notes.test.tsx` (matita/pulsante evidenziato per nota persistita; presente dopo create, assente dopo delete) | Verifica visiva DEV | — |
| 14 | Nessun listener o polling | `useLessonNotes.test.tsx` («never uses a listener/poll»); `studentLessonNotesService.test.ts` (una sola `getDoc` in load) | — | — |
| 15 | Comportamento desktop/mobile e accessibilità essenziale | `LessonNotesPanel.test.tsx` (`aside` non modale desktop / `region` mobile, `maxLength`, contatore, focus, Escape); `StudentDidatticaView.notes.test.tsx` (vista mobile) | Esperienza desktop/mobile verificata su DEV | Ripristino scroll mobile best-effort |
| 16 | Budget letture/scritture | Vedi §3, coperto da 8/9/10/14 | Conteggi coerenti osservati su DEV | — |

Totali test automatici mirati: **54** casi web (`studentLessonNotesService` 16 +
`useLessonNotes` 15 + `LessonNotesPanel` 14 + `StudentDidatticaView.notes` — eseguiti e
verdi) e **44** casi Emulator in `annot-01-lesson-notes.rules.test.ts`. La suite Rules
completa è dichiarata verde a **476/476** dopo il fix della query di bootstrap legacy.

## 3. Budget operativo (confermato)

- Apertura di una lezione: **1** read dell'indice per corso/sessione, **0** read per
  lezione a livello di indicatore.
- Apertura degli appunti di una lezione: **1** read della nota, solo alla prima apertura
  nella sessione (riapertura senza nuova lettura).
- Bootstrap una tantum dell'indice (documento mancante o import precedente): **1** read
  indice + read delle sole note del corso/import corrente + **1** write.
- Update di una nota non vuota: **1** write (nessuna scrittura dell'indice).
- Create / svuotamento / delete: **2** write in un unico batch atomico (nota + indice).
- **Zero** listener, polling, scheduler, Cloud Function, IA o indice Firestore composito.

## 4. Conferme manuali realmente utilizzate

Solo quelle effettivamente dichiarate:

1. ANNOT-03B pubblicato su DEV con Hosting + Firestore Rules; il docente ha verificato che
   l'esperienza finale è **visivamente corretta e soddisfacente**.
2. L'ultimo fix ha corretto la **query Rules usata dal bootstrap legacy dell'indice**; la
   **suite completa Rules è verde: 476/476**.

Nessun'altra conferma manuale è dichiarata o assunta.

## 5. Limiti residui accettati

- La dirty guard copre tutte le navigazioni controllate da `StudentDidatticaView`; un
  cambio di sezione dallo `StudentShell` (Didattica↔Verifiche) o il logout smontano la
  vista senza confermare un draft non salvato.
- Ripristino dello scroll mobile: best-effort, solo in memoria.
- Last-write-wins tra dispositivi senza realtime/versioning (accettato per ANNOT V1).
- Una nota di una lezione non più autorizzata resta non leggibile e non cancellabile dal
  client (fail-closed voluto).

Nessuno di questi limiti costituisce un gap funzionale o di sicurezza: sono decisioni di
progetto già dichiarate nel contratto.

## 6. Esito

Tutti i criteri della matrice sono coperti da evidenza automatica adeguata e, dove
dichiarato, da conferma manuale su DEV. Non risultano gap reali.

**Gate GANNOT — PASS.**

Questo PASS non autorizza provisioning o deploy PROD; riguarda esclusivamente la chiusura
funzionale, di sicurezza e di costo degli appunti personali dello studente.
