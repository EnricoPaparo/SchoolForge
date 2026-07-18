# SchoolForge — ANNOT-00: appunti personali dello studente

**Stato:** contratto tecnico e prototipo statico; implementazione non avviata.
**Data:** 19 luglio 2026.
**Perimetro:** progettazione di UX, modello dati, autorizzazioni, costi e pacchetti successivi.

## 1. Obiettivo e invarianti

ANNOT aggiunge appunti testuali personali associati a una lezione pubblica. Non modifica
la lezione, non introduce evidenziazioni e non rende disponibili dati tecnici del
repository.

Invarianti:

- appunti leggibili e modificabili esclusivamente dallo studente proprietario;
- il docente non può leggerli, neppure perché owner dell'istanza SchoolForge;
- nessun pool, domanda, soluzione, allegato o copia della lezione negli appunti;
- Didattica e appunti inaccessibili quando la Modalità verifica si applica alla classe;
- nessun listener sugli appunti, polling, Cloud Function o uso IA;
- un solo documento testuale per coppia studente/lezione;
- semplicità: textarea semplice, nessun editor visuale e nessun Markdown obbligatorio.

## 2. UX definitiva

### 2.1 Punto di ingresso

Il comando `Appunti` compare nella toolbar della sola lezione selezionata. Usa il
`publicLessonId` già restituito dalla proiezione studente; non tenta di ricavare un ID
da titolo o path. Il comando non è renderizzato quando la Didattica è inibita dalla
Modalità verifica. Il service e le Rules restano comunque l'autorità finale.

### 2.2 Desktop

Il comando apre un pannello non modale in stile post-it:

- flottante a destra, senza ridimensionare o spostare la lezione;
- `width: 380px`, con adattamento alla larghezza disponibile;
- `max-height: min(560px, calc(100dvh - 160px))`;
- distanza dal bordo tra `20px` e `24px`;
- posizione fissa rispetto alla viewport, sopra il contenuto ma non sopra l'header;
- non trascinabile e non ridimensionabile;
- superficie giallo caldo sobrio, testo scuro ad alto contrasto, bordo ocra leggero e
  ombra morbida;
- aspetto professionale, senza metafore infantili o messaggi sulla privatezza.

Il pannello è un `aside` con nome accessibile e ruolo semantico complementary. Non è
un dialog: non oscura la pagina, non usa focus trap e la lezione sottostante resta
consultabile e scrollabile.

Header:

- icona coerente con il set esistente;
- titolo `Appunti`;
- stato in area `aria-live="polite"`: `Salvataggio…`, `Salvato` oppure `Errore`;
- pulsante reale di chiusura con nome accessibile;
- nessuna frase «Privati, visibili solamente a te».

Corpo:

- una sola textarea con label reale;
- massimo `20.000` caratteri e contatore discreto;
- occupa lo spazio residuo del pannello;
- scrollbar interna soltanto oltre l'altezza disponibile;
- nessun editor visuale, allegato, evidenziatore o formato obbligatorio.

Focus e chiusura:

- all'apertura il focus può passare alla textarea dopo che il pannello è renderizzato;
- `Escape` chiude solo se non ci sono modifiche;
- con stato dirty, `Escape`, pulsante chiudi, cambio lezione/corso e navigazione fuori
  dalla Didattica richiedono conferma;
- dopo la chiusura il focus torna esattamente al pulsante `Appunti` che ha aperto il
  pannello;
- nessun altro elemento della pagina viene reso inerte.

### 2.3 Mobile

Sotto il breakpoint mobile il comando apre una vista dedicata a tutta larghezza, non
un pannello flottante:

- intestazione con `← Torna alla lezione`, titolo e stato di salvataggio;
- superficie giallo-post-it entro la larghezza disponibile;
- textarea ampia, senza overflow orizzontale;
- pulsante `Salva` facilmente raggiungibile, preferibilmente in una barra azioni
  sticky che non copre il testo;
- contatore e azione `Elimina appunti` accessibili;
- la stessa dirty guard del desktop si applica al ritorno;
- al ritorno si conserva la lezione selezionata e si ripristina, per quanto possibile,
  la precedente posizione di scroll memorizzata localmente prima dell'apertura.

Nessuno stato di navigazione o scroll viene scritto su Firestore.

### 2.4 Stati UX

