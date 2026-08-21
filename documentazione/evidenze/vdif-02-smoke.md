# VDIF-02 — smoke dei componenti reali

> **Evidenza storica di fase.** Il Gate GVDIF è stato successivamente superato;
> vedi [`gvdif-human-gate.md`](gvdif-human-gate.md).

**Data:** 12 agosto 2026. **Nessun deploy**, nessun rollout: lo smoke gira in
locale sui componenti dell'applicazione, non su DEV. **Gate GVDIF aperto.**

---

## 1. Che cosa è stato messo sotto smoke

I componenti **reali**: `StudentIdentityFields` (i due controlli «Classe» ed
«Etichetta» della card studente) con `StudentsView.module.css`, dentro
`RecordCard` con il proprio CSS module, e il foglio globale `index.css`. Nessuno
stile è stato riprodotto per l'occasione.

Il montaggio è avvenuto tramite un **entry Vite temporaneo**
(`apps/web/vdif02-smoke.html` + `src/vdif02-smoke.tsx`) che passa quattro card di
prova: senza etichetta, con un'etichetta dal nome lungo, con un errore di
assegnazione visibile, e con il controllo in stato `disabled`. Quell'entry è
stato **rimosso prima del commit** e non compare nel diff: serviva solo a montare
i componenti senza autenticare un docente reale.

**Limite dichiarato:** le mutazioni (assegnare, cambiare, togliere l'etichetta,
rimuovere lo studente) **non** sono state eseguite contro Firestore in questo
smoke, perché richiederebbero un owner autenticato. Sono coperte da 37 test di
service su una transazione simulata fedele (letture registrate anche sui
documenti assenti, snapshot di lettura coerente per tentativo, conflitto al
commit con retry, sentinel `serverTimestamp()` risolti dal commit), 24 test Rules
su emulatore reale, 58 asserzioni strutturali di privacy e 16 test UI. Lo smoke
visivo copre ciò che quei test non possono vedere: layout, densità, target
touch, overflow.

## 2. Screenshot

Catturati con Chromium reale via **Chrome DevTools Protocol**
(`Emulation.setDeviceMetricsOverride`), perché Chrome su Windows impone una
finestra minima di 500 px e `--window-size` produrrebbe un layout desktop
ritagliato invece di un vero viewport mobile.

| Immagine | Viewport | Contenuto |
|---|---|---|
| [`vdif-02-smoke/vdif02-card-1440.png`](vdif-02-smoke/vdif02-card-1440.png) | 1440 × 900 | quattro card: senza etichetta, nome lungo, errore visibile, controllo disabilitato |
| [`vdif-02-smoke/vdif02-card-1024.png`](vdif-02-smoke/vdif02-card-1024.png) | 1024 × 800 | stesse card |
| [`vdif-02-smoke/vdif02-card-390.png`](vdif-02-smoke/vdif02-card-390.png) | 390 × 844 | card mobile |
| [`vdif-02-smoke/vdif02-card-320.png`](vdif-02-smoke/vdif02-card-320.png) | 320 × 640 | card alla larghezza minima |

## 3. Misure raccolte

Misurate nel DOM reale a ciascuna delle quattro larghezze:

- **nessun overflow orizzontale**: `scrollWidth == clientWidth` su
  `documentElement` **e** su `body` (1440/1024/390/320), e **nessun elemento**
  con `right > clientWidth`;
- **desktop (1440 e 1024): Classe ed Etichetta sono sulla stessa riga** — le due
  select hanno lo stesso `top` (91 px), larghezza 224 px ciascuna;
- **mobile (390 e 320): Etichetta è incolonnata sotto Classe** — `top` 110 vs
  190 px a 390, 107 vs 187 px a 320; nessuna delle due divide la riga con
  l'altra;
- **target touch**: su mobile entrambe le select misurano **44 px** di altezza
  (260 px di larghezza a 320, piena larghezza della card);
- **errore ancorato alla card**: il messaggio è `role="alert"` ed è collegato
  via `aria-describedby` **alla sola select dello studente interessato**
  (verificato: l'unico `select` che punta all'id dell'alert è «Etichetta di
  Carla Colombo»), su tutte e quattro le larghezze;
- **nessun `labelId` a schermo**: le opzioni portano il nome dell'etichetta; il
  valore tecnico resta nell'attributo `value`;
- **nessun esempio diagnostico** in nessuna stringa dell'interfaccia.

## 4. Che cosa questo smoke non dimostra

Che la scrittura vada a buon fine, che i contatori si muovano, che le Rules
neghino allo studente. Sono cose che uno screenshot non può mostrare e che sono
verificate dove si possono verificare: test di service, test Rules su emulatore,
test strutturali di privacy.
