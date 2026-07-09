# Checklist manuale G4-lite — M3-lite (Portale studente)

**Versione:** 1.0
**Commit di riferimento:** branch `claude/m3-lite-google-student-portal-yk2fja` (M3L-E light)
**Ambiente:** Firebase DEV — https://schoolforge-dev.web.app
**Metodo:** checklist operativa **da eseguire manualmente** da un umano con due account Google reali (docente/owner + studente). Non è stata eseguita in questa sessione: l'agente non ha accesso interattivo a un flusso di login Google reale su DEV. È un template pronto, con step ed esito atteso già scritti; la colonna "Risultato" va compilata da chi esegue il test.

## Perché una checklist manuale e non solo test automatici

I 6 punti della gate G4-lite sono già coperti a livello di unit/component/rules test (vedi sezione "Copertura automatica già esistente" più sotto). Questa checklist non li duplica: verifica che la catena reale — login Google DEV → Security Rules DEV deployate → build DEV → browser — si comporti come i test unitari assumono, cosa che nessun test automatico locale può garantire (rules ed eseguibile deployati, non emulati).

## Setup richiesto

1. Un account Google che è owner del progetto (`ownerUid` in `settings/ownerPublic`) — già disponibile da smoke test precedenti.
2. Un secondo account Google (qualsiasi, anche personale) da usare come "studente di test", **non** l'owner.
3. Dal TeacherShell (sezione Studenti), dopo il primo login del secondo account:
   - lasciarlo in `pending` per il punto 2 della checklist;
   - poi impostarlo `blocked` per la seconda parte del punto 2;
   - poi approvarlo (`approved`) **senza** assegnargli una classe per il punto 3;
   - poi assegnargli una classe (es. "Classe A") per i punti 4 e 5.
4. Almeno un programma con `classIds` che includa "Classe A" e almeno una lezione pubblicata (`publicLessons`) al suo interno.
5. Almeno una verifica con `visibility: 'public'` e `classId` = "Classe A" (attivata dal docente), e — per il punto 5 — almeno una verifica con `visibility` diversa da `public` o `classId` diverso, per confermare che *non* compaia.
6. `settings/studentAccess.studentPortalEnabled == true` per tutta la durata del test (altrimenti nessuno studente approvato vede contenuti, per design).

## Checklist

| # | Verifica | Passi | Expected | Risultato |
|---|---|---|---|---|
| 1 | Docente vede TeacherShell | Login con account owner su https://schoolforge-dev.web.app | Reindirizzato a TeacherShell (Corsi/Classi/Verifiche/Studenti/Template), nessuna vista studente | ⬜ da eseguire |
| 2a | Studente `pending` non vede contenuti | Login con account studente mentre `students/{uid}.status == 'pending'` | Schermata di attesa approvazione, nessun contenuto Lezioni/Verifiche raggiungibile | ⬜ da eseguire |
| 2b | Studente `blocked` non vede contenuti | Impostare lo stesso account a `blocked`, ricaricare | Schermata di accesso bloccato, nessun contenuto raggiungibile | ⬜ da eseguire |
| 3 | Studente `approved` senza classe vede messaggio "nessuna classe assegnata" | Approvare l'account senza assegnare `classId`, login, apri sia Lezioni che Verifiche | Entrambe le sezioni mostrano il messaggio "Nessuna classe assegnata" (o equivalente), nessun elenco | ⬜ da eseguire |
| 4 | Studente `approved` con classe vede le lezioni della propria classe | Assegnare `classId` = "Classe A", apri Lezioni | Compaiono solo i programmi/UDA/lezioni pubblicate la cui `classIds` include "Classe A"; nessun programma di altre classi | ⬜ da eseguire |
| 5 | Studente `approved` con classe vede solo le verifiche `public` della propria classe | Apri Verifiche | Compaiono solo le verifiche `active`+`public` con `classId` = "Classe A"; verifiche `draft`/`hidden`/`closed` o di altra classe **non** compaiono | ⬜ da eseguire |
| 6 | Il PDF studente non contiene soluzioni | Da Verifiche, click "Scarica PDF" su una verifica visibile, apri il PDF scaricato | Il PDF contiene domande e spazio risposta, nessuna soluzione/risposta corretta/punteggio in nessuna pagina | ⬜ da eseguire |

## Copertura automatica già esistente (non riverificata qui, solo referenziata)

- **Docente → TeacherShell / pending / blocked**: `RoleGate.test.tsx` (19 test) — incl. varianti con portale on/off.
- **Nessuna classe assegnata**: `StudentShell.test.tsx`, `StudentLessonsView.test.tsx`, `StudentVerificationsView.test.tsx`, `studentLessonsService.test.ts`, `studentVerificationsService.test.ts` — stato `no-class` testato a ogni livello.
- **Lezioni filtrate per classe**: `studentLessonsService.test.ts`, `StudentLessonsView.test.tsx`, `m3l-student-lessons.rules.test.ts` (24 test), `m3l-storage-lesson-class-gate.rules.test.ts` (13 test).
- **Verifiche filtrate per classe + visibility public**: `studentVerificationsService.test.ts`, `StudentVerificationsView.test.tsx`, `m3l-student-verifications.rules.test.ts` (19 test), `m3l-data-projections.rules.test.ts` (44 test).
- **PDF senza soluzioni**: `verificationPdf.test.ts` (`downloadStudentPdf` e `downloadStudentPdfFromProjection`), `StudentVerificationsView.test.tsx`.
- **Integrazione StudentShell → dati reali** (gap chiuso in M3L-E light): 2 nuovi test in `StudentShell.test.tsx` che esercitano il ramo `status: 'ok'` di `loadStudentLessons`/`loadStudentVerifications` (prima testato solo il ramo `no-class`).

## Limiti residui

- Questa checklist non è stata eseguita con un login Google reale in questa sessione: è un template operativo, non un report di esito.
- Non copre carico concorrente, performance, o Security Rules sotto traffico reale (già annotato come limite in `smoke-dev-deploy.md`).
- Non copre E2E Playwright (fuori scope per M3L-E light, resta eventualmente per un M3L-E completo).
