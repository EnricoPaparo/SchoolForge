# SchoolForge — Roadmap: esiti per lezione e verifiche differenziate

**Stato:** progettazione conclusa, nessuna riga implementata. Tutte le
decisioni di interfaccia e di contratto sono prese e motivate (§2 e §3);
nessuna resta aperta.
**Data:** 8 agosto 2026.
**Dipendenze:** M4 (correzione) e VEX (varianti equivalenti) operativi;
LESSON-DEPTH-01 in produzione.

Questa roadmap affronta due bisogni distinti che condividono gli stessi dati e
nessuna riga di codice:

1. **gli esiti non tornano indietro.** Il portale produce lezione, verifica e
   correzione, ma ciò che la classe ha sbagliato non raggiunge mai la lezione
   che l'aveva preparata;
2. **la didattica è a taglia unica.** Una classe reale ha studenti con
   obiettivi minimi, misure compensative e dispensative. Non è un extra: è un
   obbligo normativo, e oggi il docente lo assolve fuori dallo strumento.

## 1. Principi invarianti

- **Nessuna soluzione può chiedere al docente di scrivere di più.** Vale qui
  come in LESSON-DEPTH: se compilare costa quanto fare la cosa a mano, lo
  strumento non serve.
- **Le etichette non escono mai dal lato docente.** Mai nel testo della
  verifica, nel PDF, nella restituzione o nella proiezione pubblica. È la
  stessa disciplina che il contratto già applica a soluzioni e metadati
  tecnici, estesa a un dato più delicato.
- **Nessun dato sanitario o certificativo nel database.** Nessuna diagnosi,
  nessun PDP, nessuna certificazione. Un'etichetta è un nome scelto dal
  docente e serve al sistema solo per sapere *quale versione servire*, mai
  *perché*.
- **Fail-closed.** Una configurazione incoerente ferma l'attivazione con un
  messaggio leggibile; non produce mai una verifica degradata in silenzio.
- **Riuso prima di costruzione.** Il meccanismo per servire domande diverse a
  studenti diversi esiste già (VEX): questa roadmap ne cambia il criterio di
  assegnazione, non l'impianto.
- Nessuna modifica a Rules, indici, schema Firestore o dipendenze oltre a
  quelle esplicitamente elencate in §3.

## 2. Pacchetto A — Esiti per lezione (sola lettura)

### Perché è quasi gratis

Il collegamento *domanda → lezione → UDA* è già tracciato:

| Dato | Dove vive già |
|---|---|
| punti per domanda e per consegna | `CorrectionDoc.evaluations[order]` (`points`, `maxPoints`) |
| lezione e UDA di provenienza | `config.questionRefs[order]` (`udaDir`, `lessonFilename`) |
| titoli leggibili del perimetro | `config.topicOutline` |

Manca solo la media. È una **derivazione pura**, calcolata su richiesta dai
documenti che il workspace di correzione già legge: nessuna collezione nuova,
nessuna scrittura, nessuna migrazione, nessuna Rule, nessun prompt.

### Che cosa calcola

1. per ogni domanda, media di `points / maxPoints` sulle sole correzioni in
   stato `completed` (una correzione in corso non è un dato);
2. aggregazione per lezione e per UDA, pesata sul numero di valutazioni.

### Come si difende dai numeri che sembrano fatti

«Fotosintesi 43%» ha l'aria di un fatto anche quando è una media su quattro
valutazioni. Le cose che possono essere poche sono però **due**, con problemi
opposti, e vanno trattate in modo opposto:

| | Se è poco | Il numero è | Rimedio |
|---|---|---|---|
| **consegne corrette** | 4 su 22 | **instabile** — cambierà finendo di correggere | copertura, non soglia |
| **domande di quella lezione** | 1 sola | **stretto** — stabile, ma misura quella domanda, non la lezione | dichiararlo, non nasconderlo |

Da cui tre regole, e **nessuna soglia arbitraria da calibrare**:

- gli Esiti si aprono su verifiche con correzione **completa**; se incompleta,
  la copertura («corrette 18 su 22») è dichiarata in evidenza, non in nota;
