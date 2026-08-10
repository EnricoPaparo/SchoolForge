# SchoolForge — Roadmap: mappa concettuale della lezione

**Stato:** **CONCEPT-MAP-01→06 implementati** (core e backend IA;
persistenza, proiezione condizionale e Rules; interfaccia docente e studente;
mappa come scheda strutturale della lezione; artefatto v2 Sintesi + Diagramma;
generazione modale con scelta esplicita Economy/Quality e default Quality).
Il **rollout DEV è autorizzato con CONCEPT-MAP-06**; il **gate umano** resta
aperto fino allo smoke reale dei due profili e della nuova review.
**Data:** 10 agosto 2026.
**Dipendenze:** AIGEN-01→03 e LESSON-DEPTH-01 in produzione; editor Markdown
della lezione (`lessonEditors`) esistente; proiezione studente `publicLessons`
e stato `LessonDoc.completed` esistenti.

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
- **La struttura non è affidata al solo prompt.** Il modello restituisce tre
  campi chiusi; il server valida e compone il Markdown canonico, aggiungendo
  sempre l'avvertenza. Ordine e presenza delle quattro parti sono quindi
  deterministici.
- **La visibilità è un confine dati, non una condizione CSS.** Prima che la
  lezione sia svolta, la mappa non deve essere presente nel documento leggibile
  dallo studente: nasconderla soltanto nell'interfaccia non sarebbe sicurezza.

## 2. L'artefatto

Struttura **fissa**, quattro parti, in quest'ordine:

1. **sintesi ragionata** — prosa continua che spiega il contenuto: copre tutti i
   concetti portanti, rende esplicite cause, conseguenze e dipendenze, e segue la
   progressione della lezione. La lunghezza la decide il contenuto, non una
   regola;
2. **diagramma** — albero a caratteri dentro un blocco di codice, che *mostra* la
   struttura che la sintesi *spiega*;
3. **avvertenza** — questa mappa non sostituisce lo studio della lezione, è un
   supporto al ripasso.

L'**ossatura** era la prima parte fino a CONCEPT-MAP-04 ed è stata rimossa (v2):
sulle generazioni reali si riduceva quasi sempre a un indice della lezione, e
duplicava il ruolo strutturale del diagramma senza aggiungere ragionamento.
Restano due parti che fanno lavori diversi invece di tre che ne facevano due.

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

### Markdown canonico

Il provider non produce liberamente l'intero documento. Restituisce uno
Structured Output chiuso:

```ts
{
  outlineMarkdown: string;
  summaryMarkdown: string;
  diagram: string;
}
```

Il server valida i tre campi e compone, in quest'ordine:

````md
## Ossatura della lezione

{outlineMarkdown}

## Sintesi

{summaryMarkdown}

## Diagramma

```text
{diagram}
```

> [!IMPORTANT]
> Questa mappa è un supporto al ripasso e non sostituisce lo studio della lezione.
````

L'avvertenza è una costante SchoolForge, non testo generato dal modello. Il
validator rifiuta campi vuoti, proprietà extra, fence interne nel diagramma,
righe del diagramma oltre **80 caratteri**, output complessivo oltre **32.000
byte UTF-8** e qualunque risultato che non possa essere composto nel formato
canonico. Nessun aggiustamento o troncamento silenzioso.

### Limite noto e accettato

Un diagramma a caratteri, per chi usa un lettore di schermo, è **peggio** di
un elenco: i caratteri di disegno vengono letti come simboli. Il limite è
mitigato dal fatto che l'elenco annidato precede il diagramma e contiene la
stessa informazione in forma leggibile. **Nessun supporto specifico per
lettori di schermo è previsto in questo pacchetto**: è una scelta consapevole
per il contesto d'uso attuale, ed è registrata qui perché sia una decisione e
non una dimenticanza.

## 3. Generazione

Tipo di richiesta nuovo e di prima classe, `concept_map`, che riusa
integralmente l'impianto esistente (stima, prenotazione, tetti di spesa,
idempotenza, validazione dell'output):

```ts
{
  kind: 'concept_map';
  requestId: string;
  modelProfile: 'economy' | 'quality';
  lessonBody: string;
}
```

Non va fatto passare come una richiesta `lesson`: deve partecipare in modo
esplicito a `AiContentRequest`, payload chiuso, `canonicalRequest`, `inputHash`,
schema Structured Output, stima, prenotazione, provider e validazione. Pool e
lezione devono restare byte-identici nei rispettivi prompt e payload.

- **input**: il corpo della lezione già scritto. Se la lezione non ha ancora
  un corpo, l'azione è **disabilitata con il motivo visibile** — non nascosta;
- **nessun altro contesto**: niente titolo, metadati, UDA, indice delle lezioni,
  pool o indicazioni docente. La mappa deve poter affermare soltanto ciò che è
  ricavabile dal corpo;
