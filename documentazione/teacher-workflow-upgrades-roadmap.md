# TWU — Teacher Workflow Upgrades (roadmap)

Interventi circoscritti di rifinitura e correzione del flusso docente, **senza
nuove funzionalità di prodotto**. Nessun redesign, nessuna nuova dipendenza,
nessuna Cloud Function nuova, nessun indice nuovo, nessun listener/polling
aggiuntivo. `Gate GTWU` resta **APERTO**.

## Stato pacchetti

| Pacchetto | Descrizione | Stato |
|---|---|---|
| **TWU-01** | Fix immediati e polish: ellissi preview picker, icone SVG coerenti nei messaggi VEX, pulsante «Aggiorna» consegne, contratto primo/ultimo accesso studente. | **Implementato** |
| TWU-02 | — (non ancora avviato) | Aperto |
| TWU-03 | — (non ancora avviato) | Aperto |
| TWU-04 | — (non ancora avviato) | Aperto |
| TWU-05 | — (non ancora avviato) | Aperto |
| Gate GTWU | Verifica finale del pacchetto TWU. | **APERTO** |

---

## TWU-01 — Fix immediati e polish del flusso docente ✅ IMPLEMENTATO

Quattro interventi indipendenti. **Solo client** salvo la Rule di accesso
studente (Task 4). Nessun deploy, nessun merge automatico.

### Task 1 — Ellissi nella preview del picker domande
- `QuestionPicker`: la preview è **clampata a due righe** con ellissi CSS reale
  (`-webkit-line-clamp: 2`), dentro un contenitore flex con `min-width: 0` per
  non forzare overflow orizzontale su mobile.
- Il **dato originale non è troncato**: il testo completo resta nel DOM (nome
  accessibile) ed è disponibile via `title` all'hover.
- Nessuna modifica a ricerca/selezione/filtri/ordinamento/persistenza; nessuna
  nuova lettura.

### Task 2 — Icone SVG coerenti nei messaggi VEX
- Rimossi i glifi testuali usati come pseudo-icona (`✕`, `!`, `ℹ`, `↻`) dai
  messaggi del builder VEX (`VexBuilder`).
- Ora usano il set **SVG inline del progetto** (`components/icons.tsx`),
  decorative (`aria-hidden`), con `currentColor` che eredita il colore
  semantico del messaggio:
  - **errore** (`IconCircleX`, colore errore, `role="alert"`),
  - **warning** (`IconTriangleAlert`, ambra, `role="status"`),
  - **info** (`IconInfo`, primario, `role="note"`),
  - nota d'ordine (`IconRotateCcw`).
- Aggiunte al set `IconInfo` e `IconCircleX` (SVG interni, **nessuna libreria**).
- Nessuna modifica alle validazioni VEX, all'autogroup, allo snapshot o alla
  persistenza.

### Task 3 — Pulsante «Aggiorna» nelle consegne
- Pulsante «Aggiorna» nella toolbar «Consegne online» (icona refresh
  `IconRotateCcw` + testo; `aria-label="Aggiorna consegne"`; label collassabile
  su viewport molto stretto).
- Al click esegue **una sola orchestrazione di refresh** che **riusa i service
  già presenti**: `loadCorrectionProgressByStudent` (stato correzioni /
  «Valutate») e `listStudents` (roster classe). **Nessuna nuova query/indice**,
  nessun listener, nessun polling; la lista consegne resta servita dal listener
  già attivo.
- Guardia sincrona anti doppio-click (ref), stato «Aggiornamento…» con pulsante
  disabilitato, feedback discreto «Aggiornato ora» via `aria-live="polite"`,
  errore leggibile che **mantiene i dati correnti**, nessun update dopo unmount,
  StrictMode-safe. Selezione, filtri e ordinamento conservati; checkbox non
  deselezionate.
- **Costo letture:** invariato a regime (nessun costo passivo aggiunto). Il
  refresh manuale costa esattamente **2 letture** per click — la lettura
  aggregata delle correzioni della verifica (`loadCorrectionProgressByStudent`)
  e la lettura del roster studenti (`listStudents`) — le stesse già eseguite
  all'apertura del monitor. Zero letture finché il docente non clicca.

