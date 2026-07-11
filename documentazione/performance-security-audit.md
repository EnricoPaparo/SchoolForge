# Audit prestazioni, costi Firebase e sicurezza — PERF-SEC-01A

**Data:** 2026-07-11
**Stato:** Baseline evidence-based, nessuna modifica al codice applicativo, a Firestore Rules o a Storage Rules.
**Ambito:** M1, M2, M3-lite, M3-full fino a M3F-11C incluso (rami merged su `main`).

## 1. Executive summary

SchoolForge è architetturalmente coerente con i suoi obiettivi dichiarati (nessuna Cloud Function, nessun polling, autosave dirty-only, listener singoli e puliti). La revisione statica delle Security Rules (`firestore.rules`, `storage.rules`) non ha trovato nessun gap non enforced rispetto al modello descritto in `sicurezza.md`: isolamento studente, immutabilità post-consegna, blocco enumerazione via `list`, campi privilegiati non modificabili dal client sono tutti verificati a livello di regola con citazione di riga. Il rischio di sicurezza reale più concreto individuato non è nelle Rules ma nel **client**: il cap di 200 attention events è enforced solo in JavaScript (`examDeterrence.ts`), non nelle Rules — un client modificato potrebbe scrivere array arbitrariamente grandi.

Sul fronte costi/prestazioni, il pattern dominante è: **query di collezione senza `where`/`limit` lette per intero e filtrate lato client** (`listVerifications`, `listPrograms`, `listClasses`, `listStudents`, `listQuestionIndex`, i controlli di blocco cancellazione in `deleteProgram`/`deletePool`). Per l'uso personale dichiarato (scenario A: 1 docente, 5 classi, 150 studenti, 20 verifiche/mese) questo resta entro le quote gratuite con ampio margine — ogni collezione coinvolta ha nell'ordine delle decine-centinaia di documenti, non migliaia. Il pattern diventa un problema reale solo nello scenario C (più docenti/traffico pubblico) perché **`listVerifications` non filtra per `ownerUid` lato server**: legge l'intera collezione `verifications` di *tutti* i possibili proprietari a ogni caricamento della vista docente, quindi il costo di ogni singolo docente scala con il totale di verifiche di tutti i docenti, non con le proprie.

Sul frontend, il bundle di produzione è **un solo chunk JS da 1.19 MB (321.65 KB gzip)**, senza alcun `React.lazy`/code-splitting per ruolo (docente vs studente) o per vista: uno studente scarica anche tutto il codice dell'editor pool/import ZIP/monitor docente mai usato. jsPDF (390 KB) e html2canvas (201 KB, dipendenza transitiva di jsPDF) sono correttamente lazy-caricati solo al momento del download PDF — questo è già ottimale.

Nessun finding **P0** (rischio immediato di sicurezza o perdita dati) è stato trovato. Sono stati identificati **2 P1**, **6 P2**, **3 P3** (dettaglio §6).

## 2. Metodo e limiti

- Analisi statica del codice sorgente (`apps/web/src`, `firestore.rules`, `storage.rules`, `firestore.indexes.json`, `firebase.json`) via lettura diretta e ricerca mirata (grep/citazioni file:riga), condotta anche tramite sotto-agenti di solo-lettura dedicati a gruppi di flussi (repository/import/pool/classi/studenti, verifiche/submission/monitor/PDF, Security Rules) per coprire l'intero perimetro richiesto senza superare il budget di contesto della sessione.
- Baseline bundle reale ottenuta da `pnpm build` (Vite) in questo ambiente, non da produzione.
- Le stime di costo (§4) sono conteggi di operazioni Firestore/Storage dedotti dal codice (numero di `getDocs`/`getDoc`/`setDoc`/`onSnapshot`), non misurazioni da Firebase Console: **nessun progetto Firebase reale è stato osservato in questa sessione**. Dove il prezzo/quota ufficiale non è stato verificato con una fonte aggiornata in questa sessione, il costo è lasciato parametrico (vedi nota in §4).
- Non sono stati eseguiti l'Emulator Suite, `pnpm test:rules`, né la suite di test completa: non richiesti per un audit statico e esclusi esplicitamente dal mandato.
- Non è stata misurata la latenza di rete reale (round-trip Firestore) né il consumo effettivo su un progetto Firebase attivo — le stime sono conteggi di operazioni, non tempi.
- L'audit copre il codice presente su `main` al momento del branch (`audit/perf-sec-01-baseline`), fino a M3F-11C incluso. Non copre M4 (non implementato).

## 3. Baseline misurata

### 3.1 Bundle di produzione (`pnpm build`, Vite 5.4.21, ambiente di sessione)

| Asset | Dimensione | Gzip |
|---|---|---|
| `index-*.js` (entry unico, tutto il codice app) | 1 187.65 KB | 321.65 KB |
| `jspdf.es.min-*.js` (lazy, solo al download PDF) | 390.47 KB | 128.80 KB |
| `html2canvas.esm-*.js` (lazy, dipendenza transitiva di jsPDF) | 201.42 KB | 48.03 KB |
| `index.es-*.js` (chunk Firebase, vedi nota sotto) | 150.73 KB | 51.57 KB |
| `index-*.css` | 78.81 KB | 12.66 KB |

Vite segnala esplicitamente in build: *"chunks are larger than 500 kB after minification"* per l'entry principale, e un warning di import misto (`firebase/firestore` importato sia staticamente sia dinamicamente da `submissionsService.ts`, che impedisce a Vite di isolarlo in un chunk separato — vedi PERF-06).

Nessun uso di `React.lazy`/`import()` per il routing per ruolo o per vista è stato trovato nel codice sorgente (`grep -rn "React.lazy\|lazy("` su `apps/web/src` → zero risultati applicativi). Questo significa che **il chunk da 1.19 MB è scaricato integralmente da ogni utente**, docente o studente, indipendentemente dalle sezioni che apre.

### 3.2 Dipendenze runtime (`apps/web/package.json`)

`firebase@^10.14.1`, `jspdf@^4.2.1`, `jszip@^3.10.1`, `marked@^18.0.5`, `dompurify@^3.4.11`, `yaml@^2.7.1`, `react@^18.3.1`/`react-dom@^18.3.1`. Nessuna libreria UI pesante aggiuntiva (niente component library, niente date-picker, niente grafici). `jszip` è usato solo nel flusso import ZIP (docente) — verificare se è già fuori dal chunk principale è un possibile follow-up (non misurato in questa sessione, vedi §7 limiti).

