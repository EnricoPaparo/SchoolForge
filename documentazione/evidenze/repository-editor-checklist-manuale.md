# Checklist manuale RE-07 — Repository Editor (hardening finale)

**Versione:** 1.0
**Commit di riferimento:** branch `claude/m3-lite-google-student-portal-yk2fja` (RE-07)
**Ambiente:** DEV — locale con emulatori Firebase (`pnpm dev` + `firebase emulators:start`) o Firebase DEV (https://schoolforge-dev.web.app)
**Metodo:** checklist operativa **da eseguire manualmente** da un umano loggato come docente/owner. Non è stata eseguita in questa sessione: l'agente non ha un browser interattivo collegato a un progetto Firebase reale. È un template pronto, con step, azioni concrete (bottoni/etichette reali della UI) ed esito atteso già scritti; la colonna "Risultato" va compilata da chi esegue il test.

## Perché una checklist manuale e non solo test automatici

Ogni operazione del Repository Editor (RE-01 → RE-06) è già coperta da unit/component test (vedi "Copertura automatica già esistente" più sotto). Questa checklist non li duplica: verifica che l'intera catena reale — UI docente → Firestore/Storage (emulati o DEV reali) → rendering docente/studente → export/reimport ZIP fuori da SchoolForge — si comporti come i test unitari assumono, cosa che nessun test automatico locale può garantire end-to-end.

## Setup richiesto

1. Un account che è owner del progetto, con accesso alla sezione **Corsi** (`TeacherShell`).
2. Un ZIP di import minimo valido (o riusare uno ZIP di test già disponibile in questo repo/dai test fixture) con almeno una UDA e una lezione con front matter valido, per il punto 1.
3. Almeno una classe già creata in **Classi**, per il punto 11 (vista studente).
4. Un secondo account Google (studente di test, non owner) approvato e assegnato a quella classe — vedi `documentazione/evidenze/g4-lite-checklist-manuale.md` per la procedura di approvazione/assegnazione, non ripetuta qui.
5. Un editor di file/estrattore ZIP per ispezionare l'archivio esportato al punto 9 (es. per confermare l'ordine cartelle/file).

## Checklist

| # | Passo | Azione concreta | Risultato atteso | Cosa controllare | Risultato |
|---|---|---|---|---|---|
| 1 | Creare programma/import base | In **Corsi**, crea un nuovo programma (titolo libero), poi "Importa ZIP" con lo ZIP minimo del setup | Il programma compare con l'import attivo; UDA e lezione dello ZIP sono visibili in **Lezioni** | `activeImportId` impostato; nessun errore di validazione; UDA/lezione visibili sia in Corsi che in Lezioni | ⬜ da eseguire |
| 2 | Creare UDA | In **Lezioni**, sul corso appena creato, click "＋" ("Nuova UDA") sulla riga del corso; compila Titolo (obbligatorio) e opzionalmente Descrizione/Competenze/Obiettivi; "Crea UDA" | La nuova UDA compare subito nella sidebar, senza dover ricaricare la pagina | Nessun refetch necessario (la UDA appare "otticamente" subito); numerazione tecnica (`uda-XX-slug`) coerente col numero massimo esistente + 1 | ⬜ da eseguire |
| 3 | Creare lezione | Sulla UDA appena creata, click "＋" ("Nuova lezione"); compila Titolo (obbligatorio) e opzionalmente sottotitolo/difficoltà/concetti chiave/obiettivi/corpo iniziale; "Crea lezione" | La nuova lezione compare subito nella UDA, senza refetch | Filename tecnico generato (`lezione-XXX-slug.md`); lezione selezionabile e apribile subito | ⬜ da eseguire |
| 4 | Modificare metadata | Apri la lezione creata al punto 3, click "✏️" ("Modifica metadata"); cambia titolo/sottotitolo/difficoltà/concetti chiave/obiettivi; "Salva" | Il pannello si chiude, l'header della lezione mostra i nuovi valori | Nessun errore mostrato; riapri il pannello "✏️" e verifica che i valori salvati siano quelli appena inseriti (non quelli precedenti) | ⬜ da eseguire |
| 5 | Modificare corpo Markdown | Sulla stessa lezione, click "📝" ("Modifica contenuto"); modifica il testo nel tab "Editor"; passa al tab "Anteprima" per controllare il rendering; "Salva" | Il contenuto renderizzato nel pannello principale riflette subito il nuovo corpo | Il tab "Anteprima" mostra l'HTML sanitizzato coerente col Markdown appena scritto; dopo "Salva" il pannello torna in modalità lettura col nuovo contenuto, senza refetch visibile | ⬜ da eseguire |
| 6 | Riordinare UDA/lezioni | Con almeno 2 UDA (e 2 lezioni nella stessa UDA) presenti, click "↕" ("Attiva riordino") nell'header della sidebar; usa "▲"/"▼" su una UDA e su una lezione per scambiarle di posizione con la vicina | L'ordine nella sidebar cambia immediatamente dopo il click, senza refetch | "▲" è disabilitato sul primo elemento della lista, "▼" sull'ultimo; durante il salvataggio solo i due elementi coinvolti nello scambio mostrano i controlli disabilitati; click "↕" di nuovo per uscire dalla modalità riordino | ⬜ da eseguire |
| 7 | Eliminare lezione libera | Con "↕" **non** attivo, sulla lezione creata al punto 3 (senza verifiche collegate), click "🗑️" ("Elimina lezione"); nel riquadro di conferma, click "Elimina definitivamente" | La lezione scompare dalla sidebar; se era quella aperta nel pannello, il pannello torna al messaggio "Seleziona una lezione…" | Nessun messaggio di blocco; se si riapre il corso/UDA con un refresh pagina, la lezione eliminata non ricompare (Firestore/Storage puliti, non solo stato locale) | ⬜ da eseguire |
| 8 | Tentare eliminazione bloccata da verifica | In **Verifiche**, crea una nuova verifica in bozza sullo stesso programma/import, aggiungi almeno una domanda dal pool di un'altra lezione (rimasta) tramite il selettore domande. Torna in **Lezioni**, click "🗑️" su quella lezione (o sulla sua UDA), poi "Elimina definitivamente" | L'eliminazione **non avviene**: il riquadro mostra l'elenco delle verifiche bloccanti (titolo + stato, es. "bozza") invece del pulsante di conferma | La lezione/UDA resta visibile in sidebar dopo il tentativo; nessun file rimosso da Storage (verificabile aprendo di nuovo la lezione: il contenuto è ancora presente); click "Chiudi" per uscire dal riquadro di blocco | ⬜ da eseguire |
| 9 | Esportare ZIP | In **Corsi**, sul programma usato ai punti precedenti, click "Esporta ZIP" | Il browser scarica un file `<titolo_programma>_export.zip` | Estrai il ZIP: contiene le cartelle `uda-XX-slug/` con i file `.md` di UDA e lezioni correnti (non quelli eliminati al punto 7), niente file `.pool.md`; l'ordine delle cartelle nell'archivio riflette l'ordine (`order`) visto in **Lezioni** dopo il riordino del punto 6, non l'ordine di creazione | ⬜ da eseguire |
| 10 | Reimportare ZIP in nuovo programma | Crea un secondo programma nuovo (titolo diverso); "Importa ZIP" usando il file scaricato al punto 9 | L'import va a buon fine senza errori di validazione | UDA e lezioni del nuovo programma hanno lo stesso ordine visto nel programma originale dopo il riordino (punto 6); metadata e corpo Markdown coincidono con le modifiche fatte ai punti 4–5 | ⬜ da eseguire |
| 11 | Verificare vista studente (programma assegnato a classe) | In **Classi** o dal pannello "Classi" del programma, assegna il programma (originale o il reimportato) alla classe del secondo account Google del setup. Login con quell'account su `/student/*` | Lo studente vede in **Lezioni** le UDA/lezioni pubblicate del programma appena assegnato, con titoli/contenuti coerenti con le modifiche fatte da editor | Nessun contenuto tecnico (pool, `questionIndex`, filename Storage) visibile allo studente; se la lezione del punto 7 è stata eliminata, non compare nemmeno lato studente; l'ordine delle lezioni lato studente coincide con quello lato docente | ⬜ da eseguire |

