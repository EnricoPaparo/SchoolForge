# SchoolForge — Verifiche differenziate per etichetta (VDIF) ed Esiti

**Stato:** **VDIF-00 completato** — contratto tecnico congelato, cost model,
matrice di test e prototipo UI approvabile. **Nessuna riga di codice runtime
implementata.** Nessuna modifica a Firebase, Security Rules, Cloud Functions,
indici, schema reale o dipendenze è introdotta da questo pacchetto.
**Data:** 11 agosto 2026.
**Dipendenze operative:** M4 (correzione manuale e IA) e VEX (varianti
equivalenti) implementati e distribuiti su DEV con **Gate GVEX PASS**;
`assignedQuestionOrders` e `resolveAssignedQuestions` già usati da tutti i
consumer downstream; LESSON-DEPTH-01 in produzione.
**Prototipo:** [`prototipi/verifiche-differenziate.html`](prototipi/verifiche-differenziate.html).
**Gate:** **GVDIF aperto.**

Questa roadmap affronta due bisogni distinti che condividono gli stessi dati:

1. **gli esiti non tornano indietro.** Il portale produce lezione, verifica e
   correzione, ma ciò che la classe ha sbagliato non raggiunge mai la lezione
   che l'aveva preparata;
2. **la didattica è a taglia unica.** Una classe reale ha studenti con
   obiettivi minimi e misure personalizzate. Non è un extra: è un obbligo
   normativo, e oggi il docente lo assolve fuori dallo strumento.

Il pacchetto **B — verifiche differenziate (VDIF)** è quello che questo
documento congela. Il pacchetto **A — Esiti (ESITI-01)** resta valido come
descritto in §12 ed è **indipendente e successivo** al Gate GVDIF.

---

## 1. Principi invarianti

Sono vincoli, non preferenze. Ogni fase VDIF-01→05 va misurata contro questa
lista, e una violazione è un blocker di merge.

1. **Le etichette sono strumenti operativi privati del docente.** Servono al
   sistema solo per sapere *quale versione servire*, mai *perché*.
2. **Nessun dato sanitario o certificativo nel database.** SchoolForge non
   memorizza diagnosi, certificazioni, PDP, BES o motivazioni sanitarie, né in
   campi dedicati né in campi liberi progettati per ospitarle.
3. **La UI invita a denominazioni operative neutrali** («Percorso A»,
   «Obiettivi essenziali», «Gruppo 2»), **senza alcun esempio diagnostico**:
   né nei placeholder, né negli stati vuoti, né nei testi di aiuto.
4. **Nessuna classificazione semantica automatica sui nomi.** SchoolForge non
   deduce, non deriva e non certifica che cosa rappresenti un'etichetta: il
   nome è una stringa opaca, confrontata solo per unicità (§5.A.5).
5. **Nessun nome, ID o riferimento di etichetta può comparire in dati o
   superfici leggibili dallo studente.** L'elenco chiuso è in §4.
6. **Un solo riferimento di etichetta per studente.** Nessuna precedenza da
   arbitrare: le combinazioni sono etichette a sé.
7. **Studente senza etichetta ⇒ verifica base.** Default esplicito.
8. **Etichetta senza variante per una domanda ⇒ domanda base.**
9. **«Nessuna domanda» è ammessa** per una specifica combinazione
   domanda × etichetta.
10. **Una configurazione che lascia un'etichetta con zero domande blocca
    l'attivazione.**
11. **Le varianti si configurano soltanto sulle domande comuni.**
12. **Le alternative provengono dalla stessa lezione della domanda base.**
13. **Le alternative non possono produrre duplicazioni** nella verifica
    risolta assegnata a uno studente.
14. **La configurazione è congelata semanticamente all'attivazione.**
15. **Cambiare l'etichetta di uno studente non modifica una verifica già
    attiva.**
16. **Nessuna configurazione viene corretta, eliminata o convertita in
    silenzio.**
17. **Qualunque incoerenza blocca l'attivazione** con un errore leggibile
    lato docente. Fail-closed sempre, degradazione silenziosa mai.
18. **Zero listener per card, zero query per riga, zero polling.**
19. **Riuso prima di costruzione.** Il meccanismo per servire domande diverse a
    studenti diversi esiste già (`assignedQuestionOrders` +
    `resolveAssignedQuestions`): VDIF ne cambia il **criterio di
    assegnazione**, non l'impianto.

---

## 2. Il modello in una frase

Il docente definisce alcune **etichette**, ne assegna **al massimo una** a
ciascuno studente, e in fase di bozza può, per ogni **domanda comune**,
scegliere esplicitamente per ciascuna etichetta fra **domanda base**,
**domanda alternativa** e **nessuna domanda**. Chi non ha etichetta, o ha
un'etichetta senza scelta per quella domanda, riceve la domanda base.

### 2.1 Decisioni prese (nessuna resta aperta)

| # | Decisione | Motivo |
|---|---|---|
| D1 | Una sola etichetta per studente | elimina ogni regola di precedenza; le combinazioni diventano etichette a sé (`Percorso A + ridotto`), al prezzo di una lista più lunga |
| D2 | Varianti solo sulle domande comuni | una domanda già in un gruppo VEX non è differenziabile: il conflitto fra sorteggio anti-copiatura e differenziazione è **eliminato**, non arbitrato (§6) |
| D3 | Alternative dalla stessa lezione | garantisce che la variante interroghi la stessa porzione di programma: è ciò che distingue un obiettivo minimo da una verifica diversa |
| D4 | Alternative non già selezionate | altrimenti lo studente riceverebbe la stessa domanda due volte |
| D5 | «Nessuna domanda» ammessa | la riduzione resta possibile, ma come eccezione decisa domanda per domanda, non come impostazione globale |
| D6 | Punteggio massimo diverso ammesso | la percentuale è già derivata dal proprio massimo: una verifica ridotta resta confrontabile senza penalizzazioni artificiali |
| D7 | Congelamento all'attivazione | coerente con `teacherSnapshot`, già immutabile per Rules. Cambiare idea richiede di riportare la verifica in bozza — gesto esplicito |
| D8 | Etichette in una **collezione owner-only separata**, non su `students/{uid}` | `students/{uid}` è leggibile dallo studente stesso e Firestore non nasconde singoli campi in lettura (§5.B.1) |
| D9 | Le configurazioni referenziano **`labelId` stabili**, mai il nome | una rinomina non deve rompere le bozze né cambiare l'assegnazione |
| D10 | Scelta **esplicita a tre valori**, mai un booleano o un campo assente | «base», «alternativa» e «nessuna» sono tre intenzioni diverse: l'assenza non può significare né la prima né la terza |

### 2.2 Che cosa esiste già e va riusato

| Serve | Esiste |
|---|---|
| servire domande diverse a studenti diversi | `SubmissionDoc.assignedQuestionOrders` (+ mirror `assignedAnswerKeys`) |
| risolvere «quali domande valgono per questa consegna» | `resolveAssignedQuestions` (`assignedVariant.ts`), già usato da correzione manuale, IA, restituzione, PDF ed export |
| sapere quali domande sono comuni | `commonEntryIds(selezionate, gruppi)` (`vexGroups.ts`), funzione pura |
| convertire `questionIndexEntryId` → `order` all'attivazione | `buildEquivalentSnapshotParts` (`vexSnapshot.ts`) |
| scegliere una domanda dal pool in modo accessibile e con anteprima | `VexQuestionSelect` (metadati + `questionPreview`, tastiera, Escape, click esterno) |
| lezione di provenienza di ogni domanda | `questionIndex.lessonFilename` / `VerificationQuestionRef.lessonFilename` |
| dialog conforme (viewport, backdrop, Escape, focus trap) | `DialogShell` |
| card full-width, menu «…», layout responsive | `RecordCard` + `RecordActionsMenu` |

---

## 3. Vocabolario congelato

| Termine | Significato esatto |
|---|---|
| **Etichetta** | Nome operativo privato del docente, con `labelId` stabile. Non è una categoria, non è una diagnosi, non ha semantica per il sistema. |
| **Assegnazione** | La relazione «questo studente ha questa etichetta». Vive in un documento owner-only separato. |
| **Domanda base** | La domanda comune selezionata nella verifica, valida per tutti finché una scelta esplicita non la sostituisce. |
| **Alternativa** | Una domanda dello stesso `lessonFilename` della base, non selezionata nella verifica, che sostituisce la base per una specifica etichetta. |
| **Omissione** | La scelta esplicita «Nessuna domanda» per una combinazione domanda × etichetta. |
| **Verifica risolta** | L'insieme di domande effettivamente servito a uno studente, dopo differenziazione e VEX. |
| **Configurazione privata** | `config.differentiation`, la struttura di bozza owner-only che descrive le scelte. |
| **Snapshot differenziato** | `teacherSnapshot.differentiation`, la stessa struttura convertita in `order` e congelata all'attivazione. |

---

## 4. Perimetro privacy — elenco chiuso

Né `labelId`, né `labelName`, né alcun valore derivato da essi (hash, indice
posizionale, colore, contatore, ordinamento osservabile) può comparire in:

| Superficie | Perché è nell'elenco |
|---|---|
| `students/{uid}` | leggibile dallo studente stesso (`firestore.rules`: `allow read: if isOwner() \|\| (isAuthenticated() && request.auth.uid == uid)`) |
| `publishedProjection/*` | leggibile da ogni compagno di classe autorizzato |
| `publicLessons/*` | proiezione studente |
| `SubmissionDoc` | leggibile dallo studente finché `draft` |
| `SubmissionReceiptDoc` | leggibile dallo studente dopo la consegna |
| `correctionReturns/*` | leggibile dallo studente quando `visibleToStudent == true` |
| PDF studente | generato nel browser dalla proiezione |
| PDF di correzione / archivio | consegnato allo studente o alla scuola |
| CSV / export registro | consegnato fuori dallo strumento |
| schermata di svolgimento (`OnlineExamView`) | vista studente |
| restituzione (`StudentCorrectionView`) | vista studente |
| messaggi di errore lato studente | testo mostrato allo studente |
| payload o snapshot pubblici, `topicOutline` incluso | contratto chiuso già in vigore |
| log applicativi e `auditEvents.reason` | `auditEvents` è owner-only ma non deve trasportare il **nome** dell'etichetta (§5.A.8) |

**Canali laterali da negare esplicitamente**, perché nessuno di essi è un
campo e tutti rivelerebbero comunque la differenziazione:

- **numero di domande.** Uno studente con omissioni riceve meno domande. È
  **inevitabile e accettato**: è il senso stesso della funzionalità. Ciò che
  non è ammesso è **dire perché** — nessun testo, badge, nota o numerazione
  con buchi può segnalare che manca qualcosa. La numerazione mostrata allo
  studente è **densa e locale** (1..N sulle domande realmente assegnate),
  esattamente come già avviene in VEX;
- **`topicOutline`.** Resta il perimetro **complessivo** della verifica —
  unione delle lezioni di tutte le domande selezionate, base e alternative
  insieme — quindi **identico per ogni studente** e muto sull'etichetta,
  esattamente come già stabilito per VEX (`sicurezza.md` §2);
- **ordine.** L'ordine visivo resta lo shuffle locale già esistente, non
  persistito, e non correla con l'etichetta;
- **messaggi di errore.** Un errore lato studente non dice mai «la tua
  configurazione», «il tuo percorso» o «la tua variante»: usa lo stesso testo
  generico già in uso per VEX.

---

## 5. Modello dati congelato

> I nomi dei campi sono **definitivi**. Nessuno di questi tipi è implementato
> da VDIF-00: sono il contratto che VDIF-01→04 dovranno rispettare alla
> lettera.

### A. Registro etichette

**Percorso:** `differentiationLabels/{labelId}` — collezione **top-level**,
**owner-only in lettura e scrittura**.

Perché top-level e non una sottocollezione di `students`: l'etichetta esiste
indipendentemente dagli studenti che la usano (può esistere senza assegnazioni,
e sopravvive alla rimozione di uno studente), ed è referenziata anche dalle
bozze di verifica, che non appartengono ad alcuno studente.

**Il documento ha esattamente sette chiavi.** Sono queste, e sono le stesse
elencate nelle Rules previste (§5.A.10), negli esempi e nel cost model (§14):