- **output**: breve per definizione. Il provider dispone di **6.000 token** per
  ragionamento e Structured Output, ma il documento accettato resta vincolato
  al cap autonomo di **32.000 byte UTF-8**;
- **modello**: profilo `economy` o `quality`, scelto esplicitamente nel dialog;
  `quality` è il default visivo, mai un fallback silenzioso;
- **costo**: il più basso di tutte le generazioni del portale — l'input è un
  testo già esistente e l'output è corto;
- **verifica**: non serve un benchmark. La domanda è «la mappa dice solo cose
  che stanno nella lezione?», e si risponde leggendo due mappe accanto alle
  rispettive lezioni. Nessuna campagna di esecuzioni a pagamento.

Un blocco di prompt nuovo implica una **versione di prompt propria**, distinta
da quella di pool e lezione, con le regole di sempre: struttura fissa
rispettata, nessun contenuto assente dalla lezione, larghezza del diagramma,
relazioni nominate. Aggiungere o modificare questo prompt non deve invalidare
il replay delle altre due generazioni.

## 4. Persistenza, proiezione e sicurezza

La mappa ha una copia autorevole privata e, solo quando consentito, una copia
pubblica:

- `LessonDoc.conceptMapMarkdown?: string` — copia canonica del docente, dentro
  la sottocollezione owner-only già esistente;
- `PublicLessonDoc.conceptMapMarkdown?: string` — proiezione studente, presente
  **solo** quando `completed === true` e una mappa esiste davvero.

Non si crea un nuovo documento e non si usa Storage: l'artefatto è breve e il
cap da 32 KB lo mantiene lontano dal limite Firestore. Il salvataggio della
mappa aggiorna il `LessonDoc`; se la lezione è già svolta aggiorna nello stesso
batch anche `publicLessons`, altrimenti il campo pubblico deve restare assente.
Il salvataggio vuoto è rifiutato: nessuna cancellazione implicita.

Il passaggio svolta/non svolta diventa una transazione autorevole:

1. legge il `LessonDoc` tecnico corrente;
2. aggiorna `completed` e `completedAt` sul documento tecnico;
3. aggiorna `publicLessons.completed`;
4. se passa a svolta e la mappa privata è valida, la copia nella proiezione;
5. se passa a non svolta, rimuove sempre `conceptMapMarkdown` dalla proiezione;
6. registra l'audit già esistente.

Le Rules devono difendere lo stesso invariante: un documento `publicLessons`
con `completed != true` non può contenere `conceptMapMarkdown`; quando il campo
è presente deve essere una stringa non vuota entro il cap. La UI non è il
confine di sicurezza. Le proiezioni legacy senza campo restano valide e non
richiedono migrazione.

Costi aggiunti:

- zero costo passivo, listener, polling o indici;
- generazione: le operazioni AIGEN già previste;
- salvataggio: una scrittura privata, più una pubblica soltanto se svolta, più
  l'audit esistente;
- cambio svolta/non svolta: una lettura puntuale transazionale e le scritture
  già necessarie alla sincronizzazione tecnica/pubblica.

## 5. Interfaccia

- **Scheda della lezione**, non azione di menu (CONCEPT-MAP-04). La mappa è una
  parte strutturale della lezione quanto il corpo: l'ordine definitivo lato
  docente è **Contenuto → Mappa concettuale → Domande → Informazioni**. La
  scheda esiste sempre; è la *generazione* a essere disabilitata con il motivo
  visibile quando manca un corpo salvato.
- **Conferma IA compatta**: il docente sceglie `Quality` o `Economy` (default
  `Quality`) e vede la stima; nessuna textarea, profondità o configurazione
  aggiuntiva. Dopo la conferma genera e apre la proposta nell'editor, senza
  autosalvataggio.
- **Editor con anteprima**, lo stesso della lezione (`lessonEditors`): la
  mappa è modificabile a mano esattamente come il corpo.
- **Rigenerazione** disponibile; sovrascrive previa conferma, perché una mappa
  modificata a mano è lavoro del docente e non va persa per un clic.
- **Visibilità allo studente** legata a `LessonDoc.completed`, che esiste già
  e che il docente usa già per altro: nessun secondo interruttore da
  ricordare. Se la lezione viene **smarcata**, la mappa torna nascosta —
  l'interruttore vale in entrambi i versi.
- **Portale studente**: la scheda «Mappa concettuale» — dopo «Contenuto» —
  compare soltanto se la proiezione pubblica contiene davvero la mappa. Prima
  non mostra scheda disabilitata, placeholder, teaser o messaggi che
  suggeriscano una scorciatoia nascosta.

## 6. Pulizia inclusa nel pacchetto

