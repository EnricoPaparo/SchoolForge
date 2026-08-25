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

## 7. Stato dichiarato (dopo la revisione 2)

| Elemento | Stato |
|---|---|
| MULTI-VISUAL-00 (revisione 2) | **Contratto e prototipo corretti su tutti i dieci blocker UX/workflow; smoke reale con metriche misurate, non dichiarate** |
| MULTI-VISUAL-01→05 | Aperte |
| Gate GMULTI | **PENDING** |

---

## 8. Revisione 3 — blocker architetturali, correzione e prova

La seconda review Codex ha approvato l'esito UX della revisione 2 (§1–§7)
ma respinto **dieci blocker architetturali**, tutti sul contratto
(`multi-visual-roadmap.md`): nessuno riguardava il prototipo, e infatti
questa revisione non lo tocca (verificato in §9.2). Correzione e prova per
ciascuno, con riferimento a `multi-visual-roadmap.md` §21 per la sintesi
puntuale corrispondente.

### Blocker 1 — Migrazione fail-closed

**Correzione.** §6.1 riscritto: la coesistenza di `visuals` e `visual` non
è più un caso ignorato in silenzio, ma `visual_legacy_conflict` — zero
rendering, zero scritture automatiche, nessuna scelta euristica. Matrice
completa 3×3 (assente/valido/malformato per ciascun campo) esplicitata in
tabella. §6.2 aggiunge il controllo come passo 0 dell'adozione, prima di
ogni altro passo.