| # | Campo | Tipo | Regola |
|---|---|---|---|
| — | *document id* | `string` | `labelId` opaco generato client-side (`crypto.randomUUID()`), **immutabile**, mai derivato dal nome |
| 1 | `labelId` | `string` | `== {labelId}` del path, **immutabile**. Ridondante per costruzione, come `StudentDoc.uid` e `SubmissionDoc.submissionId`: permette alle Rules e alla prenotazione (§5.A.6) di verificare l'identità **dal contenuto**, non solo dal path |
| 2 | `ownerUid` | `string` | `== request.auth.uid`, **immutabile** |
| 3 | `name` | `string` | trim applicato prima della scrittura; **1–40 caratteri** e **≤ 120 byte UTF-8**; nessun carattere di controllo, nessun newline |
| 4 | `nameKey` | `string` | forma normalizzata **usata esclusivamente per il confronto di unicità** (§5.A.5). Mai mostrata, mai esportata, mai usata come chiave di configurazione |
| 5 | `assignedCount` | `number` | intero `>= 0`, **contatore transazionale** delle assegnazioni studente vive (§5.A.7). È l'unica fonte che autorizza l'eliminazione |
| 6 | `createdAt` | `Timestamp` | `== request.time` |
| 7 | `updatedAt` | `Timestamp` | `== request.time` a ogni scrittura |

**Contratto chiuso:** `keys().hasOnly([...])` e `hasAll([...])` sulle **sette**
chiavi sopra. Nessun campo `color`, `note`, `description`, `category`,
`priority` o `order`: ognuno di essi sarebbe l'appiglio per scriverci una
motivazione, ed è esattamente ciò che il principio 2 vieta.

**5.A.5 — Normalizzazione per il confronto.** `nameKey = name` con: trim,
collasso degli spazi interni multipli in uno singolo, `toLowerCase()` e
normalizzazione Unicode `NFKC`. **Nulla di più**: nessuna rimozione di accenti,
nessuna traslitterazione, nessun stemming, nessuna sinonimia. La normalizzazione
serve a impedire «Percorso A» e «percorso  a» come etichette distinte, non a
interpretare il nome. È un **helper puro condiviso** (`labelNameKey.ts`),
unica fonte per UI e servizio.

**5.A.6 — Unicità autorevole: prenotazione transazionale del `nameKey`.**

L'unicità **non** è affidata a un controllo del servizio sulla lista in memoria,
e **non** è affidata ad alcuna query: entrambe perdono la corsa fra due schede
aperte contemporaneamente. È garantita da un **documento di prenotazione con
identità deterministica**, creato nella **stessa transazione** dell'etichetta.

**Percorso:** `differentiationLabelNames/{reservationId}` — top-level,
**owner-only in lettura e scrittura**.

```
reservationId = SHA-256( ownerUid + U+0000 + nameKey )   // hex minuscolo, 64 char
```

Calcolato con **Web Crypto** (`crypto.subtle.digest`), stessa tecnica già in uso
per `manifestCanonical` in `STRUCTURE-IMPORT-01`. Il separatore è il carattere
`U+0000`, che un `nameKey` valido non può contenere (il contratto di `name`
vieta i caratteri di controllo): due coppie `(ownerUid, nameKey)` diverse non
possono quindi collidere per concatenazione.

**Perché un hash e non il `nameKey` in chiaro nel path:** un path Firestore
compare in log, messaggi di errore, tracce di rete ed export della console. Se il
docente scrivesse un nome improprio nonostante il principio 4, quel nome vivrebbe
in chiaro dentro un identificatore di percorso. L'hash lo impedisce per
costruzione, senza indebolire la garanzia: la funzione è deterministica, quindi
lo stesso nome produce sempre lo stesso documento, ed è questo che rende il
`create` mutuamente esclusivo.

**Documento di prenotazione — contratto chiuso a quattro chiavi:**

| Campo | Tipo | Regola |
|---|---|---|
| `ownerUid` | `string` | `== request.auth.uid`, **immutabile** |
| `labelId` | `string` | etichetta che detiene la prenotazione |
| `nameKey` | `string` | il `nameKey` prenotato, per verificare la coerenza con l'etichetta (owner-only, mai esposto) |
| `createdAt` | `Timestamp` | `== request.time` |

**Le tre operazioni, tutte in una sola transazione ciascuna:**

| Operazione | Transazione |
|---|---|
| **Creazione** | legge `differentiationLabelNames/{r}`; se **esiste** ⇒ rifiuto leggibile «esiste già un'etichetta con questo nome» (a meno del replay, sotto). Se **assente** ⇒ `set` prenotazione + `set` etichetta, **nello stesso commit** |
| **Rinomina** | legge la vecchia prenotazione `{r_old}` e la nuova `{r_new}`; se `{r_new}` esiste e non è già di questa etichetta ⇒ rifiuto. Altrimenti `set {r_new}` + `update` etichetta (`name`, `nameKey`, `updatedAt`) + `delete {r_old}`, **nello stesso commit** |
| **Eliminazione** | legge etichetta e prenotazione; verifica `assignedCount == 0` (§5.A.7) e le altre guardie di §5.E; poi `delete` etichetta + `delete` prenotazione, **nello stesso commit** |

Firestore garantisce che una transazione client fallisca se un documento letto
è cambiato prima del commit: due creazioni concorrenti dello stesso `nameKey`
leggono entrambe «assente», ma **una sola** committa; l'altra fallisce e viene
ripresentata al docente come conflitto di nome, non come errore tecnico.

**Replay idempotente.** Un retry dopo una risposta persa rilegge la prenotazione
e la trova **già esistente con lo stesso `labelId`**: è un replay, non un
conflitto, e l'operazione si chiude come riuscita **senza scrivere nulla**. Una
prenotazione esistente con un `labelId` **diverso** è un conflitto reale.

**Fail-closed su record incoerente.** Sono tutti errori leggibili che **fermano
l'operazione senza scrivere**, mai riparazioni silenziose:

- prenotazione il cui `nameKey` non corrisponde all'etichetta che la detiene;
- prenotazione il cui `reservationId` non è l'hash del proprio `(ownerUid, nameKey)`;
- etichetta senza prenotazione corrispondente;
- prenotazione orfana (nessuna etichetta con quel `labelId`) incontrata durante
  una creazione: **non** viene riusata né sovrascritta; è segnalata come
  conflitto e richiede un'azione esplicita di riparazione.

**5.A.7 — `assignedCount`: contatore transazionale, non contatore di UI.**

Il numero mostrato sulla card etichetta è **derivato** dalle assegnazioni già
caricate nella scheda Studenti (§14): è un dato di presentazione e **non
autorizza nulla**. Ciò che autorizza l'eliminazione è `assignedCount`, letto
**dentro** la transazione di eliminazione, per path deterministico.

`assignedCount` è mantenuto esclusivamente da transazioni che toccano insieme
l'assegnazione e l'etichetta, quindi non può divergere per una scrittura
parziale:

| Evento | Transazione |
|---|---|
| assegnazione a uno studente senza etichetta | `set` assegnazione + `increment(+1)` su `L` |
| rimozione dell'etichetta da uno studente | `delete` assegnazione + `increment(−1)` su `L` |
| cambio da `L1` a `L2` | `set` assegnazione + `increment(−1)` su `L1` + `increment(+1)` su `L2` |
| eliminazione dello studente | `delete` assegnazione + `increment(−1)` su `L` |

Ogni transazione **legge prima** `differentiationLabels/{labelId}`: se
l'etichetta non esiste, l'assegnazione **fallisce fail-closed** invece di creare
un puntatore a un documento inesistente. Questo è ciò che chiude la corsa
«elimina in una scheda, assegna nell'altra» in entrambe le direzioni: o
l'eliminazione vede `assignedCount > 0` e rifiuta, o l'assegnazione non trova
l'etichetta e rifiuta.

`assignedCount` non è un dato didattico e non lascia mai il lato docente.

**5.A.8 — Audit.** Tre nuove azioni: `label.created`, `label.updated`,
`label.deleted`. `targetId == labelId`. **`reason` resta `null`**: il registro
audit è owner-only, ma non c'è alcun motivo per farvi transitare il nome
dell'etichetta, e l'assenza è la difesa più semplice da verificare.

**5.A.9 — Comportamento legacy.** Le due collezioni non esistono oggi. Assenza
totale = zero etichette, stato vuoto, nessuna migrazione. Un documento privo di
`nameKey`, con `assignedCount` non intero o negativo, o senza prenotazione
corrispondente (tutti impossibili per il contratto chiuso, ma possibili per
manomissione) è **fail-closed**: escluso dalla lista con errore leggibile, mai
riparato in silenzio.

**5.A.10 — Rules previste (forma, non testo definitivo).**

```
match /differentiationLabels/{labelId} {
  allow read, delete: if isOwner();
  allow create, update: if isOwner()
    && request.resource.data.keys().hasOnly(
         ['labelId','ownerUid','name','nameKey','assignedCount','createdAt','updatedAt'])
    && request.resource.data.keys().hasAll(
         ['labelId','ownerUid','name','nameKey','assignedCount','createdAt','updatedAt'])
    && request.resource.data.labelId == labelId
    && request.resource.data.ownerUid == request.auth.uid
    && request.resource.data.name is string
    && request.resource.data.name.size() > 0
    && request.resource.data.name.size() <= 40
    && request.resource.data.nameKey is string
    && request.resource.data.nameKey.size() > 0
    && request.resource.data.assignedCount is int
    && request.resource.data.assignedCount >= 0
    && request.resource.data.updatedAt == request.time;
}

match /differentiationLabelNames/{reservationId} {
  allow read, delete: if isOwner();
  allow create: if isOwner()
    && request.resource.data.keys().hasOnly(['ownerUid','labelId','nameKey','createdAt'])
    && request.resource.data.keys().hasAll(['ownerUid','labelId','nameKey','createdAt'])
    && request.resource.data.ownerUid == request.auth.uid
    && request.resource.data.createdAt == request.time;
  allow update: if false;   // una prenotazione si crea e si rilascia, non si muta
}

match /studentLabelAssignments/{studentUid} { allow read, write: if isOwner(); /* + contratto chiuso, §5.B */ }
```

**Confine Rules/service dichiarato.** Le Rules non possono verificare che
`reservationId == SHA-256(ownerUid + " " + nameKey)`: CEL non ha funzioni di
hash. Quella coerenza è responsabilità del **service owner-only**, che la
verifica **in lettura** su ogni prenotazione toccata (fail-closed, §5.A.6) — lo
stesso confine già in vigore per `evaluations`/`teacherSnapshot`
(`sicurezza.md` §3): l'unico principal che può scrivere è l'owner. Le Rules
garantiscono ownership, contratto chiuso e immutabilità; l'unicità è garantita
dalla **transazione**, non dal servizio e non da una query.

### B. Assegnazione studente → etichetta

**Percorso:** `studentLabelAssignments/{studentUid}` — collezione **top-level**,
**owner-only in lettura e scrittura**, id **deterministico** uguale allo
`studentUid`.

**5.B.1 — Perché `labelId` NON può stare su `students/{uid}` (dimostrazione).**

`firestore.rules` concede oggi:

```
match /students/{uid} {
  allow read: if isOwner() || (isAuthenticated() && request.auth.uid == uid);
  ...
}
```

Lo studente **legge il proprio documento** — è il percorso che `RoleGate` usa
(`getOwnStudentDoc`) per risolvere stato, classe e telemetria di accesso. Le
Firestore Security Rules autorizzano **per documento, non per campo**: non
esiste alcun costrutto — né `hasOnly` in lettura, né una projection
server-side — che consenta di restituire allo studente `students/{uid}` privo
di un singolo campo. Aggiungere `labelId` lì significherebbe che **ogni
studente potrebbe leggere la propria etichetta** con una `getDoc` banale dalla
console del browser, e questo è esattamente il principio 5.

È la stessa ragione — dichiarata in `architettura.md` ADR-12 — per cui il corpo
lezione vive in `publicLessons` e non dentro il documento tecnico `lessons`:
*«Le Firestore Security Rules autorizzano per documento, non per campo:
separare i dati tecnici dalla proiezione pubblica in documenti diversi permette
regole semplici e verificabili»*. VDIF applica lo stesso principio nella
direzione opposta: il dato sensibile resta **fuori** dal documento che lo
studente legge.

Le alternative scartate, e perché:

