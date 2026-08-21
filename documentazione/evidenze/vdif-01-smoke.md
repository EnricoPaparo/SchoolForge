# VDIF-01 — smoke dei componenti reali

> **Evidenza storica di fase.** Il Gate GVDIF è stato successivamente superato;
> vedi [`gvdif-human-gate.md`](gvdif-human-gate.md).

**Data:** 12 agosto 2026. **Nessun deploy**, nessun rollout: lo smoke gira in
locale sui componenti dell'applicazione, non su DEV. **Gate GVDIF aperto.**

---

## 1. Che cosa è stato messo sotto smoke

I componenti **reali**: `LabelsTab` con i propri CSS module, `RecordCard`,
`RecordActionsMenu`, `ActionsMenu`, `DialogShell` e il foglio globale
`index.css`. Nessuno stile è stato riprodotto per l'occasione.

Il montaggio è avvenuto tramite un **entry Vite temporaneo**
(`apps/web/vdif-smoke.html` + `src/vdif-smoke.tsx`) che passa a `LabelsTab` tre
etichette di prova e gli handler vuoti. Quell'entry è stato **rimosso prima del
commit** e non compare nel diff: serviva solo a montare il componente senza
autenticare un docente reale.

**Limite dichiarato:** le mutazioni (creazione, rinomina, eliminazione) **non**
sono state eseguite contro Firestore in questo smoke, perché richiederebbero un
owner autenticato. Sono coperte da 31 test di service su una transazione
simulata fedele (letture registrate, snapshot di lettura coerente, conflitto al
commit e retry), 25 test Rules su emulatore reale e 13 test UI. Lo smoke visivo
copre ciò che quei test non possono vedere: layout, densità, focus, target
touch, overflow.

## 2. Screenshot

Catturati con Chromium reale via **Chrome DevTools Protocol**
(`Emulation.setDeviceMetricsOverride`), perché Chrome su Windows impone una
finestra minima di 500 px e `--window-size` produrrebbe un layout desktop
ritagliato invece di un vero viewport mobile.

| Immagine | Viewport | Contenuto |
|---|---|---|
| [`vdif-01-smoke/vdif01-1440-lista.png`](vdif-01-smoke/vdif01-1440-lista.png) | 1440 × 900 | lista con tre card: libera, in uso per studenti, in uso per studenti **e** bozze |
| [`vdif-01-smoke/vdif01-1024-lista.png`](vdif-01-smoke/vdif01-1024-lista.png) | 1024 × 800 | stessa lista |
| [`vdif-01-smoke/vdif01-390-lista.png`](vdif-01-smoke/vdif01-390-lista.png) | 390 × 844 | lista mobile |
| [`vdif-01-smoke/vdif01-320-lista.png`](vdif-01-smoke/vdif01-320-lista.png) | 320 × 640 | lista alla larghezza minima |
| [`vdif-01-smoke/vdif01-1440-vuoto.png`](vdif-01-smoke/vdif01-1440-vuoto.png) | 1440 × 900 | stato vuoto |
| [`vdif-01-smoke/vdif01-390-dialog.png`](vdif-01-smoke/vdif01-390-dialog.png) | 390 × 844 | dialog «Nuova etichetta» |
| [`vdif-01-smoke/vdif01-320-dialog.png`](vdif-01-smoke/vdif01-320-dialog.png) | 320 × 640 | dialog alla larghezza minima |
| [`vdif-01-smoke/vdif01-390-dialog-oltre-limite.png`](vdif-01-smoke/vdif01-390-dialog-oltre-limite.png) | 390 × 844 | **VDIF-01-REVIEW-FIX** — contatore oltre il limite (`41/40` in rosso) con il valore **integro** nel campo |

## 3. Misure raccolte

Su tutte e quattro le larghezze, lista e dialog aperti:

- **nessun overflow orizzontale**: `scrollWidth == clientWidth` su
  `documentElement` **e** su `body`, e nessun elemento con `right > clientWidth`;
- **target touch**: nessun controllo interattivo sotto i 44 px di altezza —
  input del dialog 44, pulsanti del footer 44 e 44, trigger «…» conforme;
- **dialog entro la viewport**: 270 px su un viewport di 640, scroll interno
  disponibile, **footer raggiungibile**, nessuno scorrimento orizzontale interno;
- **nessuna textarea** nel dialog;
- **Escape chiude** il dialog di creazione; il dialog di eliminazione è
  `role="alertdialog"`, mostra il nome dell'etichetta, dichiara che l'azione è
  irreversibile e ha il pulsante distruttivo in rosso;
- **focus iniziale** sull'input del nome; contatore `0/40` presente e
  `maxlength="40"` sul campo;
- **eliminazione bloccata**: sulla card in uso la voce «Elimina etichetta» è
  `disabled` e porta `aria-describedby` verso un testo che nomina gli utilizzi
  reali — «assegnata a 2 studenti e usata in 1 bozza di verifica».

## 3a. Smoke mirato dopo VDIF-01-REVIEW-FIX

Il DOM dei dialog è cambiato (rimozione di `maxLength`, stato «oltre il limite»
del contatore), quindi lo smoke è stato rieseguito sui dialog a 390 e 320 px:

- **`maxlength` assente** dall'input di creazione e da quello di rinomina;
- **40 emoji digitate restano 40 code point**: il campo non tronca (con
  `maxLength=40` ne avrebbe tenute 20, contando unità UTF-16) e il contatore
  legge `40/40`;
- **41 caratteri** ⇒ contatore `41/40` colorato `rgb(248, 113, 113)`
  (`--color-error`), valore integro, nessun troncamento;
- dialog entro la viewport (270 px su 844 e su 640), input 44 px, pulsanti del
  footer 44 px, focus iniziale sull'input, nessuna textarea;
- **nessun overflow orizzontale** a 390 e 320 px, con e senza dialog aperto;
- le card già approvate non cambiano: nessun intervento sul loro markup.

## 4. Console

Nessun errore in console durante il montaggio e le interazioni.

## 5. Che cosa resta al docente

Guardare le immagini e confermare che la scheda Etichette appartenga
visivamente a SchoolForge. Il gate grafico non è dichiarato superato da questo
documento.
