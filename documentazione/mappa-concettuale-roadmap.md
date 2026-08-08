# SchoolForge — Roadmap: mappa concettuale della lezione

**Stato:** progettazione conclusa, nessuna riga implementata. Tutte le
decisioni sono prese e motivate; nessuna resta aperta.
**Data:** 8 agosto 2026.
**Dipendenze:** AIGEN-01→03 e LESSON-DEPTH-01 in produzione; editor Markdown
della lezione (`lessonEditors`) esistente.

Uno studente che ha studiato la lezione ha bisogno di un supporto per
ripassarla: una struttura sintetica che gli faccia rivedere l'ossatura senza
rileggere tutto. Oggi quel supporto o non esiste o se lo costruisce il docente
a mano, che è il tempo che SchoolForge deve restituire, non consumare.

## 1. Principi invarianti

- **Generata dal corpo della lezione, mai dai metadati.** È la garanzia che la
  mappa non possa contraddire la lezione: se partisse da titolo e concetti
  chiave sarebbe un secondo documento che dice cose leggermente diverse.
- **Non sostituisce lo studio, e lo dice.** L'avvertenza è parte della
  struttura dell'artefatto, non una nota facoltativa.
- **Visibile allo studente solo a lezione svolta.** Se fosse disponibile
  prima, diventerebbe la scorciatoia invece del supporto.
- **Nessuna dipendenza nuova, nessuna modifica alla CSP, nessuna modifica alla
  sanificazione.** La mappa è Markdown e attraversa la stessa pipeline di
  tutto il resto: Markdown → parser controllato → HTML → DOMPurify → render.
- **Riuso dell'editor esistente.** La mappa è Markdown come il corpo della
  lezione, quindi usa lo stesso editor con anteprima: stessa esperienza,
  stessi tasti.

## 2. L'artefatto

Struttura **fissa**, quattro parti, in quest'ordine:

1. **elenco** — l'ossatura della lezione come elenco annidato, con le
   relazioni **nominate** («la clorofilla *cattura* la luce»), mai frecce mute;
2. **sintesi scritta** — poche righe di prosa che legano l'ossatura;
3. **diagramma** — albero a caratteri dentro un blocco di codice;
4. **avvertenza** — questa mappa non sostituisce lo studio della lezione, è un
   supporto al ripasso.

### Perché il diagramma è a caratteri e non un grafo

Il renderer del portale **non disegna diagrammi per scelta**: esiste un test
che verifica che un blocco `mermaid` resti un blocco di codice e non diventi
un SVG. Un grafo vero richiederebbe una libreria di rendering, e soprattutto
di rendere e sanificare l'SVG *prima* di inserirlo nel DOM, per non violare
l'invariante «nulla viene aggiunto dopo la sanificazione» — che è la parte più
difesa del codice, quella dove un errore non produce un bug ma una
vulnerabilità.

Un albero a caratteri dentro un blocco di codice ottiene il colpo d'occhio a
costo nullo: spaziatura preservata, e **scorrimento orizzontale dentro il
proprio riquadro**, quindi su mobile la pagina non si trascina dietro il
diagramma.

Forma attesa:

```
FOTOSINTESI CLOROFILLIANA
│
├─ INGRESSI
│   ├─ luce solare ──catturata da──▶ clorofilla
│   ├─ anidride carbonica ──entra dagli──▶ stomi
│   └─ acqua ──sale dalle──▶ radici
│
└─ USCITE
    ├─ glucosio ──immagazzina──▶ energia chimica
    └─ ossigeno ──rilasciato negli──▶ stomi
```

**Vincolo di larghezza:** il prompt deve imporre un albero **profondo, non
largo** (indicativamente entro 70-80 caratteri). Un albero che sfora
costringe a scorrere anche su desktop, e uno scorrimento su un ripasso è
attrito puro.

### Limite noto e accettato