| Alternativa | Perché scartata |
|---|---|
| `labelId` su `students/{uid}` | leggibile dallo studente (sopra) |
| Sottocollezione `students/{uid}/label/current` | tecnicamente owner-only (le Rules non si ereditano), ma appende un dato del **docente** sotto l'albero identitario dello studente, e rende l'elenco delle assegnazioni una collection-group query invece di una lettura di collezione |
| Array `studentUids[]` dentro l'etichetta | rende «una sola etichetta per studente» un invariante da mantenere a mano su N documenti, e cresce senza limite dichiarato |
| Mappa `{studentUid: labelId}` in un unico documento | limite 1 MiB e contesa in scrittura su ogni singola assegnazione |

| Campo | Tipo | Regola |
|---|---|---|
| *document id* | `string` | `== studentUid`. Identità deterministica: **un solo documento per studente**, garantita dal path, senza query di unicità (stesso schema di `submissions/{verificationId}_{studentUid}`) |
| `studentUid` | `string` | `== {studentUid}` del path, **immutabile** |
| `ownerUid` | `string` | `== request.auth.uid`, **immutabile** |
| `labelId` | `string` | id di un'etichetta esistente dello stesso owner; **non nullable** |
| `createdAt` | `Timestamp` | `== request.time` |
| `updatedAt` | `Timestamp` | `== request.time` |

**5.B.2 — «Nessuna etichetta» è l'assenza del documento**, non un valore
sentinella. Motivo: un `labelId: null` sarebbe un secondo modo di dire la
stessa cosa, e ogni lettore dovrebbe gestirne due. L'assenza è già lo stato di
default più restrittivo, come `students/{uid}` assente = `pending`
(`sicurezza.md` §3.1). Rimuovere l'etichetta ⇒ `deleteDoc`.

**5.B.3 — Studente eliminato.** `removeStudent` elimina anche
`studentLabelAssignments/{uid}` **nello stesso batch**. Non è una cascata
silenziosa: è la stessa operazione, già confermata dal docente, e il documento
residuo sarebbe un puntatore a un utente inesistente. Se il batch fallisce,
nulla viene eliminato. Un'assegnazione orfana eventualmente sopravvissuta è
**ignorata in lettura** (nessuno studente corrispondente) e non blocca nulla,
ma **non conta** come utilizzo ai fini della cancellazione di un'etichetta
(§5.E), perché il conteggio si costruisce intersecando con gli studenti reali.

**5.B.4 — Etichetta rinominata.** L'assegnazione non cambia: referenzia
`labelId`. Zero scritture, zero migrazioni.

**5.B.5 — Audit.** `student.labelAssigned` con `targetId == studentUid` e
`reason == null` — **mai** il nome dell'etichetta, e nemmeno il `labelId`:
`auditEvents` non è student-readable, ma non serve a ricostruire chi aveva
quale percorso, e la sua assenza rende il vincolo verificabile con un grep.

### C. Configurazione privata della verifica (bozza)

Vive dentro `verifications/{id}.config`, che è **già owner-only** e già
scritto dal medesimo `updateVerificationConfig` di titolo, classe, data,
perimetro, domande e gruppi VEX. **Nessun documento nuovo, nessuna scrittura
aggiuntiva.**

```ts
/** VDIF — scelta esplicita a tre valori per una combinazione domanda × etichetta. */
export type DifferentiatedChoice =
  | { kind: 'base' }
  | { kind: 'alternative'; questionIndexEntryId: string }
  | { kind: 'none' };

/** VDIF — scelte per una singola domanda base comune. */
export type DifferentiatedQuestionConfig = {
  /** Domanda base: `questionIndexEntryId` STABILE, come i gruppi VEX (mai `order`). */
  baseQuestionIndexEntryId: string;
  /** Chiave = labelId stabile. Un'etichetta assente ⇒ domanda base (principio 8). */
  choices: Record<string, DifferentiatedChoice>;
};

/** VDIF — blocco versionato dentro `VerificationConfig`. */
export type VerificationDifferentiationConfig = {
  /** Versione del contratto. VDIF-01→05 scrivono e accettano solo `1`. */
  version: 1;
  /** Una voce per ogni domanda base che ha almeno una scelta non-base. */
  questions: DifferentiatedQuestionConfig[];
};

export type VerificationConfig = {
  // …campi esistenti…
  /** Assente su bozze legacy e su verifiche non differenziate ⇒ nessuna differenziazione. */
  differentiation?: VerificationDifferentiationConfig;
};
```

**Vincoli di forma, validati fail-closed prima di ogni scrittura:**

- `version` è il letterale `1`. Un valore diverso — o assente su un blocco
  presente — è un **errore leggibile**, mai un default;
- `questions[].baseQuestionIndexEntryId` è unico dentro `questions[]`;
- le chiavi di `choices` sono `labelId` esistenti dello stesso owner;
- `kind` appartiene esattamente a `{'base','alternative','none'}`;
- `alternative` porta **esattamente** `questionIndexEntryId`, nessuna
  proprietà extra: nessun testo, nessuna preview, nessun `order`, nessun nome
  di etichetta;
- proprietà extra a qualunque livello ⇒ errore, non rimozione silenziosa;
- **potatura esplicita, mai silenziosa**: una voce le cui scelte sono tutte
  `base` è equivalente all'assenza della voce, e la UI la scrive comunque come
  assenza. Il salvataggio bozza **riconcilia** la configurazione con la
  selezione corrente esattamente come `reconcileEquivalentGroups` fa oggi con
  i gruppi VEX, e ciò che rimuove lo dichiara nel riepilogo — non è una
  correzione nascosta, è l'effetto visibile di una deselezione già fatta dal
  docente.

**Perché `kind: 'base'` è rappresentabile pur essendo equivalente
all'assenza:** durante la modifica il docente deve poter *tornare* alla base in
modo esplicito, e il dialog deve poter mostrare quale radio è selezionata senza
inferirlo. Il valore esiste nel modello di editing e nel salvataggio; una voce
composta di sole `base` non viene persistita, perché sarebbe rumore.

**Perché non il nome dell'etichetta come chiave:** una rinomina romperebbe ogni
bozza esistente, e il nome tornerebbe a viaggiare dentro la configurazione,
avvicinandolo di un passo alle superfici pubbliche (D9).

### D. Snapshot all'attivazione

**5.D.1 — Che cosa resta nella configurazione privata.** `config` non viene
riscritto dall'attivazione: `config.differentiation` resta com'è, come già
avviene per `config.equivalentGroups`. È la traccia di ciò che il docente
aveva configurato, non la fonte autorevole dopo l'attivazione.

**5.D.2 — Che cosa viene congelato.** Un blocco nuovo dentro
`teacherSnapshot`, che le Rules già rendono immutabile dopo l'attivazione
(nessuna regola di update post-`draft` include `teacherSnapshot` fra le
`affectedKeys()` consentite — `sicurezza.md` §3.2):

```ts
export type DifferentiatedChoiceSnapshot =
  | { kind: 'base' }
  /** `order` (0-based) dentro `teacherSnapshot.questions[]`. */
  | { kind: 'alternative'; order: number }
  | { kind: 'none' };

export type DifferentiatedQuestionSnapshot = {
  /** `order` (0-based) della domanda base dentro `questions[]`. */
  baseOrder: number;
  /** Chiave = labelId. Etichetta assente ⇒ base. */
  choices: Record<string, DifferentiatedChoiceSnapshot>;
};

export type VerificationDifferentiationSnapshot = {
  version: 1;
  questions: DifferentiatedQuestionSnapshot[];
  /**
   * Etichette coinvolte, congelate con il **nome al momento dell'attivazione**.
   * Owner-only: rende lo snapshot autosufficiente sia per la risoluzione
   * (labelId) sia per la leggibilità della configurazione storica (labelName),
   * senza alcuna dipendenza dalla collezione live. Vedi §5.D.10.
   */
  labels: { labelId: string; labelName: string }[];
  /**
   * Order delle alternative introdotte dalla differenziazione: sono presenti in
   * `questions[]` (quindi hanno testo e soluzione congelati) ma NON in
   * `commonQuestionOrders` e NON in alcun `equivalentGroups[].alternativeOrders`.
   */
  differentiatedAlternativeOrders: number[];
};
```

`teacherSnapshot.questions[]` all'attivazione contiene **l'unione**: domande
selezionate (comuni + membri VEX) **più** tutte le alternative differenziate
realmente referenziate. Ognuna con testo, opzioni, `soluzione`, `difficolta`,
`maxCharacters`, come già oggi. Serve perché correzione, IA, restituzione e PDF
leggono da lì, e una verifica attiva non deve mai rileggere il pool corrente
(ADR-07).

**5.D.3 — Snapshot dell'assegnazione.** Un secondo blocco, congelato nella
stessa transazione:

```ts
export type VerificationLabelAssignmentSnapshot = {
  version: 1;
  /** studentUid → labelId, letto al momento dell'attivazione. Owner-only. */
  byStudentUid: Record<string, string>;
};
```

Vive in `teacherSnapshot.labelAssignments`, **owner-only e immutabile**.
È ciò che rende vero il principio 15: la risoluzione per uno studente usa
**questa** mappa, mai il documento `studentLabelAssignments` corrente. Cambiare
l'etichetta di uno studente dopo l'attivazione non ha alcun effetto sulla
verifica attiva — non perché qualcuno lo impedisca, ma perché nessuno lo
legge più.

**Nota di dimensione.** La mappa è `studentUid → labelId`: due stringhe per
studente approvato, decine di studenti, ordine di grandezza dei kilobyte. Il
controllo di limite esistente (`verificationSnapshotLimits.ts`) va esteso per
comprenderla, con la stessa soglia conservativa già in uso.

**5.D.4 — Risoluzione delle domande per uno studente (algoritmo congelato).**

Funzione **pura**, condivisa, senza IO — nome congelato
`resolveDifferentiatedOrders`:

```
input:  snapshot (questions, commonQuestionOrders, equivalentGroups,
                  differentiation, labelAssignments), studentUid, rng
output: number[]  (order assegnati, ordinati in modo crescente)

1. labelId := snapshot.labelAssignments.byStudentUid[studentUid]   // può mancare
2. base    := insieme di commonQuestionOrders
3. per ogni q in differentiation.questions:
     se q.baseOrder ∉ base                       -> ERRORE (incoerenza)
     choice := labelId ? q.choices[labelId] : assente
     se choice assente o choice.kind == 'base'   -> nessuna modifica
     se choice.kind == 'none'                    -> base := base \ {q.baseOrder}
     se choice.kind == 'alternative'             -> base := (base \ {q.baseOrder}) ∪ {choice.order}
4. per ogni gruppo VEX: estrai UNA alternativa con l'RNG sicuro già esistente
                        e aggiungila a base
5. se |base| == 0                                -> ERRORE (nessuna domanda)
6. verifica che base non contenga duplicati      -> ERRORE altrimenti
7. restituisci base ordinato
```

**Proprietà volute:** la differenziazione agisce **solo** sulle comuni (passo
3) e VEX **solo** sui gruppi (passo 4). I due passi non possono interferire
perché operano su insiemi disgiunti — invariante garantito dalle guardie di
mutua esclusione (§6) e ri-verificato all'attivazione. L'ordine dei due passi
è irrilevante: il risultato è lo stesso. La differenziazione è
**deterministica**; l'unica casualità resta quella di VEX, già congelata in
`vex-contract.md` §4.2b.

**5.D.5 — Come si producono `assignedQuestionOrders`.** Esattamente come oggi:
la callable `assignVerificationVariant` (già esistente) scrive **una sola
volta**, in transazione idempotente, `assignedQuestionOrders` +
`assignedAnswerKeys` sulla submission al primo avvio. VDIF sostituisce il solo
**calcolo** dell'insieme (`resolveDifferentiatedOrders` al posto della sola
estrazione VEX). Il contratto di scrittura, l'idempotenza, il retry e il costo
restano identici a `vex-contract.md` §4.2.

**Conseguenza di rilievo:** in `same_questions` **con differenziazione attiva**
il flusso studente **non è più interamente client-side** — deve passare dalla
callable, perché la proiezione pubblica non può contenere le alternative
differenziate. Il routing diventa:

| Modalità | Differenziazione | Percorso |
|---|---|---|
| `same_questions` | assente | client-side, invariato, **zero callable** |
| `same_questions` | presente | callable (stessa di VEX) |
| `equivalent_variants` | assente | callable, invariato |
| `equivalent_variants` | presente | callable |

