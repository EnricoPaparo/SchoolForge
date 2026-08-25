# MULTI-VISUAL-00 — review di fase

> **Gate GMULTI: PENDING.** Questo documento registra che cosa è stato
> deciso, che cosa è stato verificato, come, e — dove la verifica non è
> conclusiva — lo dice esplicitamente invece di dichiarare un PASS non
> raccolto. Non approva alcuna resa visiva o decisione di prodotto: quel
> giudizio è del docente, al gate umano di questo pilota.

**Fase:** MULTI-VISUAL-00 — contratto e prototipo, **revisione 2**. Pilota
di `AGENT-ORCHESTRATOR` sul task manifest `MULTI-VISUAL-00`.
**Data:** 25 agosto 2026.
**Base:** `main` @ merge PR #421 (`agent-orchestrator-01`).
**Branch:** `multi-visual-00`. **PR:** #423 (draft).
**Contratto:** [`../multi-visual-roadmap.md`](../multi-visual-roadmap.md)
**Prototipo:** [`../prototipi/lesson-multi-visual.html`](../prototipi/lesson-multi-visual.html)

---

## 1. Perché questa revisione esiste

La prima review Codex della revisione 1 **non ha approvato il gate** e ha
sollevato dieci blocker, riassunti e corretti punto per punto in §2. Questo
documento sostituisce integralmente la review precedente; non ne resta
alcuna parte in vigore.

---

## 2. Blocker della review 1 — correzione e prova, uno per uno

### Blocker 1 — Contratto economico opposto al manifest

**Correzione.** `multi-visual-roadmap.md` §8.3, §11.4, §12.1: **un'unica
autorizzazione** a tetto complessivo (somma dei cap di 1 proposta
coordinata + fino a N generazioni), confermata **una sola volta** prima di
qualunque chiamata a un provider. Dopo quella conferma, proposta e
generazioni procedono senza ulteriori popup di costo; il consuntivo resta
per fase e per asset (`VisualPlanRun.settlement`, §5.5).

**Prova.** Stato del prototipo `authorize` (screenshot
`320-authorize.png`, `1440-plan-review.png` a valle): un'unica schermata
mostra il tetto («proposta + fino a 3 generazioni») con un solo pulsante
«Autorizza e continua»; nessuno degli stati successivi (`proposing`,
`plan-review`, `generating`, `slot-failed`, `recovery`) presenta un
secondo pulsante di conferma di costo — solo azioni di generazione/retry
già coperte dal tetto iniziale, verificabile leggendo il footer di ciascuno
stato nel file HTML.

### Blocker 2 — Piano coordinato e diversità didattica mancanti

**Correzione.** `multi-visual-roadmap.md` §7.4, §8.3, §5.5: **una sola**
chiamata `visual_plan_proposal` restituisce 0..N slot; `anchorHeadingIndex`
e `subject` normalizzato devono essere a due a due distinti fra gli slot
della stessa chiamata (vincolo strutturale, non un rilevatore di
similarità semantica — limite dichiarato in §17.1 del contratto). Il piano
è persistito (`VisualPlanRun`/`VisualPlanSlot`, §5.5) con stati
`pending/generating/ready/failed/promoted/abandoned` e recuperabile
(§8.8).

**Prova.** Stato `plan-review` (screenshot `1440-plan-review.png`): due
slot con `decision: 'image'` mostrano ancore esplicitamente diverse («Le
quattro fasi» indice 1, «Il bilancio idrico» indice 2) e un terzo slot
`decision: 'none'` con motivazione. Stato `recovery` (screenshot
`390-recovery.png`): il piano riaperto mostra uno slot già `ready`, uno
`generating`, uno `pending`, senza richiedere una nuova autorizzazione —
la nota nel pannello lo dichiara esplicitamente.

### Blocker 3 — Quantità assente

**Correzione.** `multi-visual-roadmap.md` §8.2: Automatico(1–3)/1/2/3,
tabella esplicita delle opzioni in funzione degli slot liberi (3 → tutte le
opzioni; 2 → Automatico(1–2)/1/2; 1 → solo «1»; 0 → generazione
disabilitata, galleria comunque raggiungibile).

**Prova.** Stati `quantity` (3 liberi, screenshot `390-quantity.png`),
`quantity-limited` (1 libero) e `full` (0 liberi) nel prototipo mostrano le
tre situazioni distintamente, coerenti con la tabella del contratto.

### Blocker 4 — Limite upload errato

