# Audit prestazioni, costi Firebase e sicurezza — PERF-SEC-01A

**Data:** 2026-07-11
**Stato:** Baseline evidence-based, nessuna modifica al codice applicativo, a Firestore Rules o a Storage Rules.
**Ambito:** M1, M2, M3-lite, M3-full fino a M3F-11C incluso (rami merged su `main`).

## 1. Executive summary

SchoolForge è architetturalmente coerente con i suoi obiettivi dichiarati (nessuna Cloud Function, nessun polling, autosave dirty-only, listener singoli e puliti). La revisione statica delle Security Rules (`firestore.rules`, `storage.rules`) non ha trovato gap non enforced rispetto al modello descritto in `sicurezza.md`: isolamento studente, immutabilità post-consegna, blocco enumerazione via `list`, campi privilegiati non modificabili dal client e limite di 200 attention events sono verificati a livello di regola.

**Nota architetturale (riallineata dopo revisione — vedi changelog in fondo al documento):** SchoolForge oggi è **single-owner/single-tenant per scelta di design**, non per limite non affrontato. `settings/owner` identifica un unico docente per deployment; `isOwner()` concede a quel docente l'accesso alle proprie collezioni; non esiste oggi un insieme di proprietari concorrenti nello stesso portale. Di conseguenza, aggiungere `where('ownerUid','==',ownerUid)` alle query `list*` **non riduce le letture nel sistema attuale** (l'intera collezione coincide già con i dati del singolo docente) — non è quindi un'ottimizzazione di costo per l'oggi, ma al più una preparazione a un eventuale multi-tenant futuro. Il rischio di costo reale è un altro: **la crescita non limitata dello storico di un singolo docente nel tempo** (più verifiche, più classi, più studenti archiviati anno dopo anno), poiché le query `list*` non hanno `limit()`/paginazione e leggono sempre l'intera collezione a ogni apertura, indipendentemente da quanti di quei documenti siano effettivamente rilevanti nella sessione corrente.

Sul fronte costi/prestazioni, il pattern dominante è quindi: **query di collezione senza `limit`/paginazione, lette per intero a ogni apertura** (`listVerifications`, `listPrograms`, `listClasses`, `listStudents`, `listQuestionIndex`, i controlli di blocco cancellazione in `deleteProgram`/`deletePool`). Per l'uso personale dichiarato (scenario A: 1 docente, 5 classi, 150 studenti, 20 verifiche/mese) questo resta entro le quote gratuite con ampio margine — ogni collezione coinvolta ha nell'ordine delle decine-centinaia di documenti, non migliaia. Il rischio non è nel volume attuale ma nella **assenza di un tetto**: senza paginazione, il costo di ogni apertura cresce linearmente e indefinitamente con lo storico accumulato dal singolo docente, anno dopo anno.

Sul frontend, il bundle di produzione è **un solo chunk JS da 1.19 MB (321.65 KB gzip)**, senza alcun `React.lazy`/code-splitting per ruolo (docente vs studente) o per vista: uno studente scarica anche tutto il codice dell'editor pool/import ZIP/monitor docente mai usato. jsPDF (390 KB) e html2canvas (201 KB, dipendenza transitiva di jsPDF) sono correttamente lazy-caricati solo al momento del download PDF — questo è già ottimale.

Nessun finding **P0** (rischio immediato di sicurezza o perdita dati) è stato trovato. Sono stati identificati **2 P1**, **4 P2**, **4 P3** (dettaglio §6).

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

Nessun indice esiste per `verifications`/`programs`/`classes`/`students` filtrati per `ownerUid` da sole. Questo è coerente con il fatto che, nel modello single-owner attuale, un filtro `ownerUid` non ridurrebbe le letture (l'intera collezione coincide già con i dati dell'unico docente) — un eventuale indice andrebbe introdotto solo se si aggiungesse paginazione/ordinamento (es. `orderBy('createdAt')` + `limit()`), non come filtro di isolamento owner (vedi §4, §6 PERF-01/PERF-02).

## 4. Mappa accessi Firebase (per flusso)

> Legenda: **R** = `getDoc`/`getDocs` singolo o di query, **L** = `onSnapshot`, **W** = `setDoc`/`updateDoc`/`addDoc`, **B** = `writeBatch`, **T** = `runTransaction`, **S** = operazione Storage.