**5.D.5b — Il discriminante pubblico è tecnico e neutro.**

Il campo aggiunto alla `publishedProjection` è:

```ts
/**
 * Percorso tecnico con cui il client ottiene le domande da svolgere.
 * Dice COME, mai PERCHÉ. Identico per ogni studente della classe.
 */
export type VerificationAssignmentMode =
  /** Le domande sono già tutte nella proiezione: nessuna chiamata al server. */
  | 'same_questions'
  /** L'insieme assegnato è deciso dal server: le domande arrivano dalla callable. */
  | 'server_resolved';
```

**Un booleano `differentiated` è stato scartato**, ed è una correzione, non una
preferenza: un campo con quel nome è una **dichiarazione semantica** su un
documento che lo studente legge. Non rivela *quale* differenziazione, ma
afferma che questa verifica **è** differenziata, ed è esattamente l'informazione
che il principio 5 tiene fuori dal lato studente. `assignmentMode` non afferma
nulla sulla natura della verifica: descrive il canale da cui arrivano le domande,
ed è lo stesso valore che VEX produrrebbe da solo.

**Regola di derivazione, congelata all'attivazione:**

```
assignmentMode = (distributionMode == 'equivalent_variants' || differentiation presente)
                 ? 'server_resolved'
                 : 'same_questions'
```

Il client studente **instrada esclusivamente su `assignmentMode`**. Non deve mai
dedurre il percorso da altro, e in particolare non deve inferire nulla
combinando campi.

**Osservazione onesta sul campo preesistente `distributionMode`.** La
`publishedProjection` porta già oggi `distributionMode`
(`same_questions` | `equivalent_variants`), introdotto da VEX-02A e **fuori dallo
scope di VDIF**: è un contratto concluso e questa roadmap non lo modifica. Va
però detto chiaramente che *quel* campo è semanticamente esplicito nello stesso
modo in cui lo sarebbe stato `differentiated`, e che con VDIF diventa
**ridondante** ai fini del routing, perché `assignmentMode` lo sostituisce
integralmente. Due conseguenze:

1. **VDIF non lo peggiora e non lo usa.** Con la differenziazione attiva su una
   verifica `same_questions`, `distributionMode` resta `same_questions`: non
   guadagna alcun valore nuovo e non rivela la differenziazione;
2. la sua **rimozione dalla proiezione pubblica** — una volta che nessun client
   instrada più su di esso — è registrata qui come lavoro successivo,
   **esplicitamente fuori scope da VDIF** perché tocca il contratto VEX già
   chiuso e richiede una propria PR con la propria migrazione di lettura.

**5.D.5c — Elenco chiuso dei termini vietati negli artefatti studente.**

Nessuno di questi identificatori, in nessuna forma (campo, chiave, valore,
sottostringa di un messaggio, nome di classe CSS, testo di errore), può comparire
in `publishedProjection`, `SubmissionDoc`, `SubmissionReceiptDoc`,
`correctionReturns`, `publicLessons`, `students/{uid}`, nella risposta della
callable, nei PDF studente, negli export o nella UI studente:

`differentiated` · `differentiation` · `labelId` · `labelName` · `labels` ·
`nameKey` · `assignedCount` · il **nome** di una qualunque etichetta · qualunque
formulazione del **motivo** della selezione («percorso», «adattata»,
«personalizzata», «ridotta», «semplificata»).

Il test **T26** (§15) è la verifica automatica di questo elenco, e il test
**T39** verifica che la proiezione pubblica non contenga alcun campo
semanticamente esplicito.

**5.D.6 — Che cosa NON entra nella proiezione pubblica.** In presenza di
differenziazione la `publishedProjection.questions` contiene, come già in VEX,
**solo le domande comuni non differenziate**: una domanda base con almeno una
scelta non-base **non** vi compare, altrimenti uno studente potrebbe leggerla
anche quando gli è stata omessa o sostituita. Le domande assegnate arrivano
**solo** dalla callable.

**5.D.7 — Perché `SubmissionDoc` e le proiezioni studente non contengono
`labelId`/`labelName`.** `assignedQuestionOrders` è già sufficiente a servire,
correggere, restituire ed esportare: `resolveAssignedQuestions` filtra lo
snapshot su quegli order e non ha mai bisogno di sapere *perché* quell'insieme
è quello. Aggiungere l'etichetta sarebbe un dato **non necessario** su un
documento **student-readable** — la definizione esatta di ciò che il principio
5 vieta. Il legame studente → etichetta resta esclusivamente in
`teacherSnapshot.labelAssignments`, owner-only.

**5.D.8 — Replay e retry.** Invariati rispetto a VEX: se
`assignedQuestionOrders` esiste ed è valido, viene restituito senza nuove
scritture; se esiste ed è **invalido**, è fail-closed (nessuna rigenerazione
silenziosa). Una risposta persa dopo il commit è indistinguibile da un replay e
produce lo stesso risultato, perché la transazione è read-or-assign.

**5.D.9 — Cambio etichetta successivo e studente senza etichetta.** Il primo è
irrilevante (§5.D.3). Il secondo riceve la base: `labelId` assente ⇒ passo 3
non modifica nulla.

**5.D.10 — Autosufficienza dello snapshot: dimostrazione.**

**Strategia scelta, una sola e applicata ovunque:** lo snapshot **congela anche
il nome** dell'etichetta, owner-only, e di conseguenza **una verifica attiva o
chiusa non blocca l'eliminazione dell'etichetta**. L'alternativa — non congelare
il nome e bloccare l'eliminazione per ogni verifica che l'ha usata — è stata
scartata perché renderebbe le etichette **immortali**: dopo tre anni di verifiche
archiviate nessuna etichetta sarebbe più eliminabile, e il registro diventerebbe
un cimitero che il docente non può ripulire.

Autosufficiente significa una cosa precisa e verificabile: **nessun percorso che
riguardi una verifica non più in bozza legge `differentiationLabels` o
`studentLabelAssignments`.** Ecco l'elenco completo di ciò che serve, e dove
vive dopo l'attivazione:

| Serve a | Dato | Dove vive congelato |
|---|---|---|
| risolvere le domande di uno studente | `labelId` dello studente | `teacherSnapshot.labelAssignments.byStudentUid` |
| sapere quali domande sostituire/omettere | scelte risolte per `labelId` | `teacherSnapshot.differentiation.questions[].choices` |
| avere il testo e la soluzione dell'alternativa | domanda completa | `teacherSnapshot.questions[]` (unione, §5.D.2) |
| mostrare al docente la configurazione storica | `labelName` | `teacherSnapshot.differentiation.labels[]` |
| correggere, restituire, esportare | `assignedQuestionOrders` | `SubmissionDoc` |

**Il nome congelato non lascia mai il lato docente.** `teacherSnapshot` è
owner-only e immutabile per Rules; `labels[]` gli sta dentro ed eredita
entrambe le proprietà, esattamente come `questions[].soluzione`. È coperto
dall'elenco chiuso di §5.D.5c e dai test T26/T39.

**I cinque casi richiesti, tutti risolti dalla stessa scelta:**