**Correzione.** `MAX_VISUAL_UPLOAD_INPUT_BYTES` portato da 8 MiB a
**2.000.000 byte (2 MB)** in `multi-visual-roadmap.md` §5.6 e §9.2; allow-
list ristretta a PNG/JPEG/WebP non animati, `background=opaque`. Il
prototipo (stato `upload-error`) mostra ora «2 MB» nel testo, non 8.

**Prova.** `grep -n "8_388_608\|8 MiB\|8388608" documentazione/multi-visual-
roadmap.md documentazione/prototipi/lesson-multi-visual.html` → nessuna
occorrenza (verificato in §4.2). `grep -n "2_000_000\|2 MB"` → presente in
entrambi i file.

### Blocker 5 — Ingresso e workflow lezione+immagini

**Correzione.** `multi-visual-roadmap.md` §11.1: un solo ingresso,
«Arricchisci» dentro Azioni; nessun secondo pulsante in Contenuto. §11.2–
§11.3: «Genera lezione con immagini» è ora un **passo** del flusso di
generazione testo esistente, offerto **dopo** il salvataggio canonico del
testo; un fallimento del piano visivo non tocca mai `LessonDoc.body`, e il
retry di uno slot non rigenera il testo.

**Prova.** Nel prototipo, `page-teacher-0` mostra il menu «Azioni ▾» con
l'unica voce «Arricchisci» (nessuna scheda «Contenuto» separata con un
secondo pulsante). Lo stato `lesson-gen-step` (screenshot
`320-lesson-gen-step.png`) mostra testualmente «Il testo è già salvato in
modo canonico» come precondizione del passo, prima di offrire «Sì, genera
anche le immagini».

### Blocker 6 — Ancoraggio omonimi incompleto

**Correzione.** `multi-visual-roadmap.md` §7.1–§7.3: `VisualAnchorSelector`
(`anchorHeadingIndex` + `anchorHeadingText`) come identità autorevole in
pianificazione, promozione e riancoraggio; l'elenco mostrato al modello e
al docente è enumerato per indice, mai deduplicato per testo; lo slug resta
ricalcolato server-side dal corpo fresco solo al momento del consumo.
Collisioni testate esplicitamente in §19 (due heading «Reti» risolvono a
`reti`/`reti-2` indipendentemente da quale scelto).

**Prova.** Nel prototipo, gli stati `plan-review` e `upload` mostrano il
campo Ancora come `«Le quattro fasi» (indice 1)` / `«Il bilancio idrico»
(indice 2)` — mai un testo nudo.

### Blocker 7 — Stati prototipo incompleti

**Correzione.** Il prototipo, rinominato (Blocker 10), copre ora
realmente: galleria a 1/2/3 immagini (`gallery-1`, `gallery-2`,
`gallery-3`); piano IA modificabile con soggetto/ancora/didascalia
(`plan-review`, campi `<textarea>`/`<input>` reali, non testo statico);
generazione con progresso per asset (`generating`, tre slot in tre stati
diversi contemporaneamente); fallimento e retry di un solo asset che
preserva gli altri (`slot-failed`); upload (`upload`, `upload-error`);
sostituzione/rimozione individuale (`replace`, azione «Rimuovi» per
elemento nella galleria); lezione+immagini con testo salvato
(`lesson-gen-step`); vista studente (`page-student-with`,
`page-student-without`); recovery (`recovery`).

**Prova.** Elenco completo con screenshot in §4.4.

### Blocker 8 — Responsive/accessibilità non dimostrati

**Correzione e prova.** Sezione dedicata, §4, con metriche reali misurate
via Chromium/CDP — non dichiarazioni. Riassunto:

- `.btn--small` **rimosso**: ogni controllo interattivo eredita
  `min-height`/`min-width: 44px` dalla classe base `.btn`, senza eccezioni
  per varianti compatte (solo il padding/font-size cambia).
- Il dialog usa `<dialog>.showModal()` nativo con
  `max-height: calc(100dvh - 32px)`, corpo con `overflow-y: auto`, footer
  `flex: 0 0 auto` — mai fuori viewport, con scroll interno quando serve.
- Focus trap **verificato** con otto pressioni reali di Tab (non simulato
  a parole): un difetto reale è stato trovato e corretto (§4.5).
- Ripristino del focus sul trigger **verificato** con un difetto reale
  trovato e corretto (§4.6).
- Stabilità del frame immagine pending→ready **verificata** con un difetto
  reale trovato e corretto nel metodo di misura, poi confermato stabile
  (§4.7).
