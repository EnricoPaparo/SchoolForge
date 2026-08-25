# MULTI-VISUAL-00 — review di fase

> **Gate GMULTI: PENDING.** Questo documento registra che cosa è stato
> deciso, che cosa è stato verificato e come. Non dichiara superato alcun
> gate applicativo e non approva alcuna resa visiva o alcuna decisione di
> prodotto: quel giudizio è del docente, al gate umano di questo pilota.

**Fase:** MULTI-VISUAL-00 — contratto e prototipo. Pilota di
`AGENT-ORCHESTRATOR` sul task manifest `MULTI-VISUAL-00`
(`agent-orchestrator-roadmap.md` §5, §12).
**Data:** 25 agosto 2026.
**Base:** `main` @ `9f0adc4` (merge PR #421, `agent-orchestrator-01`).
**Branch:** `multi-visual-00`.
**Contratto:** [`../multi-visual-roadmap.md`](../multi-visual-roadmap.md)
**Prototipo:** [`../prototipi/lesson-visual-enrichment-multi.html`](../prototipi/lesson-visual-enrichment-multi.html)

---

## 1. Perimetro effettivo della fase

**Fatto:** contratto che estende `visual-enrichment-roadmap.md` a un massimo
di tre immagini per lezione (generate o caricate dal docente); forme dati
chiuse e versionate per il contenitore ad array, il manifest pubblico e la
mappa di byte studente; adozione lazy dal manifest singolo esistente;
ancoraggio N-way con split del token stream generalizzato; ciclo di vita
esteso a upload con normalizzazione server-side riusata; orchestrazione
«Genera lezione con immagini» a costi separati per immagine; corse
sull'elenco e le rispettive difese; cost model per immagine; rollout con
flag distinti lettura/scrittura e analisi esplicita del rischio di
rollback sui dati già adottati; prototipo statico interattivo a quattordici
stati, desktop e mobile.

**Non fatto, per mandato del task manifest:** runtime, tipi TypeScript
reali, Cloud Functions, provider, Firebase, Rules, dipendenze, chiamate
OpenAI. **Nessuna immagine reale è stata generata o caricata.** Le
illustrazioni del prototipo sono `<svg>` inline disegnati a mano; il
riquadro «foto caricata dal docente» è un placeholder CSS (gradiente),
deliberatamente reso in uno stile diverso dallo schizzo per rendere visibile
il compromesso di stile discusso nel contratto §9.4.

Il diff tocca **esclusivamente** `documentazione/**`:
`multi-visual-roadmap.md` (nuovo), `prototipi/lesson-visual-enrichment-
multi.html` (nuovo), `evidenze/multi-visual-00-review.md` (questo file,
nuovo), `evidenze/multi-visual-00-prototipo/` (nuovo, screenshot reali),
più tre righe di stato aggiornate in `INDEX.md`,
`agent-orchestrator-roadmap.md` e `piano-implementazione.md`. Nessun file
runtime, nessuna dipendenza, nessuna Rule.

---

## 2. Documenti letti, nell'ordine prescritto dal task

`INDEX.md` → `agent-orchestrator-roadmap.md` (protocollo, macchina degli
stati, manifest del pilota `MULTI-VISUAL-00`) → `visual-enrichment-
roadmap.md` (contratto a singola immagine, integrale) → `evidenze/visual-
enrichment-00-review.md` (review di fase, verifiche eseguite e non
eseguite) → `piano-implementazione.md` (riga `ORCHESTRATOR-04`) →
`prototipi/lesson-visual-enrichment.html` (baseline di stile e di
interazione riusata). Verificata l'assenza di `AGENTS.md` nel repository
(nessuna corrispondenza). Verificato che `main`/`HEAD` contenesse il merge
di PR #421 prima di creare il branch (`git log`, `git status`).

---

## 3. Perché questa fase riapre un punto che VE aveva chiuso

La verifica più rilevante di questa fase non è tecnica: è di **coerenza fra
mandati**. `visual-enrichment-roadmap.md` §16 elenca esplicitamente «upload
di immagini proprie» come fuori scope, con una motivazione dichiarata
(licenze, moderazione, formati, provenienza — «è una funzione diversa»). Il
task manifest di questo pilota chiede testualmente «upload con
normalizzazione server-side e limiti».

Questa review conferma che il contratto prodotto (`multi-visual-roadmap.md`
§9) **non nasconde** questa tensione: la dichiara nel testo, importa la
motivazione originale di VE senza modificarla, e la delimita con un
argomento verificabile — SchoolForge è uno strumento a singolo docente
(`brief.md`), quindi il rischio di moderazione multi-tenant che aveva
motivato l'esclusione originale non si applica nello stesso modo. Non è una
verifica che il compromesso sia "giusto": è la verifica che sia stato **reso
esplicito** invece che risolto per omissione. Resta un rischio residuo
dichiarato (`multi-visual-roadmap.md` §17.1).

---

## 4. Verifiche eseguite

### 4.1 Perimetro del diff

| Verifica | Esito |
|---|---|
| Il diff tocca solo `documentazione/**` | **PASS** |
| Nessun file runtime creato o modificato | **PASS** |
| Nessuna dipendenza aggiunta (`package.json`, lockfile invariati) | **PASS** |
| Nessuna chiamata a provider eseguita | **PASS** — nessun codice eseguibile introdotto nel diff del repository |
| Nessuna immagine reale generata o caricata | **PASS** |
| `windows-tuning-backup-2026-08-21/` non toccato | **PASS** — cartella pre-esistente e non tracciata, ignorata per l'intera sessione |
| `git diff --check` (spazi finali, conflitti) | **PASS** |
| `npx prettier --check` sui Markdown modificati/nuovi | **PASS** |
| Nessun merge, nessun deploy | **PASS** |

> `prettier --check` è stato eseguito sui quattro file Markdown toccati
> (`INDEX.md`, `agent-orchestrator-roadmap.md`, `piano-implementazione.md`,
> `multi-visual-roadmap.md`); il prototipo `.html` resta fuori dal glob di
> `format:check` del repository (`{ts,tsx,json,md,yaml,yml}`), comportamento
> preesistente e condiviso con tutti i prototipi già presenti — non
> modificato per questa fase.

### 4.2 Prototipo — verifiche statiche

| Verifica | Comando | Esito |
|---|---|---|
| Nessun URL esterno | `grep -nE 'https?://\|src="//\|url\('` | **PASS** — nessuna occorrenza |
| Nessuna risorsa remota | `grep -nE '<link\|<script[^>]+src=\|@import'` | **PASS** — nessuna occorrenza |
| Nessuna chiamata di rete | `grep -nE 'fetch\(\|XMLHttpRequest'` | **PASS** — nessuna occorrenza |
| Nessun `data:` URI | `grep -n 'data:'` | **PASS** — nessuna occorrenza |
| Quattordici stati presenti | `grep -c 'class="panel"'` | **PASS** — 14 |
| `overflow-x: hidden` su `html, body` | ispezione | **PASS** |
| `prefers-reduced-motion: reduce` dichiarato nel CSS | ispezione | **PASS** — confermato anche a runtime, §4.3 |
| `:focus-visible` con contrasto | ispezione | **PASS** — confermato anche a runtime, §4.3 |
| Target touch ≥ 44 px | token `--touch: 44px` su `.btn`, `.demo-bar button`, campi | **PASS** strutturale |
| Immagini fluide | `img, svg { max-width: 100%; height: auto }` | **PASS** |

### 4.3 Smoke responsive reale — **ESEGUITO**, a differenza di VE-00

A differenza della review di VE-00 (`visual-enrichment-00-review.md` §5.1,
non eseguita per assenza di un browser nell'ambiente di quella sessione),
questa sessione **dispone** di Chromium (`C:\Program Files\Google\Chrome\
Application\chrome.exe`, verificato al percorso reale prima di procedere).
Lo smoke è stato eseguito **davvero**, con la stessa metodologia già
prescritta da quella review e usata per `vdif-00-prototipo-visivo.md`:
Chrome reale in `--headless=new`, pilotato via **Chrome DevTools Protocol**
su un WebSocket nativo (`globalThis.WebSocket`, disponibile in Node 24 senza
alcuna dipendenza nuova), con `Emulation.setDeviceMetricsOverride` per il
viewport e `Page.captureScreenshot` per l'evidenza — **mai**
`--window-size`, per la stessa ragione già documentata in VE-00 (su Windows
Chrome impone una larghezza minima di finestra di 500 px).

Lo script pilota (`node:child_process` + WebSocket nativo, nessuna
dipendenza npm installata) vive fuori dal repository, in una cartella
temporanea del sistema, e non fa parte del diff.

**Matrice eseguita** — quattro larghezze, undici catture, gli stati che
stressano di più ciascuna larghezza:

| Larghezza | Stati catturati | Che cosa verificano |
|---|---|---|
| 1440 | 1 · 5 · 10 | griglia delle proposte (`.slots`), griglia della galleria (`.gallery`), figure impilate sulla stessa ancora nella vista lezione |
| 1024 | 5 · 11 | transizione della griglia della galleria, vista studente con più immagini |
| 390 | 0 · 3 · 8 | footer del dialog a pulsanti impilati, form di upload, conferma di abbandono |
| 320 | 1 · 5 · 9 | collasso a una colonna di `.slots` e `.gallery`, avviso di ancora persa per un singolo elemento |

**Risultato — misurato, non dichiarato per assunzione:**

```
1440×900  s1 : scrollW=1440 innerW=1440 overflowX=false visiblePanels=1
1440×900  s5 : scrollW=1425 innerW=1440 overflowX=false visiblePanels=1
1440×900  s10: scrollW=1425 innerW=1440 overflowX=false visiblePanels=1
1024×900  s5 : scrollW=1009 innerW=1024 overflowX=false visiblePanels=1
1024×900  s11: scrollW=1009 innerW=1024 overflowX=false visiblePanels=1
390×844   s0 : scrollW=390  innerW=390  overflowX=false visiblePanels=1
390×844   s3 : scrollW=390  innerW=390  overflowX=false visiblePanels=1
390×844   s8 : scrollW=390  innerW=390  overflowX=false visiblePanels=1
320×720   s1 : scrollW=320  innerW=320  overflowX=false visiblePanels=1
320×720   s5 : scrollW=320  innerW=320  overflowX=false visiblePanels=1
320×720   s9 : scrollW=320  innerW=320  overflowX=false visiblePanels=1
```

`overflowX=false` su tutte e undici le combinazioni: `document.
documentElement.scrollWidth` non supera mai `window.innerWidth`, a nessuna
delle quattro larghezze. `visiblePanels=1` su ogni cattura conferma che
`.panel[hidden] { display: none !important }` funziona come inteso — è
esattamente la classe di difetto che `vdif-00-prototipo-visivo.md` §3 aveva
trovato solo con uno screenshot, con i controlli statici verdi (un
`display: flex` che batteva `[hidden]` per specificità, lasciando visibili
più pannelli insieme); qui è stata verificata a runtime, non assunta dalla
sola ispezione del CSS. **Console del browser (`Log.entryAdded` a livello
`error`/`warning`, `Runtime.exceptionThrown`): nessuna voce, su tutte e
undici le catture.**

Le undici catture sono salvate in
[`multi-visual-00-prototipo/`](multi-visual-00-prototipo/) insieme al
report grezzo (`smoke-report.json`). Ispezione visiva delle catture (non
solo delle metriche): galleria a tre colonne leggibile a 1440, collasso a
una colonna dei pannelli `.slots`/`.gallery` a 320 senza testo troncato o
sovrapposto, form di upload e conferma di abbandono utilizzabili a 390,
badge di provenienza («Generata»/«Caricata») leggibili a ogni larghezza.

### 4.4 `prefers-reduced-motion` e `:focus-visible` — verificati a runtime

Estensione di questa sessione oltre la sola matrice responsive, con lo
stesso Chromium: la barra di avanzamento dello stato 2 (Generazione) ha
`animation-duration` **1,4 s** di base; con
`Emulation.setEmulatedMedia({ 'prefers-reduced-motion': 'reduce' })` attivo,
il valore calcolato scende a **1 µs** (il minimo praticabile prodotto dalla
regola `animation-duration: 0.001ms !important` del CSS), confermando che
la regola dichiarata in §4.2 non è solo presente nel foglio di stile ma
**ha effetto** sull'elemento realmente animato del prototipo.

Navigazione da tastiera: un singolo evento `Tab` sposta il focus su un
`<button>` della barra demo con `outline-style: solid`,
`outline-color: rgb(251, 146, 60)` (`--color-brand-orange`),
`outline-width: 2px` — la regola `:focus-visible` dichiarata in §4.2 è
verificata sull'elemento realmente attivo, non solo letta dal CSS.

### 4.5 I quattordici stati richiesti

| # | Stato | Pannello | Presente |
|---|---|---|---|
| 0 | Galleria vuota (0/3) | `#s0` | ✅ |
| 1 | Orchestrazione «Genera lezione con immagini», costi separati per slot | `#s1` | ✅ |
| 2 | Generazione in corso per un singolo slot | `#s2` | ✅ |
| 3 | Caricamento di un file proprio, normalizzazione server-side | `#s3` | ✅ |
| 4 | Errore di caricamento (formato/peso) | `#s4` | ✅ |
| 5 | Galleria «Gestisci immagini» a 3/3, provenienza mista, riordino | `#s5` | ✅ |
| 6 | Sostituzione di un elemento specifico (non dell'intero manifest) | `#s6` | ✅ |
| 7 | Slot pieno — tentativo di superare il limite di tre | `#s7` | ✅ |
| 8 | Conferma di abbandono | `#s8` | ✅ |
| 9 | Ancora persa per un singolo elemento su tre | `#s9` | ✅ |
| 10 | Vista lezione docente con immagini su ancore diverse e in coda | `#s10` | ✅ |
| 11 | Vista studente con immagini (lezione svolta) | `#s11` | ✅ |
| 12 | Vista studente senza immagini (lezione non svolta) | `#s12` | ✅ |
| 13 | Compatibilità con il manifest singolo esistente (non adottato) | `#s13` | ✅ |

Note di merito su tre stati:

- **#1 Orchestrazione** mostra tre proposte indipendenti (due generabili, una
  «nessuna immagine utile») con un'unica nota esplicita — «nessuno sconto
  combinato» — che rende visibile la decisione di costo del contratto §11.1:
  ogni slot è una spesa a sé.
- **#9 Ancora persa** è deliberatamente scoperto su **una sola** delle tre
  immagini: le altre due restano ancorate, a dimostrazione che la perdita
  dell'ancora è una proprietà per-elemento e non dell'intero manifest
  (contratto §7.4).
- **#13 Legacy singola** è la resa del punto più delicato del contratto: una
  lezione scritta sotto VE, mai toccata da MULTI-VISUAL, deve apparire
  **identica** al prototipo a singola immagine di VE-00. Il confronto visivo
  fra questo pannello e `#s7` di `lesson-visual-enrichment.html` conferma la
  stessa struttura (stessa lezione di esempio, stesso schizzo, stessa nota
  del docente riformulata per dire esplicitamente «non ancora adottato»).

---

## 5. Verifiche NON eseguite — e perché

### 5.1 Qualità didattica delle immagini — **NON MISURATA**

Nessuna immagine è stata generata né caricata. Vale identica la posizione
di VE-00: è un'ipotesi, non una misura, ed è esplicitamente fuori scope di
questa fase documentale.

### 5.2 Comportamento reale dell'adozione dal manifest legacy — **NON ESEGUITO**

Il contratto (§6.2) specifica una transazione di adozione, ma nessun codice
esiste ancora: non c'è nulla da eseguire. È dichiarato come rischio residuo
esplicito in `multi-visual-roadmap.md` §17.2 — l'adozione non sarà mai stata
esercitata su dati reali prima della prima lezione reale con due immagini,
indipendentemente da quale opzione di rollout (§15.2 del contratto) venga
scelta.

### 5.3 Verifica del margine di byte su un documento Firestore reale — **NON ESEGUITA**

Il calcolo di `multi-visual-roadmap.md` §4 (margine del 21,9% con tre
immagini al cap rigido) è aritmetica verificabile a mano, non una misura
contro un'istanza Firestore reale — nessun Firestore, reale o emulato, è
stato toccato in questa fase. La verifica contro un'istanza reale è
esplicitamente elencata come test obbligatorio di una fase implementativa
futura (`multi-visual-roadmap.md` §19).

### 5.4 Componenti React reali — **NON APPLICABILE A QUESTA FASE**

Il prototipo è HTML statico. Lo smoke di §4.3 verifica il prototipo, non i
componenti React che una fase implementativa dovrà costruire — quello smoke
resta da fare quando quei componenti esisteranno, con la stessa metodologia
(§19 del contratto lo elenca esplicitamente).

---

## 6. Stato dichiarato

| Elemento | Stato |
|---|---|
| MULTI-VISUAL-00 | **Contratto e prototipo prodotti; smoke responsive reale eseguito e verde** |
| MULTI-VISUAL-01→05 | **Aperte** |
| Gate GMULTI | **PENDING** |
| Dipendenza dichiarata | VE-00→05A (Gate GVISUAL **PENDING** — vedi `multi-visual-roadmap.md` §15.1 per la raccomandazione di sequenza) |

---

## 7. Domande aperte per il gate umano

Nessuna di queste è risolvibile in implementazione: sono decisioni del
docente, aggiuntive rispetto a quelle già aperte da
`visual-enrichment-00-review.md` §7 (non risolte da questa fase, vedi
`multi-visual-roadmap.md` §17.7).

1. **Tre immagini restano il numero giusto?** Il contratto lo deriva
   matematicamente dal limite di documento Firestore (§4), non da un
   giudizio di prodotto: il docente potrebbe comunque ritenere che anche
   tre siano troppe, o troppo poche per un uso reale.
2. **L'upload di immagini proprie vale la riapertura di un punto già
   chiuso in VE?** È il compromesso più grande di questo pilota (§3), reso
   esplicito ma non risolto: nessuna moderazione automatica del contenuto
   caricato, responsabilità interamente del docente.
3. **La sequenza raccomandata (VE prima, MULTI-VISUAL dopo) è quella
   giusta**, o conviene assorbire subito MULTI-VISUAL come V1 dell'intera
   funzione (opzione B di `multi-visual-roadmap.md` §15.2), accettando che
   l'adozione resti non esercitata su dati reali più a lungo?
4. **Il costo separato per immagine nell'orchestrazione «Genera lezione con
   immagini» è comunicato in modo sufficientemente chiaro** nel flusso del
   prototipo (stato #1), o rischia comunque di essere percepito come un
   pacchetto unico da chi non legge la nota esplicita?
5. **Il riordino a sole frecce da tastiera (§16 del contratto, nessun
   drag-and-drop in V1)** è un compromesso di accessibilità accettabile, o
   un'esperienza percepita come troppo macchinosa per tre elementi al
   massimo?

---

## 8. Scope esatto di MULTI-VISUAL-01

Riportato qui perché la fase successiva non debba ricostruirlo da zero,
sullo stesso modello di VE-00 §8:

Fase **tipi e validatori puri**. Nessuna Function, nessuna UI, nessuna
persistenza, nessun deploy, nessuna chiamata a provider.

**Da produrre**, come da `multi-visual-roadmap.md` §18, riga
MULTI-VISUAL-01: `LessonVisualsManifest`, `LessonVisualItem` e relativo
validatore strutturale a chiavi chiuse (§5.1 del contratto);
`PublicLessonVisualsManifest`/`PublicLessonVisualItem` (§5.2);
`PublicLessonVisualBytesDoc` come mappa per `assetId` (§5.3);
`adaptSingular` puro (§6.1); risolutore d'ancora esteso a N elementi con la
stessa regola di confronto esatto di VE; costanti
`MAX_VISUALS_PER_LESSON = 3` e `MAX_VISUAL_UPLOAD_INPUT_BYTES = 8_388_608`;
test di non-regressione byte-identica sui contratti VE-01 esistenti
(namespace `visual-enrichment/v1` invariato).

**Prima di procedere oltre questa fase**, il contratto raccomanda
esplicitamente una decisione su Gate GVISUAL (`multi-visual-roadmap.md`
§15.1) — non un blocco tecnico su MULTI-VISUAL-01 stesso, che può procedere
in parallelo essendo puro e senza alcuna dipendenza da dati reali.

**Definition of Done:** stessa disciplina di VE-01 — build/typecheck/lint/
test verdi (quando esisterà codice da compilare), non-regressione degli
`inputHash` dimostrata, nessuna dipendenza nuova, nessun file web
modificato, nessun deploy.