- ogni riga porta **su quante domande** si basa: «Fotosintesi 43% — 1 domanda»
  dice tutto ciò che serve per decidere quanto crederci, e il docente sa se
  quella domanda era rappresentativa. Nasconderla sarebbe peggio: è comunque
  l'unica informazione disponibile su quell'argomento;
- il solo caso davvero tagliato è l'incrocio dei due — poche domande **e**
  poche consegne — dove il numero non dice nulla in nessuna direzione.

### Interfaccia

Sulla card di una verifica **chiusa**, nel menu azioni già esistente, la voce
`Esiti`. Apre un dialog con una tabella UDA · Lezione · Padronanza · N
valutazioni, ordinata dalla più debole. Nient'altro.

Nessuna azione, nessun bottone di rimando, nessuna generazione. Creare una
lezione di ripasso è un percorso che il portale già offre in tre clic, e il
docente decide da sé se e come farlo.

### Non fa parte del pacchetto

La generazione automatica di lezioni di ripasso (` - R`) è stata **valutata e
scartata**: richiedeva un blocco di prompt dedicato, una nuova versione del
prompt e una campagna di misura, per duplicare un percorso manuale già
disponibile. Non è rinviata: è fuori perimetro.

### DoD

Vista `Esiti` funzionante su una verifica chiusa reale; nessuna scrittura
introdotta; test sulla derivazione (media, aggregazione, correzioni non
completate escluse, copertura dichiarata, numero di domande per riga).

## 3. Pacchetto B — Verifiche differenziate per etichetta

### Il modello in una frase

Il docente definisce alcune **etichette**, ne assegna **una sola** a ciascuno
studente, e in fase di bozza può sostituire singole domande con alternative
scelte per etichetta. Chi non ha etichetta, o ha un'etichetta senza variante
per quella domanda, riceve la domanda base.

### Decisioni prese

| # | Decisione | Motivo |
|---|---|---|
| D1 | **Una sola etichetta per studente** | elimina ogni regola di precedenza; le combinazioni diventano etichette a sé (`PDP + minimi`), al prezzo di una lista più lunga |
| D2 | **Varianti solo sulle domande comuni** | una domanda già dentro un gruppo di varianti equivalenti non è etichettabile: il conflitto fra sorteggio anti-copiatura e differenziazione viene eliminato invece che arbitrato |
| D3 | **Alternative dalla stessa lezione** | garantisce che la variante interroghi la stessa porzione di programma: è ciò che distingue un obiettivo minimo da una verifica diversa |
| D4 | **Alternative non già selezionate** | altrimenti lo studente riceverebbe la stessa domanda due volte |
| D5 | **«Nessuna domanda» ammessa** | la riduzione resta possibile, ma come eccezione decisa domanda per domanda, non come impostazione |
| D6 | **Punteggio massimo diverso ammesso** | la percentuale è già derivata dal proprio massimo: una verifica ridotta resta confrontabile senza penalizzazioni artificiali |
| D7 | **Congelamento all'attivazione** | coerente con `teacherSnapshot`, oggi immutabile per Rules. Cambiare idea richiede di riportare la verifica in bozza — gesto esplicito e reversibile. L'alternativa lascerebbe correzioni fatte su domande non più esistenti |

### Riuso: che cosa esiste già

| Serve | Esiste |
|---|---|
| servire domande diverse a studenti diversi | `assignedQuestionOrders` sulla consegna |
| risolvere «quali domande valgono per questa consegna» | `resolveAssignedQuestions`, già usato da correzione manuale, IA, restituzione ed export |
| sapere quali domande sono comuni | `commonEntryIds(selezionate, gruppi)`, funzione pura |
| scegliere una domanda dal pool in modo accessibile | `VexQuestionSelect` (metadati + anteprima reale, navigazione da tastiera) |
| lezione di provenienza di ogni domanda | `questionIndex.lessonFilename` |

Cambia il **criterio di assegnazione** — deterministico per etichetta invece
che casuale — non l'impianto.

### Interfaccia, schermo per schermo