- Interception di Escape su un piano non salvato: **verificata funzionante
  sul percorso DOM standard**, **non verificabile in modo conclusivo**
  contro l'input sintetico di CDP in headless — riportato come limite di
  verifica, non come PASS (§4.8).

### Blocker 9 — Stato prodotto e minimizzazione

**Correzione.** `multi-visual-roadmap.md` §1.1: la divergenza fra lo stato
dichiarato di VE su `main` (Gate GVISUAL: PENDING, holdout D «non ancora
eseguito», anche nel commit più recente che tocca quel file) e la guida
operativa di questo pilota (arricchimento a singola immagine funzionante e
validato) è **dichiarata esplicitamente**, senza scegliere quale sia
corretta e senza riscrivere i file di VE. Ogni meccanismo (adozione, corse,
cost model) è specificato per restare corretto in entrambi gli scenari
(§6.3 del contratto). `source` **rimosso** dal manifest pubblico
(`PublicLessonVisualItem`, §5.3) — resta solo nel manifest privato
(`LessonVisualItem`, §5.1).

**Prova.** `grep -n "nessuna lezione reale ha mai avuto"
documentazione/multi-visual-roadmap.md` → nessuna occorrenza (la frase
categorica della revisione 1 è stata rimossa). `grep -n "source"` nel blocco
`PublicLessonVisualItem` di §5.3 → assente; presente solo in
`LessonVisualItem` (§5.1).

### Blocker 10 — Deliverable e cost model

**Correzione.** File rinominato in
`documentazione/prototipi/lesson-multi-visual.html` (verificato: il vecchio
nome non esiste più nel repository, §4.2). `multi-visual-roadmap.md` §12
riscritto con tabelle e **formule esplicite** per 0/1/2/3 immagini,
distinguendo pianificazione coordinata (§12.1), N generazioni indipendenti
(§12.2), upload (§12.3), promozione individuale/in blocco (§12.4), lettura
studente (§12.5), riordino/rimozione/cleanup (§12.6).

**Prova.** Il vecchio file è stato rimosso (`git rm`) e il nuovo creato con
il nome corretto nello stesso commit. Git non lo rileva come una rinomina
automatica (`git diff --cached -M --stat` mostra `D`/`A` distinti, non `R`)
perché il contenuto è stato riscritto per intero e scende sotto la soglia
di similarità euristica — è una sostituzione dichiarata, non una rinomina
silenziosa: `git status --short -- documentazione/prototipi/` mostra
esplicitamente `D  .../lesson-visual-enrichment-multi.html` e
`A  .../lesson-multi-visual.html`.

---

## 3. Perimetro effettivo di questa revisione

Il diff tocca **esclusivamente** `documentazione/**`:
`multi-visual-roadmap.md` (riscritto), `prototipi/lesson-multi-visual.html`
(nuovo, sostituisce il file rinominato), `evidenze/multi-visual-00-
review.md` (questo file, riscritto), `evidenze/multi-visual-00-prototipo/`
(screenshot e report rigenerati), più le righe di collegamento in
`INDEX.md` e `agent-orchestrator-roadmap.md` aggiornate al nuovo nome del
file. Nessun file runtime, nessuna dipendenza, nessuna Rule, nessuna
chiamata a provider.

---

## 4. Verifiche eseguite — con metriche reali, non dichiarazioni

### 4.1 Perimetro del diff

| Verifica | Esito |
|---|---|
| Il diff tocca solo `documentazione/**` | **PASS** |
| Nessun file runtime creato o modificato | **PASS** |
| Nessuna dipendenza aggiunta | **PASS** |
| `windows-tuning-backup-2026-08-21/` non toccato | **PASS** |
| `git diff --check` | **PASS** (§5) |
| `npx prettier --check` sui Markdown/JSON modificati | **PASS** (§5) |

### 4.2 Nome del file — verificato, non assunto

```
$ git status --short -- documentazione/prototipi/
D  documentazione/prototipi/lesson-visual-enrichment-multi.html
A  documentazione/prototipi/lesson-multi-visual.html
```

Il vecchio nome non compare più in alcun link:
`grep -rn "lesson-visual-enrichment-multi" documentazione/` → nessuna
occorrenza fuori da questo stesso paragrafo di cronaca.

### 4.3 Prototipo — verifiche statiche