**Prova.** `grep -n "visual_legacy_conflict" documentazione/multi-visual-
roadmap.md` → presente in §6.1 (definizione, matrice, effetti), §6.2 (passo
0 dell'adozione), §6.3 (fail-closed su forma inattesa), §5.5
(`corrupted_state` per il piano, stesso principio). La tabella della
matrice in §6.1 elenca tutte e nove le celle esplicitamente, con le tre
celle di conflitto marcate identiche indipendentemente dalla validità
individuale dei campi.

### Blocker 2 — Forma chiusa del piano

**Correzione.** §5.5 riscritto: `VisualPlanRun` dichiara ora `ownerUid`,
`programId`, `importId`, `lessonId`, `publicLessonId`, `udaDir`,
`requestId`, `planHash`, ciascuno con un commento che ne dichiara la fonte
autorevole (mai il payload client nudo). Percorso del documento dichiarato
esplicitamente (`visualPlanRuns/{opaquePlanId}`). Nuovo paragrafo dedicato
a «record presente ma divergente o malformato ⇒ `corrupted_state`, mai
assenza o replay».

**Prova.** Lettura diretta di §5.5: ogni campo di identità ha un commento
`/** ... Fonte autorevole: ... */` che dichiara da dove viene e perché non
è il payload grezzo. Il paragrafo finale di §5.5 enumera esplicitamente i
quattro casi (assente / valido e coincidente / valido ma divergente /
strutturalmente invalido) con l'esito distinto per ciascuno.

### Blocker 3 — Budget e retry riconciliati

**Correzione.** Costante rinominata `VISUAL_PLAN_MAX_ATTEMPTS_PER_SLOT`
(era `VISUAL_PLAN_MAX_GENERATION_ATTEMPTS_PER_SLOT`). Formula del tetto in
§12.1 corretta a `proposalCap + generationCap × ceiling ×
maxAttemptsPerSlot`. §8.5 non propone più «una conferma singola aggiuntiva»
oltre il tetto di tentativi: lo slot diventa terminale per quel piano, e un
ulteriore tentativo richiede un piano nuovo. §8.7 corretto per il caso
«tutti gli slot esauriti, zero promossi».

**Prova.** `grep -n "maxAttemptsPerSlot\|totalReserved(ceiling)"
documentazione/multi-visual-roadmap.md` mostra la formula corretta in §5.5
e §12.1, con la tabella `ceiling = 1/2/3` ricalcolata (`× 2` per i
tentativi). `grep -n "propria, singola.*conferma"` non trova più
occorrenze nel testo attivo di §8.5 (resta solo nella frase che la
descrive come **respinta** dalla review, dentro il paragrafo di
correzione).

### Blocker 4 — Race body/ancora

**Correzione.** §7.2 diviso in 7.2.1 (promozione/riancoraggio: fail-closed,
`visual_promotion_anchor_stale`, zero scritture) e 7.2.2 (dopo una
promozione già avvenuta: coda invariata da VE §5.3). I test di §19
corretti: il fallback non è più atteso alla promozione, solo al rendering
successivo a una promozione riuscita.

**Prova.** `grep -n "visual_promotion_anchor_stale"
documentazione/multi-visual-roadmap.md` → presente in §7.2.1 e nel test
corrispondente di §19. Il paragrafo §7.2.2 dichiara esplicitamente «Questo
caso **non** rientra in §7.2.1: nessuna scrittura è in corso in quel
momento».

### Blocker 5 — Documento byte pubblico e Rules

**Correzione.** §5.4: `PublicLessonVisualBytesDoc` porta ora
`publicLessonId`/`programId`/`importId` a livello di documento e
`width`/`height` per ogni asset. Nuovo §5.4.1 con le Rules in pseudocodice:
owner-only per il docente; per lo studente, guardie di scoperta +
`completed:true` + manifest valido + **corrispondenza esatta** delle
chiavi `bytes` con gli assetId pubblici + identità e dimensioni coerenti;
scrittura client sempre negata.

**Prova.** Lettura di §5.4: l'interfaccia TypeScript include i tre campi di
identità e, per asset, `width`/`height` accanto a `dataUri`/`mimeType`.
§5.4.1 contiene un blocco Rules-like con le sei condizioni numerate per
`isStudentAllowedToRead`. §19 elenca la lista di test Emulator richiesta
dal blocker (aggiunta/rimozione/sostituzione, chiave extra, chiave
mancante, asset estraneo, `completed:false`, import inattivo, identità
divergente) — verificato che tutte e sette le voci siano presenti come
punti elenco distinti.

### Blocker 6 — Export davvero multi

**Correzione.** Nuovo §14.2: `AiVisualExportBatchResult` chiuso, per
lezione `{ status: 'absent' }` o `{ status: 'present', assets: [...] }`
con `assets` da 1 a 3 elementi nell'ordine del manifest; validazione
all-or-nothing estesa all'insieme; dedup sull'intero batch; compatibilità
con la forma singolare via `adaptSingular`, senza forzare un'adozione;
requisito esplicito che il composer web iteri `assets` per intero.

**Prova.** `grep -n "AiVisualExportAsset\|status: 'present'"
documentazione/multi-visual-roadmap.md` → tipi presenti in §14.2 con
`assets: AiVisualExportAsset[]`. Il paragrafo «Composer web» dichiara
esplicitamente: «Un composer che si fermasse al primo elemento
produrrebbe uno ZIP strutturalmente valido ma silenziosamente
incompleto».

### Blocker 7 — Cleanup lezione/UDA/corso

**Correzione.** Nuovo §8.12: `VisualCleanupRecoveryRecord` chiuso (un
record per lezione, array di `assetIds`/`storageRefs`), procedura in
cinque passi con letture sempre prima delle scritture, divieto esplicito
di delete per prefisso a livello di lezione o UDA (motivato in §8.12.3,
con l'unica eccezione dichiarata per corso/import via
`deleteImportPrefix`), chunking ≤100 lezioni, formule di costo con delta
esplicito sul baseline di VE-03.

**Prova.** `grep -n "aiVisualCleanupForDelete\|nessun delete per prefisso"
documentazione/multi-visual-roadmap.md` → §8.12 presente con la procedura
completa. §8.12.3 («Perché mai un delete per prefisso») argomenta
esplicitamente la distinzione fra lezione/UDA (sempre enumerazione
esplicita) e corso/import (unica eccezione, già autorevole in VE).

### Blocker 8 — Cost model basato sui numeri misurati VE

**Correzione.** Nuovo §12.0: tabella con i dieci numeri misurati di
VE-03 (`visual-enrichment-roadmap.md` §15.5), citati testualmente. Ogni
tabella successiva di §12 dichiara se è misurata (promozione, rimozione,
delete lezione/UDA — stesso conteggio del baseline, perché la stessa
classe di operazione) o stimata (piano, generazione, upload, cleanup piano
scaduto — nessun equivalente in VE-03). Prenotazione e run del piano
contati come 2 scritture Firestore distinte.

**Prova.** Confronto diretto fra la tabella di §12.0 e i numeri citati
nella richiesta della review (promozione 9R/3W+1R/1W/1D; rimozione
7R/6W+1D; delete lezione 7R/5W+1D; delete UDA 3 lezioni 21R/15W+3D) —
identici, citati come tali. `grep -c "STIMATO\|misurato" documentazione/
multi-visual-roadmap.md` conferma l'etichettatura sistematica presente in
tutte le intestazioni di sottosezione di §12.

### Blocker 9 — Diversità didattica

**Correzione.** §7.4 riscritto: `anchorHeadingIndex` uguale non è più, da
solo, un blocco strutturale. Il controllo lessicale si applica a `subject`
**e** `rationale` (nuovo), indipendentemente dall'ancora. Il paragrafo apre
riconoscendo esplicitamente che il prototipo (`page-teacher-2`) già
mostrava due immagini sulla stessa ancora, e che vietarlo per costruzione
avrebbe contraddetto il prototipo stesso.

**Prova.** Lettura di §7.4: la frase «`anchorHeadingIndex` NON è più, da
solo, un blocco» è esplicita. Il test corrispondente in §19 include ora un
caso **positivo** con ancora condivisa e subject/rationale distinti,
assente nella revisione 2.

### Blocker 10 — Evidenza e smoke

**Correzione e prova**, in questa sezione e nella successiva (§9).

---

## 9. Gate eseguiti — revisione 3

### 9.1 Filename e link

`grep -rn "lesson-visual-enrichment-multi" documentazione/` trova
occorrenze **solo** dentro la cronaca della revisione 2 (questa stessa
sezione §2 e le righe che citano l'output di `git status` della rinomina)
— nessun link attivo residuo. Il prototipo resta
`documentazione/prototipi/lesson-multi-visual.html`, referenziato
correttamente dal contratto (intestazione e §21) e da questo documento.

### 9.2 Prototipo — confermato invariato, non assunto

```
$ git diff --stat -- documentazione/prototipi/lesson-multi-visual.html
(nessun output)
```

Zero byte modificati rispetto al commit della revisione 2. Nessuno dei
dieci blocker architetturali di questa revisione richiedeva un cambiamento
di interfaccia: sono tutti concentrati sul contratto (forme dati,
transazioni, Rules, cost model). Di conseguenza **lo smoke Chromium/CDP
reale della revisione 2 (§4) resta l'evidenza valida**: rieseguirlo contro
un file bit-per-bit identico non misurerebbe nulla di nuovo, e ripeterlo
solo per produrre un secondo screenshot identico sarebbe evidenza
decorativa, non verifica. Questo paragrafo esiste per rendere quella
scelta verificabile — un `git diff --stat` a zero righe, non un'asserzione.

### 9.3 Gate testuali

| Comando | Esito |
|---|---|
| `npx prettier --check` su `multi-visual-roadmap.md` e su questo file | **PASS** |
| `git diff --cached --check` sull'intero diff della revisione 3 | **PASS** — nessuno spazio finale, nessun marcatore di conflitto |
| Sanity check sui marcatori di sezione (`grep -c "^## "` / `"^### "`) | 21 sezioni di secondo livello, 62 di terzo — nessun errore di annidamento rilevato in lettura |

### 9.4 Che cosa NON è stato verificato in questa revisione — dichiarato, non nascosto

Nessuna riga di questa revisione ha eseguito codice contro un Firestore o
Storage Emulator reale: tutte le correzioni sono a un contratto
documentale, non a un'implementazione (§1 del contratto — nessun runtime
in questo pilota). Di conseguenza:

- **i numeri "STIMATO" di `multi-visual-roadmap.md` §12.1–§12.3, §12.7**
  (piano, generazione, upload, cleanup del piano scaduto) restano stime
  derivate dal baseline misurato di VE-03, **non misure**: nessuna riga di
  questa revisione le ha eseguite contro un Emulator, e il contratto lo
  dichiara esplicitamente in ogni intestazione di sottosezione, non solo
  qui;
- **le Rules di §5.4.1 sono pseudocodice congelato, non ancora tradotto in
  `firestore.rules` reali né eseguito contro l'Emulator delle Rules**: i
  sette test elencati in §19 del contratto sono **richiesti**, non
  **eseguiti** — restano un impegno per MULTI-VISUAL-03, non un'evidenza di
  questa fase;
- **l'export v2 (§14.2) e il cleanup generalizzato (§8.12) sono contratti
  di interfaccia, non implementazioni**: nessuna callable con questi nomi
  esiste nel repository oggi.

Questa sezione esiste perché la review ha esplicitamente chiesto di non
sovradichiarare: i rischi residui aggiornati (§10) elencano queste stesse
lacune come tali, non come dettagli minori.

---

## 10. Rischi residui — aggiornati dopo la revisione 3

Ereditati da §6 (revisione 2) e da `multi-visual-roadmap.md` §17, più:

1. **Nessuno dei numeri "STIMATO" del cost model (§12.1–§12.3, §12.7 del
   contratto) è stato verificato contro un Emulator reale.** Sono
   derivazioni disciplinate dal baseline misurato di VE-03, non misure
   indipendenti — potrebbero rivelarsi imprecise una volta implementate
   (per esempio se il ledger di budget AIGEN richiede più di una scrittura
   per settlement).
2. **Le Rules di §5.4.1 sono pseudocodice, non ancora eseguito contro
   l'Emulator delle Rules.** I sette scenari di test elencati in §19 del
   contratto sono un impegno per una fase implementativa, non un'evidenza
   già raccolta.
3. **Il vincolo di diversità didattica (§7.4 del contratto) resta
   lessicale, non semantico**, anche dopo la correzione del Blocker 9: due
   soggetti descritti con parole del tutto diverse ma la stessa idea
   restano indistinguibili dai soli controlli su `subject`/`rationale`. Il
   backstop dichiarato è la revisione gratuita del piano (§8.4), non un
   meccanismo automatico.
4. **Escape via automazione CDP non verificato in modo conclusivo**
   (§4.8, ereditato dalla revisione 2, non toccato da questa).
5. **Il cap di upload a 2 MB resta più stretto delle foto tipiche di uno
   smartphone** (ereditato).
6. **La divergenza sullo stato di VE resta dichiarata, non risolta**
   (ereditata).

---

## 11. Stato dichiarato (dopo la revisione 3)

| Elemento | Stato |
|---|---|
| MULTI-VISUAL-00 (revisione 3) | **Contratto corretto su tutti i dieci blocker architetturali della seconda review; prototipo confermato invariato (zero modifiche richieste); nessuna verifica Emulator eseguita in questa fase — dichiarato esplicitamente, non nascosto** |
| MULTI-VISUAL-01→05 | Aperte |
| Gate GMULTI | **PENDING** |

---

## 12. Revisione 4 — coerenza e idempotenza, correzione e prova

La terza review Codex ha trovato **sei difetti di coerenza/idempotenza**
sopravvissuti alla revisione 3 — tutti sul contratto, nessuno sul
prototipo (confermato in §13.1). Correzione e prova per ciascuno,
riferimento a `multi-visual-roadmap.md` §22 per la sintesi puntuale.

### Punto 1 — Replay del piano dopo le sue stesse promozioni

**Correzione.** §10.1 riscritto: `planHash` calcolato una sola volta, alla
creazione, da destinazione completa + stato iniziale; mai ricalcolato
contro il mondo attuale. Un replay valida identità persistita contro
richiesta corrente. Nuovo §10.1.1 per la guardia sul mondo mutabile
(coerenza dell'array), separata e applicata solo alla scrittura.

**Prova.** `grep -n "planHash = SHA-256" documentazione/multi-visual-
roadmap.md` mostra la formula con tutti e cinque i campi di destinazione
(`ownerUid, programId, importId, lessonId, publicLessonId`) più
`sourceBodyHash`/`existingItemAssetIds`/`quantity` iniziali — assenti
nella formula (ma non nel commento) della revisione 3. Il paragrafo «Un
record presente ma divergente...» dichiara esplicitamente: «il giudizio
non confronta più nulla contro una rilettura del mondo attuale». Nuovo
campo `VisualPlanSlot.promotedAssetId` verificabile in §5.5.

### Punto 2 — Un solo piano attivo non era garantito

**Correzione.** Nuovo §10.3: lease deterministico
`visualPlanLeases/{SHA-256(ownerUid,lessonId)}`, mai derivato dal
`requestId`. Acquisizione nella stessa transazione della prenotazione;
Race A e Race B esplicite; riacquisizione condizionata per lease scaduto;
`corrupted_state` per lease malformato.

**Prova.** `grep -n "leaseId = SHA-256" documentazione/multi-visual-
roadmap.md` conferma che il percorso dipende da `(ownerUid, lessonId)`,
non da `requestId`. Il paragrafo «Perché questo, e non un campo su
LessonDoc» e le due race esplicite («Race A», «Race B») sono presenti per
nome in §10.3.

### Punto 3 — Upload senza contratto di idempotenza

**Correzione.** Nuovi §9.6–§9.9: `VisualUploadRun` indipendente dal piano,
`requestId` stabile, replay/conflitto, promozione che riusa §8.6 producendo
`source: 'uploaded'`/`styleVersion: 'uploaded/v1'`, cap combinato di tre,
nessuna partecipazione al lease, abbandono senza conferma bloccante,
cleanup TTL.

**Prova.** `grep -n "interface VisualUploadRun" documentazione/multi-
visual-roadmap.md` → forma chiusa presente in §9.6 con tutti i campi di
identità, `rawBytesSha256`, `normalized`. §9.7 contiene sia il caso di
replay sia `visual_upload_conflict` per byte/ancora divergenti sotto lo
stesso `requestId`.

### Punto 4 — Rules con primitive reali

**Correzione.** §5.4.1 riscritto con `isOwner()` (globale, single-tenant)
al posto di `isOwnerOfLesson`/`lessonIdOf` (inventate); guardie di
scoperta espanse negli helper reali (`isApprovedStudent`, `isClassmateOf`,
`activeImportId`, `examModeAppliesToClass`, citati da `sicurezza.md` §170).
Nuovo §5.4.2: `bytesKeysAndDimsMatch` a rami espliciti 1/2/3. Nuovo §5.4.3:
costo dichiarato dei `get()`.

**Prova.** `grep -n "lessonIdOf\|assetIdsOf(.*\.toSet" documentazione/
multi-visual-roadmap.md` → nessuna occorrenza fuori dalla cronaca delle
correzioni (§22). `grep -c "items.size() =="
documentazione/multi-visual-roadmap.md` → 3 occorrenze in §5.4.2, una per
cardinalità.

### Punto 5 — Export all-or-nothing del batch

**Correzione.** §14.2 corretto: un asset invalido in una qualunque lezione
aborte l'intera callable prima di produrre output. Procedura a due fasi.
Composer corretto per attendere l'intero export multi-batch.

**Prova.** Il paragrafo «Validazione all-or-nothing sull'INTERO batch, non
lezione per lezione» dichiara esplicitamente il comportamento corretto e
cita perché quello della revisione 3 era ambiguo. Il test dedicato in §19
(«tre lezioni nel batch, un asset non recuperabile nella seconda») verifica
che né la prima né la terza lezione compaiano in un output parziale.

### Punto 6 — Test e costi delle nuove guardie

**Correzione e prova**, in questa sezione e nella successiva (§13).

---

## 13. Gate eseguiti — revisione 4

### 13.1 Prototipo — confermato bit-per-bit invariato, con hash

**Corretto rispetto al metodo della revisione 3** (che si affidava solo a
`git diff --stat`): questa volta anche uno SHA-256 indipendente dal diff.

```
$ git diff --stat -- documentazione/prototipi/lesson-multi-visual.html
(nessun output)

$ git show HEAD:documentazione/prototipi/lesson-multi-visual.html | sha256sum
5af7553ae4f5ee7a2ec4d09182595db8062ece955e1da21035ff21777bcb5c2a *-

$ sha256sum documentazione/prototipi/lesson-multi-visual.html
5af7553ae4f5ee7a2ec4d09182595db8062ece955e1da21035ff21777bcb5c2a *documentazione/prototipi/lesson-multi-visual.html
```

Hash identico fra la copia già committata e quella sul disco: zero byte
modificati. Nessuno dei sei difetti di questa revisione riguardava
l'interfaccia — tutti architetturali sul contratto (identità del piano,
lease, upload, Rules, export). Lo smoke reale della revisione 2 (§4) resta
l'evidenza valida per il prototipo; non è stato rieseguito perché non ci
sarebbe nulla di nuovo da misurare, e questa volta la prova non è solo un
diff a zero righe ma anche una corrispondenza di hash indipendente.

### 13.2 Gate testuali

| Comando | Esito |
|---|---|
| `npx prettier --check` su `multi-visual-roadmap.md` e su questo file | **PASS** |
| `git diff --cached --check` sull'intero diff della revisione 4 | **PASS** — nessuno spazio finale, nessun marcatore di conflitto |
| Confronto SHA-256 del prototipo (§13.1) | **PASS** — hash identico |

### 13.3 Che cosa NON è stato verificato in questa revisione

Come nelle revisioni precedenti, nessuna riga ha eseguito codice contro un
Firestore/Storage Emulator reale: tutte le correzioni sono al contratto.
In aggiunta a quanto già dichiarato in §9.4:

- **il lease (§10.3) non è stato eseguito contro un Emulator**: le due
  race (A e B) sono descritte e testate *sulla carta* (§19 del contratto),
  non misurate contro transazioni concorrenti reali;
- **`VisualUploadRun` (§9.6–§9.9) non ha alcuna implementazione**: è un
  contratto di interfaccia, come l'export v2 e il cleanup generalizzato
  già dichiarati non implementati in §9.4;
- **`bytesKeysAndDimsMatch` (§5.4.2) non è stato tradotto in
  `firestore.rules` reali**: resta pseudocodice verificato per
  leggibilità e assenza di primitive CEL impossibili, non per esecuzione.

---

## 14. Rischi residui — aggiornati dopo la revisione 4

Ereditati da §10 (revisione 3), più:

1. **Il lease deterministico (§10.3) introduce un nuovo singolo punto di
   contesa per lezione**: ogni autorizzazione di piano, indipendentemente
   da quante ce ne sono state prima, transita per lo stesso documento
   `visualPlanLeases/{leaseId}`. Per un singolo docente con al più poche
   sessioni simultanee (due schede) questo non è un collo di bottiglia
   pratico, ma è un pattern di contesa deliberato, non incidentale — vale
   la pena registrarlo come tale.
2. **`VisualUploadRun` e il piano sono due contratti di idempotenza
   paralleli, non unificati.** È una scelta esplicita (§9.6: mescolarli
   avrebbe costretto il piano a contabilizzare operazioni a costo zero),
   ma significa che un'implementazione futura mantiene due macchine a
   stati invece di una, con superficie di test raddoppiata.
3. **Nessuno dei meccanismi di questa revisione (lease, upload run, Rules
   a rami) è stato eseguito contro un Emulator.** Restano contratti di
   interfaccia verificati per coerenza interna e leggibilità, non per
   comportamento a runtime.

---

## 15. Stato dichiarato — dopo la revisione 4

| Elemento | Stato |
|---|---|
| MULTI-VISUAL-00 (revisione 4) | **Contratto corretto sui sei difetti di coerenza/idempotenza della terza review; prototipo confermato bit-per-bit invariato (diff vuoto + hash SHA-256 identico); nessuna verifica Emulator eseguita in questa fase — dichiarato esplicitamente** |
| MULTI-VISUAL-01→05 | Aperte |
| Gate GMULTI | **PENDING** |