Un diagramma a caratteri, per chi usa un lettore di schermo, è **peggio** di
un elenco: i caratteri di disegno vengono letti come simboli. Il limite è
mitigato dal fatto che l'elenco annidato precede il diagramma e contiene la
stessa informazione in forma leggibile. **Nessun supporto specifico per
lettori di schermo è previsto in questo pacchetto**: è una scelta consapevole
per il contesto d'uso attuale, ed è registrata qui perché sia una decisione e
non una dimenticanza.

## 3. Generazione

Tipo di richiesta nuovo, che riusa integralmente l'impianto esistente (stima,
prenotazione, tetti di spesa, validazione dell'output):

- **input**: il corpo della lezione già scritto. Se la lezione non ha ancora
  un corpo, l'azione è **disabilitata con il motivo visibile** — non nascosta;
- **output**: breve per definizione. Il tetto di token va tenuto **stretto**:
  una mappa lunga è una mappa fallita, e il tetto è il modo più diretto di
  dirlo anche al modello;
- **costo**: il più basso di tutte le generazioni del portale — l'input è un
  testo già esistente e l'output è corto;
- **verifica**: non serve un benchmark. La domanda è «la mappa dice solo cose
  che stanno nella lezione?», e si risponde leggendo due mappe accanto alle
  rispettive lezioni. Nessuna campagna di esecuzioni a pagamento.

Un blocco di prompt nuovo implica comunque una **versione di prompt nuova**,
con le regole di sempre: struttura fissa rispettata, nessun contenuto assente
dalla lezione, larghezza del diagramma, relazioni nominate.

## 4. Interfaccia

- **Azione sulla riga della lezione** in Didattica, accanto alle altre.
  Genera, e alla fine apre la mappa nell'editor.
- **Editor con anteprima**, lo stesso della lezione (`lessonEditors`): la
  mappa è modificabile a mano esattamente come il corpo.
- **Rigenerazione** disponibile; sovrascrive previa conferma, perché una mappa
  modificata a mano è lavoro del docente e non va persa per un clic.
- **Visibilità allo studente** legata a `LessonDoc.completed`, che esiste già
  e che il docente usa già per altro: nessun secondo interruttore da
  ricordare. Se la lezione viene **smarcata**, la mappa torna nascosta —
  l'interruttore vale in entrambi i versi.

## 5. Pulizia inclusa nel pacchetto

`apps/web/src/features/teacher/lessonPdf.ts` e il suo test sono **codice
morto**: l'esportazione PDF della lezione è stata rimossa dall'interfaccia e
nessun componente importa più `downloadLessonPdf`. Vanno eliminati insieme a
questo lavoro, non perché siano in mezzo, ma perché un modulo che nessuno
chiama diventa una fonte di conclusioni sbagliate — è già successo in questa
progettazione, dove è stato scambiato per una funzionalità viva e ha prodotto
una stima di costo errata.

## 6. Fuori scope

- **il grafo disegnato** (mermaid o equivalente): resta una possibilità
  aperta e **non costerebbe di buttare nulla**, perché il contenuto generato
  sarebbe lo stesso — cambierebbe solo la resa. Voci di costo note: libreria e
  caricamento pigro, sanificazione dell'SVG prima dell'inserimento, leggibilità
  su schermo stretto, e l'affidabilità della sintassi prodotta dal modello (una
  riga sbagliata non dà un grafo brutto, non dà alcun grafo);
- supporto per lettori di schermo (§2, limite accettato);
- qualunque uso della mappa fuori dalla lezione che l'ha generata.

## 7. DoD

Mappa generata da una lezione reale con corpo esistente; struttura a quattro
parti rispettata; diagramma entro la larghezza prevista e scorrevole nel
proprio riquadro su mobile; editor con anteprima funzionante e modifica
persistente; rigenerazione con conferma; mappa invisibile allo studente finché
la lezione non è marcata svolta e di nuovo invisibile se smarcata; `lessonPdf`
e il suo test rimossi; nessuna dipendenza nuova nel `package.json`.
