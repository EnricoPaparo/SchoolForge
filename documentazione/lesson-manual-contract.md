# Manuale digitale delle lezioni — contratto grafico (LESSON-MANUAL-00)

> **Stato: LESSON-MANUAL-01 implementato come variante opt-in; Gate umano
> ancora PENDING.** Le decisioni qui congelate sono ora realizzate nel runtime
> web, ma **solo** come variante attivabile per le due viste lezione: il
> renderer legacy resta disponibile e predefinito ovunque altro. La sostituzione
> del renderer corrente come resa unica richiede ancora l'approvazione della
> review ([`evidenze/lesson-manual-00-review.md`](evidenze/lesson-manual-00-review.md)).
> Il prototipo [`prototipi/lesson-manual.html`](prototipi/lesson-manual.html)
> resta il riferimento visivo.
>
> **Attuazione (LESSON-MANUAL-01):**
> `components/lessonManualMarkdown.ts` (istanza `Marked` isolata, callout, slug,
> pipeline di sanificazione), `components/LessonManualBody.tsx` (indice,
> osservatore, navigazione), blocco CSS additivo in coda a `index.css`,
> `<MarkdownRenderer variant="lesson" />` in `CourseWorkspace` e
> `StudentDidatticaView`.
>
> **Non implementato e fuori scope:** KaTeX, Mermaid, formule e diagrammi
> renderizzati, prompt IA, evidenziazione della sintassi, stampa/PDF.

---

## 0. Audit dello stato attuale

### 0.1 Perché oggi una lezione appare come testo monocromatico

Il renderer è deliberatamente minimo — `apps/web/src/components/MarkdownRenderer.tsx`
sono 19 righe: `marked.parse()`, `DOMPurify.sanitize()`, un `<div class="prose">`.
Tutta la resa vive in `.prose` (`apps/web/src/index.css`). Le cause concrete,
nell'ordine in cui pesano:

1. **Nessuna colonna di lettura.** `.prose` dichiara `max-width: 100%` con un
   commento esplicito («Fills whatever width its panel gives it»). Su un
   desktop a 1440 px il testo si distende per ~960 px: oltre 120 caratteri per
   riga, ben sopra il limite tipografico leggibile.
2. **Gerarchia degli heading quasi piatta.** `h1: 1.5rem`, `h2: 1.25rem`,
   `h3: 1.05rem`: fra un titolo di sezione e il corpo (`0.9375rem`) ci sono
   ~5 px di differenza. Nessun colore, nessun bordo, nessuno stacco: una
   sezione nuova non si vede scorrendo.
3. **Spaziatura uniforme.** Gli heading hanno `margin-top: 1.5em` e i paragrafi
   `margin-bottom: 0.875em` per tutti i livelli: manca il ritmo «molto spazio
   *prima* della sezione, poco spazio *dentro*» che rende scandibile un manuale.
4. **Corpo piccolo.** `0.9375rem` (15 px) è una misura da pannello applicativo,
   non da lettura prolungata.
5. **Un solo colore.** L'unico accento è `--color-primary` sui link. Titoli,
   marcatori di lista, intestazioni di tabella sono tutti `--color-text`.
6. **Nessuna semantica di blocco.** Ogni `blockquote` è identico: bordo grigio,
   corsivo, testo attenuato. Definizione, esempio, avvertenza e soluzione hanno
   la stessa identica resa.
7. **Nessun orientamento.** Nessun indice, nessuna ancora, nessun senso di
   «dove sono» in una lezione lunga.

### 0.2 Cosa è già supportato

`marked` con impostazioni predefinite (GFM attivo) copre già: heading, paragrafi,
enfasi, liste puntate e numerate, liste annidate, **checklist** (`- [ ]`),
tabelle, codice inline e a blocchi con info-string del linguaggio, blockquote,
link (riscritti con `target="_blank" rel="noopener noreferrer"`), regole
orizzontali, immagini, HTML inline sanificato da DOMPurify.