| Stato | Comportamento |
|---|---|
| Mai aperto | Nessuna lettura note eseguita. |
| Caricamento iniziale | Textarea disabilitata brevemente; errore sanitizzato e possibilità di riprovare. |
| Pulito | Contenuto locale uguale all'ultimo contenuto letto/salvato. |
| Dirty | Contenuto locale modificato; navigazione protetta. |
| Salvataggio | Un solo write in corso; comandi incompatibili disabilitati. |
| Salvato | Baseline locale aggiornata; dirty falso. |
| Errore | Testo locale preservato; dirty resta vero; retry manuale consentito. |
| Vuoto mai persistito | Salva può non scrivere; non esiste documento. |
| Eliminato | Documento personale rimosso e stato locale riportato a vuoto/pulito. |

## 3. Strategia di lettura e salvataggio

### 3.1 Cache di sessione

- prima apertura di una lezione: un `getDoc` sul path deterministico;
- aperture successive nella stessa sessione: riuso dello stato locale già caricato;
- nessun `onSnapshot`, polling o listener sugli appunti;
- cambiamenti provenienti da un altro dispositivo non sono sincronizzati in tempo
  reale; vengono osservati a una nuova sessione o dopo un'esplicita ricarica futura.

La cache è indicizzata per `publicLessonId` e conserva `content`, baseline salvata,
dirty e stato di caricamento. Non viene persistita in localStorage in ANNOT-02.

### 3.2 Scritture

Un salvataggio è tentato:

1. dal pulsante `Salva`;
2. al `blur` della textarea;
3. dopo `15` secondi di inattività dall'ultima modifica.

Prima del write il client verifica:

- contenuto diverso dalla baseline;
- lunghezza non superiore a `20.000` caratteri;
- nessun salvataggio già in corso;
- studente, lezione e accesso ancora coerenti con lo stato corrente.

Se il contenuto non è cambiato non avviene alcuna scrittura. Le richieste concorrenti
per la stessa nota vengono coalesciate: al massimo un write è in corso; se il testo
cambia durante il write, al completamento resta dirty e il prossimo ciclo salva la
versione più recente. Non si cancella il timer senza preservare l'intenzione di
salvataggio.

In caso di errore:

- nessun messaggio Firebase o dettaglio infrastrutturale è mostrato;
- il testo locale non viene sostituito né cancellato;
- lo stato resta dirty;
- viene mostrato `Errore. Riprova il salvataggio.` e resta disponibile il salvataggio
  manuale.

### 3.3 Limite e conflitti

Il limite `20.000` è applicato con `maxLength` nel client e validato nuovamente dalle
Rules. Il client non si affida a un troncamento silenzioso lato server.

Senza realtime e senza controllo versione, due dispositivi possono produrre
last-write-wins. Per ANNOT V1 il limite è accettato e va dichiarato nel gate; nessuna
cronologia o merge automatico è previsto.

### 3.4 Eliminazione

`Elimina appunti`:

- richiede conferma distruttiva esplicita;
- elimina soltanto `students/{studentUid}/lessonNotes/{publicLessonId}`;
- non modifica `publicLessons`, programmi, contenuto Markdown o Storage;
- è disponibile solo al proprietario e solo fuori dalla Modalità verifica;
- dopo il successo svuota cache/baseline della nota e mantiene aperta la lezione;
- un errore conserva il contenuto locale e mostra un messaggio sanitizzato.

## 4. Modello dati proposto

Path deterministico:

```text
students/{studentUid}/lessonNotes/{publicLessonId}
```

Documento proposto:

```ts
type StudentLessonNoteDoc = {
  studentUid: string;
  publicLessonId: string;
  programId: string;
  importId: string;
  lessonId: string;
  content: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};
```

Contratto:

| Campo | Regola |
|---|---|
| `studentUid` | Uguale a `{studentUid}` nel path e a `request.auth.uid`; immutabile. |
| `publicLessonId` | Uguale all'ID documento e a una proiezione accessibile; immutabile. |
| `programId` | Uguale al campo della `publicLessons/{publicLessonId}` associata; immutabile. |
| `importId` | Uguale all'import attivo del programma e alla proiezione; immutabile. |
| `lessonId` | Uguale all'identità lezione della proiezione; immutabile. |
| `content` | Stringa, massimo 20.000 caratteri; unico campo contenutistico modificabile. |
| `createdAt` | `request.time` in create; immutabile. |
| `updatedAt` | `request.time` in create e update. |

Esiste al massimo un documento per studente e lezione pubblica. Non vengono duplicati
testo della lezione, titolo, nome/email, classe, pool, domande, soluzioni o asset.
Non viene creata una collezione globale. Il documento viene letto per path e non
richiede indici compositi.