### Task 4 — Primo e ultimo accesso studente

**Causa del bug `lastLoginAt`.** `lastLoginAt` (e `createdAt`) venivano scritti
**una sola volta**, dentro `requestStudentAccess`, al momento della richiesta
iniziale di accesso. Non venivano mai aggiornati agli ingressi successivi:
rappresentavano quindi la **data di richiesta**, non l'ultimo accesso reale.

**Contratto definitivo dei timestamp (nessuna migrazione distruttiva):**
- `createdAt` / `lastLoginAt` — timestamp della **richiesta**; la UI docente li
  mostra come **«Richiesta accesso»** (non più «Primo accesso»).
- `firstPortalAccessAt` *(opzionale, nuovo)* — scritto alla **prima apertura
  effettiva** del portale studente dopo l'approvazione; una volta presente è
  **immutabile**. Mostrato come **«Primo accesso»**.
- `lastPortalAccessAt` *(opzionale, nuovo)* — scritto nello **stesso** momento
  del primo accesso e **aggiornato a ogni ingresso effettivo** successivo.
  Mostrato come **«Ultimo accesso»**.
- Fonte autorevole: sempre `serverTimestamp()` / `request.time`, **mai**
  `Date.now()` persistito.
- **Al più una scrittura per ingresso** applicativo (guardia in `RoleGate`,
  StrictMode-safe). Nessun listener/polling. I documenti **legacy** senza i
  nuovi campi mostrano «—» finché non avviene un nuovo accesso reale (nessuna
  invenzione di `firstPortalAccessAt` da vecchi timestamp).

**Writer client-side (nessuna Cloud Function).** `RoleGate`, all'atto di
risolvere uno studente **approvato con portale attivo**, chiama
`recordPortalAccess(uid, hasFirstAccess, db)` una sola volta per ingresso.
È **non bloccante**: un errore di scrittura non nega il portale a chi è già
autorizzato — viene solo loggato un messaggio sanitizzato, senza dati personali.

**Security Rules.** `students/{uid}` `allow update` ammette, oltre al docente,
solo un `isOwnPortalAccessPing(uid)`: studente **autenticato**, **stesso uid**,
documento già **`approved`**; `affectedKeys ⊆ {firstPortalAccessAt,
lastPortalAccessAt, updatedAt}`; `lastPortalAccessAt == request.time` (mai
eliminabile); `firstPortalAccessAt` impostabile **solo se prima assente** e
`== request.time`, poi **immutabile** e non eliminabile; `updatedAt`, se
toccato, `== request.time`. Ogni altro campo (status/classe/nome/email/owner)
resta invariato. Docente non-owner, altro studente, pending/rejected e anonimo
sono negati; l'owner conserva le sole autorizzazioni già previste.

**Letture/scritture accessi:** invariate le letture (RoleGate legge già il
documento studente). Aggiunta **una scrittura** `students/{uid}` per ingresso
effettivo di uno studente approvato (una `updateDoc` con 1 o 2 campi
timestamp). Nessuna lettura/scrittura per pending/blocked/portale disattivo.

### Rischi residui
- L'accuratezza di «Ultimo accesso» dipende dal passaggio da `RoleGate`: un
  ingresso che non attraversa il gate (improbabile nel flusso attuale) non
  aggiorna il timestamp. Accettabile: il campo è telemetria, non autorizzazione.
- I documenti legacy restano a «—» per primo/ultimo accesso finché lo studente
  non rientra: comportamento voluto (nessuna migrazione).

### Fuori perimetro / stato invariato
- Functions, provider IA, prompt, costi IA e VEX runtime **non toccati**.
- Nessun nuovo indice Firestore. `firestore.rules` modificato **solo** per la
  Rule di accesso studente sopra.
- TWU-02/03/04/05 invariati; Gate GTWU **APERTO**; nessun deploy, nessun merge.