`apps/web/src/features/teacher/lessonPdf.ts` e il suo test sono **codice
morto**: l'esportazione PDF della lezione è stata rimossa dall'interfaccia e
nessun componente importa più `downloadLessonPdf`. Vanno eliminati insieme a
questo lavoro, non perché siano in mezzo, ma perché un modulo che nessuno
chiama diventa una fonte di conclusioni sbagliate — è già successo in questa
progettazione, dove è stato scambiato per una funzionalità viva e ha prodotto
una stima di costo errata.

## 7. Fuori scope

- **il grafo disegnato** (mermaid o equivalente): resta una possibilità
  aperta e **non costerebbe di buttare nulla**, perché il contenuto generato
  sarebbe lo stesso — cambierebbe solo la resa. Voci di costo note: libreria e
  caricamento pigro, sanificazione dell'SVG prima dell'inserimento, leggibilità
  su schermo stretto, e l'affidabilità della sintassi prodotta dal modello (una
  riga sbagliata non dà un grafo brutto, non dà alcun grafo);
- supporto per lettori di schermo (§2, limite accettato);
- qualunque uso della mappa fuori dalla lezione che l'ha generata.

## 8. Fasi di implementazione

### CONCEPT-MAP-01 — core e backend IA ✅ implementato

Nuovo kind `concept_map`, payload chiuso, prompt dedicato, Structured Output a
tre campi, compositore Markdown deterministico, validazione dimensionale e di
larghezza, token/costi, replay e test di non-regressione byte-identica di pool
e lezione. Nessuna UI, persistenza o deploy.

**Come è stato realizzato**, oltre a quanto già scritto sopra:

- **contratto dei tre campi**, fail-closed: niente heading
  ATX o Setext, niente HTML (tag reali, commenti, doctype, CDATA), niente fence,
  niente front matter. L'ossatura deve essere
  davvero un elenco (`-`, `*`, `+`, almeno una voce). Una voce può continuare
  su più righe secondo CommonMark, comprese le continuazioni lazy; dopo una
  riga vuota una continuazione deve essere indentata, così un nuovo paragrafo
  di prosa resta rifiutato. La sintesi deve essere prosa (nessuna riga puntata, nemmeno
  parziale); il diagramma resta entro 80 code point per riga. Il controllo HTML
  non è generico su `<`: «a < b» non è markup e non viene rifiutato;
- **normalizzazione controllata del provider.** I tre campi strutturati vengono
  privati esclusivamente degli spazi esterni prima della validazione; spazi e
  righe interne restano byte-identici. La prova DEV ha mostrato che il provider
  può aggiungere una newline finale innocua: rifiutarla rendeva instabile una
  risposta semanticamente valida. Il documento composto e il replay restano
  canonici byte per byte;
- **profili e margine tecnico.** `economy` e `quality` sono entrambi accettati
  fail-closed e partecipano a `inputHash`, stima, prenotazione e replay. Il
  massimo provider è 6.000 token per consentire ragionamento e Structured
  Output; non autorizza mappe più lunghe, che restano limitate a 32 KB UTF-8;
- **errori distinti.** Un provider interrotto da `max_output_tokens` produce
  `output_incomplete`; un documento realmente oltre il cap conserva
  `output_too_large`. Il client non confonde più i due casi.
- **validazione del documento persistito.** Il replay non accetta «una stringa
  non vuota entro il cap»: verifica oggetto con **esattamente una chiave**,
  quattro parti presenti una sola volta e nell'ordine canonico, **una sola**
  fence correttamente chiusa, avvertenza esatta, nessun contenuto dopo di essa
  oltre la newline finale, e riapplica alle sezioni estratte gli stessi
  contratti dei campi generati. L'oracolo finale è l'uguaglianza con la
  ricomposizione: se il documento non è ciò che il compositore avrebbe prodotto,
  non è canonico. Il Markdown viene restituito **identico**, mai ricomposto;
- **non-regressione ancorata.** Due `inputHash` di pool e lezione sono congelati
  come costanti nei test: sono la chiave di replay dei run già memorizzati, e
  cambiarli in silenzio li invaliderebbe tutti.

**Limite dichiarato:** `AI_CONCEPT_MAP_PROMPT_VERSION` esiste ed è separata da
`AI_CONTENT_PROMPT_VERSION`, ma **non è persistita nel documento run** e non è
usata per replay, audit o confronto. Nessun consumatore la legge. Va dichiarata
operativa solo quando un consumatore esisterà davvero.

### CONCEPT-MAP-02 — persistenza e Rules ✅ implementato

Campi tipizzati, servizio di salvataggio, proiezione condizionale, transazione
di completamento, audit e Rules emulator. Nessuna UI e nessuna chiamata IA.