Il nome `lessonId` deve essere verificato contro il campo realmente presente nella
proiezione al momento di ANNOT-01. Se l'attuale `PublicLessonDoc` usa il proprio ID
documento come unica identità della lezione, il contratto TypeScript dovrà evitare una
duplicazione non verificabile: la decisione va risolta prima delle Rules, mantenendo
comunque i campi approvati oppure formalizzando l'uguaglianza all'ID canonico.

## 5. Autorizzazioni proposte

### 5.1 Helper esistenti riutilizzabili

L'inventario di `firestore.rules` conferma helper implementabili e già usati:

| Helper | Uso per ANNOT |
|---|---|
| `isAuthenticated()` | Prerequisito base. |
| `isOwner()` | Deve essere negato esplicitamente dal ramo note; non concede accesso. |
| `studentPortalEnabled()` | Incluso da `isApprovedStudent()`. |
| `isApprovedStudent()` | Nega pending, blocked e portale disabilitato. |
| `myStudentClassId()` | Richiede classe non nulla. |
| `isClassmateOf(classIds)` | Verifica assegnazione della classe al programma. |
| `examModeAppliesToClass(classId)` | Nega ogni operazione durante Modalità verifica globale/per classe. |
| `programActiveImportId(programId)` | Verifica che la proiezione appartenga all'import attivo. |

Firestore Rules supporta `get`, `exists`, `resource`, `request.resource`,
`request.resource.data.diff(resource.data).affectedKeys()`, `keys().hasOnly`,
`request.time` e confronti sui path. Non supporta query arbitrarie, cicli, join generici
o ricerche per campo durante una singola autorizzazione. Per questo l'ID deterministico
e `publicLessons/{publicLessonId}` sono essenziali.

### 5.2 Predicati proposti

ANNOT-01 può aggiungere helper equivalenti a:

```text
lessonProjection(publicLessonId)
  = get(/publicLessons/{publicLessonId}).data

canAccessLessonForNotes(publicLessonId)
  = isApprovedStudent()
    AND myStudentClassId() != null
    AND NOT isOwner()
    AND NOT examModeAppliesToClass(myStudentClassId())
    AND publicLessons/{publicLessonId} exists
    AND programs/{projection.programId} exists
    AND projection.importId == programActiveImportId(projection.programId)
    AND isClassmateOf(program.classIds)
```

Non è necessario che lo studente abbia permesso diretto di leggere il programma o la
lezione affinché `get()` nelle Rules valuti i documenti: i cross-document access delle
Rules operano sul documento server-side. Vanno tuttavia rispettati i limiti di access
calls; riuso e memoizzazione degli stessi path devono essere verificati con Emulator.

### 5.3 Matrice

| Attore/stato | Read | Create | Update | Delete |
|---|---:|---:|---:|---:|
| Studente owner, approved, classe assegnata, portale attivo, lezione accessibile, fuori exam mode | Sì | Sì | Sì | Sì |
| Stesso studente, lezione non più nell'import attivo o classe non assegnata | No | No | No | No |
| Stesso studente durante Modalità verifica globale o applicata alla classe | No | No | No | No |
| Studente pending, blocked, senza classe o portale disabilitato | No | No | No | No |
| Altro studente | No | No | No | No |
| Docente owner | No | No | No | No |
| Utente anonimo | No | No | No | No |

### 5.4 Validazione per operazione

**Read:** path `studentUid == request.auth.uid` e `canAccessLessonForNotes` vero.

**Create:** oltre al read gate:

- chiavi esattamente quelle del contratto (`hasOnly` e, se utile, `hasAll`);
- identity fields uguali a path, auth e proiezione;
- `content is string && content.size() <= 20000`;
- `createdAt == request.time && updatedAt == request.time`.

**Update:** oltre al gate:

- chiavi chiuse;
- campi modificati soltanto `content` e `updatedAt`;
- identity fields e `createdAt` immutabili;
- contenuto entro limite e `updatedAt == request.time`.

**Delete:** gate completo, owner del path e lezione ancora accessibile. La decisione
fail-closed implica che una nota di una lezione non più accessibile non può essere
cancellata dal client. Un'eventuale procedura amministrativa di retention è fuori
scope e non deve concedere lettura al docente.

Il match annidato deve avere regole proprie:

```text
match /students/{studentUid}/lessonNotes/{publicLessonId} { ... }
```

Le autorizzazioni del documento padre non si propagano automaticamente. Il default
deny finale resta invariato. Nessuna Rule concede accesso a `questionIndex`, pool,
soluzioni, import tecnici o Storage.