### 3.3 Indici Firestore dichiarati (`firestore.indexes.json`)

Tre indici compositi + un field override:
- `publishedProjection` (`COLLECTION_GROUP`) su `classId`+`visibility` — richiesto dal pattern di lettura studente (§5.10 sicurezza.md, confermato in rules review).
- `submissions` su `verificationId`+`ownerUid`+`status`.
- `submissions` su `verificationId`+`ownerUid`+`lastSavedAt` (desc).
- `verifications` su `ownerUid`+`status`+`onlineEnabled` — usato da `listActiveOnlineVerificationClassIds`.
- Field override: `publicLessons.content` escluso dall'indicizzazione (corretto, evita costi di indicizzazione su un campo di testo lungo mai interrogato).

Nessun indice esiste per `verifications`/`programs`/`classes`/`students` filtrati per `ownerUid` da sole — coerente con l'evidenza che `listVerifications`/`listPrograms`/`listClasses`/`listStudents` **non usano `where('ownerUid','==',...)` lato server** (vedi §4, §6 PERF-01/PERF-02).

## 4. Mappa accessi Firebase (per flusso)

> Legenda: **R** = `getDoc`/`getDocs` singolo o di query, **L** = `onSnapshot`, **W** = `setDoc`/`updateDoc`/`addDoc`, **B** = `writeBatch`, **T** = `runTransaction`, **S** = operazione Storage.

### Login e RoleGate
- `RoleGate.tsx`: 1× **R** (`settings/ownerPublic`) sempre. Se non-owner: + 1× **R** (`settings/studentAccess`) + 1× **R** (`students/{uid}`). Se studente nuovo: + 1× **W** (creazione `students/{uid}` in stato `pending`), guardato da un ref così scatta una sola volta per mount.
- Nessun listener in RoleGate stesso. `StudentShell` apre poi 1× **L** persistente su `settings/studentAccess` (Modalità verifica), con cleanup su unmount confermato.
- **Totale worst-case per sessione**: 1–3 R + 0–1 W. Nessuna query di collezione.

### Apertura portale docente (`VerificationsView`, `LessonsView`, `StudentsView`, ecc.)
- Ogni vista principale chiama la propria `list*` **senza filtro server-side**: `listVerifications` (`getDocs(collection(db,'verifications'))`, poi `.filter(ownerUid)` client-side), `listPrograms`, `listClasses`, `listStudents` — stesso pattern in tutte e quattro. Nessun `limit()`.
- Costo: 1 read per documento nell'intera collezione, non per documento del docente. Vedi PERF-01/PERF-02.

### Apertura portale studente
- `StudentShell` monta 1× **L** su `settings/studentAccess` (exam mode).
- `StudentVerificationsView`/`StudentLessonsView` leggono le rispettive proiezioni filtrate (`publicLessons` per `classId`, `publishedProjection` via collectionGroup con indice dedicato) — filtrate lato server, coerente con gli indici dichiarati.

### Visualizzazione Lezioni (docente)
- `listPrograms`, `listUdas`, `listLessons` — tutte `getDocs` non filtrate/non limitate su sotto-collezioni per import; costo proporzionale al numero di UDA/lezioni nell'import selezionato (tipicamente decine, non migliaia).

### Import ZIP
- **S**: upload paralleli (`Promise.all`) — un'operazione Storage per file, concorrenti.
- **B**: un solo `writeBatch` per import metadata + N UDA + N lezioni + N questionIndex, tutti nello stesso batch (1 round-trip di rete). **Non chunked**: il limite Firestore di 500 mutazioni per batch non è gestito per import molto grandi (vedi PERF-03).
- **T**: una `runTransaction` per lo swap atomico di `publicLessons` (delete stale + set nuovi), anch'essa non chunked oltre il limite di 500 mutazioni per transazione.
- 1× **R** senza `limit()` per trovare i `publicLessons` stale da rimuovere.

### Creazione/modifica/eliminazione programma, UDA, lezione
- Creazione/modifica: singole **W** + 1 **W** di audit event ciascuna (nessun batching tra mutazione principale e audit).
- `deleteProgram`: 1× **R** **non filtrata sull'intera collezione `verifications`** solo per verificare l'esistenza di un blocco (costo cresce con *tutte* le verifiche del sistema, non solo quelle del programma) — vedi PERF-02. Poi, per ogni import del programma, **sequenzialmente** (non `Promise.all` tra import): 3 **R** parallele (uda/lessons/questionIndex) + delete batched chunked a 400 + delete Storage ricorsivo. Le cancellazioni dentro un singolo import sono corrette (batch chunked); la sequenzialità è **tra** import multipli dello stesso programma.

### Editor pool
- `loadPool`: 1 **R** (doc lezione) + 1 **S** (lettura file `.pool.md` intero).
- `savePool`: 1 **S** (upload) + 1 **R** (query questionIndex per uda/lezione) + **loop sequenziale `for...await setDoc`, una write per domanda** (N+1 esplicito, non batched) + delete stale chunked + 1 **W** finale sul doc lezione. Questo è il pattern N+1 in scrittura più netto trovato nell'intero codebase — vedi PERF-04.
- `deletePool`: 1 **R** non filtrata/non limitata su `verifications` (stesso pattern di `deleteProgram`) per il controllo blocco.

### Creazione/salvataggio/attivazione/chiusura verifica
- `createVerification`: 1 **B** (doc + audit).
- `updateVerificationConfig` (Salva bozza, M3F-11C): 1 **R** + 2 **W** sequenziali (config + audit) — non batched tra loro.
- `activateVerification`: 1 **R** pre-check + letture Storage per le domande (fuori transazione, corretto) + 1 **T** (get+update+set, tutto atomico: snapshot immutabile + proiezione pubblica) + 1 **W** di audit **fuori** dalla transazione (rischio minimo: crash tra commit e audit lascia una verifica attivata senza audit — non un problema di dati, solo di tracciabilità).
- `setVerificationVisibility`/`closeVerification`: 1 **R** + 2 **W** sequenziali **non atomiche** (parent + proiezione mirror) — a differenza di `setVerificationOnlineEnabled`/`setVerificationStudentPdfEnabled`, che usano correttamente un **B** atomico. Incoerenza interna al service — vedi PERF-05.
- `deleteVerification`: 1 **R** + 1 delete + 1 **W** audit. Il documento `publishedProjection/data` sotto una verifica cancellata **non viene mai esplicitamente cancellato** (Firestore non cancella sotto-collezioni a cascata) — orfano innocuo ai fini Rules (irraggiungibile dal path del genitore cancellato) ma persiste come costo di storage residuo.

