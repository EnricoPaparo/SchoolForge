# Checklist manuale DEV — post-hardening M3-lite

**Versione:** 1.0
**Ambiente:** Firebase DEV — https://schoolforge-dev.web.app
**Metodo:** checklist operativa **da eseguire manualmente** da un umano con un account Google docente (owner) e un secondo account Google reale da usare come studente. Non eseguita in questa sessione: nessun accesso interattivo a un login Google reale. Copre l'intero flusso docente + studente dopo l'hardening delle Storage Rules (Storage non legge più Firestore, vedi `sicurezza.md` §3.2a) e va ripetuta dopo ogni modifica a `firestore.rules`/`storage.rules` o a un flusso di import/pubblicazione.

## Perché questa checklist, oltre a `g4-lite-checklist-manuale.md`

`g4-lite-checklist-manuale.md` copre i 6 criteri minimi della gate G4-lite (routing docente/studente, pending/blocked, nessuna classe, filtro classe lezioni/verifiche, PDF senza soluzioni). Questa checklist è più ampia: copre l'intero regression flow docente (import, classi, verifiche, cancellazioni) più il flusso studente end-to-end, pensata per essere ripetuta dopo modifiche architetturali come la rimozione della lettura Firestore da `storage.rules`.

## Setup richiesto

1. Un account Google owner del progetto DEV (già configurato).
2. Un secondo account Google (personale, non owner) da usare come studente di test.
3. Uno ZIP didattico importabile (il kit di esempio scaricabile da **Repository didattico** è sufficiente).

## Checklist

| # | Verifica | Passi | Expected | Risultato |
|---|---|---|---|---|
| 1 | Login docente | Vai su https://schoolforge-dev.web.app, accedi con l'account owner | TeacherShell caricata (Corsi/Classi/Verifiche/Studenti/Template) | ⬜ da eseguire |
| 2 | Creazione/modifica classi | In Classi, crea una classe "Classe Test"; modifica il nome | Classe creata e visibile; modifica salvata | ⬜ da eseguire |
| 3 | Import programma | In Corsi, crea un programma e importa il kit ZIP di esempio | Messaggio "Import completato: N UDA, N lezioni, N domande"; UDA/lezioni visibili | ⬜ da eseguire |
| 4 | Assegnazione programma a classe | Sulla riga del programma, bottone **Classi** → seleziona "Classe Test" → Salva | Il programma mostra "Classe Test" come classe assegnata | ⬜ da eseguire |
| 5 | Apertura lezioni docente | In Lezioni, espandi il programma → UDA → clicca una lezione | Contenuto Markdown renderizzato, titolo leggibile (da front matter o filename pulito) | ⬜ da eseguire |
| 6 | Login studente Google | Su un browser/profilo diverso, accedi con il secondo account Google | Se non ancora registrato: schermata di richiesta accesso o attesa approvazione; nessun contenuto docente visibile | ⬜ da eseguire |
| 7 | Richiesta accesso studente | Se `newStudentRequestsEnabled` è attivo, verifica che il login crei automaticamente `students/{uid}` in `pending` | Lo studente compare in Studenti con stato "In attesa" | ⬜ da eseguire |
| 8 | Approvazione/blocco studente | Dal docente, approva lo studente; poi bloccalo; poi riportalo a `pending`/riapprovalo | Ogni transizione di stato si riflette immediatamente lato studente al refresh (attesa → contenuti → bloccato → attesa) | ⬜ da eseguire |
| 9 | Assegnazione classe studente | Dal docente, assegna "Classe Test" allo studente approvato | Lo studente smette di vedere "nessuna classe assegnata" | ⬜ da eseguire |
| 10 | Visibilità lezioni solo per classe | Lato studente, apri Lezioni | Compaiono solo i programmi assegnati a "Classe Test" (punto 4); nessun altro programma | ⬜ da eseguire |
| 11 | Apertura contenuto lezione studente | Lato studente, clicca una lezione | Il contenuto Markdown si carica correttamente (verifica specifica dell'hardening Storage: nessun errore di permesso) | ⬜ da eseguire |
| 12 | Creazione verifica | Dal docente, in Verifiche, crea una verifica sul programma importato, classe "Classe Test", seleziona almeno 1 domanda | Verifica in stato "bozza" | ⬜ da eseguire |
| 13 | Attivazione verifica | Clicca Attiva verifica → Conferma attivazione | Stato passa ad "attiva"; appaiono i bottoni PDF | ⬜ da eseguire |
| 14 | Pubblicazione/nascondimento verifica | Clicca l'icona pubblica/nascondi più volte | Il badge alterna "pubblica"/"nascosta" coerentemente | ⬜ da eseguire |
| 15 | Visibilità verifica studente | Lato studente, apri Verifiche con la verifica nascosta, poi pubblicata | Nascosta: non compare. Pubblicata: compare con classe e conteggio domande | ⬜ da eseguire |
| 16 | Download PDF verifica studente | Lato studente, clicca Scarica PDF sulla verifica pubblicata | PDF scaricato con nome `aaaammgg-classe-titoloverifica-Nome-Cognome.pdf`; campi Nome e Cognome/Data precompilati con l'identità Google; nessuna soluzione | ⬜ da eseguire |
| 17 | Download PDF docente e soluzioni | Dal docente, scarica sia il PDF anteprima (⬇️) sia il PDF soluzioni (🔑) | Anteprima: campi vuoti, nessuna soluzione, nome `aaaammgg-classe-titoloverifica.pdf`. Soluzioni: risposte/opzioni corrette visibili, nome `<titolo>_soluzioni_docente.pdf` | ⬜ da eseguire |
| 18a | Cancellazione verifiche bozza/chiuse | Crea una verifica bozza e cancellala; chiudi una verifica attiva e cancellala | Entrambe si cancellano con conferma; una verifica **attiva** non mostra il bottone di cancellazione diretta | ⬜ da eseguire |
| 18b | Blocco cancellazione programma con verifiche collegate | Prova a eliminare il programma usato al punto 12, con la verifica ancora esistente | Messaggio "Impossibile eliminare il corso: esistono verifiche associate..."; elimina prima la verifica, poi il programma si elimina | ⬜ da eseguire |

## Copertura automatica già esistente (non riverificata qui, solo referenziata)

- Routing docente/studente, pending/blocked, nessuna classe, filtro classe lezioni/verifiche, PDF senza soluzioni: `g4-lite-checklist-manuale.md` + suite `pnpm test`.
- Storage Rules (nuovo modello, nessuna lettura Firestore): `apps/web/src/rules/storage.test.ts`, `apps/web/src/rules/m3l-storage-lesson-class-gate.rules.test.ts`, `apps/web/src/rules/import.rules.test.ts` — verificati con `pnpm test:rules` prima di questa checklist (213/213 al momento della stesura).
- Blocco cancellazione programma con verifiche collegate: `programsService.test.ts`/`CourseWorkspace.test.tsx`.
- Naming e prefill PDF verifica studente: `verificationPdfNaming.test.ts`, `verificationPdf.test.ts`.

## Limiti residui

- Questa checklist non è stata eseguita con login Google reale in questa sessione: è un template operativo, non un report di esito.
- Non copre carico concorrente, performance, o quota Firebase.
- **Limite di sicurezza accettato e documentato** (non un bug da correggere qui): un utente Google autenticato che conoscesse o indovinasse un `contentPath` Storage esatto potrebbe leggere quel file senza passare dalla discovery Firestore — vedi `sicurezza.md` §3.2a. Non testabile in una checklist manuale (richiede di conoscere già un path arbitrario); accettato come compromesso per evitare `403` di produzione sulle letture cross-service.