| Caso | Comportamento |
|---|---|
| **etichetta rinominata dopo l'attivazione** | la verifica attiva non cambia: continua a mostrare il nome **al momento dell'attivazione**, che è il nome con cui quella configurazione è stata decisa. La UI docente lo dichiara («nome al momento dell'attivazione»), così un nome diverso dalla lista corrente non sembra un errore |
| **etichetta eliminata dopo l'attivazione** | la verifica attiva non cambia e resta interamente leggibile: `labelId`, `labelName`, assegnazioni e scelte sono tutti nello snapshot |
| **verifica attiva ancora eseguibile** | sì, senza eccezioni: la callable risolve da `teacherSnapshot` e non consulta né le etichette né le assegnazioni correnti. Uno studente che avvia la verifica dopo l'eliminazione dell'etichetta riceve **esattamente** l'insieme che avrebbe ricevuto prima |
| **configurazione storica docente ancora leggibile** | sì: il riepilogo della verifica attiva/chiusa si costruisce solo da `teacherSnapshot` |
| **nessuna nuova dipendenza dalla collezione live** | garantita da un **test strutturale** (T36): i moduli che servono verifiche non in bozza non possono importare i service di etichette e assegnazioni |

**Costo dell'aggiunta.** `labels[]` è una coppia di stringhe per etichetta
coinvolta — unità di byte per una manciata di etichette. Rientra nel controllo di
limite di `verificationSnapshotLimits.ts` già esteso per `labelAssignments`
(§5.D.3), senza soglia nuova.

### E. Rinomina ed eliminazione

| Regola | Contratto |
|---|---|
| Nomi unici per docente | garantita dalla **prenotazione transazionale** su `nameKey` (§5.A.6), non da una query e non da un controllo in memoria. Un duplicato è rifiutato con errore leggibile che nomina l'etichetta in conflitto |
| La rinomina conserva l'ID | `labelId` immutabile; cambiano solo `name`, `nameKey`, `updatedAt`, più prenotazione nuova e rilascio della vecchia nello **stesso commit**. Assegnazioni, bozze e snapshot **non** vengono toccati |
| Etichetta assegnata ⇒ non eliminabile | `assignedCount > 0` letto **dentro** la transazione di eliminazione |
| Etichetta usata in almeno una bozza ⇒ non eliminabile | almeno una `verifications` in `status == 'draft'` la cui `config.differentiation` contiene il `labelId` con scelta non-base |
| Verifiche **attive o chiuse** | **non** contano come uso: lo snapshot è autosufficiente (§5.D.10) |
| Eliminazione fail-closed | ogni accertamento **precede** qualunque scrittura. Se un accertamento non è eseguibile (errore di lettura), l'eliminazione **non parte**: mai «probabilmente libera» |
| Nessuna cascata silenziosa | eliminare un'etichetta non modifica né rimuove assegnazioni o configurazioni. Se è in uso, non si elimina — punto |
| Dove è ancora usata | messaggio **specifico e azionabile**: «Assegnata a 3 studenti» e/o «Usata in 2 bozze: *Reti — 12/03*, *Chimica — 05/04*». Nel menu «…» la voce **Elimina** è disabilitata con il motivo associato via `aria-describedby`, **mai nascosta** |

**5.E.1 — Come il servizio determina che un'etichetta è usata (esatto).**

Non «un preflight». Sono due accertamenti distinti con due meccanismi diversi,
perché i due usi hanno proprietà diverse.

**Uso 1 — assegnazioni studente. Meccanismo: contatore transazionale.**

| | |
|---|---|
| documenti letti | **1**: `differentiationLabels/{labelId}`, per path, **dentro la transazione di eliminazione** |
| query | **nessuna** |
| indici | **nessuno** |
| condizione | `assignedCount == 0`; qualunque altro valore ⇒ rifiuto |
| costo | **O(1)**, indipendente dal numero `E` di assegnazioni |
| race | **chiusa in entrambe le direzioni** (§5.A.7): la transazione di eliminazione legge il documento etichetta e fallisce se è cambiato prima del commit; la transazione di assegnazione legge lo stesso documento e fallisce se l'etichetta non esiste più |

Questo è il «controllo ripetuto dentro la transazione» richiesto: il valore che
autorizza è riletto nella transazione che scrive, non prima.

**Uso 2 — bozze di verifica. Meccanismo: query di preflight + guardia di
attivazione.**

| | |
|---|---|
| query | **1**: `where('ownerUid','==',uid)` + `where('status','==','draft')` su `verifications` |
| documenti letti | `V_draft`, cioè le sole **bozze**, non tutte le verifiche |
| filtro | in memoria su `config.differentiation` di ciascuna: `labelId` presente con scelta non-base |
| indici | **nessuno nuovo**. Due filtri di uguaglianza sono serviti dalla fusione degli indici a campo singolo automatici di Firestore; l'indice composito già presente `verifications (ownerUid, status, onlineEnabled)` ne copre inoltre il prefisso |
| più bozze | tutte quelle che usano l'etichetta sono elencate per titolo e data nel messaggio; il rifiuto è unico e la lista è completa, non troncata a una |
| costo | **O(V_draft)** letture, una sola volta, **solo alla pressione di «Elimina»** — mai al caricamento della lista, mai per card |

**Perché questo uso non è dentro la transazione.** Una transazione client
Firestore **non può eseguire query**: `getDocs` dentro `runTransaction` non
esiste. Non c'è quindi modo di rileggere «tutte le bozze che usano L» nel commit.
Le tre alternative sono state valutate:

| Alternativa | Perché scartata |
|---|---|
| contatore `draftUsageCount` sull'etichetta | dovrebbe essere aggiornato transazionalmente a ogni salvataggio bozza, che oggi è **una sola** scrittura su un documento; introdurrebbe una transazione multi-documento nel percorso più caldo del builder per proteggere un'operazione rara |
| Cloud Function di eliminazione | una Function per un'operazione che il docente compie forse dieci volte in un anno, in un sistema single-owner |
| bloccare l'eliminazione se esiste **una qualunque** bozza | rende l'etichetta ostaggio di una bozza dimenticata e non usata |

**Che cosa succede davvero nella finestra rimasta.** L'unico principal capace di
creare quella corsa è il docente stesso, in due schede: elimina L in una mentre
nell'altra sta configurando una variante che usa L. Esito: la bozza resta con un
`labelId` che non esiste più. **Non degrada in silenzio**, ed è questo che conta:

- il **builder** mostra quella riga come «etichetta non più esistente», con la
  scelta ancora leggibile e un'azione esplicita per rimuoverla;
- l'**attivazione** è bloccata dalla guardia **G04** (`labelId` inesistente) con
  un errore leggibile che nomina domanda ed etichetta;
- nessuna verifica può quindi essere attivata su una configurazione che punta a
  un'etichetta eliminata.

Il limite è dichiarato in §16 (R2) e coperto dal test **T35**.

**Uso 3 — verifiche attive e chiuse. Meccanismo: nessuno, per scelta.**

Non vengono lette, non vengono contate, non compaiono nel messaggio. §5.D.10
dimostra perché non serve.

**5.E.2 — Il conteggio mostrato sulla card non autorizza nulla.**

La card etichetta mostra «4 studenti» derivandolo dalle assegnazioni **già
caricate** nella scheda Studenti: zero letture aggiuntive, zero query per card.
È un dato di presentazione e può essere stantio di qualche secondo. La voce
**Elimina** è disabilitata a partire da quel dato **come affordance**, ma
l'autorizzazione reale è `assignedCount` riletto in transazione: se il dato di UI
dicesse «0 studenti» e la realtà fosse diversa, l'eliminazione **fallirebbe**,
con un messaggio che invita a ricaricare. Il contrario — UI che dice «in uso» e
transazione che permetterebbe — non causa perdita di dati, solo un'azione in più.

---

## 6. Mutua esclusione VEX ↔ differenziazione

Il contratto è **bidirezionale** e **indipendente dall'ordine delle
operazioni**: qualunque sequenza di azioni del docente produce lo stesso
insieme di stati leciti.

1. Una domanda **membro di un gruppo VEX** non può ricevere varianti per
   etichetta.
2. Una domanda base **con almeno una scelta non-base** non può entrare in un
   gruppo VEX.
3. Una domanda usata come **alternativa differenziata** non può
   contemporaneamente essere: domanda comune selezionata; membro di un gruppo
   VEX; alternativa di un'altra combinazione in modo da produrre duplicazioni
   nella stessa assegnazione risolta.
4. Il builder delle varianti mostra il controllo **«Varianti»** anche sulle
   domande VEX, **disabilitato** con motivazione leggibile associata via
   `aria-describedby`. Non nascosto: un controllo che compare solo su alcune
   righe lascia il docente a chiedersi perché.
5. Il builder VEX mostra le domande coinvolte nella differenziazione come
   **non selezionabili**, con motivazione leggibile.
6. **Nessuna conversione automatica.** Per passare da una modalità all'altra il
   docente deve prima rimuovere le varianti differenziate e poi creare il
   gruppo VEX, oppure prima sciogliere il gruppo VEX e poi configurare le
   varianti. Due gesti espliciti, nessun «ti sistemo io».
7. Uno stato **concorrente, legacy o manomesso** che contiene entrambe le
   configurazioni sulla stessa domanda **blocca l'attivazione** con errore
   leggibile (§7, guardia G11).
8. **Helper puro condiviso** — nome congelato `classifyQuestionParticipation`,
   modulo `questionParticipation.ts`:

```ts
export type QuestionParticipation =
  | 'common_free'              // comune, nessuna variante, fuori da ogni gruppo VEX
  | 'vex_member'               // membro di un gruppo equivalente
  | 'differentiated_base'      // comune con almeno una scelta non-base
  | 'differentiated_alternative'; // referenziata come alternativa, non selezionata

export function classifyQuestionParticipation(input: {
  selectedEntryIds: readonly string[];
  equivalentGroups: readonly EquivalentGroupConfig[];
  differentiation?: VerificationDifferentiationConfig;
}): Map<string, QuestionParticipation>;
```

**Nessuna UI ricostruisce autonomamente questa classificazione.** Il builder
VEX, il builder delle varianti, il riepilogo di attivazione e le guardie
leggono tutti da qui. È la stessa disciplina di `resolveAssignedQuestions`:
un'unica fonte di verità, altrimenti due schermate divergono e nessuno se ne
accorge finché non è in produzione.

9. **VEX e differenziazione convivono nella stessa verifica**, su domande
   diverse. Esempio da mantenere come caso di test end-to-end:

| Domanda | Ruolo |
|---|---|
| Q1 | comune, con alternativa per l'etichetta L1 |
| Q2 | membro di un gruppo VEX (Q2a / Q2b) |
| Q3 | comune, invariata |

- **Studente con etichetta L1:** Q1-alternativa + un membro estratto del
  gruppo Q2 + Q3.
- **Studente senza etichetta:** Q1-base + un membro estratto del gruppo Q2 +
  Q3.

10. **Test obbligatori** (dettaglio in §15): variante → tentativo di creare
    gruppo VEX; gruppo VEX → tentativo di aggiungere variante; alternativa
    differenziata → tentativo di selezionarla come comune; configurazione
    incoerente arrivata all'attivazione; modifica concorrente fra apertura
    bozza e attivazione.

---

## 7. Guardie di attivazione (fail-closed)

Tutte le precondizioni, nell'**ordine esatto** in cui vanno eseguite. Le
guardie G01→G16 sono **preflight**, fuori dalla transazione, su dati riletti
autorevolmente. G17→G20 sono **dentro** la transazione.

### 7.1 Ordine di letture e scritture

```
FASE 0 — preflight (nessuna scrittura, fuori transazione)
  R1  getDoc  verifications/{id}                      -> stato bozza + config
  R2  getDocs differentiationLabels                   -> etichette dell'owner
  R3  getDocs studentLabelAssignments                 -> assegnazioni correnti
  R4  getDocs students                                -> già caricati dal contesto
  R5  Storage: loadSelectedQuestionsWithSolutions(
        questionRefs ∪ alternative differenziate)     -> UNA lettura, come oggi
  R6  getDocs udas + lessons (già eseguite oggi)      -> topicOutline autorevole
  ── validazioni pure G01..G16 su questi dati ──
  ── costruzione teacherQuestions, snapshot VDIF (differentiation.labels[] con
     labelId + labelName congelati da R2, labelAssignments da R3), snapshot VEX,
     proiezione pubblica con assignmentMode derivato (§5.D.5b) ──

FASE 1 — transazione (client Firestore SDK, come oggi)
  T1  transaction.get verifications/{id}
  G17 stato ancora 'draft'
  G18 questionRefs invariati                (sameQuestionRefs, già esistente)
  G19 config.differentiation invariata      (confronto strutturale profondo)
  G20 fingerprint assegnazioni invariato    (§7.3)
  T2  transaction.update verifications/{id} (status, visibility, teacherSnapshot)
  T3  transaction.set    publishedProjection/data

FASE 2 — dopo la transazione
  W1  setDoc auditEvents (verification.activated)     — invariato
```

**Confine transazionale.** Resta quello attuale: una transazione client
Firestore SDK sul solo documento verifica più la sua proiezione, come descritto
in `architettura.md` §6.3. VDIF **non** introduce una Cloud Function di
attivazione. Motivo: tutte le letture necessarie sono owner-only e già
disponibili al client docente; l'unico principal che potrebbe scrivere dati
incoerenti è l'owner stesso, già fidato per ogni altro percorso owner-only
(`sicurezza.md` §3). La callable resta l'unica cosa server-side, e resta
`assignVerificationVariant`.

### 7.2 Elenco delle guardie

| ID | Condizione bloccante | Messaggio (sostanza) |
|---|---|---|
| G01 | verifica non trovata | «Verifica non trovata.» |
| G02 | verifica non in bozza / già attiva | «Verifica non attivabile: non è in bozza.» |
| G03 | `differentiation` presente con `version != 1` o proprietà extra | «Configurazione delle varianti non riconosciuta.» |
| G04 | `labelId` referenziato **inesistente** | nomina l'ID e la domanda |
| G05 | `labelId` di **altro owner** | stesso messaggio di G04: non si conferma l'esistenza altrui |
| G06 | assegnazione che punta a uno **studente inesistente** | l'assegnazione è ignorata; **non** blocca (§5.B.3) |
| G07 | assegnazione di uno studente di **altro owner** | blocca: indica manomissione |
| G08 | `baseQuestionIndexEntryId` **non selezionato** nella verifica | nomina la domanda |
| G09 | alternativa **inesistente** nel `questionIndex` corrente | nomina base e alternativa |
| G10 | alternativa **rimossa dal pool** fra bozza e attivazione | riferimento in chiaro, mai un ID nudo |
| G11 | alternativa di **lezione diversa** dalla base | nomina le due lezioni |
| G12 | alternativa **già selezionata** come domanda della verifica | nomina la domanda |
| G13 | **duplicazione** nella verifica risolta di almeno un'etichetta | nomina etichetta e domanda |
| G14 | **conflitto VEX**: base differenziata dentro un gruppo, o alternativa differenziata dentro un gruppo, o entrambe le configurazioni sulla stessa domanda | nomina la domanda e le due configurazioni |
| G15 | un'etichetta resta con **zero domande** | nomina l'etichetta e quante domande le restano |
| G16 | **punteggio massimo non valido** per almeno un'etichetta (≤ 0, non intero, o non pari alla somma delle `maxPoints` risolte) | nomina l'etichetta |
| G16b | `teacherSnapshot` o `publishedProjection` **oltre il limite** dimensionale conservativo | «La verifica è troppo grande per essere congelata.» |
| G17 | stato cambiato **durante** l'attivazione | invita a riprovare |
| G18 | **selezione domande** cambiata durante l'attivazione | messaggio già esistente, invariato |
| G19 | **configurazione varianti** cambiata durante l'attivazione | «La configurazione delle varianti è cambiata durante l'attivazione. Riprova.» |
| G20 | **assegnazioni studente** cambiate durante l'attivazione | «Le etichette degli studenti sono cambiate durante l'attivazione. Riprova.» |
| G21 | **retry dopo risposta persa** | la transazione rilegge lo stato: se la verifica è già `active`, G02 blocca **senza scrivere nulla**. Nessuna doppia attivazione, nessuna doppia proiezione |

**G16 in dettaglio.** Il massimo per etichetta è la somma delle `maxPoints`
delle domande realmente risolte per quell'etichetta. È **legittimamente diverso**
fra etichette (D6): la guardia verifica che sia un intero positivo, non che sia
uguale a quello base.

### 7.3 Fingerprint delle assegnazioni (G20)

La transazione non può rileggere `studentLabelAssignments` (documenti fuori dal
suo perimetro senza costo aggiuntivo, e una `getDocs` non è ammessa dentro una
transazione Firestore client). Il preflight calcola quindi un **fingerprint
deterministico** delle assegnazioni — coppie `studentUid:labelId` ordinate,
serializzate canonicamente e ridotte a SHA-256 via Web Crypto, stessa tecnica
già usata da `STRUCTURE-IMPORT-01` per `manifestCanonical` — e lo confronta con
un secondo calcolo eseguito **immediatamente prima** di aprire la transazione.

Limite dichiarato, senza ipocrisia: questa è una finestra **stretta**, non
nulla. In un sistema **single-owner** l'unico principal capace di cambiare le
assegnazioni è il docente stesso, dalla stessa sessione; la finestra reale è
quella di due schede aperte dello stesso browser. Ciò che il fingerprint
garantisce è che uno snapshot palesemente stantio non venga congelato in
silenzio; ciò che non garantisce è la serializzabilità completa, che
richiederebbe una Cloud Function di attivazione — costo sproporzionato rispetto
al rischio in questo modello.

---

## 8. UI — sezione Studenti

Allineata al **portale attuale** (card `RecordCard` full-width, menu «…» in
alto a destra, tablist accessibile), non alla tabella descritta nella prima
stesura di questa roadmap.

Le schede diventano **Studenti · Classi · Etichette**, con la stessa `tablist`
già esistente in `StudentsView`: `role="tablist"`, `role="tab"` con
`aria-selected` e `aria-controls`, `role="tabpanel"` con `aria-labelledby`,
roving `tabIndex`, ←/→ ciclici, Home/End, focus visibile, nessuno scorrimento
orizzontale a nessuna larghezza. Con tre schede la navigazione da tastiera
diventa ciclica su tre elementi: `handleTabKeyDown` va generalizzato a una
lista, non duplicato.

### 8.A Scheda Etichette

**Subito sotto le schede:** pulsante **«Nuova etichetta»** a **larghezza
piena**, stessa anatomia visiva di «Nuova classe» (`btn-primary`, altezza
sobria, icona `IconPlus` a sinistra) — non un banner.

**Una card full-width per etichetta** (`RecordCard`, `actionLayout` dedicato,
compatto e senza riquadri metrica come `class-admin`):

- **titolo in ciano SchoolForge** (`--color-brand-blue`), come ogni altra card;
- **`titleMeta`** con il numero di studenti associati: «4 studenti» / «1
  studente» / «Nessuno studente»;
- **utilizzo nelle bozze**, mostrato **solo se già disponibile senza costo
  passivo**: le bozze del docente sono già caricate nella sezione Verifiche, ma
  **non** nella sezione Studenti. Contratto: la scheda Etichette **non** carica
  le verifiche per mostrare questo dato in lista. Il conteggio d'uso nelle
  bozze viene calcolato **on-demand**, una sola volta, nel **preflight di
  eliminazione** — che è esattamente il momento in cui serve davvero
  (§14);
- **menu «…» in alto a destra** (`RecordActionsMenu`), con:
  - **Modifica** (`IconPencil`);
  - **Elimina** (`IconTrash`, classe `menuDanger`), **azione distruttiva**;
    **disabilitata con motivo visibile** quando l'etichetta è in uso, associato
    via `aria-describedby`.

**Stato vuoto** — curato e compatto, mai una pagina spoglia:

> **Nessuna etichetta.**
> Le etichette servono a te, per servire domande diverse a studenti diversi
> nella stessa verifica. Usa nomi operativi — «Percorso A», «Obiettivi
> essenziali» — e assegnane al massimo una per studente.
> Gli studenti non le vedono mai.

Nessun esempio diagnostico, nessuna sigla normativa, in nessun punto della UI.

**Creazione e rinomina** — entrambe in `DialogShell`:

- input moderno a larghezza piena, `label` visibile e associata;
- **contatore** «12/40» accanto all'etichetta del campo, `aria-live="polite"`;
- limiti applicati: `maxLength` sul campo **e** validazione byte prima della
  scrittura;
- **Invio** salva, **Escape** annulla (`closeOnEscape` di `DialogShell`);
- **guardia anti-doppio-click** sincrona con un `ref`, come in `ClassesTab`:
  due click nello stesso tick non creano due etichette;
- **il testo digitato è conservato in caso di errore**, il focus torna
  nell'input;
- **nessuna linea separatrice sopra il footer**;
- dialog sempre **dentro la viewport** (`max-height: calc(100dvh - 2rem)`,
  scroll interno, footer sempre raggiungibile — già garantito da
  `DialogShell`).

La rinomina usa un **dialog**, non l'editing inline della card classe: il
campo ha un contatore e un vincolo di unicità da comunicare, che in linea
starebbero stretti.

### 8.B Card Studente

La card attuale **resta**. Si aggiunge, dentro `identityControl`, un **secondo
campo** «Etichetta» accanto (desktop) o immediatamente sotto (mobile) al
selettore «Classe»:

- `<label>` **visibile** e semanticamente associata (`htmlFor`), più
  `aria-label` esteso col nome dello studente, esattamente come «Classe»;
- prima opzione **«Nessuna etichetta»** (valore vuoto), poi le etichette in
  ordine alfabetico;
- **salvataggio immediato** alla `change`, come «Classe» — nessun menu, nessun
  pulsante di conferma: è una modifica che deve essere rapida;
- **stato busy circoscritto** alla sola card interessata;
- **il valore selezionato è conservato in caso di errore**, con messaggio
  ancorato alla card, non un reset silenzioso al valore precedente;
- il click sulla select **non apre la card** — `RecordCard` esclude già
  `select` dal fallback di apertura.

**Ricerca.** La barra di ricerca studenti comprende anche il **nome
dell'etichetta**, accanto a nome, email, stato e classe, con lo stesso
`haystack` in minuscolo. «Nessuna etichetta» è cercabile come stringa, esatto
parallelo di «nessuna classe» già in uso.

**Mobile.** Classe ed Etichetta **entrambe leggibili**, ciascuna a larghezza
piena in una propria riga sotto nome ed email: niente troncamenti, niente
overflow, nessun affiancamento che comprimerebbe due select su 320 px. Trigger
«…» in alto a destra; target touch ≥ 44 px per select e trigger; ordine visivo
identità → Classe → Etichetta → riquadri → errori.

---

## 9. UI — bozza della verifica

Per ogni **domanda comune** dell'elenco delle domande selezionate:

- pulsante **«Varianti (n)»**, dove **n = numero di etichette con scelta
  non-base** su quella domanda. `n = 0` ⇒ «Varianti».

Per le domande **membro di un gruppo VEX**:

- **stesso pulsante, visibile e disabilitato**;
- motivo associato via `aria-describedby`: «Questa domanda è in un gruppo di
  varianti equivalenti: non può avere varianti per etichetta.»;
- **nessun controllo semplicemente nascosto** (§6.4).

### 9.1 Dialog delle varianti

Struttura, dall'alto:

1. **intestazione**: numero della domanda, tipologia, difficoltà — es. «Domanda
   3 · Aperta · Difficoltà 3»;
2. **testo della domanda base**;
3. **soluzione base** (owner-only, come ogni altra superficie docente);
4. **una card/riga per ciascuna etichetta**, in ordine alfabetico;
5. **prima l'etichetta, poi la scelta**: si decide *per chi*, non *cosa*;
6. **selezione a tre valori** (`radiogroup` per etichetta):
   **Domanda base** (default) · **Domanda alternativa** · **Nessuna domanda**;
7. **alternative filtrate**, e il filtro è un contratto, non un'euristica:
   - **stessa lezione** della base (`lessonFilename` identico — D3);
   - **non già selezionate** nella verifica (D4);
   - **non appartenenti a un gruppo VEX**;
   - **non capaci di creare duplicazioni**: esclude ciò che è già assegnato
     alla **stessa** etichetta come alternativa di un'altra domanda;
8. **anteprima reale** della domanda alternativa — `questionPreview` già
   caricata nel `questionIndex`, mai una nuova lettura;
9. **spiegazione quando non esistono alternative**: «Questa lezione non ha
   altre domande disponibili per una variante.» — una lista vuota senza
   spiegazione sembra un guasto;
10. **salvataggio esplicito** della configurazione: il dialog ha «Annulla» e
    «Salva varianti»; «Salva varianti» aggiorna lo **stato locale della
    bozza** e marca la bozza *dirty*;
11. **nessuna scrittura Firebase mentre si modifica localmente**: il flusso
    canonico corrente salva soltanto con **«Salva bozza»**, e VDIF non lo
    cambia. `differentiation` viaggia nello **stesso**
    `updateVerificationConfig` di titolo, classe, data, perimetro, domande e
    gruppi VEX — **zero scritture aggiuntive**.

**Riuso di `VexQuestionSelect`.** Il selettore delle alternative riusa il
componente esistente, **senza duplicarne accessibilità e anteprima**. È già una
listbox accessibile con due righe (metadati + preview reale), tastiera, Escape
e click esterno; gli serve soltanto un `options` filtrato e una `label`
diversa. Se un requisito di VDIF richiedesse una modifica al componente,
va fatta **dentro** `VexQuestionSelect` in modo retrocompatibile, mai
forkandolo.

### 9.2 Dirty guard dei dialog — contratto definitivo

Un dialog che contiene modifiche non salvate **non si chiude per distrazione**.
Escape e backdrop sono gesti facili da compiere per sbaglio; scartare una
configurazione di varianti costruita etichetta per etichetta è un danno reale,
e ricostruirla costa esattamente il tempo che lo strumento deve restituire.

| Stato del dialog | Escape | Backdrop | «Chiudi» / «Annulla» |
|---|---|---|---|
| **pulito** (nessuna modifica rispetto all'apertura) | chiude | chiude | chiude |
| **dirty** (almeno una scelta cambiata) | apre la conferma | apre la conferma | apre la conferma |

**La conferma ha tre azioni esplicite**, e nessuna di esse è ambigua:

| Azione | Effetto |
|---|---|
| **Continua modifica** | torna al dialog **senza perdere nulla**: stessa bozza locale, stessa etichetta a fuoco, stesso punto di scorrimento |
| **Salva e chiudi** | applica la configurazione alla bozza locale e chiude (equivale a «Salva varianti») |
| **Abbandona modifiche** | **l'unica** azione che scarta. Variante distruttiva (`btn-danger`), mai il pulsante predefinito, mai quello a fuoco all'apertura |

Su questa conferma Escape e backdrop equivalgono a **Continua modifica**: non
scartano mai. È la stessa semantica già adottata da `AiReviewExitConfirm`.

**Nessun dialog annidato con focus trap concorrenti.** La conferma **non** è una
seconda `DialogShell`: è una **fase** della stessa, che sostituisce il corpo e il
titolo mantenendo un unico focus trap. È una divergenza deliberata dal pattern
AIGEN attuale (`AiPoolGenerationDialog` monta `AiReviewExitConfirm` come shell
separata, quindi due trap coesistono): quel pattern funziona, ma due trap
sovrapposti sono una fonte nota di focus perso con gli screen reader.
Armonizzare AIGEN su questo modello è lavoro successivo, **fuori scope da VDIF**.

**Nessun cambio di layout improvviso.** Il contenitore conserva la larghezza e
una `min-height` pari all'altezza della fase di modifica, così passare a
conferma e tornare indietro non fa saltare la pagina né sposta il backdrop.

**Chiusura e doppio click protetti.** La transizione a conferma e il ritorno sono
guardati da un `ref` sincrono: due Escape ravvicinati non producono due
conferme, e un doppio click su «Abbandona modifiche» non esegue due chiusure.

**Creazione e rinomina etichetta.** Il dialog del nome è dirty non appena il
testo differisce dal valore iniziale, e segue la stessa tabella. In più —
requisito già in vigore in §8.A — **il testo digitato resta nel campo in caso di
errore** (nome duplicato, limite superato, prenotazione in conflitto), il focus
torna nell'input e nulla viene svuotato.

**Fuori dal contratto dirty:** i dialog puramente informativi o di sola conferma
(eliminazione etichetta, conferma di attivazione, esito) non hanno stato da
perdere e restano chiudibili con Escape e backdrop.

---

## 10. UI — riepilogo prima dell'attivazione

Prima della conferma, **owner-only** e **mai persistito** in alcuna proiezione
studente, il pannello di conferma esistente mostra:

- **studenti che riceveranno la verifica base** (n);
- **studenti che riceveranno una verifica differenziata** (n);
- **numero di etichette coinvolte**;
- **numero di sostituzioni** (scelte `alternative`);
- **numero di omissioni** (scelte `none`);
- **studenti senza etichetta** (n) — è il momento in cui ci si accorge di aver
  dimenticato qualcuno;
- **conteggio finale delle domande per ciascuna etichetta**, più la riga
  «Nessuna etichetta»;
- **blocker per etichetta**, se presenti: elenco esplicito, in rosso, con
  l'azione bloccata dichiarata.

Il riepilogo è **derivato puro** dagli stessi dati del preflight: nessuna
lettura aggiuntiva, nessuna scrittura, nessun documento. Non mostra **mai**
nomi diagnostici predefiniti — mostra i nomi che il docente ha scelto, e basta.

---

## 11. Qualità visiva

Vincoli, non suggerimenti. Il prototipo li rispetta tutti e li rende
verificabili a occhio.

- superfici **grafite/blu notte** (`--color-surface*`), mai nero puro;
- **ciano** (`--color-brand-blue`) per struttura e informazione: titoli card,
  icone metrica, accento laterale;
- **arancione SchoolForge** (`--color-brand-interactive`) su **hover e focus**,
  mai a riposo, mai come colore di stato;
- **verde** solo per esiti positivi, **rosso** solo per azioni distruttive ed
  errori;
- **card full-width**, bordi e raggi coerenti (`--radius`, `--radius-lg`);
- menu **«…» in alto a destra**;
- microinterazioni sobrie; **niente gradienti gratuiti**; niente effetto
  «dashboard aziendale» generico;
- **niente tabella su mobile**;
- **niente textarea ridimensionabili** (`textarea { resize: none }` globale,
  già in vigore e protetto da test statico);
- **target touch ≥ 44 px** su ogni controllo interattivo sotto il breakpoint
  mobile o con `pointer: coarse`;
- **`:focus-visible`** sempre percepibile, mai rimosso;
- **`prefers-reduced-motion`** rispettato: transizioni e sollevamenti annullati;
- **dialog entro `100dvh`**, scroll interno, **footer sempre raggiungibile**;
- scrollbar nascosta **solo visivamente** e solo dove il contratto già lo
  prevede (`DialogShell`);
- **nessun overflow orizzontale a 320 px**.

### 11.1 Gate grafico — **PENDING**

Le misure DOM (larghezze, altezze, target touch, assenza di overflow) dicono che
la UI **non è rotta**. Non dicono che è bella, e non sostituiscono lo sguardo del
docente. Le evidenze visive del prototipo sono raccolte in
[`evidenze/vdif-00-prototipo-visivo.md`](evidenze/vdif-00-prototipo-visivo.md)
con gli screenshot reali a 1440 (scheda Etichette), 1024 (riepilogo di
attivazione), 390 (card studente con Classe + Etichetta) e 320 px (dialog
Varianti).

**Il gate grafico resta PENDING fino alla conferma umana.** Nessuna fase VDIF
successiva può dichiararlo superato al posto del docente.

---

## 12. Pacchetto A — Esiti per lezione (ESITI-01)

Invariato rispetto alla stesura precedente, e **indipendente e successivo** al
Gate GVDIF.

### Perché è quasi gratis

Il collegamento *domanda → lezione → UDA* è già tracciato:

| Dato | Dove vive già |
|---|---|
| punti per domanda e per consegna | `CorrectionDoc.evaluations[order]` (`points`, `maxPoints`) |
| lezione e UDA di provenienza | `config.questionRefs[order]` (`udaDir`, `lessonFilename`) |
| titoli leggibili del perimetro | `config.topicOutline` |

Manca solo la media: è una **derivazione pura**, calcolata su richiesta dai
documenti che il workspace di correzione già legge. Nessuna collezione nuova,
nessuna scrittura, nessuna migrazione, nessuna Rule, nessun prompt.

### Che cosa calcola

1. per ogni domanda, media di `points / maxPoints` sulle sole correzioni in
   stato `completed` (una correzione in corso non è un dato);
2. aggregazione per lezione e per UDA, pesata sul numero di valutazioni.

### Come si difende dai numeri che sembrano fatti

«Fotosintesi 43%» ha l'aria di un fatto anche quando è una media su quattro
valutazioni. Le cose che possono essere poche sono **due**, con problemi
opposti:

| | Se è poco | Il numero è | Rimedio |
|---|---|---|---|
| **consegne corrette** | 4 su 22 | **instabile** — cambierà finendo di correggere | copertura, non soglia |
| **domande di quella lezione** | 1 sola | **stretto** — stabile, ma misura quella domanda | dichiararlo, non nasconderlo |

Da cui tre regole, e **nessuna soglia arbitraria da calibrare**: gli Esiti si
aprono su verifiche con correzione completa e, se incompleta, la copertura
(«corrette 18 su 22») è dichiarata in evidenza; ogni riga porta su quante
domande si basa; il solo caso tagliato è l'incrocio dei due.

### Interfaccia

Sulla card di una verifica **chiusa**, nel menu azioni esistente, la voce
`Esiti`. Apre un dialog con una tabella UDA · Lezione · Padronanza · N
valutazioni, ordinata dalla più debole. Nient'altro: nessuna generazione,
nessun rimando.

### Interazione con VDIF

Con la differenziazione attiva, studenti diversi possono avere risposto a
domande diverse della **stessa** lezione. La media per lezione resta corretta
perché è già pesata sul numero di valutazioni: una domanda risposta da meno
studenti pesa meno. La riga dichiara il numero di valutazioni, quindi il dato
resta onesto senza alcuna logica dedicata a VDIF. **Nessuna etichetta compare
negli Esiti**: aggregano per lezione, non per studente né per gruppo.

### Fuori dal pacchetto

La generazione automatica di lezioni di ripasso (` - R`) è stata **valutata e
scartata**: richiedeva un blocco di prompt dedicato, una nuova versione del
prompt e una campagna di misura, per duplicare un percorso manuale già
disponibile in tre clic. Non è rinviata: è fuori perimetro.

### DoD

Vista `Esiti` funzionante su una verifica chiusa reale; nessuna scrittura
introdotta; test sulla derivazione (media, aggregazione, correzioni non
completate escluse, copertura dichiarata, numero di domande per riga).

---

## 13. Roadmap eseguibile

| Fase | Scope | Dipende da | DoD |
|---|---|---|---|
| **VDIF-00** ✅ | Contratto tecnico, privacy, cost model, matrice di test e **prototipo UI**. Solo documentazione e prototipo statico. | GVEX PASS | Questo documento + `prototipi/verifiche-differenziate.html` + fasi in `piano-implementazione.md`. Zero runtime. |
| **VDIF-01** | **Registro etichette owner-only**: tipi a **sette chiavi**, `differentiationLabels`, **prenotazione transazionale `differentiationLabelNames`** (creazione, rinomina con rilascio, eliminazione con rilascio, replay idempotente, fail-closed su record incoerente), `labelNameKey.ts`, Rules owner-only a contratto chiuso per entrambe le collezioni, audit, **scheda Etichette** (card, dialog crea/rinomina con dirty guard §9.2, elimina protetta, stato vuoto). | VDIF-00 | CRUD reale su DEV; T34/T34b/T34c/T34d/T34e verdi; test Rules Emulator (owner ok, studente sempre negato, contratto chiuso, chiavi extra negate, `update` sulla prenotazione sempre negato); nessun indice nuovo. |
| **VDIF-02** | **Assegnazione privata studente → etichetta**: `studentLabelAssignments`, **transazione con `assignedCount`** (esistenza dell'etichetta verificata in-transaction, `increment` ±1, cambio `L1→L2` in un solo commit), selettore nella card studente, ricerca per etichetta, Rules, audit, eliminazione studente nello stesso batch. | VDIF-01 | Assegnazione/rimozione reali; test Rules (studente non legge né scrive, altro owner negato); T35/T35b verdi; ricerca; nessuna etichetta in alcun dato studente. |
| **VDIF-03** | **Builder delle varianti**: `classifyQuestionParticipation`, pulsante «Varianti (n)», dialog a tre valori, filtro alternative, riuso `VexQuestionSelect`, `config.differentiation` nello stesso «Salva bozza», **mutua esclusione VEX bidirezionale**. | VDIF-02 | Configurazione salvata e ricaricata; helper puro condiviso usato da tutte le UI; test dei cinque scenari di §6.10; zero scritture aggiuntive. |
| **VDIF-04** | **Attivazione**: guardie G01→G21, snapshot privato autosufficiente (`differentiation` con `labels[]` = `labelId` + `labelName` congelati, `labelAssignments`), `resolveDifferentiatedOrders`, produzione di `assignedQuestionOrders` via callable esistente, **`assignmentMode` neutro** sulla proiezione, riepilogo pre-attivazione. | VDIF-03 | Attivazione reale con ≥ 2 etichette, ≥ 1 sostituzione e ≥ 1 omissione; ogni guardia coperta da test; T36/T39/T40 verdi; idempotenza e replay verdi. |
| **VDIF-05** | **Consumer downstream**: svolgimento, correzione manuale, correzione IA, restituzione, PDF, CSV, ricevute e **privacy audit** end-to-end. | VDIF-04 | Ogni consumer opera sulla sola assegnazione; audit di privacy che dimostra l'assenza di etichette in ogni superficie di §4. |
| **GVDIF** | **Rollout DEV e gate umano multi-studente**: smoke reale con più studenti etichettati e non, isolamento, correzione, restituzione, export. | VDIF-05 | Checklist firmata in `evidenze/gvdif-human-gate.md`. **Aperto.** |
| **ESITI-01** | Vista di **sola lettura** degli esiti aggregati per UDA/lezione (§12). **Indipendente e successiva a GVDIF.** | GVDIF | §12, DoD. |

### 13.1 Fuori scope da VDIF — esplicito

Le misure seguenti **non** entrano in VDIF, in nessuna fase, nemmeno come
campo predisposto:

- **tempo aggiuntivo**;
- **limiti temporali personalizzati**;
- **materiali consultabili**;
- **formulari**;
- **limiti di caratteri personalizzati** (`maxCharacters` resta il limite
  tecnico della singola domanda, non una misura per studente);
- **ulteriori misure compensative o dispensative** di qualunque natura.

Sono un **asse distinto**: proprietà della *consegna*, non della *selezione
delle domande*. Richiederebbero una roadmap autonoma, un modello dati proprio e
un'analisi di privacy separata. Introdurne una «già che ci siamo» dentro VDIF
significherebbe congelare oggi un contratto sbagliato.

---

## 14. Cost model

Riferimento: `students` e `classes` sono già caricati una volta all'apertura
della sezione Studenti (`loadAll`).

| Evento | Letture | Scritture | Note |
|---|---|---|---|
| **Caricamento scheda Etichette** | **1 query** `differentiationLabels` (collezione intera, decine di documenti), unita al `Promise.all` esistente di `loadAll` | 0 | **nessuna query per etichetta**, **nessuna lettura per card** |
| **Caricamento assegnazioni** | **1 query** `studentLabelAssignments`, nello stesso `Promise.all` | 0 | mappa `studentUid → labelId` in memoria; **nessun listener per studente**. Le prenotazioni **non** vengono mai caricate in lista |
| **Creazione etichetta** | **1** in transazione: `differentiationLabelNames/{r}` per path | **3**: prenotazione + etichetta (stesso commit) + audit | unicità garantita dalla transazione, **nessuna query** |
| **Rinomina** | **2** in transazione: prenotazione nuova + prenotazione vecchia, per path | **4**: `set` nuova + `update` etichetta + `delete` vecchia (stesso commit) + audit | `labelId` invariato ⇒ nessuna propagazione a bozze, assegnazioni o snapshot |
| **Eliminazione** | **1 query** sulle bozze (`ownerUid` + `status == 'draft'`) ⇒ `V_draft` letture, **solo** alla pressione di «Elimina» + **2** in transazione: etichetta (per `assignedCount`) e prenotazione, per path | **3**: `delete` etichetta + `delete` prenotazione (stesso commit) + audit — **solo** se entrambi gli accertamenti sono verdi | **O(1) rispetto a `E`** assegnazioni (contatore), **O(V_draft)** rispetto alle verifiche, e `V_draft` sono le sole bozze, non tutte le verifiche. Fail-closed: accertamento non eseguibile ⇒ nessuna scrittura |
| **Assegnazione a uno studente** | **1** in transazione: `differentiationLabels/{labelId}` per path (esistenza + contatore) | **3**: assegnazione + `increment` sull'etichetta (stesso commit) + audit. Cambio `L1→L2`: **4** (due `increment`) | il costo aggiuntivo rispetto a `assignStudentClass` è **una lettura e una scrittura per operazione**, ed è il prezzo dell'unica garanzia transazionale contro la corsa elimina/assegna (§5.A.7) |
| **Apertura builder varianti** | **0** | 0 | `questionIndex` e `questionPreview` sono già in memoria nella bozza |
| **Salvataggio bozza** | 0 | **1**: lo `updateVerificationConfig` **esistente**, esteso con `differentiation` | **zero scritture aggiuntive** |
| **Attivazione** | preflight: verifica + etichette + assegnazioni + studenti + **1** lettura Storage delle domande (già oggi) + udas/lessons (già oggi) | **3**: update verifica + set proiezione + audit — **invariato** | le alternative differenziate entrano nella **stessa** lettura Storage: nessuna lettura in più per alternativa |
| **Primo avvio studente** | 1 callable + letture server-side già necessarie | **1**: `assignedQuestionOrders` + `assignedAnswerKeys` (stessa scrittura) | identico a VEX §4.3 |
| **Replay / refresh** | 1 callable + lettura submission | **0** | read-or-assign idempotente |
| **Retry transazionale** | rilettura in transazione | **0** in caso di replay | G21 |
| **Consumer downstream** | **0 aggiuntive** | 0 | correzione, IA, restituzione, PDF e CSV riusano `resolveAssignedQuestions` su documenti già caricati |

### 14.1 Vietati, senza eccezioni

- **lettura per card** (una `getDoc` per etichetta o per studente);
- **query per etichetta** nella lista (una `where('labelId','==',…)` per riga);
- **listener per studente** o per etichetta;
- **polling** di qualunque genere;
- **duplicazione di dati** di etichetta su documenti pubblici;
- **query come garanzia di unicità**: l'unicità è transazionale (§5.A.6), e una
  query non può garantirla perché legge un istante già passato quando il commit
  avviene;
- **caricamento in lista delle prenotazioni**: si leggono solo per path, solo
  dentro le tre transazioni che le toccano.

### 14.2 Indici

**Nessun indice composito nuovo è richiesto.**

- `differentiationLabels`: nessuna query filtrata — si legge la collezione
  intera (owner-only, decine di documenti). Gli indici a campo singolo
  automatici bastano;
- `differentiationLabelNames`: **nessuna query, mai**. Accesso esclusivamente per
  path deterministico dentro una transazione;
- `studentLabelAssignments`: come `differentiationLabels` — collezione intera in
  una query, nessun filtro;
- accertamento d'uso nelle bozze: `where('ownerUid','==',…)` +
  `where('status','==','draft')` su `verifications`. Due filtri di uguaglianza
  sono serviti dalla **fusione degli indici a campo singolo automatici** di
  Firestore; inoltre l'indice composito già presente
  `verifications (ownerUid, status, onlineEnabled)` ne copre il prefisso. Se in
  VDIF-01 la misura reale mostrasse il contrario, l'indice va **dichiarato in
  quella PR con motivazione**, non introdotto qui a scatola chiusa.

---

## 15. Matrice minima dei test (congelata)

| # | Test | Livello |
|---|---|---|
| T01 | ownership: solo l'owner legge/scrive `differentiationLabels` | Rules Emulator |
| T02 | isolamento fra docenti: etichetta di altro owner mai leggibile né referenziabile | Rules + unit |
| T03 | **lo studente non legge le etichette** (get e list negati) | Rules Emulator |
| T04 | **lo studente non legge le assegnazioni** (la propria inclusa) | Rules Emulator |
| T05 | **lo studente non può scrivere** etichette né assegnazioni | Rules Emulator |
| T06 | una sola etichetta per studente (id deterministico, secondo documento impossibile) | Rules + unit |
| T07 | rinomina con `labelId` stabile: assegnazioni e bozze intatte | unit + integrazione |
| T08 | eliminazione libera quando non in uso | integrazione |
| T09 | eliminazione **bloccata** se assegnata ad almeno uno studente | unit + integrazione |
| T10 | eliminazione **bloccata** se usata in almeno una variante di bozza | unit + integrazione |
| T11 | ricerca studenti per nome etichetta (e per «nessuna etichetta») | unit UI |
| T12 | scelta **domanda base**: risolve la base | unit puro |
| T13 | alternativa della **stessa lezione** accettata | unit puro |
| T14 | alternativa di **altra lezione** rifiutata (G11) | unit puro |
| T15 | **«Nessuna domanda»**: la base è rimossa per quella sola etichetta | unit puro |
| T16 | **zero domande risultanti** per un'etichetta ⇒ attivazione bloccata (G15) | unit + integrazione |
| T17 | conflitto VEX **in entrambe le direzioni** (variante→gruppo, gruppo→variante) | unit + UI |
| T18 | alternativa differenziata **non selezionabile come comune** | unit + UI |
| T19 | **duplicazioni** nella verifica risolta rifiutate (G13) | unit puro |
| T20 | **pool modificato** fra bozza e attivazione ⇒ blocco leggibile (G09/G10) | integrazione |
| T21 | **cambio etichetta dopo l'attivazione** non altera la verifica attiva | integrazione |
| T22 | **studente senza etichetta** riceve la base | unit + integrazione |
| T23 | **replay** della callable: stessa assegnazione, zero scritture | Functions + emulator |
| T24 | **doppia attivazione** rifiutata senza scritture (G02/G21) | integrazione |
| T25 | **risposta persa** dopo il commit: retry idempotente | Functions |
| T26 | **nessuna etichetta in dati e UI studente** — audit automatizzato su ogni superficie di §4 | test strutturale |
| T27 | correzione manuale sulla **sola assegnazione** | unit + integrazione |
| T28 | correzione IA sulla **sola assegnazione** | Functions |
| T29 | restituzione sulla **sola assegnazione** | integrazione |
| T30 | PDF/CSV sulla **sola assegnazione** | unit |
| T31 | modifica concorrente fra apertura bozza e attivazione (G18/G19/G20) | integrazione |
| T32 | configurazione con **proprietà extra** rifiutata (G03) | unit puro |
| T33 | `classifyQuestionParticipation`: le quattro classi, e nessuna UI che le ricostruisca (test strutturale sul sorgente) | unit + strutturale |
| T34 | **concorrenza su creazione**: due creazioni dello stesso `nameKey` in parallelo ⇒ **una sola** riesce, l'altra riceve un conflitto di nome, nessuna doppia etichetta | Rules Emulator + integrazione |
| T34b | **concorrenza su rinomina**: due rinomine verso lo stesso `nameKey` ⇒ una sola riesce; rinomina e creazione in corsa ⇒ una sola detiene la prenotazione | integrazione |
| T34c | **rilascio della prenotazione**: dopo rinomina il vecchio `nameKey` è di nuovo disponibile; dopo eliminazione lo è quello corrente; entrambi i rilasci avvengono **nello stesso commit** dell'operazione | integrazione |
| T34d | **replay idempotente**: ripetere creazione/rinomina/eliminazione dopo una risposta persa non scrive nulla e non produce errore | integrazione |
| T34e | **prenotazione incoerente** (`nameKey` non corrispondente, `reservationId` non uguale all'hash, prenotazione orfana, etichetta senza prenotazione) ⇒ **fail-closed**, zero scritture | unit + integrazione |
| T35 | **delete preflight concorrente**: assegnazione creata durante l'eliminazione ⇒ una delle due fallisce; bozza che acquisisce l'etichetta durante l'eliminazione ⇒ l'attivazione è poi bloccata da G04 e il builder mostra «etichetta non più esistente» | integrazione |
| T35b | il conteggio mostrato sulla card **non autorizza**: con contatore di UI a `0` e `assignedCount > 0` reale, l'eliminazione **fallisce** con invito a ricaricare | integrazione |
| T36 | **snapshot autosufficiente**: dopo rinomina e dopo eliminazione dell'etichetta, una verifica attiva resta eseguibile, risolve lo stesso insieme di domande e resta leggibile lato docente con il `labelName` congelato; **test strutturale** che vieta ai percorsi delle verifiche non-bozza di importare i service di etichette e assegnazioni | integrazione + strutturale |
| T37 | **dirty guard**: su dialog dirty, Escape / backdrop / «Chiudi» aprono la conferma e **non** scartano; «Continua modifica» conserva tutto; «Abbandona modifiche» è l'unica azione che scarta; su dialog pulito i tre gesti chiudono direttamente | unit UI |
| T37b | **un solo focus trap**: la conferma è una fase della stessa `DialogShell`, non una seconda shell; nessun cambio di larghezza fra le due fasi; doppio Escape e doppio click protetti | unit UI |
| T38 | **VEX e differenziazione in entrambi gli ordini**: variante → gruppo, gruppo → variante, e la verifica mista Q1/Q2/Q3 risolta correttamente per studente etichettato e non | unit + integrazione |
| T39 | **nessun campo semanticamente esplicito nella proiezione pubblica**: `assignmentMode` è l'unico campo aggiunto e appartiene a `{'same_questions','server_resolved'}`; l'elenco chiuso di §5.D.5c non compare in alcun artefatto studente | strutturale |
| T40 | **stato legacy o manomesso fail-closed**: `differentiation.version` diversa da `1`, chiavi extra, `assignedCount` non intero o negativo, snapshot con `labels[]` incoerente rispetto alle `choices` ⇒ errore leggibile, mai fallback | unit |

**T26 in dettaglio.** È il test che tiene in piedi il principio 5: un test
strutturale che, dato l'insieme dei writer delle superfici di §4, verifica che
nessuno di essi possa mai ricevere `labelId`/`labelName` — stessa tecnica del
test statico che vieta a `textarea` di essere ridimensionabile e a
`STRUCTURE-IMPORT-01` di importare Firebase.

---

## 16. Rischi residui accettati

| # | Rischio | Perché è accettato |
|---|---|---|
| R1 | **Il numero di domande rivela la differenziazione** a uno studente attento | è intrinseco alla funzionalità; ciò che si difende è il *motivo*, non il *fatto* (§4) |
| R2 | Una **bozza** può acquisire un'etichetta mentre la si elimina (§5.E.1, uso 2) | una transazione client Firestore non può eseguire query, quindi «tutte le bozze che usano L» non è rileggibile nel commit. **Non degrada in silenzio**: il builder mostra «etichetta non più esistente» e l'attivazione è bloccata da G04. Le tre alternative valutate sono in §5.E.1 |
| R3 | La **finestra** fra fingerprint delle assegnazioni e transazione di attivazione non è nulla (§7.3) | single-owner: la finestra reale è due schede dello stesso browser. Chiuderla richiederebbe una Cloud Function di attivazione, sproporzionata |
| R3b | La coerenza `reservationId == SHA-256(ownerUid, nameKey)` è verificata dal **service**, non dalle Rules | CEL non ha funzioni di hash. L'unicità però **non** dipende da questa verifica: dipende dal `create` mutuamente esclusivo su un path deterministico, che le Rules autorizzano e Firestore serializza. La verifica del service serve solo a rifiutare record manomessi, fail-closed |
| R4 | Un docente può comunque **scrivere una diagnosi dentro il nome** di un'etichetta | SchoolForge non lo impedisce e non lo può impedire senza classificazione semantica, che il principio 4 vieta. Difesa: nessun esempio diagnostico nella UI, testo esplicito nello stato vuoto, e il nome non lascia mai il lato docente |
| R5 | `same_questions` **con differenziazione** perde il percorso interamente client-side | è il prezzo dell'isolamento delle alternative; il costo resta 1 callable + 1 scrittura al primo avvio, poi zero |
| R6 | Le **verifiche attive e chiuse** non bloccano l'eliminazione di un'etichetta | il loro snapshot è autosufficiente e congela anche `labelName` (§5.D.10); l'alternativa renderebbe le etichette immortali |
| R7 | Una verifica attivata mostra il **nome dell'etichetta al momento dell'attivazione**, che può differire da quello corrente dopo una rinomina | è il nome con cui quella configurazione è stata decisa: mostrarne uno diverso riscriverebbe la storia. La UI docente lo dichiara esplicitamente |
| R8 | `distributionMode` sulla proiezione pubblica resta semanticamente esplicito | è contratto **VEX già concluso**, fuori scope da VDIF (§5.D.5b). VDIF non lo usa, non lo estende e non gli fa assumere valori nuovi; la sua rimozione è registrata come lavoro successivo con la propria PR |

---

## 17. Decisioni aperte

**Nessuna.** Ogni scelta di modello dati, UI, sicurezza, costo e sequenza è
presa e motivata sopra. Le fasi VDIF-01→05 sono implementabili senza tornare a
chiedere.
