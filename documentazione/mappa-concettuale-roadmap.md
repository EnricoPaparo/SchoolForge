# SchoolForge — Roadmap: mappa concettuale della lezione

**Stato:** progettazione conclusa, nessuna riga implementata. Tutte le
decisioni sono prese e motivate; nessuna resta aperta.
**Data:** 9 agosto 2026.
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
  modelProfile: 'economy';
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
- **output**: breve per definizione. Il tetto di token va tenuto **stretto**:
  una mappa lunga è una mappa fallita, e il tetto è il modo più diretto di
  dirlo anche al modello. Il tetto iniziale è **2.000 token di output**;
- **modello**: profilo `economy`, fisso e dichiarato nell'interfaccia. Questa è
  un'operazione di riorganizzazione e sintesi, non di creazione di una lezione;
  la prima versione non espone un selettore del modello;
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

- **Azione sulla riga della lezione** in Didattica, dentro lo stesso menu delle
  altre azioni: «Genera mappa concettuale» quando assente, «Modifica mappa
  concettuale» quando presente.
- **Conferma IA compatta**: mostra profilo economico e stima; nessuna textarea,
  profondità o configurazione aggiuntiva. Dopo la conferma genera e apre la
  proposta nell'editor, senza autosalvataggio.
- **Editor con anteprima**, lo stesso della lezione (`lessonEditors`): la
  mappa è modificabile a mano esattamente come il corpo.
- **Rigenerazione** disponibile; sovrascrive previa conferma, perché una mappa
  modificata a mano è lavoro del docente e non va persa per un clic.
- **Visibilità allo studente** legata a `LessonDoc.completed`, che esiste già
  e che il docente usa già per altro: nessun secondo interruttore da
  ricordare. Se la lezione viene **smarcata**, la mappa torna nascosta —
  l'interruttore vale in entrambi i versi.
- **Portale studente**: la sezione «Mappa concettuale» compare soltanto se la
  proiezione pubblica contiene davvero la mappa. Prima non mostra placeholder,
  teaser o messaggi che suggeriscano una scorciatoia nascosta.

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

### CONCEPT-MAP-01 — core e backend IA

Nuovo kind `concept_map`, payload chiuso, prompt dedicato, Structured Output a
tre campi, compositore Markdown deterministico, validazione dimensionale e di
larghezza, token/costi, replay e test di non-regressione byte-identica di pool
e lezione. Nessuna UI, persistenza o deploy.

### CONCEPT-MAP-02 — persistenza e Rules

Campi tipizzati, servizio di salvataggio, proiezione condizionale, transazione
di completamento, audit e Rules emulator. Nessuna UI e nessuna chiamata IA.

### CONCEPT-MAP-03 — interfaccia e smoke DEV

Azione docente, dialog di stima/generazione, editor/anteprima, conferma di
rigenerazione, sezione studente, rimozione del PDF morto, rollout DEV e smoke
umano su una lezione teorica e una tecnica. Gate umano prima di considerare la
funzione conclusa.

## 9. DoD

Mappa generata da una lezione reale con corpo esistente; struttura a quattro
parti composta dal server; diagramma entro 80 caratteri per riga e scorrevole
nel proprio riquadro su mobile; editor con anteprima funzionante e modifica
persistente; rigenerazione con conferma; mappa assente — non soltanto nascosta
dalla UI — dalla proiezione studente finché la lezione non è marcata svolta e
rimossa atomicamente se smarcata; pool e lezione IA byte-identici; `lessonPdf`
e il suo test rimossi; nessuna dipendenza nuova nel `package.json`.