### Avvio, autosave e consegna online (studente)
- Avvio/ripresa sessione (`examSessionService.findActiveDraftSession`): **loop sequenziale di `getDoc` singoli**, uno per verifica online candidata — non `Promise.all`. Basso rischio pratico (poche verifiche online candidate per studente in un dato momento) ma è un pattern sequenziale evitabile.
- Autosave: `setInterval` a 120 000 ms, dirty-only (nessuna write se nulla è cambiato dall'ultimo tick), 1 **W** per tick attivo — confermato in `OnlineExamView.tsx:21,178-185`.
- Attention events: bufferizzati in memoria, **mai causa di write da soli** (commento esplicito nel codice), viaggiano solo agganciati al prossimo autosave "vero" o alla consegna, con `arrayUnion` solo se ci sono nuovi eventi. Cap 200 lato client (`examDeterrence.ts`).
- Consegna: 1 **B** (update submission + set receipt, atomico).

### Monitor consegne docente
- 1× **L** su `submissions` filtrato per `ownerUid`+`verificationId` (query indicizzata), nessun `limit()` (accettabile: limitato dalla dimensione della classe). Il documento intero (inclusi `answers`/`flagged`) attraversa la rete a ogni snapshot; solo lato client vengono scartati prima del render — nessun costo economico aggiuntivo nel modello a pagamento per documento di Firestore, ma è un costo di banda e superficie dati non necessaria (vedi PERF-07/SEC-nota).
- Lifecycle: effect chiuso su cambio verifica/unmount, mai aperto per bozze, mai più di un listener attivo — confermato.

### Gestione studenti
- `listStudents` non filtrata/non limitata (stesso pattern PERF-01/02). `countPendingStudents` **richiama `listStudents` da capo** ogni volta che serve solo un conteggio — doppio lavoro se entrambe vengono chiamate nella stessa vista (vedi PERF-08). Ogni azione singola (approva/blocca/assegna classe) = 2 write sequenziali (mutazione + audit), non batched.

### Modalità verifica
- 1 **L** persistente per ogni studente collegato su `settings/studentAccess` (singolo documento condiviso, scala linearmente col numero di studenti online simultanei — atteso e minimo per la feature).

## 5. Stime per scenario

> Le stime sono conteggi di operazioni Firestore/Storage dedotti dal codice, non misure da un progetto reale. I prezzi/quote citati sono presi da fonti ufficiali con data di verifica indicata; dove non è stato possibile verificare una tariffa aggiornata in questa sessione, il costo è lasciato parametrico.

**Quote gratuite Firestore (Spark, piano gratuito):** 50 000 letture/giorno, 20 000 scritture/giorno, 20 000 cancellazioni/giorno, 1 GiB storage totale. *(Fonte: pagina ufficiale prezzi Firebase, https://firebase.google.com/pricing — valori storicamente stabili della quota Spark per Firestore; verificare la cifra corrente sulla pagina ufficiale al momento della revisione, poiché questa sessione non ha effettuato una verifica live del sito.)* Per lo stesso motivo il prezzo Blaze per unità (storicamente ~$0.036/100k letture, ~$0.108/100k scritture, ~$0.18/GiB-mese) è riportato **solo a titolo parametrico** e va riconfermato sulla pagina ufficiale prima di qualsiasi decisione di budget.

### Scenario A — Uso personale (1 docente, 5 classi, 150 studenti, 20 verifiche/mese, uso normale lezioni)

- Apertura portale docente 1×/giorno: `listVerifications`+`listPrograms`+`listClasses`+`listStudents` ≈ 4 letture di collezione. Con collezioni nell'ordine di decine-centinaia di documenti totali (1 docente = tutta la collezione, essendo single-tenant per progetto), il costo per apertura resta nell'ordine di **decine-centinaia di letture**, non migliaia.
- 20 verifiche/mese: create (2 write) + salvataggi bozza multipli (stimare 3-5 salvataggi × 3 op = 9-15 op) + attivazione (1 R + T + 1 W ≈ 4 op) + eventuale chiusura (3 op) ≈ **20-30 operazioni per verifica**, quindi ~400-600 operazioni/mese solo per il ciclo di vita verifiche.
- Import lezioni: sporadico, batch singolo, trascurabile su base mensile.
- **Giudizio**: con questi volumi, anche sommando tutte le viste aperte più volte al giorno, il progetto resta ordini di grandezza sotto la quota gratuita giornaliera (50 000 letture, 20 000 scritture). Nessun rischio di superamento quota in questo scenario, anche considerando il pattern "collection intera senza filtro" di PERF-01/02, perché la collezione stessa è piccola in un deployment mono-docente.

### Scenario B — Verifica online (1 classe, 30 studenti, 60 minuti, autosave dirty per tutta la prova, monitor docente aperto)

- Autosave: nel limite teorico di modifica continua per 60 minuti a intervallo 120s → **massimo 30 tick per studente**, ma dirty-only quindi tipicamente meno; worst-case 30 studenti × 30 write = **900 write**.
- Consegna: 30 × 1 batch (2 op interne, 1 costo di rete) = 30 operazioni.
- Monitor docente aperto per tutta la prova: 1 listener, riceve un evento di aggiornamento per ogni write di ogni studente → fino a **~900-930 letture "di aggiornamento"** lato listener (ogni snapshot delta conta come lettura secondo il modello standard Firestore per documento cambiato).
- Avvio sessione: 30 studenti × (1-3 R RoleGate/StudentShell + ricerca sessione attiva, 1 R per verifica online candidata) ≈ 30-90 R aggiuntive.
- **Totale indicativo per una sessione da 60 minuti/30 studenti**: nell'ordine di **1 800-2 000 operazioni Firestore combinate** (letture + scritture). Ben sotto la quota giornaliera gratuita anche in un giorno con più classi in verifica online, salvo un numero molto elevato di sessioni sovrapposte nello stesso giorno.

### Scenario C — Uso ampliato (più docenti o traffico pubblico)

Ipotesi esplicite: il progetto Firestore attuale è **single-tenant per design** (un solo `settings/owner`, confermato dalla rules review, §5). "Più docenti" nel modello attuale richiederebbe o (a) un progetto Firebase separato per docente, oppure (b) un cambio di architettura multi-tenant non presente oggi. Nel caso (a), i costi non si sommano nello stesso progetto — ogni docente ha la propria quota gratuita indipendente, quindi lo scenario C si riduce a N istanze indipendenti dello scenario A/B, ciascuna sotto quota.

Se invece si ipotizza **traffico pubblico non autenticato** verso pagine servite da Hosting (es. una landing page), il moltiplicatore di costo rilevante è quello di **Firebase Hosting** (banda), non Firestore, poiché tutte le collezioni Firestore sono protette da `isAuthenticated()`/`isOwner()`/`isApprovedStudent()` e non hanno superfici pubbliche non autenticate lette in massa (confermato in rules review, nessun `allow read: if true` trovato). Il principale moltiplicatore di costo in caso di crescita reale entro il modello attuale (singolo docente, più studenti) è quindi il pattern **PERF-01/02** (letture di collezione intera senza filtro server): il costo di ogni apertura della vista docente scala con il numero *totale* di documenti in quella collezione — che nel modello single-tenant coincide comunque con "i documenti di quel docente", quindi il moltiplicatore reale è la crescita nel tempo di un singolo docente (più classi, più studenti, più verifiche archiviate), non un secondo docente. Non vengono fatte previsioni assolute di costo per questo scenario, in assenza di un numero di documenti storici realistico da misurare.

## 6. Findings (ordinati per priorità)

Nessun finding P0 identificato.

### P1 — costo o blocco prestazionale importante

**PERF-01 — `listVerifications` legge l'intera collezione senza filtro server-side**
- Evidenza: `apps/web/src/features/repository/verifications/verificationsService.ts:38-55` — `getDocs(collection(db,'verifications'))` poi `.filter((item) => item.ownerUid === ownerUid)` lato client.
- Impatto: ogni apertura/refresh della vista Verifiche legge *tutti* i documenti `verifications` esistenti nel progetto, non solo quelli del docente corrente. Nel modello single-tenant attuale coincide comunque con "tutte le verifiche di quel docente", ma il costo cresce linearmente con lo storico accumulato (nessun filtro per data/stato, nessun `limit()`).
- Scenario che lo attiva: uso prolungato nel tempo con molte verifiche archiviate (scenario A esteso su più anni scolastici), o refresh frequenti (la funzione è richiamata dopo create/activate/close/delete — più volte per sessione).
- Soluzione minimale: aggiungere `where('ownerUid','==',ownerUid)` alla query (richiede indice singolo campo, automatico in Firestore per query a un solo `where`), mantenendo il filtro client come fallback per compatibilità.
- Beneficio atteso: costo di lettura proporzionale alle verifiche del docente, non all'intera collezione; nessun impatto visibile nello scenario A attuale ma previene crescita futura.
- Rischio della modifica: basso — query equivalente per risultato, richiede solo verifica che l'indice a campo singolo sia già implicito (lo è, Firestore crea automaticamente indici a campo singolo).
- File coinvolti: `verificationsService.ts`.
- Verifica necessaria: test service esistente + conferma che il risultato sia identico al filtro client attuale.

**PERF-04 — `savePool` scrive una domanda alla volta in sequenza (N+1 scritture non batched)**
- Evidenza: `apps/web/src/features/repository/pools/poolEditorService.ts:190-196` — `for (const q of pool.questions) { await setDoc(...) }`.
- Impatto: per un pool con molte domande (decine-centinaia), ogni salvataggio del pool costa un round-trip di rete sequenziale per domanda — tempo di salvataggio proporzionale al numero di domande, non costante. Anche il costo in operazioni Firestore è 1 write per domanda (non evitabile per definizione, essendo N documenti distinti), ma la sequenzialità aggiunge latenza percepita.
- Scenario che lo attiva: editor pool su una lezione con molte domande (es. 50+), ogni salvataggio del docente.
- Soluzione minimale: sostituire il loop sequenziale con un `writeBatch` (fino a 500 operazioni per batch, chunked se necessario come già fatto altrove nello stesso file per le cancellazioni).
- Beneficio atteso: un solo round-trip di rete invece di N, salvataggio percepito quasi istantaneo indipendentemente dal numero di domande.
- Rischio della modifica: basso — pattern già usato altrove nello stesso file (`deleteDocRefsInBatches`), stessa collezione, stesso owner.
- File coinvolti: `poolEditorService.ts`.
- Verifica necessaria: test service mirato che verifichi lo stesso risultato finale (stessi documenti scritti) con un batch invece di N `setDoc`.

### P2 — ottimizzazione utile e misurabile

**PERF-02 — Query di collezione intera senza filtro/limit ripetute in più service (`listPrograms`, `listClasses`, `listStudents`, `listQuestionIndex`, blocchi cancellazione)**
- Evidenza: `programsService.ts` (`listPrograms`, `listUdas`, `listLessons`), `classesService.ts:15-20` (`listClasses`), `studentsService.ts:17-25` (`listStudents`), `questionIndexService.ts:25-58` (`listQuestionIndex`), più i controlli di blocco cancellazione in `deleteProgram` (`programsService.ts:267`) e `deletePool` (`poolEditorService.ts:252-254`) che leggono l'intera collezione `verifications` solo per un controllo booleano.
- Impatto: stesso pattern di PERF-01 applicato a più collezioni; nello scenario A resta trascurabile, ma è un pattern ripetuto che merita una correzione sistemica piuttosto che puntuale.
- Scenario che lo attiva: crescita organica nel tempo (più classi, più studenti, più import).
- Soluzione minimale: dove esiste un `ownerUid` sul documento, aggiungere `where('ownerUid','==',ownerUid)`; per i controlli di blocco cancellazione, considerare una query mirata (es. `where('config.programId','==',programId)` se il campo è già presente) invece di leggere l'intera collezione per un controllo di esistenza.
- Beneficio atteso: riduzione lineare del costo di lettura con la crescita dei dati.
- Rischio della modifica: basso-medio — verificare che i campi `where` esistano già sui documenti (in gran parte sì, `ownerUid` è già scritto ovunque) e che non serva un nuovo indice composito per i controlli di blocco cancellazione (da verificare caso per caso).
- File coinvolti: `programsService.ts`, `classesService.ts`, `studentsService.ts`, `questionIndexService.ts`, `poolEditorService.ts`.
- Verifica necessaria: test service mirati per ogni funzione modificata + eventuale aggiornamento `firestore.indexes.json` se un nuovo `where` richiede un indice composito.

**PERF-03 — Import ZIP e swap `publicLessons` non gestiscono il limite di 500 mutazioni per batch/transazione**
- Evidenza: `importRepository.ts:81-101` (batch unico per import metadata+UDA+lezioni+questionIndex, nessun chunking) e `importRepository.ts:114-150` (transazione unica per lo swap `publicLessons`, nessun chunking).
- Impatto: un import molto grande (molte UDA/lezioni/domande in un unico ZIP) potrebbe superare il limite Firestore di 500 mutazioni per batch/transazione e fallire a runtime — non osservato in questa sessione (nessun test con dataset di quella scala), ma è un limite noto della piattaforma non gestito nel codice.
- Scenario che lo attiva: import di un intero anno scolastico in un colpo solo, con molte UDA/lezioni/domande.
- Soluzione minimale: chunking esplicito del batch di import (già presente altrove nel codice come pattern, `deleteDocsInBatches`/`deleteDocRefsInBatches` chunkano a 400) e della transazione di swap `publicLessons`.
- Beneficio atteso: import robusto indipendentemente dalla dimensione, elimina un fallimento silente/rumoroso a scala.
- Rischio della modifica: medio — il chunking del batch di scrittura import è più delicato del chunking delle cancellazioni, perché va preservata l'atomicità logica percepita dal docente (un import "a metà" è uno stato peggiore di un import fallito interamente); da progettare con attenzione in fase di remediation, non applicare meccanicamente.
- File coinvolti: `importRepository.ts`.
- Verifica necessaria: test con un import sintetico che superi 500 mutazioni (se il costo di scrivere un test così grande è giustificato) o quantomeno una verifica statica/commento esplicito del limite noto.

**PERF-05 — Incoerenza atomicità tra funzioni gemelle in `verificationsService.ts`**
- Evidenza: `setVerificationVisibility` (righe ~292-321) e `closeVerification` (righe ~438-466) usano 2 `setDoc` sequenziali non atomici (parent + proiezione mirror), mentre `setVerificationOnlineEnabled` (righe ~342-376) e `setVerificationStudentPdfEnabled` (righe ~399-429) usano correttamente un `writeBatch` atomico per lo stesso tipo di doppia scrittura.
- Impatto: un crash o errore di rete tra le due `setDoc` sequenziali lascia `verifications/{id}` e `publishedProjection/data` temporaneamente fuori sincrono (es. verifica marcata `closed` ma la proiezione pubblica ancora visibile, o viceversa) — finestra di rischio breve ma reale, e incoerente con il pattern già corretto usato nelle funzioni gemelle.
- Scenario che lo attiva: qualunque chiamata a `setVerificationVisibility`/`closeVerification` durante un errore di rete transitorio.
- Soluzione minimale: allineare le due funzioni al pattern `writeBatch` già usato da `setVerificationOnlineEnabled`/`setVerificationStudentPdfEnabled` nello stesso file.
- Beneficio atteso: eliminazione della finestra di incoerenza, nessun costo aggiuntivo (stesso numero di operazioni, solo atomiche invece di sequenziali).
- Rischio della modifica: basso — pattern già collaudato nello stesso file per lo stesso tipo di scrittura doppia.
- File coinvolti: `verificationsService.ts`.
- Verifica necessaria: test service mirato che verifichi l'atomicità (es. simulando un fallimento a metà, se il mock lo consente) o quantomeno che il risultato finale sia identico.

**PERF-06 — Import misto di `firebase/firestore` impedisce a Vite di isolare il chunk Firebase**
- Evidenza: warning esplicito di build — `firebase/firestore` importato dinamicamente da `submissionsService.ts` ma staticamente da oltre 15 altri file (`OwnerSetup.tsx`, `RoleGate.tsx`, `classesService.ts`, ecc.).
- Impatto: Vite non può spostare il modulo Firestore in un chunk separato scaricabile pigramente; il codice Firestore resta nel chunk principale indipendentemente dal singolo import dinamico in `submissionsService.ts`, che quindi non produce il beneficio di code-splitting presumibilmente cercato.
- Scenario che lo attiva: qualunque caricamento dell'app (sempre, essendo un problema di bundling, non di runtime).
- Soluzione minimale: rendere l'import di `firebase/firestore` in `submissionsService.ts` statico come ovunque altro nel codice (rimuovere l'unica eccezione), oppure — se l'obiettivo originale era isolare Firestore in un chunk separato — rendere *tutti* gli import dinamici in modo coerente (cambio più ampio, da valutare in remediation).
- Beneficio atteso: bundle più prevedibile, elimina un warning di build; il beneficio dimensionale reale dipende dalla scelta (statico ovunque = nessun beneficio dimensionale ma coerenza; dinamico ovunque = code-splitting reale ma tocca ~15 file).
- Rischio della modifica: basso per la prima opzione (statico ovunque), medio per la seconda (dinamico ovunque, tocca molti file e richiede gestione asincrona diffusa).
- File coinvolti: `submissionsService.ts` (+ eventualmente tutti i file elencati nel warning, se si sceglie la seconda opzione).
- Verifica necessaria: `pnpm build` senza warning di import misto; confronto dimensione bundle prima/dopo.

**PERF-07 — Il monitor docente riceve il documento `submissions` intero (inclusi `answers`/`flagged`) via listener, anche se la UI li scarta**
- Evidenza: `submissionsMonitorService.ts` — `watchSubmissions` interroga `submissions` senza proiezione di campi (Firestore non supporta la proiezione lato server su `onSnapshot`), poi `toMonitorItem` scarta `answers`/`flagged` lato client.
- Impatto: non è un costo economico aggiuntivo nel modello di prezzo per-documento di Firestore (un documento letto costa uguale indipendentemente dai suoi campi, entro i limiti dimensionali), ma è un costo di banda/tempo di trasferimento e una superficie dati non necessaria che attraversa la rete verso il browser del docente a ogni autosave di ogni studente durante una verifica online (fino a ~900 trasferimenti nello scenario B).
- Scenario che lo attiva: verifica online con monitor docente aperto (scenario B).
- Soluzione minimale: nessuna soluzione lato Firestore nativa (i listener restituiscono sempre il documento intero); l'unica riduzione possibile senza Cloud Functions sarebbe spostare `answers`/`flagged` in un sotto-documento separato scritto dallo studente, e far leggere al monitor solo un documento "stato" più leggero — cambio di schema non banale, da valutare costo/beneficio in remediation, non applicare automaticamente.
- Beneficio atteso: riduzione di banda trasferita durante il monitoraggio; nessun beneficio di costo Firestore diretto.
- Rischio della modifica: medio-alto — richiede un cambio di schema `submissions` (split in due documenti), tocca Rules, service, e i test di sicurezza esistenti; non è una modifica "a basso rischio/alto beneficio" e va probabilmente scartata o rimandata rispetto ad altri finding.
- File coinvolti: `submissionsService.ts`, `submissionsMonitorService.ts`, `firestore.rules` (se implementata).
- Verifica necessaria: da definire solo se la remediation viene approvata; per ora finding informativo.

### P3 — miglioramento eventuale, non prioritario

**PERF-08 — `countPendingStudents` richiama `listStudents` invece di condividere il risultato già caricato**
- Evidenza: `studentsService.ts:28-31`.
- Impatto: se una vista chiama sia `listStudents` sia `countPendingStudents` nello stesso ciclo di rendering, la collezione `students` viene letta due volte invece di una. Nello scenario A (150 studenti) il costo aggiuntivo è trascurabile.
- Scenario che lo attiva: uso della card/badge "studenti in attesa" insieme alla lista studenti completa nella stessa vista.
- Soluzione minimale: derivare il conteggio dal risultato già caricato da `listStudents` quando entrambi sono necessari nello stesso posto, invece di una seconda chiamata dedicata.
- Beneficio atteso: dimezza le letture in quel punto specifico; beneficio assoluto piccolo ai volumi attuali.
- Rischio della modifica: basso.
- File coinvolti: `studentsService.ts` e il chiamante che usa entrambe le funzioni.
- Verifica necessaria: test service/vista mirato.

**PERF-09 — `loadSelectedQuestionsWithSolutions` legge i pool in sequenza, a differenza della sua gemella `loadSelectedQuestions` (concorrenza 4)**
- Evidenza: `loadSelectedQuestionsWithSolutions.ts:52-85` (`for...await getBytes`) vs `loadSelectedQuestions.ts:20-40,67-91` (pool di concorrenza 4).
- Impatto: solo latenza (tempo di generazione del PDF soluzioni per il docente), nessun costo economico aggiuntivo (stesso numero di letture Storage, solo sequenziali invece che concorrenti). Percorso a basso traffico (solo docente, solo su richiesta esplicita).
- Scenario che lo attiva: PDF soluzioni per una verifica le cui domande provengono da molti file pool distinti.
- Soluzione minimale: allineare alla stessa utility di concorrenza-4 già usata in `loadSelectedQuestions.ts`.
- Beneficio atteso: generazione PDF soluzioni più veloce quando le domande coprono molti pool distinti.
- Rischio della modifica: basso — stesso pattern già collaudato nel file gemello.
- File coinvolti: `loadSelectedQuestionsWithSolutions.ts`.
- Verifica necessaria: test mirato esistente su questa funzione, confermare stesso risultato con concorrenza.

**PERF-10 — Nessun code-splitting per ruolo/vista sul bundle principale**
- Evidenza: bundle unico da 1.19 MB (§3.1), nessun `React.lazy` trovato nel codice.
- Impatto: ogni utente (docente o studente) scarica l'intero codice applicativo, incluse sezioni mai visitate dal proprio ruolo (es. uno studente scarica il codice dell'editor pool e dell'import ZIP, mai raggiungibile dal suo ruolo). Impatto pratico limitato dal fatto che 321.65 KB gzip è comunque un carico iniziale ragionevole su una connessione tipica, e Vite/browser cache l'asset dopo il primo caricamento.
- Scenario che lo attiva: primo caricamento dell'app per ogni nuovo utente/dispositivo/dopo un deploy (cache invalidata).
- Soluzione minimale: `React.lazy` sui componenti di route principali (`TeacherShell`/sotto-viste docente vs `StudentShell`/sotto-viste studente), separando almeno il confine docente/studente, che è il confine di codice più naturale e a più alto beneficio.
- Beneficio atteso: uno studente scaricherebbe solo il codice del proprio ruolo (stima approssimativa, non misurata: una parte sostanziale del codice sotto `features/repository/**` e `features/teacher/**` è irraggiungibile per uno studente).
- Rischio della modifica: medio — richiede introdurre `Suspense`/boundary di caricamento e verificare che non rompa test esistenti basati su render sincrono; da pianificare, non applicare meccanicamente senza validare l'impatto UX del caricamento differito.
- File coinvolti: componente di routing principale (`App.tsx` o equivalente), `TeacherShell`/`StudentShell` e le viste che montano.
- Verifica necessaria: `pnpm build` con confronto dimensione chunk prima/dopo, smoke test di navigazione per ruolo.

## 7. Sicurezza — sintesi (dettaglio completo nella revisione statica allegata)

Nessun gap "NOT ENFORCED" è stato trovato in `firestore.rules`/`storage.rules` rispetto al modello descritto in `sicurezza.md`. Sono state verificate esplicitamente, con citazione di riga: isolamento studente su `submissions`/`submissionReceipts`/`students` (nessuna lettura incrociata possibile, ID deterministici legati a `request.auth.uid`, mai a un parametro arbitrario), filtro per classe su `publishedProjection` risolto **server-side** (non fidandosi di un `classId` fornito dal client), impossibilità di auto-approvazione studente (`status`/`classId` forzati e mai aggiornabili dallo studente stesso), immutabilità della submission dopo `submitted` (nessuna regola di update matcha più), blocco dell'enumerazione via `list` su `submissions`/`submissionReceipts` (solo `allow get`, mai `allow read`), nessun campo privilegiato modificabile dal client in nessuna delle collezioni esaminate, `storage.rules` con un'unica regola non-deny che richiede `request.auth.uid == ownerUid` sull'intero path `repository/**` (nessuna via di lettura per lo studente, coerente con la migrazione M3F-08).

Un solo elemento è annotato come **"enforced ma degno di nota"**: la lettura di `settings/studentAccess` è intenzionalmente aperta a *qualunque* utente autenticato (anche non ancora approvato) — la scrittura resta owner-only e ogni gate di contenuto reale ri-legge il documento server-side, quindi non è uno scavalcamento di sicurezza, ma espone comunque quali `classId` sono in Modalità verifica a un account Google autenticato ma non approvato. Documentato come tradeoff esplicito già in `sicurezza.md`, non trattato come finding SEC in questo report perché non contraddice il contratto documentato.

**SEC-01 (P2) — Il cap di 200 attention events è enforced solo lato client**
- Evidenza: `examDeterrence.ts` — `MAX_ATTENTION_EVENTS = 200` applicato da `capAttentionEvents`, richiamata prima di ogni `arrayUnion` in `submissionsService.ts`. Nessun riferimento a `attentionEvents.size()` o simile è stato trovato in `firestore.rules` durante la revisione delle regole `submissions` (righe 396-513).
- Prerequisiti dell'attacco: un client modificato (bypass della UI React, chiamata diretta all'SDK Firestore) che invia un `update` con un array `attentionEvents` più lungo di 200 elementi.
- Impatto: crescita del documento `submissions` oltre il limite atteso (comunque ben sotto il limite fisico di 1 MB per documento anche con migliaia di eventi, essendo ogni evento un piccolo record `{type, ts}`), quindi non è un rischio di perdita dati o violazione di isolamento — è un mancato enforcement di un vincolo di igiene dati dichiarato come garantito ("Gli attention events... sono limitati a 200" nel contesto del task). Il rischio pratico è basso (nessun dato sensibile aggiuntivo esposto, nessun altro utente impattato) ma il vincolo non è oggi verificabile lato server.
- Soluzione minimale: aggiungere un vincolo `request.resource.data.attentionEvents.size() <= 200` alla regola di update di `submissions` in `firestore.rules` (fuori ambito di questa fase, che non modifica le Rules — da valutare in PERF-SEC-01B).
- Beneficio atteso: garanzia server-side del vincolo già rispettato dal client onesto.
- Rischio della modifica: basso — regola additiva, non restringe alcun comportamento client legittimo esistente (che già rispetta il cap).
- File coinvolti: `firestore.rules` (blocco `submissions`, update rule).
- Verifica necessaria: test Rules mirato (positivo: ≤200 eventi accettato; negativo: >200 rifiutato) — richiederebbe `pnpm test:rules`, non eseguito in questa fase.