**Come è stato realizzato**, con le decisioni che la progettazione non aveva
fissato:

- **contratto puro separato** (`conceptMapContract.ts`): cap in byte UTF-8,
  validazione che non modifica mai il testo, e due letture fail-closed. La
  lettura pubblica riapplica l'invariante di visibilità — `completed !== true`
  ⇒ `null` **anche** se un documento malformato contenesse il campo. Difesa in
  profondità: le Rules impediscono di scriverlo, la lettura impedisce di
  mostrarlo se ci fosse finito comunque;
- **servizio dedicato** (`conceptMapService.ts`) invece che dentro il repository
  editor: quello gestisce il ciclo di vita dei documenti attraverso Storage e
  batch, questa è una singola operazione transazionale su due documenti che
  Storage non lo tocca;
- **validazione prima della transazione.** Un payload non valido non costa
  nemmeno le due letture: la garanzia «zero write» diventa «zero operazioni»;
- **identità della coppia dimostrata, non assunta.** Verificare owner, import e
  corso non basta: due lezioni dello stesso corso, import e docente li superano
  tutti, quindi l'id pubblico della lezione B passato mentre si modifica la A
  scriverebbe la copia privata su A e quella pubblica su B. La correzione è
  cambiare la **fonte** dell'id: quello ricevuto dal chiamante non è autorevole,
  si deriva dal `LessonDoc` con `resolvePublicLessonId` e il valore ricevuto
  viene solo **confrontato**. Le letture sono perciò **sequenziali** — prima il
  documento tecnico, poi la proiezione al suo indirizzo derivato — e un
  disallineamento costa una lettura sola, senza scritture né audit. Dopo la
  seconda lettura si confrontano anche i campi identitari stabili `udaDir`,
  `path` e `filename`: l'indirizzo giusto non basta se il documento che ci sta
  è un altro. Il tutto vive in `lessonProjectionIdentity.ts`, puro e senza
  Firebase, condiviso dai due servizi perché non possano divergere su che cosa
  considerano coerente;
- **legacy senza sorprese**: `publicLessonId` presente ⇒ si usa esattamente
  quello; assente ⇒ si ricade sul `lessonId` nudo. Mai un id provato e poi un
  altro, mai una query per «trovare» la proiezione;
- **`setLessonCompleted` passa da `writeBatch` a `runTransaction`.** Un batch
  scrive senza leggere, e da qui in avanti la decisione dipende dalla mappa
  privata **letta**: quella lettura fuori dall'atomicità lascerebbe una lezione
  svolta senza mappa o — nel verso pericoloso — una proiezione non svolta che la
  conserva. Firma pubblica invariata: `CourseWorkspace` non cambia. Un test
  statico impedisce di reintrodurre il batch;
- **mappa privata malformata ⇒ fail-closed.** Assente è normale e significa
  «niente da proiettare»; presente ma non valida ferma il cambio svolta con zero
  scritture, perché copiarla violerebbe il contratto e ignorarla nasconderebbe
  un dato corrotto;
- **audit `lesson.conceptMapSaved`.** La roadmap proponeva
  `lesson.concept_map.saved`; è stato preferito il `camelCase` dopo il punto di
  tutte le trenta azioni esistenti — la coerenza del registro vale più della
  sfumatura di leggibilità.

**Confine delle Rules, dichiarato.** Le Rules verificano l'invariante di
visibilità, il tipo, la non-vuotezza e un tetto di 32.000 **caratteri**:
`size()` sulle stringhe conta caratteri, non byte UTF-8, quindi quel bound è più
**debole** di quello applicativo da 32.000 byte (per un testo non ASCII i byte
sono più dei caratteri). Le Rules fermano payload assurdi e la visibilità; il
limite dimensionale autorevole e la struttura canonica restano applicativi.
Attribuire alle Rules una garanzia che non possono dare sarebbe peggio che
dichiararne il limite.

**Costi effettivi.** Zero costo passivo, listener, polling e indici. Salvataggio:
2 letture puntuali transazionali, 1 scrittura privata, 1 scrittura pubblica
**solo** se serve sincronizzare o rimuovere, 1 audit. Cambio svolta: 2 letture
puntuali transazionali, 2 aggiornamenti, 1 audit. Un retry transazionale ripete
le letture, che restano fatturate.

### CONCEPT-MAP-03 — interfaccia ✅ implementata; rollout DEV ⏳ aperto

**Una finestra sola.** La mappa non ha una fase di configurazione — il payload è
il corpo salvato della lezione e nient'altro — quindi separare «genera» da
«modifica» avrebbe prodotto due dialog che si passano un testo, con due punti in
cui perderlo. `ConceptMapDialog` tiene il testo in un solo stato e ogni
transizione dichiara che cosa ne fa: schede editor/anteprima, stima prima della
spesa, conferma prima di sostituire, salvataggio esplicito.