**Non** supportati oggi: `> [!NOTA]` (rimane un blockquote con il marcatore come
testo letterale), evidenziazione della sintassi, `id` sugli heading, indice,
formule, diagrammi.

### 0.3 Superfici che condividono il renderer

Un solo componente, quattro consumatori:

| Superficie | File |
|---|---|
| Lezione docente | `features/teacher/CourseWorkspace.tsx` |
| Lezione studente | `features/student/StudentDidatticaView.tsx` |
| Anteprima editor Markdown | `features/teacher/lessonEditors.tsx` |
| Anteprima generazione IA | `features/teacher/AiLessonGenerationDialog.tsx` |

`features/teacher/MarkdownRenderer.tsx` è un semplice re-export di compatibilità.
Conseguenza vincolante: **qualunque modifica non opt-in a `.prose` cambia anche
le due anteprime**, dove una resa da manuale è fuori contesto.

### 0.4 Cosa provocò l'effetto indesiderato di LESSON-POLISH-01

Commit `4cfa9aa` (PR #279), revertito da `a466e57`/`680614e` (PR #280). Aggiungeva
184 righe al renderer e 320 righe di CSS. Le cause dell'effetto «non è più una
lezione»:

- **Barra di avanzamento della lettura** `position: sticky` con transizione
  continua: un elemento da blog/Medium, in movimento a ogni scroll.
- **Indice come `<details>` in cima al contenuto**, con riempimento scuro
  proprio, bordo sinistro colorato e `font-weight: 750` — una card che si
  interpone fra la testata e la prima riga.
- **Zebratura delle tabelle** (`tbody tr:nth-child(even)`) e riquadri multipli:
  densità decorativa, non informativa.
- **Troppe regole `.prose--lesson` insieme**: heading, paragrafi, liste, quote,
  codice, tabelle, link, `hr`, immagini ridefiniti in blocco, senza un principio
  unico. Il risultato era «tutto un po' diverso» invece di «una gerarchia».
- **Nessun confronto affiancato prima del merge**: il giudizio è arrivato solo
  a codice distribuito, e l'unica via d'uscita è stata il revert.

Questa fase esiste per non ripetere quell'errore: si valuta il prototipo
**prima** di scrivere runtime.

### 0.5 Migliorabile centralmente, senza toccare i Markdown

Tipografia e colonna di lettura; gerarchia e spaziatura degli heading; colore
strutturale sugli H2; ritmo dei paragrafi; marcatori di lista; contenitore
scrollabile e intestazione delle tabelle; barra del linguaggio sui blocchi di
codice; `id` e ancore generate dagli heading; indice derivato dagli heading
esistenti; testata composta dai metadati **già presenti** nel front-matter.

### 0.6 Richiede convenzioni Markdown (e, in futuro, prompt IA)

Callout semantici (`> [!DEFINITION]` …); procedure numerate distinte da una
semplice lista ordinata; formule; diagrammi. Nessuna di queste convenzioni viene
introdotta ora, e **nessun prompt IA viene modificato in questa fase**.

---

## 1. Anatomia approvabile della lezione

```
┌───────────────────────────────────────────────────────────┐
│ UDA 1 — Il Web · Lezione 2 di 5          (contesto, 12px) │
│ Il protocollo HTTP                       (H1, 28px)       │
│ Come browser e server si scambiano…      (sottotitolo)    │
│ Difficoltà · Concetti chiave · Obiettivi (riga metadati)  │
├───────────────────────────────────────────────────────────┤
│ corpo di lettura (max 42rem)          │ indice (13rem)    │
│                                       │ sticky, discreto  │
└───────────────────────────────────────────────────────────┘
```

**Testata** — riga di contesto UDA (secondaria, maiuscoletto attenuato); H1;
sottotitolo solo se presente; riga metadati compatta `<dl>` con difficoltà,
concetti chiave, obiettivi. Un unico bordo inferiore la separa dal corpo:
**nessuna card**, nessun hero, nessun riquadro colorato.

**Vietato inventare dati.** Nessun tempo di lettura stimato, nessun conteggio di
parole, nessun «livello» non presente nel front-matter. Un metadato assente non
produce alcuna riga.

---

## 2. Token grafici riusati

Solo variabili già definite in `apps/web/src/index.css`. **Nessun nuovo token.**

| Uso | Token |
|---|---|
| Sfondo pagina | `--color-surface-subtle` |
| Superfici (callout, barre, indice mobile) | `--color-surface` |
| Testo / testo attenuato | `--color-text` / `--color-text-muted` |
| Bordi e separatori | `--color-border` |
| **Struttura e navigazione** (H2, marcatori, sezione corrente, numeri di passo) | `--color-brand-blue` |
| **Interazione e contenuti realmente importanti** | `--color-brand-orange` |
| Avvertenze | `--color-warning` |
| Soluzioni | `--color-success` |
| Errori di rendering | `--color-error` |
| Font | `--font-sans`, `--font-mono` (nessun font esterno) |

L'arancione non compare mai come decorazione: solo focus, hover di superfici
navigabili e callout `IMPORTANT`.

---

## 3. Breakpoint e comportamento responsive

| Larghezza | Comportamento |
|---|---|
| ≥ 60rem (960 px) | Due colonne: corpo `max-width: 42rem` + indice `13rem` sticky. Sidebar del corso invariata e mai coperta. |
| < 60rem | Una colonna. Indice laterale nascosto, sostituito dal controllo «In questa lezione». Corpo a larghezza piena, `padding` 0.9rem. |
| ≤ 22.5rem (360 px) | `padding` 0.7rem, H1 ridotto, indentazione della procedura ridotta. |

Invariante: **nessun overflow orizzontale della pagina a nessuna larghezza**.
Lo scroll orizzontale è ammesso solo *dentro* il contenitore di una tabella o di
un blocco di codice.

---

## 4. Regole dell'indice

- Compare **solo** con **almeno 3** heading significativi (`h2`/`h3`). Sotto la
  soglia non esiste e il corpo resta centrato.
- Costruito dagli heading **già presenti**: nessuna lettura, nessuna query,
  nessun listener Firebase, nessun campo persistito.
- Desktop: colonna stretta sticky a destra, separata da un filo verticale, senza
  riempimento proprio. Sezione corrente evidenziata **solo** con colore e peso
  (`aria-current="true"`), mai con un blocco pieno.
- Non riduce il corpo sotto la misura di lettura e non copre la sidebar del corso.
- Mobile: `<details>` «In questa lezione», chiuso di default, **non sticky**, che
  si richiude dopo la navigazione.
- Le ancore sugli heading sono discrete: invisibili a riposo, visibili su hover e
  su `:focus-visible`, con `aria-label` esplicito.

### 4.1 Identificatori degli heading

- **Slug deterministici**: lo stesso testo produce sempre lo stesso identificatore,
  a parità di contenuto e indipendentemente dall'ordine di rendering. Nessun
  identificatore casuale, nessun contatore globale che dipenda da quante lezioni
  sono già state renderizzate nella sessione.
- **Duplicati distinti da un suffisso progressivo** nell'ordine del documento:
  `#derivate`, `#derivate-2`, `#derivate-3`. Il primo non porta suffisso.
- **Caratteri accentati gestiti stabilmente**: normalizzazione `NFKD` +
  rimozione dei segni diacritici + minuscolo con locale `it`, così `Perché`,
  `perche` e `PERCHÉ` convergono sullo stesso slug in modo prevedibile su ogni
  browser. Uno slug che risultasse vuoto ricade su un valore fisso (`sezione`)
  più il suffisso progressivo.
- **Nessun identificatore proveniente da HTML non attendibile.** Lo slug è
  derivato **solo** dal `textContent` di nodi DOM **già sanificati**: mai da
  stringhe HTML grezze, mai da un attributo `id` presente nel Markdown sorgente.
  Un `id` fornito dall'autore viene ignorato ai fini dell'indice.

### 4.2 Vincoli di runtime dell'indice

- **Un solo `IntersectionObserver`** per vista lezione, creato una volta e
  riusato. Vietato un osservatore per heading.
- **Nessun listener per heading**: né `scroll`, né `resize`, né handler
  individuali. L'osservatore aggiorna esclusivamente `aria-current`.
- **Cleanup allo smontaggio**: `disconnect()` nella funzione di pulizia
  dell'effetto, e prima di ogni ricostruzione dell'indice. Nessun osservatore
  superstite dopo un cambio di lezione.
- **Nessuna scrittura nella cronologia durante lo scroll**: niente
  `history.replaceState`/`pushState` per riflettere la sezione corrente. Il
  pulsante «indietro» del browser non deve mai riempirsi di sezioni attraversate.
- **Click dell'indice**: oltre allo scroll, il focus si sposta sulla sezione di
  destinazione. Gli heading ricevono `tabindex="-1"` (focalizzabili da codice,
  fuori dall'ordine di tabulazione) e `focus({ preventScroll: true })`; il
  contorno di focus compare solo con `:focus-visible`, non a ogni click.
- **`prefers-reduced-motion: reduce`** disattiva `scroll-behavior: smooth`: la
  navigazione diventa istantanea, non assente.

---

## 5. Contratto dei callout

Cinque tipi, **nessuno in più**:

| Tipo | Accento | Uso |
|---|---|---|
| `DEFINITION` | ciano | ciò che va saputo a memoria |
| `EXAMPLE` | neutro | applicazione concreta |
| `IMPORTANT` | arancione | contenuto realmente critico |
| `WARNING` | giallo | rischio o errore frequente |
| `SOLUTION` | verde | risposta di un esercizio |

Sintassi **futura** prevista (non implementata ora):

```markdown
> [!DEFINITION]
> HTTP è il protocollo applicativo con cui…
```

Resa: fascia laterale sottile (3 px), icona del set SchoolForge, titolo in
maiuscoletto leggibile, sfondo appena distinto, bordo tenue. **Mai emoji**, mai
gradienti, mai un callout che inghiotte un'intera sezione.

`SOLUTION` usa `<details>`/`<summary>` nativi: richiudibile, accessibile da
tastiera, indicizzabile, e visibile nella stampa futura tramite `details[open]`
forzato in `@media print`. Nessun contenuto è mai nascosto in modo irreversibile.

**Markdown legacy:** un blockquote senza marcatore resta un blockquote ordinario.
Un marcatore sconosciuto (`> [!TIP]`) resta testo letterale: nessuna invenzione,
nessuna perdita.

### 5.1 Pipeline autorevole dei callout

L'ordine è vincolante e non negoziabile:

```
Markdown sorgente
  → parser Markdown/callout controllato   (riconosce i cinque marcatori)
  → HTML
  → DOMPurify.sanitize()                  (ultimo passaggio che vede stringhe)
  → render
```

- **È vietata qualunque iniezione di HTML successiva alla sanificazione.** Nessun
  `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`,
  `template.innerHTML` o `dangerouslySetInnerHTML` su contenuto prodotto **dopo**
  `DOMPurify.sanitize()`.
- **La soluzione preferita è il parsing prima della sanificazione finale**: i
  callout vengono riconosciuti dal parser, che emette markup già strutturato, e
  quel markup passa poi per DOMPurify come tutto il resto. Le classi e i tag
  usati dai callout devono quindi essere ammessi dalla configurazione di
  sanificazione, non aggirarla.
- Se una trasformazione dovesse comunque avvenire **dopo** la sanificazione, può
  operare **soltanto creando nodi React controllati** — elementi costruiti dal
  codice, con testo preso da `textContent` di nodi già sanificati — e **mai**
  tramite assegnazione di HTML. Questa resta una via di ripiego, non il disegno.
- Vale lo stesso per gli identificatori degli heading e per l'indice: si opera su
  nodi DOM già ripuliti, leggendone il testo, senza reintrodurre stringhe HTML.

### 5.2 Isolamento del parser

Il renderer attuale registra la propria estensione dei link con `marked.use()`
**sull'istanza globale del modulo**. Aggiungere lì l'estensione dei callout
cambierebbe il comportamento di *tutte* le superfici, incluse le anteprime
editor e IA, che devono restare invariate. Vincoli:

- **La variante lesson non deve registrare estensioni tramite `marked.use()`
  sull'istanza globale.** Nessuna configurazione condivisa, nessun effetto
  collaterale a livello di modulo.
- Deve usare un **parser o un'istanza isolata** (per esempio una `Marked`
  dedicata, costruita una volta e usata solo dalla variante lesson).
- **Il `MarkdownRenderer` legacy mantiene output e comportamento invariati**,
  byte per byte, anche quando la variante lesson è stata caricata e usata nella
  stessa sessione.
- **Nessuna estensione callout deve apparire nelle superfici non opt-in**: nelle
  anteprime editor e IA un `> [!DEFINITION]` continua a comparire come
  blockquote con il marcatore letterale, esattamente come oggi.
- **Test futuro obbligatorio**: renderizzare con il renderer legacy, poi
  renderizzare con la variante lesson, poi **renderizzare di nuovo con il
  legacy** — il DOM prodotto dal legacy prima e dopo deve essere identico. È il
  solo modo per dimostrare che nessuna registrazione globale è avvenuta.

---

## 6. Gerarchia degli heading

| Livello | Ruolo | Resa |
|---|---|---|
| H1 | **riservato alla testata** della lezione | 1.75rem, mai nel corpo |
| H2 | sezione | 1.375rem, **ciano**, bordo inferiore tenue, `margin-top: 2.75rem` |
| H3 | sottosezione | 1.0625rem, peso 650, colore testo, `margin-top: 1.75rem` |
| H4+ | eccezione | peso, nessun colore aggiuntivo |

Spaziatura asimmetrica deliberata: molto spazio **prima** dell'heading, poco fra
heading e il suo testo — è ciò che rende il documento scandibile. Nessuna card
attorno agli heading.

Un H1 presente nel corpo Markdown (legacy) non viene rimosso né riscritto: viene
reso come H2 dal punto di vista visivo, mantenendo il tag originale.

---

## 7. Liste, tabelle, codice

**Liste** — marcatori ciano; interlinea più ampia; annidamento leggibile senza
separatori. Le checklist GFM restano caselle native disabilitate, allineate al
testo. La **procedura numerata** (opt-in, classe applicata a una lista ordinata)
usa numeri in cerchi da 1.6rem e un filo verticale tenue: due dettagli, non una
timeline.

**Tabelle** — avvolte in un contenitore con `overflow-x: auto` e bordo proprio:
lo scroll è confinato alla tabella e non produce mai scroll di pagina. Header
distinto per sfondo e peso, righe separate da un filo. **Nessuna zebratura**
(era una delle cause dell'effetto indesiderato di LESSON-POLISH-01).

**Codice** — inline con sfondo tenue e bordo. A blocchi: contenitore con barra
superiore che mostra il **linguaggio dichiarato** e, solo quando il blocco è
realmente copiabile, un pulsante «Copia» che dichiara l'esito reale
(`Copiato` / `Non riuscito` / `Non disponibile`), mai un successo presunto.
Nessuna evidenziazione della sintassi in questa fase, nessuna colorazione vivace.

---

## 8. Comportamento con Markdown legacy

Vincolo assoluto: **i file Markdown non vengono mai riscritti, migrati o
normalizzati.** Una lezione esistente resa con la nuova presentazione deve
risultare uguale nel testo e migliore solo nella forma.

- Nessun marcatore di callout ⇒ nessun callout: blockquote ordinari.
- Meno di 3 heading ⇒ nessun indice, corpo centrato.
- Nessun front-matter ⇒ testata ridotta al solo titolo.
- Tabelle o codice molto larghi ⇒ scroll interno, mai troncamento.
- Nessuna trasformazione persistente, in nessun momento.

---

## 9. Accessibilità

- Un solo `H1` per pagina; ordine dei livelli non saltato.
- Indice come `<nav aria-label>`; sezione corrente con `aria-current="true"`.
- Callout `SOLUTION` con `<details>`/`<summary>` nativi.
- `:focus-visible` sempre presente e con contrasto sufficiente; nessun
  `outline: none` senza sostituto.
- Nessuna informazione veicolata **solo** dal colore: ogni callout ha un titolo
  testuale.
- `prefers-reduced-motion: reduce` disattiva `scroll-behavior: smooth`,
  transizioni e animazioni.
- Target tattili ≥ 44 px per i controlli dell'indice mobile e del pulsante Copia.
- Contrasto verificato sui token esistenti; nessun nuovo colore introdotto.

---

## 10. Sicurezza

- **DOMPurify resta l'ultimo passaggio che vede stringhe**: parser → HTML →
  `sanitize()` → render. Nessun bypass, nessuna iniezione di HTML successiva
  alla sanificazione, in nessuna forma (`innerHTML`, `insertAdjacentHTML`,
  `dangerouslySetInnerHTML` su contenuto post-sanitize). Dettaglio in §5.1.
- I callout sono riconosciuti **prima** della sanificazione, da un parser
  isolato (§5.2): il loro markup attraversa DOMPurify come qualunque altro
  contenuto, invece di essere aggiunto dopo.
- Gli `id` degli heading sono generati su **nodi DOM già ripuliti**, con slug
  derivato dal solo `textContent` — mai da HTML grezzo e mai da un `id` fornito
  nel Markdown sorgente.
- Nessuna esecuzione di codice contenuto nel Markdown.
- I link mantengono `target="_blank" rel="noopener noreferrer"`.
- Nessuna rete aggiuntiva, nessun font esterno, nessuna risorsa remota.

---

## 11. Confine con KaTeX e Mermaid

**Fuori scope, in questa fase e in LESSON-MANUAL-01.** Il prototipo mostra
soltanto **placeholder statici** che dichiarano come apparirebbero: formula
centrata, diagramma centrato, didascalia facoltativa, e un fallback di errore
leggibile che conserva il testo originale.

Nessuna libreria è installata, importata o eseguita. La valutazione di KaTeX e
Mermaid — peso del bundle, superficie di sicurezza, rendering asincrono, stampa —
è un pacchetto separato, successivo e con Gate proprio.

---

## 12. Confine con generazione IA e pool

- **Nessun prompt IA viene modificato in questa fase.** Le convenzioni Markdown
  qui descritte sono una proposta di contratto, non un'istruzione al generatore.
- L'aggiornamento dei prompt potrà essere valutato **solo dopo** che il Gate
  umano avrà approvato la resa: prima di allora il generatore continua a produrre
  esattamente ciò che produce oggi.
- I **pool di domande** sono estranei a questo lavoro: nessuna modifica a
  `parsePool`, al contratto `schoolforge-pool/v2`, alle verifiche o alla
  correzione.
- L'anteprima della generazione IA e l'anteprima dell'editor **restano sulla
  resa compatta attuale**: la variante manuale è opt-in delle sole viste lezione.

---

## 13. Piano di implementazione successivo

**LESSON-MANUAL-01 — implementato.** Corrispondenza fra contratto e codice:

| Vincolo | Dove è attuato |
|---|---|
| Variante opt-in | `MarkdownRenderer` accetta `variant="lesson"`; senza prop, percorso legacy invariato |
| Parser isolato (§5.2) | `createLessonMarked()` costruisce una `Marked` dedicata; nessun `marked.use()` globale |
| Pipeline (§5.1) | `parseLessonMarkdown()`: parser → HTML → `DOMPurify.sanitize()` → render; unico `dangerouslySetInnerHTML` sull'output sanificato |
| Slug (§4.1) | `headingSlug()` + `nextHeadingId()`, id iniettati **prima** della sanificazione |
| Ancore non dirottabili | `findHeading()` risolve solo `h2`/`h3` con quell'id |
| Indice (§4.2) | `LessonManualBody`: un solo `IntersectionObserver`, `disconnect()` allo smontaggio e prima di ogni ricostruzione, `preventDefault()` sul click (nessuna voce di cronologia) |
| Soglia 3 heading | `shouldShowToc()` |
| Callout (§5) | Cinque tipi nel renderer del blockquote; marcatore ignoto ⇒ blockquote letterale; `SOLUTION` come `<details>` |
| CSS additivo | Blocco `LESSON-MANUAL-01` in coda a `index.css`, tutto sotto `.prose--manual` / `.lesson-manual` / `.lm-` |

**Scope originale, per confronto:**

1. Variante **opt-in** del renderer: `<MarkdownRenderer variant="lesson" />`.
   `variant` assente ⇒ comportamento odierno, byte per byte.
2. **Parser isolato** per la variante lesson (§5.2): istanza dedicata, **mai**
   `marked.use()` sull'istanza globale, nessuna estensione visibile alle
   superfici non opt-in.
3. CSS additivo sotto un unico selettore radice (`.prose--manual`), senza
   modificare una sola riga di `.prose`.
4. Testata, indice e ancore **solo** nelle due viste lezione (docente e
   studente), con resa equivalente fra i due ruoli.
5. **Callout riconosciuti prima della sanificazione** (§5.1): parser → HTML →
   DOMPurify → render. Nessuna iniezione di HTML post-sanitize.
6. **Slug e indice** secondo §4.1/§4.2: slug deterministici, suffisso progressivo
   sui duplicati, accenti normalizzati, `id` mai da HTML non attendibile, un solo
   `IntersectionObserver` con cleanup allo smontaggio, nessun listener per
   heading, nessuna scrittura nella cronologia durante lo scroll, click
   dell'indice che sposta anche il focus, `prefers-reduced-motion` rispettato.
7. Attivazione iniziale **solo in DEV**, dietro un interruttore esplicito.
8. Test obbligatori:
   - **isolamento del parser**: render legacy → render lesson → render legacy
     produce lo stesso DOM (§5.2);
   - nessuna estensione callout nelle anteprime editor/IA;
   - resa equivalente docente/studente;
   - nessun indice sotto i 3 heading;
   - marcatore sconosciuto invariato;
   - slug deterministici e suffissi progressivi sui duplicati, accenti inclusi;
   - un solo osservatore, disconnesso allo smontaggio;
   - nessuna voce aggiunta alla cronologia durante lo scroll;
   - contratto CSS statico contro le regressioni.
9. Smoke reale a 1440/1024/390/320 px sulle due viste.

Fuori da LESSON-MANUAL-01: KaTeX, Mermaid, prompt IA, evidenziazione della
sintassi, stampa/PDF della lezione, sostituzione del renderer corrente.

---

## 14. Strategia di rollback (congelata)

1. **I file Markdown non vengono mai riscritti o migrati.**
2. **Nessun nuovo campo Firestore** e nessuna nuova collezione.
3. **Nessuna trasformazione persistente**: la resa è interamente client-side, a
   partire dal contenuto originale.
4. Il renderer corrente **resta disponibile** per tutta la prima implementazione:
   la nuova resa è una variante, non una sostituzione.
5. La variante è **opt-in e isolata**: un solo prop, un solo selettore radice.
6. **Attivazione iniziale soltanto in DEV.**
7. **Un singolo revert — o la semplice rimozione dell'opt-in — ripristina
   integralmente il renderer precedente**, senza migrazioni e senza cleanup.
8. **Nessun contenuto dipende irreversibilmente dalla nuova UI**: ogni lezione
   resta pienamente leggibile con la resa attuale.
9. **Gate umano obbligatorio** prima di sostituire il renderer corrente come
   predefinito. Fino ad allora la resa attuale resta quella ufficiale.