## 8. Budget prestazionale proposto

Contratto minimo, basato sulle soglie già osservate nel codice attuale (non valori arbitrari):

| Vincolo | Soglia | Base della soglia |
|---|---|---|
| Zero polling | 0 `setInterval`/`setTimeout` usati per rileggere dati Firestore in loop | Confermato assente nel codice attuale (solo l'autosave a intervallo fisso, che è una write pianificata, non un polling di lettura) |
| Massimo un listener realtime per funzione attiva | 1 `onSnapshot` per (monitor consegne docente), 1 per (Modalità verifica studente) | Pattern già rispettato ovunque nel codice attuale |
| Listener chiuso quando la vista non è attiva | Cleanup nell'`useEffect` return in ogni componente con `onSnapshot` | Già rispettato (monitor, StudentShell) |
| Autosave minimo 120s, dirty-only | 120 000 ms, nessuna write se non ci sono modifiche | Valore già in produzione (`OnlineExamView.tsx:21`) |
| Nessuna write causata dai soli attention events | Eventi bufferizzati in memoria, mai `arrayUnion` isolato | Già rispettato; SEC-01 chiede solo l'enforcement server-side del cap, non tocca questo vincolo |
| Query di collezioni crescenti sempre filtrate o limitate | `where('ownerUid','==',...)` su ogni collezione con più di un owner potenziale nello schema; `limit()` esplicito dove la crescita non ha un owner naturale (es. `verifications` con molte voci storiche) | Oggi violato da PERF-01/PERF-02 — soglia proposta come target di remediation |
| Niente N+1 sui flussi frequenti | Batch invece di loop `await` sequenziale per scritture multiple sullo stesso trigger utente | Oggi violato da PERF-04 (pool) — soglia proposta come target |
| Nessun contenuto pesante caricato prima dell'apertura | jsPDF/html2canvas restano lazy (già rispettato); considerare lazy anche per sezioni intere per ruolo (PERF-10, target futuro) | jsPDF già lazy, confermato in build |
| Limite 200 attention events | Enforced lato client oggi; enforced anche lato Rules dopo SEC-01 | Valore già dichiarato nel contesto del progetto |
| Cancellazioni con feedback di avanzamento e stato recuperabile | Non misurato in questa sessione se `deleteProgram`/`deletePool` espongono progresso incrementale alla UI — verificare in una fase successiva, nessun finding aperto qui per mancanza di evidenza diretta raccolta | — |
| Budget bundle iniziale e chunk PDF separati | Bundle iniziale (entry, gzip) sotto ~350 KB gzip come soglia di allarme (attuale: 321.65 KB gzip, già vicino al limite proposto); chunk PDF (jspdf+html2canvas) resta lazy, mai nel bundle iniziale | Soglia derivata dalla misura attuale stessa: 321.65 KB è già la baseline reale, quindi il budget proposto è "non peggiorare oltre ~10% da qui" finché non si applica PERF-10 |

## 9. Piano di remediation (indicativo, da approvare in PERF-SEC-01B)

Ordine proposto per rapporto beneficio/complessità (non vincolante, da confermare prima di ogni intervento):

1. PERF-01 (filtro `ownerUid` su `listVerifications`) — beneficio sistemico, complessità minima.
2. PERF-04 (batch invece di loop in `savePool`) — beneficio percepito alto (tempo di salvataggio), pattern già collaudato nello stesso file.
3. PERF-05 (allineare atomicità `setVerificationVisibility`/`closeVerification` al pattern batch già usato dalle funzioni gemelle) — beneficio di correttezza, complessità minima.
4. PERF-02 (stesso filtro `ownerUid` sulle altre `list*`) — beneficio sistemico, complessità bassa-media (verificare indici).
5. SEC-01 (cap 200 eventi lato Rules) — beneficio di garanzia, complessità bassa, ma richiede toccare Rules e quindi `test:rules` (esplicitamente fuori ambito di questa fase A).
6. PERF-06 (import Firestore coerente) — beneficio di igiene bundle, complessità bassa se si sceglie l'opzione "statico ovunque".
7. PERF-03 (chunking import/transazione) — beneficio di robustezza a scala, complessità media, da progettare con cura per non introdurre stati parziali.
8. PERF-10 (code-splitting per ruolo) — beneficio dimensionale potenzialmente alto ma non misurato con precisione, complessità media; consigliato solo se si osserva un problema di caricamento reale, non preventivamente.
9. PERF-07, PERF-08, PERF-09 — beneficio marginale ai volumi attuali, rimandabili.

## 10. Verifiche consigliate su DEV

- Osservare da Firebase Console (scheda Utilizzo) il conteggio reale di letture/scritture Firestore durante una sessione di verifica online reale con almeno 5-10 studenti simultanei, per confrontare con le stime di §5 scenario B.
- Dopo l'eventuale remediation di PERF-01/PERF-02, confermare via Console che il numero di letture per apertura vista docente sia effettivamente sceso.
- Dopo l'eventuale remediation di PERF-04, misurare il tempo di salvataggio pool prima/dopo su un pool con almeno 30-50 domande.
- Se si implementa SEC-01, eseguire `pnpm test:rules` con un caso positivo (200 eventi) e uno negativo (201 eventi) prima del deploy.
- Se si implementa PERF-10, eseguire `pnpm build` e confrontare la dimensione del chunk iniziale scaricato da un utente studente vs docente (via Network tab), non solo la dimensione totale del bundle.

---

## Output finale

**Giudizio sintetico**: architettura solida e coerente con gli obiettivi minimalisti dichiarati; nessun problema di sicurezza enforced mancante nelle Rules; il pattern di costo dominante (letture di collezione intera senza filtro server) è oggi innocuo ai volumi dello scenario A/B dichiarati ma è una scelta che non scala e merita correzione preventiva a basso rischio prima che il volume di dati cresca.

**Finding**: 0 P0, 2 P1 (PERF-01, PERF-04), 6 P2 (PERF-02, PERF-03, PERF-05, PERF-06, PERF-07, SEC-01), 3 P3 (PERF-08, PERF-09, PERF-10).

**Cinque rischi principali**:
1. `listVerifications` legge l'intera collezione senza filtro server-side (PERF-01) — cresce col tempo, non con l'uso.
2. `savePool` scrive una domanda alla volta in sequenza, nessun batching (PERF-04) — latenza percepita proporzionale al numero di domande.
3. Cap di 200 attention events enforced solo lato client, non nelle Rules (SEC-01) — vincolo dichiarato non garantito server-side.
4. Import ZIP e swap `publicLessons` non gestiscono il limite di 500 mutazioni per batch/transazione (PERF-03) — rischio di fallimento a scala, non osservato ma non gestito.
5. Incoerenza di atomicità tra `setVerificationVisibility`/`closeVerification` (non atomici) e le loro funzioni gemelle (atomiche) nello stesso file (PERF-05) — finestra di stato incoerente in caso di errore transitorio.

**Cinque ottimizzazioni con miglior rapporto beneficio/complessità**:
1. PERF-01 — filtro `ownerUid` su `listVerifications`.
2. PERF-05 — allineare `setVerificationVisibility`/`closeVerification` al pattern batch già collaudato.
3. PERF-04 — batch invece di loop sequenziale in `savePool`.
4. PERF-06 — rendere coerente l'import di `firebase/firestore` (statico ovunque).
5. PERF-02 — stesso filtro `ownerUid` sulle altre `list*` (`listPrograms`, `listClasses`, `listStudents`, `listQuestionIndex`).

**Stima operativa dei tre scenari**: scenario A (uso personale) e scenario B (una verifica online da 30 studenti) restano ampiamente entro la quota gratuita Firestore anche senza remediation, sulla base dei conteggi di operazioni dedotti dal codice (centinaia-basse migliaia di operazioni per evento, contro una quota giornaliera gratuita nell'ordine delle decine di migliaia). Lo scenario C (più docenti) non è supportato nativamente dall'architettura single-tenant attuale — ogni docente richiederebbe un progetto Firebase separato, il che mantiene ciascuno sotto quota indipendentemente; un moltiplicatore di costo reale nel modello attuale è la crescita nel tempo di un singolo docente (più classi/studenti/verifiche archiviate), mitigata dalle remediation P1/P2 proposte.

**File modificati in questa fase**: nessun file applicativo, nessuna Rules. Aggiunti/modificati solo:
- `documentazione/performance-security-audit.md` (nuovo — questo documento)
- `documentazione/m3-full-roadmap.md` (aggiunta voci PERF-SEC-01A/01B e gate)
- `documentazione/piano-implementazione.md` (aggiunta voci PERF-SEC-01A/01B e gate)

**Verifiche eseguite**: `pnpm format:check`, `pnpm build` (per le dimensioni reali del bundle riportate in §3.1), letture/ricerche statiche mirate su servizi, viste, Rules. Nessuna suite di test completa, nessun `test:rules` (Rules non modificate in questa fase).

**Limiti dell'audit**: nessuna misura da un progetto Firebase reale attivo (Firebase Console non consultata in questa sessione); le stime di costo sono conteggi di operazioni dedotti dal codice, non osservazioni; le tariffe Blaze citate sono parametriche e vanno riverificate sulla pagina ufficiale prima di qualunque decisione di budget; non è stata misurata la dimensione reale dei documenti Firestore su dati di produzione; PERF-10 (code-splitting) è una stima qualitativa, non una misura quantitativa dell'impatto per ruolo.

**Link PR draft**: da aprire dopo il commit di questo documento (vedi messaggio finale della sessione).