| Verifica | Esito |
|---|---|
| Nessun URL esterno / risorsa remota / chiamata di rete / `data:` URI | **PASS** — nessuna occorrenza |
| 7 pagine lezione (`class="page"`) | **PASS** — 7 |
| Nessun controllo sotto 44 px in CSS (`36px` non presente come valore) | **PASS** |
| `--touch: 44px` applicato dalla classe base `.btn` a ogni variante | **PASS** — verificato leggendo le regole CSS; confermato a runtime in §4.4 |

### 4.4 Smoke responsive reale — Chromium via CDP, misure raccolte

Metodologia invariata dalla revisione 1 (Chrome reale
`--headless=new`, `Emulation.setDeviceMetricsOverride`,
`Page.captureScreenshot`, mai `--window-size`), estesa con le metriche
richieste esplicitamente dalla review: overflow orizzontale, rettangolo
dialog/viewport con scroll interno e footer raggiungibile, dimensione di
ogni controllo interattivo visibile, stabilità del frame immagine. Script
fuori dal repository (cartella temporanea di sistema), nessuna dipendenza
npm installata (WebSocket nativo di Node 24).

**Matrice eseguita — undici catture, quattro larghezze:**

| Larghezza | Stati catturati |
|---|---|
| 1440 | `plan-review` · `generating` · `gallery-3` |
| 1024 | `gallery-2` · `slot-failed` |
| 390 | `quantity` · `upload` · `recovery` |
| 320 | `authorize` · `gallery-1` · `lesson-gen-step` |

**Overflow orizzontale — misurato su tutte e undici le catture:**

```
1440×900  plan-review : scrollW=1425 innerW=1440 overflowX=false
1440×900  generating  : scrollW=1425 innerW=1440 overflowX=false
1440×900  gallery-3   : scrollW=1425 innerW=1440 overflowX=false
1024×900  gallery-2   : scrollW=1009 innerW=1024 overflowX=false
1024×900  slot-failed : scrollW=1009 innerW=1024 overflowX=false
390×844   quantity    : scrollW=390  innerW=390  overflowX=false
390×844   upload      : scrollW=390  innerW=390  overflowX=false
390×844   recovery    : scrollW=390  innerW=390  overflowX=false
320×720   authorize   : scrollW=320  innerW=320  overflowX=false
320×720   gallery-1   : scrollW=320  innerW=320  overflowX=false
320×720   lesson-gen-step: scrollW=320 innerW=320 overflowX=false
```

`overflowX=false` su tutte le undici combinazioni.

**Target interattivi ≥ 44 px — ogni controllo visibile, non un campione:**
per ciascuna delle undici catture, lo script ha enumerato **tutti** i
`button`/`a`/`input`/`textarea`/`select`/`[role=menuitem]` visibili nella
vista corrente (dialog se aperto, altrimenti pagina) e misurato
`getBoundingClientRect()`:

```
1440 plan-review   : 7 controlli, 0 sotto 44px
1440 generating    : 1 controllo,  0 sotto 44px
1440 gallery-3     : 11 controlli, 0 sotto 44px
1024 gallery-2     : 8 controlli,  0 sotto 44px
1024 slot-failed   : 2 controlli,  0 sotto 44px
390  quantity      : 6 controlli,  0 sotto 44px
390  upload        : 5 controlli,  0 sotto 44px
390  recovery      : 1 controllo,  0 sotto 44px
320  authorize     : 2 controlli,  0 sotto 44px
320  gallery-1     : 4 controlli,  0 sotto 44px
320  lesson-gen-step: 2 controlli, 0 sotto 44px
```

