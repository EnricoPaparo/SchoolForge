# VDIF-00 — evidenze visive del prototipo

**Gate grafico: PENDING.** Questo documento raccoglie screenshot reali; **non**
dichiara approvata la resa visiva. L'approvazione è del docente e non può essere
sostituita da alcuna misura automatica.

**Prototipo:** [`../prototipi/verifiche-differenziate.html`](../prototipi/verifiche-differenziate.html)
**Data della cattura:** 11 agosto 2026.

---

## 1. Come sono stati prodotti

Chromium reale (Google Chrome installato sulla macchina di sviluppo), in headless,
pilotato via **Chrome DevTools Protocol** con
`Emulation.setDeviceMetricsOverride` e cattura `Page.captureScreenshot`.

**Perché il CDP e non `--window-size`:** Chrome su Windows impone una **larghezza
minima di finestra di 500 px**. Con `--window-size=390,844` il viewport reale
risulta 500 px e l'immagine viene semplicemente ritagliata a 390: si otterrebbe
una fotografia del layout **desktop** spacciata per mobile. È stato verificato
empiricamente con una pagina sonda (`inner=500 client=500` a fronte di
`--window-size=390`), e per questo la cattura mobile passa dal CDP, che imposta
il viewport CSS in modo esatto.

Ogni cattura registra il viewport effettivo e la presenza di overflow
orizzontale **prima** di scattare:

```
1440-etichette     viewport=1440x900  scrollW=1440  overflowX=no
1024-riepilogo     viewport=1024x800  scrollW=1024  overflowX=no
390-studenti       viewport=390x844   scrollW=390   overflowX=no
320-varianti       viewport=320x640   scrollW=320   overflowX=no
```

Lo script di cattura vive fuori dal repository (directory temporanea di
sessione): non è codice di prodotto e non entra nel diff.

## 2. Gli screenshot

| Immagine | Viewport | Che cosa mostra |
|---|---|---|
| [`vdif-00-prototipo/1440-etichette.png`](vdif-00-prototipo/1440-etichette.png) | 1440 × 900 | **Scheda Etichette**: tablist a tre schede con «Etichette» selezionata, pulsante full-width «Nuova etichetta», tre card full-width con titolo ciano, conteggio studenti, motivo di eliminabilità e menu «…» in alto a destra |
| [`vdif-00-prototipo/1024-riepilogo.png`](vdif-00-prototipo/1024-riepilogo.png) | 1024 × 800 | **Riepilogo di attivazione**: domanda VEX con «Varianti» disabilitato e motivo leggibile, sei riquadri di sintesi, conteggio domande per etichetta, assenza di blocker e il discriminante pubblico neutro `assignmentMode: server_resolved` |
| [`vdif-00-prototipo/390-studenti.png`](vdif-00-prototipo/390-studenti.png) | 390 × 844 | **Card studente mobile** con **Classe + Etichetta**, ciascuna su riga propria a larghezza piena, etichette visibili, nessun troncamento, trigger «…» in alto a destra, Stato a riga intera e i due accessi affiancati |
| [`vdif-00-prototipo/320-varianti.png`](vdif-00-prototipo/320-varianti.png) | 320 × 640 | **Dialog Varianti** a larghezza minima: intestazione, testo e soluzione base, spiegazione del filtro, prima card etichetta con le tre scelte a tutta larghezza e focus visibile arancione |

## 3. Due difetti reali trovati **solo** dagli screenshot

Vanno registrati, perché sono la ragione per cui le misure DOM non bastano: nel
giro precedente entrambi i controlli automatici erano **verdi**.

1. **I tre pannelli erano tutti visibili insieme.** `.tabPanel { display: flex }`
   è un selettore di classe e batte per specificità la regola UA
   `[hidden] { display: none }`: l'attributo `hidden` veniva impostato
   correttamente — il controllo su `panel.hidden` lo confermava — ma non nascondeva
   nulla. Selezionando «Etichette» si vedeva l'elenco studenti. Corretto con una
   regola esplicita `[hidden] { display: none !important }`.
2. **Il campo di ricerca era alto ~220 px su mobile.** `flex: 1 1 220px` fissa il
   *flex-basis*, che è la dimensione sull'**asse principale**: quando
   `.filterRow` passa a `flex-direction: column` sotto il breakpoint, quei 220 px
   diventano un'altezza. Corretto usando `min-width`, che significa la stessa cosa
   su entrambi gli assi.

Inoltre `body { overflow-x: hidden }` è stato **rimosso**: nascondeva un
eventuale overflow invece di eliminarlo e rendeva vuoto ogni controllo su
`scrollWidth`. Le misure riportate sopra sono state rifatte senza quella regola.

## 4. Controlli automatici che accompagnano le immagini

Eseguiti su Chromium reale, su tutte e tre le schede e sulla bozza, a 1440 /
1024 / 390 / 320 px:

- **nessun overflow orizzontale**: `scrollWidth == clientWidth` su
  `documentElement` e su `body`, e nessun elemento con `right > clientWidth`;
- **un solo pannello visibile** per scheda selezionata (`display != none`);
- **target touch**: select Classe/Etichetta 44 px di altezza, trigger «…»
  44 × 44, pulsanti del footer dei dialog 44 px, scelte del dialog varianti 44 px;
- **dialog entro `100dvh`** con scroll interno e footer raggiungibile (616 px di
  altezza su un viewport di 640);
- **nessuna textarea** e nessun elemento con `resize` diverso da `none`;
- **`:focus-visible`** reale da tastiera, outline arancione SchoolForge
  `rgb(251, 146, 60)`;
- **dirty guard** verificata: dialog pulito chiuso da Escape; dialog dirty che
  apre la conferma su Escape, backdrop e «Annulla»; «Continua modifica» che
  conserva la scelta e la larghezza; doppio Escape che non produce due conferme;
  un solo elemento `.dialog` presente in ogni istante.

## 5. Che cosa resta al docente

Guardare le quattro immagini e dire se la resa è quella giusta per SchoolForge:
gerarchia, densità, uso del ciano per la struttura e dell'arancione per
l'interazione, sobrietà delle card, leggibilità su mobile. **Finché quella
conferma non arriva, il gate grafico resta PENDING** e nessuna fase VDIF
successiva può dichiararlo superato.