### Login e RoleGate
- `RoleGate.tsx`: 1× **R** (`settings/ownerPublic`) sempre. Se non-owner: + 1× **R** (`settings/studentAccess`) + 1× **R** (`students/{uid}`). Se studente nuovo: + 1× **W** (creazione `students/{uid}` in stato `pending`), guardato da un ref così scatta una sola volta per mount.
- Nessun listener in RoleGate stesso. `StudentShell` apre poi 1× **L** persistente su `settings/studentAccess` (Modalità verifica), con cleanup su unmount confermato.
- **Totale worst-case per sessione**: 1–3 R + 0–1 W. Nessuna query di collezione.

### Apertura portale docente (`VerificationsView`, `LessonsView`, `StudentsView`, ecc.)
- Ogni vista principale chiama la propria `list*` **senza `limit()`/paginazione**: `listVerifications` (`getDocs(collection(db,'verifications'))`, poi `.filter(ownerUid)` client-side — filtro ridondante nel modello single-owner attuale, dato che l'intera collezione appartiene già a quel docente), `listPrograms`, `listClasses`, `listStudents` — stesso pattern in tutte e quattro.
- Costo: 1 read per documento nell'intera collezione, che nel modello attuale coincide con "tutti i documenti del docente" — il costo cresce con lo storico accumulato nel tempo, non con l'uso di una singola sessione. Vedi PERF-01/PERF-02.

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
- Attention events: bufferizzati in memoria, **mai causa di write da soli** (commento esplicito nel codice), viaggiano solo agganciati al prossimo autosave "vero" o alla consegna, con `arrayUnion` solo se ci sono nuovi eventi. Cap 200 lato client (`examDeterrence.ts`) e nelle Rules sia su create sia su update (`firestore.rules`); test Rules positivi a 200 e negativi a 201 già presenti.
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
- **Giudizio**: la stima statica indica margine ampio rispetto alle quote gratuite giornaliere (50 000 letture, 20 000 scritture) nelle ipotesi dichiarate, anche sommando tutte le viste aperte più volte al giorno e considerando il pattern "collezione intera senza `limit()`" di PERF-01/02 — da confermare con misure Firebase Console su un progetto reale (nessun conteggio osservato in questa sessione, vedi §2).

### Scenario B — Verifica online (1 classe, 30 studenti, 60 minuti, autosave dirty per tutta la prova, monitor docente aperto)

- Autosave: nel limite teorico di modifica continua per 60 minuti a intervallo 120s → **massimo 30 tick per studente**, ma dirty-only quindi tipicamente meno; worst-case 30 studenti × 30 write = **900 write**.
- Consegna: 30 × 1 batch (2 op interne, 1 costo di rete) = 30 operazioni.
- Monitor docente aperto per tutta la prova: 1 listener, riceve un evento di aggiornamento per ogni write di ogni studente → fino a **~900-930 letture "di aggiornamento"** lato listener (ogni snapshot delta conta come lettura secondo il modello standard Firestore per documento cambiato).
- Avvio sessione: 30 studenti × (1-3 R RoleGate/StudentShell + ricerca sessione attiva, 1 R per verifica online candidata) ≈ 30-90 R aggiuntive.
- **Totale indicativo per una sessione da 60 minuti/30 studenti**: nell'ordine di **1 800-2 000 operazioni Firestore combinate** (letture + scritture). La stima statica indica margine rispetto alla quota giornaliera gratuita anche in un giorno con più classi in verifica online, salvo un numero molto elevato di sessioni sovrapposte nello stesso giorno — da confermare con misure Firebase Console (vedi §10).

### Scenario C — Uso ampliato (più docenti o traffico pubblico)

Ipotesi esplicite: **SchoolForge nella sua architettura attuale supporta un solo docente owner per deployment** (`settings/owner` è un singleton, confermato dalla rules review, §5). Non esiste oggi alcuna nozione di "secondo docente" nello stesso progetto Firestore. Per supportare più docenti esistono, in astratto, due strategie **future e non implementate**, entrambe fuori dal perimetro dell'MVP attuale:

1. **Deployment/progetto Firebase separato per docente o istituto** — strategia più semplice e isolata: ogni docente ha il proprio progetto Firebase, la propria quota gratuita indipendente, nessuna modifica architetturale al codice esistente. Lo scenario C si riduce in questo caso a N istanze indipendenti dello scenario A/B, ciascuna sotto quota separatamente.
2. **Evoluzione multi-tenant nello stesso progetto Firestore** — richiederebbe un redesign non banale: introduzione di un concetto di tenant/owner multiplo, filtri `where('ownerUid','==',...)` che a quel punto diventerebbero effettivi (oggi non lo sono, vedi nota architetturale in §1), nuove Security Rules per l'isolamento tra tenant, nuovi indici compositi, e verifica che nessuna query lato client assuma implicitamente "un solo owner nel database".

Nessuna delle due strategie è pianificata o necessaria per l'uso personale dichiarato; sono menzionate qui solo come inquadramento delle opzioni disponibili se il prodotto crescesse oltre il perimetro attuale.

Se invece si ipotizza **traffico pubblico non autenticato** verso pagine servite da Hosting (es. una landing page), il moltiplicatore di costo rilevante sarebbe quello di **Firebase Hosting** (banda), non Firestore, poiché tutte le collezioni Firestore sono protette da `isAuthenticated()`/`isOwner()`/`isApprovedStudent()` e non hanno superfici pubbliche non autenticate lette in massa (confermato in rules review, nessun `allow read: if true` trovato).

Nel modello attuale (un solo docente, più classi/studenti/verifiche nel tempo), il moltiplicatore di costo reale non è "più docenti" ma **la crescita non limitata dello storico di quell'unico docente** (vedi PERF-01 in §6) — mitigabile con paginazione, non con un filtro owner. Non vengono fatte previsioni assolute di costo per lo scenario multi-tenant, in assenza di un design multi-tenant reale da misurare.

## 6. Findings (ordinati per priorità)

Nessun finding P0 identificato.

### P1 — costo o blocco prestazionale importante

**PERF-04 — `savePool` scrive una domanda alla volta in sequenza (N+1 scritture non batched)**
- Evidenza: `apps/web/src/features/repository/pools/poolEditorService.ts:190-196` — `for (const q of pool.questions) { await setDoc(...) }`.
- Impatto: per un pool con molte domande (decine-centinaia), ogni salvataggio del pool costa un round-trip di rete sequenziale per domanda — tempo di salvataggio proporzionale al numero di domande, non costante. Anche il costo in operazioni Firestore è 1 write per domanda (non evitabile per definizione, essendo N documenti distinti), ma la sequenzialità aggiunge latenza percepita.
- Scenario che lo attiva: editor pool su una lezione con molte domande (es. 50+), ogni salvataggio del docente.
- Soluzione minimale: sostituire il loop sequenziale con un `writeBatch` (fino a 500 operazioni per batch, chunked se necessario come già fatto altrove nello stesso file per le cancellazioni).
- Beneficio atteso: un solo round-trip di rete invece di N, salvataggio percepito quasi istantaneo indipendentemente dal numero di domande.
- Rischio della modifica: basso — pattern già usato altrove nello stesso file (`deleteDocRefsInBatches`), stessa collezione, stesso owner.
- File coinvolti: `poolEditorService.ts`.
- Verifica necessaria: test service mirato che verifichi lo stesso risultato finale (stessi documenti scritti) con un batch invece di N `setDoc`.

**PERF-05 — Incoerenza atomicità tra funzioni gemelle in `verificationsService.ts` (promosso a P1 — correttezza, non solo velocità) — ✅ RISOLTO da PERF-SEC-01B-1**
- Evidenza: `setVerificationVisibility` (righe ~292-321) e `closeVerification` (righe ~438-466) usano 2 `setDoc` sequenziali non atomici (parent + proiezione mirror), mentre `setVerificationOnlineEnabled` (righe ~342-376) e `setVerificationStudentPdfEnabled` (righe ~399-429) usano correttamente un `writeBatch` atomico per lo stesso tipo di doppia scrittura.
- Impatto: un crash o errore di rete tra le due `setDoc` sequenziali lascia `verifications/{id}` e `publishedProjection/data` temporaneamente fuori sincrono (es. verifica marcata `closed` ma la proiezione pubblica ancora visibile, o viceversa). Questa è una finestra di incoerenza **reale e confermata dal codice** (non solo teorica): la sequenza `await setDoc(A); await setDoc(B);` non ha alcuna garanzia atomica tra i due `setDoc`, e un fallimento di rete tra i due lascia lo stato osservabile inconsistente per un tempo indefinito (fino alla prossima mutazione riuscita su quella verifica). Riguarda la correttezza dei dati esposti allo studente (proiezione pubblica), non solo la latenza — da qui la promozione a P1 rispetto alla classificazione P2 iniziale.
- Scenario che lo attiva: qualunque chiamata a `setVerificationVisibility`/`closeVerification` durante un errore di rete transitorio tra le due `setDoc`.
- Soluzione minimale: allineare le due funzioni al pattern `writeBatch` già usato da `setVerificationOnlineEnabled`/`setVerificationStudentPdfEnabled` nello stesso file.
- Beneficio atteso: eliminazione della finestra di incoerenza, nessun costo aggiuntivo (stesso numero di operazioni, solo atomiche invece di sequenziali).
- Rischio della modifica: basso — pattern già collaudato nello stesso file per lo stesso tipo di scrittura doppia.
- File coinvolti: `verificationsService.ts`.
- Verifica necessaria: test service mirato che verifichi l'atomicità (es. simulando un fallimento a metà, se il mock lo consente) o quantomeno che il risultato finale sia identico.
- **Stato**: risolto in PERF-SEC-01B-1 — `setVerificationVisibility` e `closeVerification` ora usano un singolo `writeBatch` (parent + proiezione + audit), stesso pattern già usato da `setVerificationOnlineEnabled`/`setVerificationStudentPdfEnabled`. Test service aggiornati in `verificationsService.test.ts`.

### P2 — ottimizzazione utile e misurabile

**PERF-01 — `listVerifications` legge l'intera collezione a ogni apertura, senza tetto sullo storico (riclassificato da P1 a P2)**
- Evidenza: `apps/web/src/features/repository/verifications/verificationsService.ts:38-55` — `getDocs(collection(db,'verifications'))` poi `.filter((item) => item.ownerUid === ownerUid)` lato client.
- Impatto: ogni apertura/refresh della vista Verifiche legge *tutti* i documenti `verifications` esistenti. **Correzione rispetto alla prima versione di questo report**: nel modello single-owner attuale questa collezione contiene già solo i documenti dell'unico docente — non "tutte le verifiche di tutti i docenti" — quindi un filtro `where('ownerUid','==',ownerUid)` non ridurrebbe le letture nel sistema di oggi. Il rischio reale è che, senza `limit()`/paginazione, il costo di ogni apertura cresce linearmente e senza tetto con lo storico accumulato dal singolo docente nel tempo (più anni scolastici, più verifiche archiviate).
- Scenario che lo attiva: uso prolungato nel tempo con molte verifiche archiviate (scenario A esteso su più anni scolastici), o refresh frequenti (la funzione è richiamata dopo create/activate/close/delete — più volte per sessione). Ai volumi dichiarati nello scenario A (20 verifiche/mese) non è un rischio importante immediato — da qui la riclassificazione a P2.
- Soluzione proposta (da valutare in dettaglio in remediation, non implementata qui): introdurre paginazione/`limit()` con una strategia distinta per bozze (tipicamente poche, sempre rilevanti, da mostrare per intero) e verifiche storiche (potenzialmente molte, ordinabili per data più recente, paginabili), mantenendo comunque la possibilità di raggiungere lo storico completo su richiesta esplicita (non nasconderlo). Un eventuale filtro `ownerUid` andrebbe considerato solo come preparazione a un futuro multi-tenant (vedi §5 scenario C), non come risparmio di costo nel sistema attuale.
- Beneficio atteso: costo di apertura della vista limitato e costante nel tempo, indipendente dallo storico accumulato.
- Rischio della modifica: medio — richiede decidere la UX di "carica altro"/paginazione per lo storico verifiche, non è una sostituzione meccanica di una riga di query.
- File coinvolti: `verificationsService.ts`, `VerificationsView.tsx`.
- Verifica necessaria: test service mirato + verifica che la UX di accesso allo storico resti chiara (nessuna verifica "persa" dietro paginazione senza modo di raggiungerla).

**PERF-02 — Query di collezione intera senza `limit`/paginazione ripetute in più service (`listPrograms`, `listClasses`, `listStudents`, `listQuestionIndex`, blocchi cancellazione)**
- Evidenza: `programsService.ts` (`listPrograms`, `listUdas`, `listLessons`), `classesService.ts:15-20` (`listClasses`), `studentsService.ts:17-25` (`listStudents`), `questionIndexService.ts:25-58` (`listQuestionIndex`), più i controlli di blocco cancellazione in `deleteProgram` (`programsService.ts:267`) e `deletePool` (`poolEditorService.ts:252-254`) che leggono l'intera collezione `verifications` solo per un controllo booleano.
- Impatto: stesso pattern di PERF-01, ma le collezioni coinvolte non sono equivalenti tra loro. **Correzione rispetto alla prima versione**: nel modello single-owner attuale un filtro `ownerUid` non produce risparmio (stesso ragionamento di PERF-01) — non va quindi proposto genericamente per tutte queste collezioni. Vanno distinte:
  - **Collezioni strutturalmente crescenti nel tempo** (`verifications`, potenzialmente `students` in una scuola con molti anni di iscrizioni): da valutare con `limit()`/paginazione, stessa logica di PERF-01.
  - **Collezioni naturalmente piccole per un singolo docente** (`programs`, `classes` — tipicamente poche decine anche su più anni): nessuna modifica preventiva necessaria, il costo resta trascurabile per costruzione.
  - **`listQuestionIndex`**: scope già naturalmente limitato a un singolo import/lezione, non una collezione globale crescente — nessuna azione necessaria.
  - I controlli di blocco cancellazione (`deleteProgram`/`deletePool` che leggono l'intera collezione `verifications`) restano un caso a parte: qui il problema non è l'assenza di filtro owner ma l'assenza di un filtro *mirato al programma/pool* (es. `where('config.programId','==',programId)`), utile indipendentemente dal modello single/multi-tenant.
- Scenario che lo attiva: crescita organica nel tempo, principalmente per `verifications` e in misura minore `students`.
- Soluzione minimale: `limit()`/paginazione solo dove la collezione può realisticamente crescere senza tetto naturale; nessun indice `ownerUid` da introdurre preventivamente nell'architettura corrente.
- Beneficio atteso: riduzione del rischio di crescita futura sulle sole collezioni che ne hanno bisogno, senza modifiche inutili altrove.
- Rischio della modifica: basso-medio, e solo dove applicata (vedi sopra).
- File coinvolti: `verificationsService.ts` (già in PERF-01), `programsService.ts`/`poolEditorService.ts` (solo per i controlli di blocco cancellazione mirati).
- Verifica necessaria: test service mirati solo per le funzioni effettivamente modificate.

**PERF-03 — Import ZIP e swap `publicLessons` non gestiscono il limite di 500 mutazioni per batch/transazione**
- Evidenza: `importRepository.ts:81-101` (batch unico per import metadata+UDA+lezioni+questionIndex, nessun chunking) e `importRepository.ts:114-150` (transazione unica per lo swap `publicLessons`, nessun chunking).
- Impatto: un import molto grande (molte UDA/lezioni/domande in un unico ZIP) potrebbe superare il limite Firestore di 500 mutazioni per batch/transazione e fallire a runtime — non osservato in questa sessione (nessun test con dataset di quella scala), ma è un limite noto della piattaforma non gestito nel codice.
- Scenario che lo attiva: import di un intero anno scolastico in un colpo solo, con molte UDA/lezioni/domande.
- Soluzione minimale: chunking esplicito del batch di import (già presente altrove nel codice come pattern, `deleteDocsInBatches`/`deleteDocRefsInBatches` chunkano a 400) e della transazione di swap `publicLessons`.
- Beneficio atteso: import robusto indipendentemente dalla dimensione, elimina un fallimento silente/rumoroso a scala.
- Rischio della modifica: medio — il chunking del batch di scrittura import è più delicato del chunking delle cancellazioni, perché va preservata l'atomicità logica percepita dal docente (un import "a metà" è uno stato peggiore di un import fallito interamente); da progettare con attenzione in fase di remediation, non applicare meccanicamente.
- File coinvolti: `importRepository.ts`.
- Verifica necessaria: test con un import sintetico che superi 500 mutazioni (se il costo di scrivere un test così grande è giustificato) o quantomeno una verifica statica/commento esplicito del limite noto.

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

**PERF-06 — Import misto di `firebase/firestore` impedisce a Vite di isolare il chunk Firebase (riclassificato da P2 a P3)**
- Evidenza: warning esplicito di build — `firebase/firestore` importato dinamicamente da `submissionsService.ts` ma staticamente da oltre 15 altri file (`OwnerSetup.tsx`, `RoleGate.tsx`, `classesService.ts`, ecc.).
- Impatto: Vite non può spostare il modulo Firestore in un chunk separato scaricabile pigramente; il codice Firestore resta nel chunk principale indipendentemente dal singolo import dinamico in `submissionsService.ts`. **Correzione rispetto alla prima versione**: la semplice sostituzione dell'import dinamico con uno statico (rendere `submissionsService.ts` coerente con gli altri ~15 file) non è di per sé un'ottimizzazione prestazionale misurabile — è principalmente pulizia/coerenza del codice ed eliminazione di un warning di build. Non c'è evidenza misurata che questo cambio da solo riduca la dimensione del bundle iniziale (il modulo Firestore resterebbe comunque nel chunk principale in entrambi i casi, essendo importato staticamente da tutti gli altri file). Il code-splitting reale (isolare Firestore o intere sezioni per ruolo in chunk separati) è una decisione architetturale distinta e più ampia — vedi PERF-10 — non un effetto collaterale di questa correzione.
- Scenario che lo attiva: qualunque caricamento dell'app (sempre, essendo un problema di bundling, non di runtime) — impatto pratico basso.
- Soluzione minimale: rendere l'import di `firebase/firestore` in `submissionsService.ts` statico come ovunque altro nel codice, per eliminare il warning e la disomogeneità — senza attendersi un beneficio dimensionale misurabile da questo solo cambio.
- Beneficio atteso: bundle più prevedibile, elimina un warning di build; nessun beneficio dimensionale atteso senza un intervento di code-splitting più ampio (PERF-10).
- Rischio della modifica: basso.
- File coinvolti: `submissionsService.ts`.
- Verifica necessaria: `pnpm build` senza warning di import misto; confronto dimensione bundle prima/dopo per confermare (o smentire) l'assenza di beneficio dimensionale diretto.

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

## 8. Budget prestazionale proposto

Contratto minimo, basato sulle soglie già osservate nel codice attuale (non valori arbitrari):

| Vincolo | Soglia | Base della soglia |
|---|---|---|
| Zero polling | 0 `setInterval`/`setTimeout` usati per rileggere dati Firestore in loop | Confermato assente nel codice attuale (solo l'autosave a intervallo fisso, che è una write pianificata, non un polling di lettura) |
| Massimo un listener realtime per funzione attiva | 1 `onSnapshot` per (monitor consegne docente), 1 per (Modalità verifica studente) | Pattern già rispettato ovunque nel codice attuale |
| Listener chiuso quando la vista non è attiva | Cleanup nell'`useEffect` return in ogni componente con `onSnapshot` | Già rispettato (monitor, StudentShell) |
| Autosave minimo 120s, dirty-only | 120 000 ms, nessuna write se non ci sono modifiche | Valore già in produzione (`OnlineExamView.tsx:21`) |
| Nessuna write causata dai soli attention events | Eventi bufferizzati in memoria, mai `arrayUnion` isolato | Già rispettato |
| Query di collezioni strutturalmente crescenti sempre limitate o paginate | `limit()`/paginazione esplicita su `verifications` (storico che cresce nel tempo) e, se necessario in futuro, su `students`; nessun filtro `ownerUid` da introdurre nell'architettura single-owner attuale (non produrrebbe risparmio, vedi PERF-01) | Oggi violato da PERF-01 (assenza di tetto sullo storico) — soglia proposta come target di remediation |
| Niente N+1 sui flussi frequenti | Batch invece di loop `await` sequenziale per scritture multiple sullo stesso trigger utente | Oggi violato da PERF-04 (pool) — soglia proposta come target |
| Nessun contenuto pesante caricato prima dell'apertura | jsPDF/html2canvas restano lazy (già rispettato); considerare lazy anche per sezioni intere per ruolo (PERF-10, target futuro) | jsPDF già lazy, confermato in build |
| Limite 200 attention events | Enforced lato client e nelle Rules su create/update; test Rules 200/201 presenti | Vincolo già rispettato end-to-end |
| Cancellazioni con feedback di avanzamento e stato recuperabile | Non misurato in questa sessione se `deleteProgram`/`deletePool` espongono progresso incrementale alla UI — verificare in una fase successiva, nessun finding aperto qui per mancanza di evidenza diretta raccolta | — |
| Budget bundle iniziale e chunk PDF separati | Bundle iniziale (entry, gzip) sotto ~350 KB gzip come soglia di allarme (attuale: 321.65 KB gzip, già vicino al limite proposto); chunk PDF (jspdf+html2canvas) resta lazy, mai nel bundle iniziale | Soglia derivata dalla misura attuale stessa: 321.65 KB è già la baseline reale, quindi il budget proposto è "non peggiorare oltre ~10% da qui" finché non si applica PERF-10 |

## 9. Piano di remediation (indicativo, da approvare in PERF-SEC-01B)

Proposto in pacchetti tematici, ciascuno indipendentemente approvabile ed eseguibile — non un ordine numerico rigido ma un raggruppamento per tipo di beneficio, in modo da poter approvare/rimandare un pacchetto alla volta:

**01B-1 — Correttezza delle proiezioni**
- **PERF-05** — allineare `setVerificationVisibility`/`closeVerification` al pattern `writeBatch` atomico già usato dalle funzioni gemelle nello stesso file. Beneficio: elimina una finestra di incoerenza reale tra `verifications` e `publishedProjection`. Complessità: minima, pattern già collaudato.

**01B-2 — Latenza delle operazioni** (percepita dall'utente, non costo economico)
- **PERF-04** — batch invece di loop sequenziale in `savePool`. Beneficio: salvataggio pool quasi istantaneo indipendentemente dal numero di domande. Complessità: bassa, pattern già collaudato nello stesso file.
- **PERF-09** — concorrenza limitata (stessa utility già usata da `loadSelectedQuestions`) in `loadSelectedQuestionsWithSolutions`. Beneficio: generazione PDF soluzioni più veloce con domande da molti pool distinti. Complessità: bassa.

**01B-3 — Letture e crescita dei dati**
- **PERF-01 (corretto)** — paginazione/`limit()` su `listVerifications`, con strategia distinta per bozze (sempre visibili) e storico (paginabile ma raggiungibile). Complessità: media, richiede decisioni di UX, non solo di query.
- **PERF-08** — evitare la doppia lettura `listStudents`/`countPendingStudents`, **solo se confermato** che un chiamante reale effettua entrambe le letture nello stesso ciclo di rendering (verificare prima di implementare, non assumere).
- Eventuali altri scan di collezione realmente evitabili individuati durante l'implementazione di PERF-01 (es. `PERF-02` limitatamente ai controlli di blocco cancellazione con filtro mirato al programma/pool, non un filtro owner generico).

**01B-4 — Bundle**
- Misurare prima di implementare: dimensione del chunk iniziale effettivamente scaricato per ruolo (docente vs studente), non solo la dimensione totale del bundle.
- Implementare code-splitting per ruolo (**PERF-10**) solo se la misura conferma un beneficio concreto, non automaticamente.
- **PERF-06** (coerenza import Firestore) può essere applicato in questo stesso pacchetto come pulizia minima, senza attendersi un beneficio dimensionale da solo.

Rimandabili senza pacchetto dedicato, a beneficio marginale ai volumi attuali: **PERF-03** (chunking import/transazione oltre 500 mutazioni — nessuna evidenza di occorrenza reale, solo un limite di piattaforma non gestito), **PERF-07** (split schema `submissions` per ridurre banda al monitor — cambio di schema non banale, rapporto beneficio/complessità sfavorevole).

## 10. Verifiche consigliate su DEV

- Osservare da Firebase Console (scheda Utilizzo) il conteggio reale di letture/scritture Firestore durante una sessione di verifica online reale con almeno 5-10 studenti simultanei, per confrontare con le stime di §5 scenario B.
- Dopo l'eventuale remediation di PERF-01/PERF-02, confermare via Console che il numero di letture per apertura vista docente sia effettivamente sceso.
- Dopo l'eventuale remediation di PERF-04, misurare il tempo di salvataggio pool prima/dopo su un pool con almeno 30-50 domande.
- Se si implementa PERF-10, eseguire `pnpm build` e confrontare la dimensione del chunk iniziale scaricato da un utente studente vs docente (via Network tab), non solo la dimensione totale del bundle.

---

## Output finale

**Giudizio sintetico**: architettura solida e coerente con gli obiettivi minimalisti dichiarati; nessun problema di sicurezza enforced mancante nelle Rules; SchoolForge è single-owner/single-tenant per scelta di design, non per limite non affrontato — un filtro `ownerUid` sulle query non produce risparmio nel sistema attuale. Il rischio reale non è "più docenti" ma la crescita non limitata nel tempo dello storico di un singolo docente (soprattutto `verifications`), mitigabile con paginazione mirata.

**Finding (aggiornati dopo revisione)**: 0 P0, **2 P1** (PERF-04, PERF-05), **4 P2** (PERF-01, PERF-02, PERF-03, PERF-07), **4 P3** (PERF-06, PERF-08, PERF-09, PERF-10).

**Cambiamenti di classificazione rispetto alla prima versione**:
- **PERF-01**: P1 → P2 — riscritto da "manca filtro `ownerUid`" a "manca un tetto/paginazione sullo storico"; ai volumi personali dichiarati non è un rischio importante immediato.
- **PERF-02**: testo rivisto per non proporre più filtri `ownerUid` generici su collezioni naturalmente piccole (`programs`, `classes`); resta P2, ma limitato alle collezioni realmente crescenti (`verifications`) e ai controlli di blocco cancellazione con filtro mirato.
- **PERF-05**: P2 → **P1** — è correttezza dei dati esposti (finestra di incoerenza parent/proiezione confermata dal codice), non solo velocità.
- **PERF-06**: P2 → P3 — è pulizia/coerenza del codice ed eliminazione di un warning, non un'ottimizzazione prestazionale misurata; il code-splitting reale resta una decisione separata (PERF-10).
- **Scenario C**: riscritto per non affermare "ogni docente richiederebbe un progetto Firebase separato" come unica via; ora presenta esplicitamente le due strategie future (progetto separato per docente/istituto, oppure redesign multi-tenant), nessuna delle due nell'MVP attuale.

**Cinque rischi principali**:
1. `savePool` scrive una domanda alla volta in sequenza, nessun batching (PERF-04, P1) — latenza percepita proporzionale al numero di domande.
2. Incoerenza di atomicità tra `setVerificationVisibility`/`closeVerification` (non atomici) e le loro funzioni gemelle già atomiche nello stesso file (PERF-05, P1) — finestra di stato incoerente confermata dal codice in caso di errore transitorio.
3. `listVerifications` non ha un tetto sullo storico letto a ogni apertura (PERF-01, P2) — cresce nel tempo con l'uso del singolo docente, non con "altri docenti".
4. Import ZIP e swap `publicLessons` non gestiscono il limite di 500 mutazioni per batch/transazione (PERF-03, P2) — rischio di fallimento a scala, non osservato ma non gestito.
5. Il monitor trasferisce documenti submission completi anche se scarta le risposte prima del render (PERF-07, P2) — costo di banda, non di read Firestore.

**Cinque ottimizzazioni con miglior rapporto beneficio/complessità**:
1. PERF-05 — allineare `setVerificationVisibility`/`closeVerification` al pattern batch già collaudato (pacchetto 01B-1).
2. PERF-04 — batch invece di loop sequenziale in `savePool` (pacchetto 01B-2).
3. PERF-09 — concorrenza limitata anche per il PDF soluzioni (pacchetto 01B-2).
4. PERF-08 — evitare la doppia lettura studenti, solo se confermato un uso combinato reale (pacchetto 01B-3).
5. PERF-01 — progettare una paginazione dello storico senza nascondere bozze o dati raggiungibili (pacchetto 01B-3).

**Nuova sequenza PERF-SEC-01B (pacchetti, non ordine numerico rigido)**: 01B-1 (correttezza: PERF-05) → 01B-2 (latenza: PERF-04, PERF-09) → 01B-3 (letture/crescita dati: PERF-01 corretto, PERF-08 se confermato, altri scan mirati) → 01B-4 (bundle: misura prima, code-splitting solo se il beneficio è concreto, PERF-06 come pulizia minima). Dettaglio in §9.

**Stima operativa dei tre scenari**: la stima statica indica margine ampio rispetto alla quota gratuita Firestore per lo scenario A (uso personale) e lo scenario B (verifica online da 30 studenti), sulla base dei conteggi di operazioni dedotti dal codice — **da confermare con misure Firebase Console**, non osservata in questa sessione. Lo scenario C (più docenti) non è supportato nell'architettura single-tenant attuale: le due strategie future possibili sono (a) un progetto Firebase separato per docente/istituto, più semplice e isolato, o (b) un redesign multi-tenant nello stesso progetto — nessuna delle due è nell'MVP attuale. Nel modello di oggi, il moltiplicatore di costo reale è la crescita nel tempo di un singolo docente (più classi/studenti/verifiche archiviate), mitigata dal pacchetto 01B-3.

**File modificati in questa fase**: nessun file applicativo, nessuna Rules, nessuna dipendenza. Aggiunti/modificati solo:
- `documentazione/performance-security-audit.md` (riallineamento concettuale su single-owner vs multi-tenant, riclassificazione PERF-01/02/05/06, riscrittura scenario C, nuovo piano di remediation a pacchetti)
- `documentazione/m3-full-roadmap.md` (voci PERF-SEC-01A/01B e gate — invariate in questo aggiornamento)
- `documentazione/piano-implementazione.md` (voci PERF-SEC-01A/01B e gate — invariate in questo aggiornamento)

**Conferma**: nessun codice applicativo e nessuna Security Rule (Firestore o Storage) sono stati modificati in questo aggiornamento — solo il documento di audit e, nella fase precedente, i due riepiloghi di roadmap.

**Verifiche eseguite in questo aggiornamento**: `pnpm format:check`. Nessuna build (la baseline bundle §3.1 non cambia, nessun codice toccato), nessun test, nessun deploy.

**Limiti dell'audit**: nessuna misura da un progetto Firebase reale attivo (Firebase Console non consultata in questa sessione); le stime di costo sono conteggi di operazioni dedotti dal codice, non osservazioni; le tariffe Blaze citate sono parametriche e vanno riverificate sulla pagina ufficiale prima di qualunque decisione di budget; non è stata misurata la dimensione reale dei documenti Firestore su dati di produzione; PERF-10 (code-splitting) è una stima qualitativa, non una misura quantitativa dell'impatto per ruolo.

**Link PR draft**: https://github.com/EnricoPaparo/SchoolForge/pull/110 (aggiornata da questo commit, resta draft).
