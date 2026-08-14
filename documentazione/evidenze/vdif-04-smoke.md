# VDIF-04 — smoke del riepilogo di attivazione

**Data:** 14 agosto 2026. **Nessun deploy**, nessun rollout: lo smoke gira in
locale sui componenti dell'applicazione, non su DEV. **Gate GVDIF aperto.**

---

## 1. Che cosa è stato messo sotto smoke

Il componente **reale**: `ActivationSummaryDialog` dentro `DialogShell`, con
`ActivationSummaryDialog.module.css`, `DialogShell.module.css` e il foglio
globale `index.css`. Nessuno stile è stato riprodotto per l'occasione.

Il montaggio è avvenuto tramite un **entry Vite temporaneo**
(`apps/web/vdif04-smoke.html` + `src/vdif04-smoke.tsx`) che passa un riepilogo di
prova con quattro percorsi: base, due etichette valide (una con nome lungo) e una
terza **bloccata** perché resterebbe senza domande. Quell'entry è stato **rimosso
prima del commit** e non compare nel diff.

**Limite dichiarato:** l'attivazione reale (transazione, decremento dei
contatori, scrittura della proiezione) **non** è stata eseguita contro Firestore
in questo smoke, perché richiederebbe un owner autenticato. È coperta da 23 test
di service su una transazione simulata, 27 test sulle guardie pure, 46 test del
risolutore (di cui 12 su vettori di conformità condivisi con le Functions) e 66
asserzioni strutturali di privacy. Lo smoke visivo copre ciò che quei test non
possono vedere: layout, densità, target touch, contenimento nella viewport.

## 2. Screenshot

Catturati con Chromium reale via **Chrome DevTools Protocol**
(`Emulation.setDeviceMetricsOverride`), perché Chrome su Windows impone una
finestra minima di 500 px e `--window-size` produrrebbe un layout desktop
ritagliato invece di un vero viewport mobile.

| Immagine | Viewport | Contenuto |
|---|---|---|
| [`vdif-04-smoke/vdif04-riepilogo-1440.png`](vdif-04-smoke/vdif04-riepilogo-1440.png) | 1440 × 900 | riepilogo completo con un percorso bloccato |
| [`vdif-04-smoke/vdif04-riepilogo-1024.png`](vdif-04-smoke/vdif04-riepilogo-1024.png) | 1024 × 800 | stesso riepilogo |
| [`vdif-04-smoke/vdif04-riepilogo-390.png`](vdif-04-smoke/vdif04-riepilogo-390.png) | 390 × 844 | mobile: metriche su due colonne, pulsanti a larghezza piena |
| [`vdif-04-smoke/vdif04-riepilogo-320.png`](vdif-04-smoke/vdif04-riepilogo-320.png) | 320 × 640 | larghezza minima, dialog con scroll interno |

## 3. Misure raccolte

Misurate nel DOM reale a ciascuna delle quattro larghezze:

- **nessun overflow orizzontale**: `scrollWidth == clientWidth` su
  `documentElement` **e** su `body`, e **zero elementi** con
  `right > clientWidth`;
- **dialog entro la viewport**: `bottom <= clientHeight` a tutte e quattro le
  larghezze, con `overflow-y: auto` e `max-height` derivata da `100dvh`
  (868 px a 1440, 768 px a 1024, 820 px a 390, 616 px a 320);
- **target touch**: i pulsanti del footer misurano **40 px** su desktop e
  **44 px** su mobile (390 e 320), dove passano anche a larghezza piena;
- **blocker visibile e vincolante**: la riga «Gruppo 2» è resa in rosso, il
  motivo è `role="alert"` e il pulsante «Conferma attivazione» risulta
  `disabled` su tutte e quattro le larghezze;
- **nessun separatore orizzontale sopra il footer**: gli unici bordi presenti
  sono quelli **perimetrali** delle card metrica e delle righe percorso, non una
  riga di separazione;
- **nessun nome inventato**: le righe portano «Nessuna etichetta» e i nomi
  passati dal preflight, e nessuna stringa dell'interfaccia contiene un esempio
  diagnostico.

## 4. Comportamento noto, dichiarato

A **320 px** il dialog si apre già scorso verso il footer. Non è un difetto di
questo componente: `DialogShell` porta il focus sul primo elemento focalizzabile
al montaggio (qui «Annulla», perché «Conferma attivazione» è disabilitata dal
blocker) e il browser lo porta in vista. È il comportamento condiviso da ogni
dialog dell'applicazione dalla sua introduzione; cambiarlo tocca la primitiva
comune e non appartiene a questo pacchetto. Il contenuto resta interamente
raggiungibile scorrendo, e a 390 px il riepilogo entra per intero senza scroll.

## 5. Che cosa questo smoke non dimostra

Che la transazione committi, che i contatori si muovano, che le guardie blocchino
davvero. Sono cose che uno screenshot non può mostrare e che sono verificate dove
si possono verificare: test di service sulla transazione simulata, test puri
sulle guardie, test Functions sul risolutore e sulla callable.