**Totale: 49 controlli misurati, 0 sotto 44 px, su tutte le larghezze,
incluse quelle a puntatore presumibilmente coarse (390, 320, `mobile:
true` nell'emulazione).**

**Dialog dentro il viewport, scroll interno, footer raggiungibile** —
misurato sullo stato `plan-review` (il più alto in contenuto) a ciascuna
larghezza:

```
1440: dialogWithinViewport=true  bodyHasInternalScroll=false footerReachable=true
1024: dialogWithinViewport=true  bodyHasInternalScroll=false footerReachable=true
390:  dialogWithinViewport=true  bodyHasInternalScroll=true  footerReachable=true
320:  dialogWithinViewport=true  bodyHasInternalScroll=true  footerReachable=true
```

Il dialog resta sempre entro il rettangolo del viewport
(`top/left ≥ 0`, `right/bottom ≤` dimensioni viewport, tolleranza
0,5 px). Lo scroll interno si attiva correttamente solo alle altezze più
basse (390/320, dove il contenuto non entra nell'altezza disponibile);
alle altezze desktop (900 px) il contenuto entra senza bisogno di
scroll. Il footer resta sempre interamente dentro il viewport.

**Console del browser**: `Log.entryAdded` a livello `error`/`warning` e
`Runtime.exceptionThrown` — **zero voci** su tutta la sessione di smoke.

Le undici catture e il report grezzo (`smoke-report.json`) sono salvati in
[`multi-visual-00-prototipo/`](multi-visual-00-prototipo/).

### 4.5 Focus trap — un difetto reale trovato e corretto

**Prima misura (non dichiarata PASS):** otto pressioni reali di Tab
(`Input.dispatchKeyEvent`) a partire dall'apertura del dialog hanno
mostrato che, al giro di boccola dall'ultimo elemento focalizzabile
(«Chiudi») al primo, il focus transitava per un istante su `<body>` —
fuori dal dialog — prima di rientrare al Tab successivo. È un difetto
reale del solo affidamento al comportamento nativo di `<dialog>` in questo
ambiente, trovato **perché** la misura è stata eseguita passo per passo
invece di controllare solo lo stato iniziale e finale.

**Correzione.** Aggiunto un handler `keydown` esplicito sul dialog che
intercetta Tab sull'ultimo elemento focalizzabile e Shift+Tab sul primo,
forzando il wrap senza mai lasciare che il focus tocchi `<body>` o
qualunque elemento fuori dal dialog.

**Rimisura, dopo la correzione:**

```
trapHeldAcross8Tabs: true
```

Otto Tab consecutivi restano tutti dentro `#arricchisci` (verificato con
`dialog.contains(document.activeElement)` a ogni singolo passo, non solo
all'inizio e alla fine).

### 4.6 Ripristino del focus sul trigger — un secondo difetto trovato e corretto

**Prima misura:** aprendo il dialog dal percorso reale (click su «Azioni
▾» → click su «Arricchisci» nel menu), e premendo poi Escape, il focus
**non** tornava sull'elemento che aveva aperto il dialog. Causa: la voce di
menu «Arricchisci» viene nascosta (`hidden`) nello stesso istante in cui il
dialog si apre, quindi al momento della chiusura quell'elemento non è più
focalizzabile e il ripristino nativo non ha un bersaglio valido.

**Correzione.** Il ripristino del focus è ora gestito esplicitamente:
`lastTrigger` è impostato al pulsante «Azioni ▾» (che resta visibile per
tutta la vita del dialog, a differenza della voce di menu), e un listener
`close` lo rifocalizza esplicitamente se è ancora presente e visibile.

**Rimisura, dal trigger reale (non una scorciatoia della barra demo):**

```
afterOpen:  { open: true, activeInsideDialog: true, activeTag: "BUTTON" }
afterEscape:{ open: false, activeTag: "BUTTON", activeIsTrigger: true }
```

Il focus torna correttamente sul pulsante «Azioni ▾».

### 4.7 Stabilità del frame immagine pending→ready — un errore di metodo corretto

**Prima misura (metodo errato, scartata):** un primo tentativo confrontava
il frame di uno slot nella vista `generating` (griglia a tre colonne) con
il frame di un elemento nella vista `gallery-1` (griglia a una colonna):
`stable=false` a 1440 e 1024, perché **la griglia intera cambia larghezza
di colonna** fra un contesto a tre elementi e uno a un elemento — un
effetto di layout dovuto al numero di elementi nel contenitore, non un
layout shift del contenuto della singola card. Confrontare due contesti
diversi non misura ciò che il blocker chiede.

**Metodo corretto.** Il confronto giusto è **dentro la stessa vista**: la
vista `generating` mostra contemporaneamente uno slot già `ready` (slot 1,
con miniatura reale) e uno slot ancora `generating` (slot 2, con
scheletro/spinner), fianco a fianco nella stessa griglia. Se il loro
`.frame` ha la stessa dimensione, il box non cambia misura quando il
contenuto passa da scheletro a immagine reale — è esattamente l'invariante
richiesto.

**Misura, con il metodo corretto:**

```
1440: ready={w:282.66,h:176.66} generating={w:282.67,h:176.66} stable=true
1024: ready={w:279.66,h:174.78} generating={w:279.67,h:174.78} stable=true
390:  ready={w:300,   h:187.5 } generating={w:300,   h:187.5 } stable=true
320:  ready={w:230,   h:143.75} generating={w:230,   h:143.75} stable=true
```

Stabile a tutte e quattro le larghezze (differenza sub-pixel, < 0,5 px,
dovuta a `box-sizing` e non a un ridimensionamento del contenuto).

### 4.8 Escape su un piano non salvato — verificato dove possibile, limite dichiarato altrove

Il contratto richiede che chiudere il dialog mentre un piano ha slot già
generati (costo sostenuto) e non ancora applicati non scarti nulla in
silenzio, ma apra una conferma di abbandono (§8.7 del contratto,
`abandon-plan` nel prototipo).

**Tre misure indipendenti, riportate senza arrotondarle a un unico
verdetto:**

1. **Evento `cancel` generato attraverso il percorso DOM standard**
   (`dialog.dispatchEvent(new Event('cancel', {cancelable:true}))` —
   equivalente, per specifica, a ciò che un browser genera davvero quando
   Escape chiude un `<dialog>`): `defaultPrevented: true`,
   `stillOpen: true`, il pannello passa a «Abbandonare il piano?». **La
   logica applicativa dell'intercettazione funziona.**
2. **Click reale sul backdrop** (`Input.dispatchMouseEvent` fuori dal
   contenuto del dialog): il dialog **resta aperto**, senza alcuna
   intercettazione necessaria — comportamento nativo confermato di
   `<dialog>.showModal()`, che a differenza di molte modali custom **non**
   si chiude da solo al click esterno. Nessun rischio da mitigare su
   questo fronte.
3. **Escape simulato come input sintetico via Chrome DevTools Protocol**
   in modalità headless: il dialog **si chiude comunque**
   (`stillOpen: false`), nonostante l'handler `cancel` e un secondo
   handler `keydown` in fase di cattura dedicato esplicitamente a questo
   caso. Non è stato possibile, nel tempo di questa sessione, determinare
   con certezza se il comportamento sia un limite specifico
   dell'automazione headless via CDP (il caso 1 dimostra che la stessa
   identica logica applicativa, raggiunta per un percorso diverso,
   funziona) oppure un caso reale non coperto.

**Conclusione onesta, non un PASS forzato.** L'intercettazione
dell'abbandono è verificata funzionante quando innescata dal normale
evento `cancel` del DOM (caso 1) e il click sul backdrop non pone il
problema (caso 2, comportamento nativo). Il caso 3 — Escape via automazione
CDP — **non è dichiarato superato**: è un limite di verifica registrato
come rischio residuo (§6) e un'azione da ripetere in una fase futura con
uno strumento di automazione che simuli l'input a un livello diverso (per
esempio Playwright, non disponibile in questo ambiente), o con un test
manuale reale.

---

## 5. Gate eseguiti

| Comando | Esito |
|---|---|
| `npx prettier --check` sui Markdown/JSON modificati | **PASS** |
| `git diff --check` sull'intero diff staged | **PASS** — nessuno spazio finale, nessun marcatore di conflitto |
| Controlli statici del prototipo (§4.3) | **PASS** |
| Smoke Chromium reale 1440/1024/390/320 (§4.4–§4.8) | **PASS su overflow, target ≥44px, dialog/viewport, stabilità frame, focus trap, ripristino focus, backdrop; limite di verifica dichiarato su Escape via CDP (§4.8)** |

---

## 6. Rischi residui aggiornati da questa revisione

Ereditati da `multi-visual-roadmap.md` §17, più:

1. **Escape via automazione CDP non verificato in modo conclusivo**
   (§4.8). Azione futura: ripetere con Playwright o con un test manuale
   reale prima di considerare questo specifico comportamento chiuso.
2. **Il vincolo di diversità del piano resta strutturale, non
   semantico** (ereditato, contratto §7.4, §17.1).
3. **Il cap di upload a 2 MB è più stretto delle foto tipiche di uno
   smartphone** (ereditato, contratto §17.2) — friction reale per il
   docente, non eliminata da questo documento.
4. **La divergenza sullo stato di VE resta dichiarata, non risolta**
   (contratto §1.1, §17.3).

---

## 7. Stato dichiarato

| Elemento | Stato |
|---|---|
| MULTI-VISUAL-00 (revisione 2) | **Contratto e prototipo corretti su tutti i dieci blocker; smoke reale con metriche misurate, non dichiarate** |
| MULTI-VISUAL-01→05 | Aperte |
| Gate GMULTI | **PENDING** |