## Copertura automatica già esistente (non riverificata qui, solo referenziata)

- **Creazione UDA/lezione**: `repositoryEditorService.test.ts` (`createUda`/`createLesson`), `LessonsView.test.tsx` (RE-03A/RE-03B).
- **Modifica metadata/corpo**: `repositoryEditorService.test.ts` (`updateUdaMetadata`/`updateLessonMetadata`/`updateLessonMarkdownBody`), `LessonsView.test.tsx` (RE-01/RE-02).
- **Riordino**: `repositoryEditorService.test.ts` (`reorderUda`/`reorderLesson`, incl. fallback legacy senza `order`), `LessonsView.test.tsx` (RE-04, incl. limiti primo/ultimo elemento e disabilitazione parziale durante il salvataggio).
- **Eliminazione protetta**: `repositoryEditorGuards.test.ts` (guardia pura `findRepositoryDeleteBlockers`), `repositoryEditorService.test.ts` (`deleteUda`/`deleteLesson`, blocco/libera, tolleranza a file Storage assenti), `LessonsView.test.tsx` (RE-05, conferma esplicita, elenco blocchi, deselezione lezione eliminata).
- **Export/reimport coerente**: `exportZip.test.ts` (ordine preservato anche con fetch fuori ordine, round-trip completo `buildExportZip` → `readZipFile` → `validateImport` → `buildImportPayload` con verifica dell'`order` finale), `readZipFile.test.ts` (ordine fisico dell'archivio preservato).
- **Vista studente**: `StudentLessonsView.test.tsx`, `studentLessonsService.test.ts` (filtro per classe, già verificato in M3L-C — il Repository Editor non introduce nuovi percorsi di lettura studente).

## Limiti residui

- Questa checklist non è stata eseguita con un browser reale in questa sessione: è un template operativo, non un report di esito.
- Non copre editing concorrente da due tab/dispositivi (fuori scope RE — nessuna collaborazione multiutente prevista).
- Non copre l'editing del pool domande (esplicitamente escluso da tutta la fase RE) né un eventuale export/reimport di `programma.md` con metadata di programma (limite pre-esistente, non introdotto da RE, segnalato in `repository-editor-roadmap.md`/PR RE-06).
- Non copre carico concorrente, performance, o Security Rules sotto traffico reale (stesso limite già annotato in `smoke-dev-deploy.md` e `g4-lite-checklist-manuale.md`).