**Il testo non si perde mai in silenzio.** Una proposta generata costa denaro
reale e una modifica manuale costa lavoro del docente: backdrop ed Escape non le
scartano quando c'è del lavoro non salvato, e ogni percorso che sostituirebbe il
testo — rigenerazione, chiusura — passa da una conferma modale, mai da controlli
che compaiono spostando il layout. `dirty` è calcolato rispetto alla **baseline
salvata**, non rispetto alla proposta accettata: una generazione non ancora
salvata resta riconoscibile come non salvata.

**Nessun autosave.** «Salva mappa» è l'unica azione che scrive, ed è protetta da
una guardia sincrona: un doppio click nello stesso tick invoca il service una
volta sola, prima ancora che React abbia riprodotto lo stato `saving`.

**L'azione è disabilitata, non nascosta, e dice perché.** La voce «Genera/Modifica
mappa concettuale» nel menu «Azioni» esiste sempre; è disabilitata quando il
corpo non è disponibile, è vuoto, oppure ha modifiche non salvate — con il motivo
in chiaro accanto, legato via `aria-describedby`. Generare da un corpo non
salvato produrrebbe una mappa di un testo che non esiste per nessuno: né per lo
studente, né al prossimo caricamento. L'etichetta cambia in base alla presenza
della mappa: una sola voce che cambia nome, non due voci alternative.

**Zero letture nuove.** La mappa già salvata è letta dall'albero in memoria con
`readPrivateConceptMap(selectedLesson)`: aprire la finestra non aggiunge alcun
`getDoc`, né listener, polling, indici o dipendenze. Nessuna callable è invocata
all'apertura: la spesa parte solo da un gesto esplicito.

**Payload verso il server.** `aiConceptMapClient` costruisce esattamente quattro
campi (`kind`, `requestId`, `modelProfile`, `lessonBody`) e riusa le callable
esistenti `aiContentPreview`/`aiContentGenerate`: nessuna Function nuova. Il
profilo `economy` o `quality` è scelto esplicitamente nel dialog; `quality` è
soltanto il default iniziale. Preview e generate ricevono lo **stesso** payload con lo stesso
`requestId`, così la stima mostrata e la spesa effettuata riguardano la stessa
richiesta.

**Lato studente la sezione esiste solo se la mappa c'è davvero.** Nessun
placeholder, nessun «non disponibile», nessun pulsante inerte: un segnaposto
racconterebbe allo studente che esiste qualcosa che non può vedere. La
visibilità è già decisa dai dati (CONCEPT-MAP-02); la vista rende soltanto ciò
che è arrivato, con la stessa variante manuale del corpo lezione — una pagina
sola, un linguaggio solo.

**Codice morto rimosso.** `lessonPdf.ts` e il suo test sono stati eliminati:
nessun modulo li importava. Gli altri PDF (programma svolto, verifiche,
correzioni) restano intatti.

**Il risultato IA è validato con il contratto autorevole.** `validateConceptMapResult`
usa `isValidConceptMap` — lo stesso metro della persistenza — quindi tipo,
non-vuotezza e cap di 32.000 **byte UTF-8**. Il cap non è riscritto nel client:
duplicarlo avrebbe prodotto due limiti destinati a divergere e, soprattutto, un
limite in caratteri. Una mappa ricca di accenti o di caratteri di disegno del
diagramma pesa in byte molto più di quanto sia lunga: con un cap in caratteri una
proposta sarebbe stata accettata dall'anteprima e poi rifiutata dal salvataggio,
con il testo precedente ormai sostituito. Rifiutare subito, con lo stesso metro,
è ciò che rende impossibile quello stato.

**Smoke responsive eseguito** a 1440/1024/390/320 px su Chromium, con e senza
puntatore touch: nessuna larghezza produce scorrimento orizzontale di pagina, il
dialog sta dentro la viewport, il footer resta raggiungibile ovunque, e il
diagramma a caratteri scorre **dentro il proprio `<pre>`** (verificato:
`scrollWidth > clientWidth` con `overflow-x: auto`), non trascinando la pagina.

**Target touch ≥ 44 px, opt-in.** Le schede editor/anteprima li hanno per
costruzione; i pulsanti delle azioni li raggiungono tramite una classe del CSS
module che si **affianca** a `dialog-actions` senza sostituirla — layout, gap e
wrapping restano quelli condivisi, cambia solo `min-height`. La regola vale su
`(pointer: coarse)` **oppure** viewport ≤ 640 px: legarla alla sola larghezza
avrebbe lasciato a 36 px un tablet in orizzontale, che è largo e si tocca
comunque con un dito. `DialogShell` e il foglio globale non sono toccati, e su
desktop con mouse i pulsanti restano quelli di tutti gli altri dialog del
portale — verificato nello smoke su entrambi i tipi di puntatore.