**Etichette.** Terza scheda in *Studenti*, accanto a «Studenti» e «Classi»:
elenco, crea, rinomina, elimina. Un'etichetta è solo un nome. Un'etichetta
usata da almeno uno studente o da almeno una variante **non è eliminabile**,
solo rinominabile.

**Studente → etichetta.** Colonna in più nella tabella studenti, accanto a
Classe; assegnazione dal menu azioni della riga. L'etichetta entra nel testo
cercabile della barra di ricerca, che già filtra per nome, email, stato e
classe.

**Assegnazione delle varianti.** Nell'elenco delle domande selezionate della
bozza, ogni domanda **comune** ha un pulsante `Varianti (n)`. Le domande in un
gruppo equivalente hanno lo stesso pulsante **disabilitato con il motivo
visibile** — nasconderlo lascerebbe il docente a chiedersi perché compaia solo
su alcune righe.

Il dialog mostra in alto testo e soluzione della domanda base, e sotto una
riga per etichetta. L'ordine è vincolante: **prima l'etichetta, poi la
domanda** — si decide *per chi*, non *cosa*. Il selettore propone solo domande
della stessa lezione non già inserite nella verifica, più la voce esplicita
`Nessuna domanda`. Se quella lezione non ha altre domande disponibili, il
dialog **lo dice**: una lista vuota senza spiegazione sembra un guasto.

**Prima dell'attivazione.** Una riga di riepilogo dice quanti studenti
riceveranno una verifica diversa da quella base. È il momento in cui ci si
accorge di aver dimenticato qualcuno.

### Casi limite, tutti fail-closed

- **Etichetta che resta senza domande** (tutte sostituite con «Nessuna
  domanda»): l'attivazione **rifiuta**, indicando l'etichetta e quante domande
  le restano.
- **Studente senza etichetta**: riceve la verifica base. Default esplicito,
  non implicito.
- **Etichetta senza variante per una data domanda**: riceve la domanda base.
- **Variante che punta a una domanda non più nel pool** (pool rigenerato fra
  bozza e attivazione): l'attivazione rifiuta con il riferimento illeggibile
  in chiaro.
- **Studente che cambia etichetta a verifica attiva**: irrilevante, lo
  snapshot e l'assegnazione sono congelati (D7).

### DoD

Verifica attivata con almeno due etichette e una variante «Nessuna domanda»;
consegne, correzione manuale, correzione IA, restituzione ed export coerenti
con le domande realmente assegnate; nessuna etichetta presente in alcun
artefatto lato studente; guardie di attivazione verdi sui casi limite sopra.

## 4. Sequenza

1. **Pacchetto A** — Esiti. Indipendente, di sola lettura, nessun rischio.
2. **Pacchetto B1** — etichette e assegnazione allo studente.
3. **Pacchetto B2** — varianti per domanda, guardie di attivazione,
   assegnazione al momento della consegna.

A e B1 non hanno dipendenze reciproche e possono procedere in qualsiasi
ordine.

## 5. Fuori scope

- generazione automatica di lezioni di ripasso (§2, scartata);
- mappa concettuale della lezione: bisogno reale e già definito
  (artefatto generato dal **corpo** della lezione, struttura fissa sintesi +
  mappa + avvertenza che non sostituisce lo studio, visibile allo studente
  solo quando la lezione è marcata `completed`), ma indipendente da questa
  roadmap;
- misure compensative e dispensative diverse dalla selezione delle domande
  (tempo aggiuntivo, limiti di caratteri, materiale consultabile): asse
  distinto, proprietà della consegna e non della selezione;
- qualunque forma di condivisione fra docenti o multi-utenza.

## 6. Decisioni aperte

Nessuna. L'unica rimasta — la soglia minima di valutazioni negli Esiti — è
stata **eliminata invece che rimandata**: la regola di §2 («copertura
dichiarata, numero di domande per riga») non richiede alcun numero da
calibrare a mano, ed è onesta in entrambe le direzioni: non nasconde un dato
che potrebbe servire, e non fa sembrare solido un dato che non lo è.