## 6. Costi operativi

Non si fissano tariffe monetarie, perché possono cambiare. Il budget si esprime in
operazioni:

- prima apertura di una nota per lezione/sessione: circa `1` document read;
- ogni salvataggio realmente diverso: `1` document write;
- nessuna scrittura se il testo non cambia;
- eliminazione esplicita: `1` delete;
- nessun listener note, polling, Cloud Function, IA o lettura docente;
- cross-document checks delle Rules possono comportare accessi dipendenti dalle
  regole e vanno misurati con Emulator/console billing in ANNOT-03;
- spazio: al massimo un documento testuale ≤ 20.000 caratteri per lezione annotata.

Scenario indicativo: `30` studenti × `10` lezioni annotate × `2` salvataggi reali.

| Operazione | Calcolo | Totale indicativo |
|---|---:|---:|
| Prime aperture | `30 × 10 × 1` | 300 letture note |
| Salvataggi effettivi | `30 × 10 × 2` | 600 scritture |
| No-op, listener, polling | nessuno | 0 operazioni note |
| Documenti massimi creati | `30 × 10` | 300 documenti |
| Contenuto massimo teorico | `300 × 20.000` caratteri | 6.000.000 caratteri, overhead escluso |

La lettura già necessaria di studente, programmi e lezioni per mostrare la Didattica
non viene moltiplicata intenzionalmente dal service note. Le Rules verificano
autorizzazioni indipendentemente dal client.

## 7. Pacchetti successivi

### ANNOT-01 — contratto TypeScript, service e Rules

Scope:

- `StudentLessonNoteDoc` definitivo;
- service `get/save/delete` a path deterministico;
- limite client/server 20.000;
- Rules owner-student-only con gate classe/import/exam mode;
- test unitari e Emulator, senza UI finale.

Criteri di accettazione:

- tutte le righe della matrice autorizzazioni provate per read/create/update/delete;
- docente e altro studente non possono leggere neppure conoscendo il path;
- timestamp, identity fields, chiavi e limite contenuto fail-closed;
- Modalità verifica nega tutte le operazioni;
- nessun listener, indice, Function o dato didattico duplicato.

### ANNOT-02 — UI desktop/mobile e dirty guard

Scope:

- comando Appunti nella lezione;
- pannello desktop non modale e vista mobile dedicata;
- cache di sessione, salvataggio manuale/blur/debounce 15 s;
- dirty guard, focus return, stati sanitizzati ed eliminazione confermata.

Criteri di accettazione:

- una sola lettura per prima apertura nella sessione;
- no-op senza write, doppio salvataggio protetto e testo locale preservato su errore;
- desktop e mobile accessibili, senza overflow o focus trap;
- Didattica/exam mode non aggirabili dalla UI;
- test con timer controllato per debounce e navigazione dirty.

### ANNOT-03 — smoke DEV e Gate GANNOT

Scope:

- deploy DEV autorizzato in pacchetto separato;
- smoke multi-account e viewport;
- misurazione operazioni e verifica sicurezza.

Criteri di accettazione:

- studente A non legge note di B; docente non legge note;
- classe/accesso/import e Modalità verifica provati sul DEV;
- salvataggio, errore, refresh sessione, delete e limite 20.000 verificati;
- conteggi operativi coerenti con il budget;
- nessuna esposizione di pool/soluzioni e nessun errore console;
- approvazione umana esplicita del Gate GANNOT.

## 8. Decisioni definitive e limiti residui

Decisioni definitive:

- pannello post-it non modale desktop e vista dedicata mobile;
- solo testo semplice, 20.000 caratteri;
- path deterministico annidato nello studente;
- docente sempre escluso;
- lettura lazy e salvataggi manuale/blur/debounce 15 s senza realtime;
- Modalità verifica nega UI e operazioni Firestore;
- delete personale confermato;
- nessuna evidenziazione, Function, IA, indice o collezione globale.

Limiti da verificare in ANNOT-01/03:

- nome e disponibilità dell'identità lezione nella proiezione V2 definitiva;
- numero effettivo di access calls Rules e loro costo osservato;
- last-write-wins tra dispositivi, accettato senza versioning nella prima versione;
- una nota non più autorizzata resta non leggibile e non cancellabile dal client;
- ripristino dello scroll mobile è best-effort, perché layout e contenuto possono
  cambiare tra apertura e ritorno.

Questo documento e il prototipo non modificano il contratto applicativo in vigore e
non dichiarano ANNOT implementato.