**Ancora aperti:** rollout DEV e gate umano (vedi §10).

### CONCEPT-MAP-04 — la mappa come scheda della lezione ✅ implementata

**Perché l'assetto precedente era incoerente.** In CONCEPT-MAP-03 la mappa era
una voce del menu «Azioni» che apriva una finestra. Il menu «Azioni» contiene
operazioni *sulla* lezione — modificarne il contenuto, le informazioni,
eliminarla — mentre la mappa è un **contenuto** della lezione, come il corpo e
come le domande. Metterla lì la faceva sembrare un'operazione occasionale, e
soprattutto costringeva a uscire dalla lezione per leggerla: il docente non
poteva guardare mappa e contenuto nello stesso posto in cui lo studente li
guarda. L'incoerenza non era estetica ma di modello: una cosa che *è* parte
della lezione veniva presentata come qualcosa che *si fa* alla lezione.

**Anatomia docente.** Quattro schede — Contenuto, Mappa concettuale, Domande,
Informazioni — con la stessa grammatica: `role="tablist"`/`tab`/`tabpanel`,
`aria-selected`/`aria-controls`/`aria-labelledby`, roving tabindex, ←/→ ciclici,
Home ed End, ritorno a «Contenuto» al cambio lezione. La scheda mappa ha due
modalità, perché sono due intenzioni diverse: **lettura** (la mappa salvata
resa come la legge lo studente, o uno stato vuoto compatto) e **modifica**
(editor e anteprima, salvataggio esplicito). La generazione resta disponibile in
entrambe.

**Anatomia studente.** Due schede — Contenuto, Mappa concettuale — con la stessa
navigazione da tastiera. La tablist **non esiste affatto** quando la mappa non è
proiettata: nessuna scheda disabilitata, nessun placeholder. La vecchia sezione
in fondo al contenuto è stata rimossa.

**Il componente è stato estratto, non duplicato.** `ConceptMapEditor` contiene
la macchina a stati verificata in CONCEPT-MAP-03 — stessa `requestId` fra stima
e generazione, stessa validazione autorevole del risultato, conferma prima di
rigenerare, conferma prima di abbandonare, guardia anti-doppio-click, nessun
aggiornamento dopo unmount — spostata dentro il pannello invece che riscritta.
`ConceptMapDialog` è stato **rimosso**: restava senza chiamanti. Restano modali
soltanto le due conferme distruttive, con `role="alertdialog"`: sono gli unici
momenti in cui una risposta sbagliata perde del lavoro.

**Dirty guard.** La mappa entra nella guardia **già esistente** del workspace
(`anyDirty`), non in una seconda: cambiare lezione, tornare alla libreria o
lasciare la vista con una modifica non salvata passa dalla stessa conferma di
corpo, metadati e pool. Cambiare scheda non perde nulla, perché il pannello
resta montato dopo la prima apertura; «Annulla» ripristina l'ultima mappa
salvata; un errore IA non tocca il draft; un salvataggio riuscito aggiorna la
baseline locale.

**Confine di sicurezza invariato.** La visibilità studente resta decisa dal
campo realmente presente nella proiezione pubblica (CONCEPT-MAP-02), non da una
condizione dell'interfaccia su `completed`: legare la scheda al flag
significherebbe sostituire un confine dati con un confine di rendering. Zero
letture, query, listener, indici o dipendenze nuove; Functions, prompt, payload,
provider, costi, Rules e schema non sono toccati.

**Responsive.** A 1440 e 1024 px le quattro schede stanno su una riga sola. A
390 e 320 px la griglia mobile passa da tre a **due** colonne: la regola
precedente ne fissava tre e la quarta sarebbe finita da sola su una riga. Tutte
e quattro le etichette restano leggibili per intero, con target ≥ 44 px e senza
alcuno scorrimento orizzontale di pagina.

### CONCEPT-MAP-05 — quality-only e sintesi ragionata ✅ implementata

**Perché la scelta del modello era intermittente.** Il selettore Economy/Quality
era renderizzato **solo** dentro il ramo della modalità modifica, mentre il
pulsante «Genera/Rigenera con IA» esisteva in **entrambe** le modalità e leggeva
comunque lo stato interno del componente. Generando dalla lettura non compariva
alcuna scelta, ma un profilo veniva usato lo stesso — quello corrente. Peggio:
lo stato sopravviveva al cambio di modalità, perché `leaveEdit()` ripristinava
bozza, fase, errore e stima ma **non** il profilo. Un docente che avesse scelto
Economy in modifica e poi premuto «Annulla» continuava a generare in Economy
dalla lettura, senza che nulla lo mostrasse.

**Perché la risposta non è stato mostrare il selettore anche in lettura.** Il
profilo non era una preferenza legittima: `economy` produceva mappe
qualitativamente insufficienti, e una mappa sbagliata non è un risparmio — è un
ripasso che disinforma. La mappa è quindi **quality-only**, e la coerenza è
ottenuta togliendo la scelta, non replicandola.

**Doppia difesa.** Il client non espone il profilo nella firma di
`buildConceptMapRequest`: non esiste alcun percorso, visibile o nascosto, che
produca una richiesta Economy. Il server la rifiuta comunque `fail-closed` nella
validazione del payload, cioè **prima** di provider, stima, prenotazione, run e
qualunque scrittura. Pool e lezione conservano entrambi i profili: il vincolo è
del kind, non del profilo.

**Sintesi ragionata.** Alla sintesi non si chiede più di essere breve — era
proprio la brevità imposta («poche righe») a renderla un sommario inutile. Ora
deve coprire tutti i concetti portanti, esplicitare cause, conseguenze,
dipendenze e passaggi, spiegare i termini indispensabili e mantenere la
progressione della lezione, con la lunghezza proporzionata alla complessità
effettiva. Resta vietato l'elenco — puntato o numerato — perché un elenco qui
tornerebbe a essere l'indice che l'ossatura già era; resta il solo cap tecnico di
32.000 byte UTF-8 sul documento composto.

**Compatibilità: nessuna migrazione.** Le mappe già salvate non vengono toccate,
riscritte né convertite. Il parser del documento persistito è version-aware e
riconosce fail-closed **entrambe** le forme canoniche — v1 (Ossatura + Sintesi +
Diagramma + avvertenza) e v2 (Sintesi + Diagramma + avvertenza) — restituendo il
Markdown byte per byte. Una v1 resta v1 anche in replay: convertirla cambierebbe
ciò che il docente ha salvato e ciò che lo studente sta già leggendo, senza che
nessuno l'abbia chiesto. La tolleranza è però solo sulla *forma*: una v1
malformata è rifiutata esattamente come una v2 malformata. Le nuove risposte del
provider possono produrre **soltanto** v2, e `outlineMarkdown` è rifiutato come
qualunque altra proprietà extra.

**Limite dichiarato sui run legacy.** Un run Economy memorizzato prima di questa
fase non autorizza una nuova generazione Economy: la richiesta viene rifiutata
alla validazione del payload, prima di raggiungere la logica di replay. I run
hanno TTL di 24 ore, quindi la finestra si chiude da sola, e l'ordine fail-closed
delle callable non è stato allentato per recuperare un artefatto temporaneo.

**Versione del prompt.** `AI_CONCEPT_MAP_PROMPT_VERSION` passa a
`concept-map-05-v3`; quelle di pool e lezione non sono toccate. Come già in
CONCEPT-MAP-01, questa versione **non è persistita nel run** e non è usata per
replay né per audit: resta una costante di codice, ed è bene che la
documentazione dica ciò che è operativo e non ciò che sarebbe elegante.

**Persistenza, visibilità e costi invariati.** Il contratto persistito resta una
stringa non vuota entro 32 KB UTF-8, deliberatamente **non** irrigidito sulla
sola struttura v2: irrigidirlo romperebbe le mappe già salvate. Rules, schema,
indici, dipendenze, `saveLessonConceptMap`, la matrice privata/pubblica di
CONCEPT-MAP-02 e il comportamento di «Segna svolta» non sono toccati; il costo
passivo resta zero.

### CONCEPT-MAP-06 — generazione modale e profilo esplicito ✅ implementata

CONCEPT-MAP-05 aveva eliminato la scelta del profilo per rimuovere uno stato
invisibile e intermittente. La causa, però, non era l'esistenza di Economy: era
il fatto che profilo, stima e generazione vivessero dentro l'editor e fossero
renderizzati soltanto in una delle sue modalità. CONCEPT-MAP-06 sostituisce
quella sola decisione UX con lo stesso confine già usato dalla generazione
della lezione.

Ogni pressione su «Genera con IA» o «Rigenera con IA» apre una **nuova finestra**
con entrambi i profili, `Quality` preselezionato, e la sequenza configurazione →
stima → conferma → generazione → revisione → «Usa questa bozza». Il profilo non
sopravvive alla chiusura: una nuova apertura riparte sempre da Quality. Cambiare
profilo invalida stima e `requestId`; preview e generate ricevono lo stesso
payload e la stessa `requestId`.

Il server accetta soltanto i due valori chiusi `economy|quality`, senza fallback
né degradazione silenziosa. La proposta non sostituisce il draft corrente e non
produce scritture finché il docente non preme «Usa questa bozza»; anche allora
diventa soltanto una modifica locale protetta dalla dirty guard. «Salva mappa»
resta l'unica persistenza. Artefatto v2, prompt, validazione, cap, proiezione
studente e compatibilità v1/v2 restano invariati.

### CONCEPT-MAP-07 — compressione didattica della sintesi ✅ implementata

Due generazioni reali Quality — una introduttiva e una tecnica — hanno mostrato
lo stesso difetto: correttezza e progressione erano buone, ma la sintesi tendeva
a riscrivere la lezione. La causa era nel contratto: «copri tutti i concetti
portanti» insieme a «una lezione complessa merita una sintesi lunga» premiava
l'esaustività locale, non la selezione gerarchica. Nel campione tecnico il
risultato conservava persino modelli commerciali, prezzi e molteplici casi
d'acquisto, dettagli corretti ma marginali rispetto al modello mentale della CPU.

Il prompt ora definisce la mappa come strumento di ripasso, non come seconda
lezione. La sintesi deve essere sostanzialmente più breve del corpo attraverso
selezione, gerarchia e relazioni; conserva soltanto i nuclei indispensabili,
usa un paragrafo compatto per funzione, al massimo un esempio quando necessario
a sciogliere una misconcezione e non aggiunge un riepilogo ripetitivo. Prezzi,
modelli commerciali, aneddoti e dati contingenti sono esclusi salvo costituiscano
il tema centrale esplicito. Non c'è un cap editoriale di caratteri o paragrafi:
il solo limite resta quello tecnico del documento, e una relazione necessaria
non va troncata per rispettare una quota artificiale.

Il diagramma usa normalmente quattro-sette nodi principali, privilegia relazioni
causali, funzionali e logiche e non replica tutti i dettagli. Un controllo finale
obbliga il modello a rimuovere ridondanze fra sintesi e diagramma e a non rendere
universale una relazione condizionata — ad esempio, l'esecuzione di un'istruzione
può coinvolgere l'ALU o altre unità, non sempre e solo l'ALU.

`AI_CONCEPT_MAP_PROMPT_VERSION` passa a `concept-map-07-v1`. Payload, Structured
Output, parser v1/v2, compositore canonico, cap, profili, costi, persistenza,
proiezione studente, Rules e schema restano invariati. La fase richiede un nuovo
gate qualitativo reale sul campione tecnico prima del rollout definitivo.

## 9. DoD

Mappa generata da una lezione reale con corpo esistente; struttura v2 composta
dal server (Sintesi + Diagramma); diagramma entro 80 caratteri per riga e scorrevole
nel proprio riquadro su mobile; editor con anteprima funzionante e modifica
persistente; rigenerazione con conferma; mappa assente — non soltanto nascosta
dalla UI — dalla proiezione studente finché la lezione non è marcata svolta e
rimossa atomicamente se smarcata; pool e lezione IA byte-identici; `lessonPdf`
e il suo test rimossi; nessuna dipendenza nuova nel `package.json`.

## 10. Checklist di rollout DEV

Da eseguire **manualmente** su `schoolforge-dev`, dopo il deploy, con
`AI_CONTENT_MODE=openai`. Ogni riga è una verifica osservabile, non un'opinione.

1. **Lezione teorica** — apri una lezione con corpo salvato, «Azioni» → «Genera
   mappa concettuale». La stima compare **prima** di qualunque spesa.
2. **Generazione economy** — conferma: la proposta arriva, il costo effettivo è
   mostrato, e la mappa **non è salvata** (il pulsante «Salva mappa» è attivo).
3. **Lezione tecnica** — ripeti su una lezione con formule/codice: il diagramma
   resta entro 80 caratteri per riga e non sfonda il riquadro.
4. **Modifica manuale** — cambia il Markdown in editor, controlla l'anteprima,
   salva. Riapri: il testo salvato è quello.
5. **Rigenerazione con annullo** — «Rigenera con IA» → «Continua la modifica»:
   nessuna chiamata, testo intatto. Poi «Rigenera» → «Annulla» alla stima:
   nessuna spesa, testo ancora intatto.
6. **Lezione non svolta** — dal portale studente la sezione «Mappa concettuale»
   **non compare**, e un `get()` diretto sul documento pubblico non contiene il
   campo.
7. **Lezione marcata svolta** — lo studente vede la mappa.
8. **Ritorno a non svolta** — la mappa sparisce dal portale studente e il campo
   è rimosso dal documento pubblico.
9. **Mobile 390 e 320 px** — dialog usabile, footer raggiungibile, diagramma
   scorrevole nel proprio riquadro, pagina senza scorrimento orizzontale.
10. **Costo** — il totale speso nello smoke è coerente con le stime mostrate
    (`actual ≤ settled ≤ reservation`).
