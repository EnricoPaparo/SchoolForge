# TWU — Teacher Workflow Upgrades (roadmap)

Interventi circoscritti di rifinitura e miglioramento del flusso docente.
Nessun redesign, nessuna nuova dipendenza, nessuna nuova Cloud Function, nessun
nuovo indice, nessun listener/polling aggiuntivo. `Gate GTWU` resta **APERTO**.

## Stato pacchetti

| Pacchetto | Descrizione | Stato |
|---|---|---|
| **TWU-01** | Fix immediati e polish: ellissi preview picker, icone SVG coerenti nei messaggi VEX, pulsante «Aggiorna» consegne, contratto primo/ultimo accesso studente. | **Implementato** |
| **TWU-02** | Preferenze predefinite della correzione IA (owner-only) + scelta profilo modello chiuso (`economy`/`quality`), risolto server-side; form condiviso tra i due dialog; gerarchia prompt esplicita. | **Implementato** |
| **TWU-03** | Visibilità batch delle correzioni restituite dalla toolbar «Consegne online». | **Implementato** |
| **TWU-03A** | Toolbar batch ordinata e stato restituzione/soluzioni nella tabella consegne. | **Implementato** |
| **TWU-03B** | Restituzione visibile con soluzioni congelate per default, inclusa la sola variante VEX assegnata. | **Implementato** |
| **TWU-04A** | Contratto import UDA. | **Progettato** — vedi [uda-import-contract.md](uda-import-contract.md) |
| TWU-04B | — (non ancora avviato) | Pendente |
| **CHUNK-RECOVERY-01** | Recovery esplicita dei moduli PDF dinamici obsoleti dopo un deploy, senza reload automatico. | **Implementato** per «Programma svolto (PDF)», Registro Correzioni e CORR-PDF-01 |
| **CORR-PDF-01** | Un PDF scolastico autonomo per ogni consegna selezionata; ZIP soltanto come contenitore di PDF separati quando la selezione è multipla. | **Implementato** — smoke DEV pendente; vedi [correction-archive-export-contract.md](correction-archive-export-contract.md) |
| TWU-05 | Riservato ad altri upgrade del flusso docente. | Pendente |
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
- Al click esegue **una sola orchestrazione di refresh**: riusa
  `loadCorrectionProgressByStudent` (stato correzioni / «Valutate») e
  `listStudents` (roster classe), e dopo TWU-03A include la query mirata delle
  `correctionReturns` della verifica per gli indicatori di visibilità. Nessun
  listener/polling; la lista consegne resta servita dal listener già attivo.
- Guardia sincrona anti doppio-click (ref), stato «Aggiornamento…» con pulsante
  disabilitato, feedback discreto «Aggiornato ora» via `aria-live="polite"`,
  errore leggibile che **mantiene i dati correnti**, nessun update dopo unmount,
  StrictMode-safe. Selezione, filtri e ordinamento conservati; checkbox non
  deselezionate.
- **Costo letture:** invariato a regime (nessun costo passivo aggiunto). Ogni
  click esegue **una sola orchestrazione di refresh** con **tre operazioni di
  caricamento** — progresso correzioni, roster e visibilità restituzioni — le
  stesse già eseguite all'apertura del monitor. Le **letture Firestore
  fatturate sono proporzionali ai documenti restituiti** da quelle query (una
  per documento letto), non un fisso «2 letture». **Zero costo finché il docente
  non clicca**; nessun listener o polling aggiuntivo.

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
- Gate GTWU **APERTO**; nessun deploy, nessun merge.

---

## TWU-03 — Visibilità batch delle correzioni restituite ✅ IMPLEMENTATO

La toolbar «Consegne online» espone un unico menu «Visibilità» con quattro
azioni indipendenti: rendere visibile o nascondere la restituzione e mostrare o
nascondere le soluzioni. Il batch riusa esclusivamente i service autorevoli
`setReturnVisibleToStudent` e `setSolutionsVisible`: nessun accoppiamento
implicito tra i due flag e nessuna duplicazione dei controlli canonici.

Sono elaborabili soltanto correction attualmente `returned`, con
`correctionReturns` coerente con owner e verifica. Il preflight usa lo stato già
caricato e, solo dopo la scelta dell'azione, una lettura puntuale per ciascuna
candidata restituita; i service ripetono le verifiche autorevoli prima della
write. L'esecuzione ha concorrenza massima 3, prosegue dopo errori individuali e
distingue riuscite, no-op, escluse e fallite. Le checkbox restano invariate.

TWU-03A ordina la toolbar come «Correggi con IA → Completa → Restituisci →
Visibilità → Riapri → Azzera» e sostituisce nella sola UI la colonna «Codice»
con «Visibilità». Una query owner-only filtrata per `verificationId`, eseguita
all'apertura e al solo refresh manuale, carica i due flag senza letture per
riga. I documenti incoerenti sono esclusi fail-closed. Dopo un batch, soltanto
gli esiti riusciti/no-op aggiornano la mappa locale confermata dal service; le
righe fallite conservano il valore precedente e non viene eseguita una
rilettura finale. `deliveryCode` resta invariato nel contratto persistito e
negli export.

Costi: zero listener/polling e nessuna scansione globale. La query di
visibilità costa letture proporzionali alle projection restituite all'apertura
o al refresh manuale; le letture puntuali di preflight e le eventuali scritture
restano proporzionali alle righe selezionate;
`setSolutionsVisible(true)` conserva il contratto VEX e include soltanto le
soluzioni assegnate. Rules, Functions e indici restano invariati.

TWU-03B rende la proiezione iniziale già visibile con le soluzioni congelate:
`visibleToStudent: true`, `solutionsVisible: true` e un `correctAnswer` per ogni
domanda. La sola fonte è il `teacherSnapshot` immutabile già letto; non vengono
consultati pool live, Storage o `publishedProjection`. Il resolver canonico VEX
include soltanto la variante assegnata. Snapshot o soluzione malformata
bloccano ogni write e il limite dimensionale è verificato sul documento
completo. Gli esiti batch riusciti aggiornano subito la mappa locale senza una
query aggiuntiva; i toggle TWU-03 restano indipendenti.

TWU-04A resta **progettato**, TWU-04B resta **pendente** e Gate GTWU resta
**APERTO**. Nessun deploy e nessun merge automatico.

---

## CHUNK-RECOVERY-01 ✅ e CORR-PDF-01 ✅ — PDF affidabili e archivio scolastico

Le decisioni complete sono congelate in
[correction-archive-export-contract.md](correction-archive-export-contract.md).

- `CHUNK-RECOVERY-01` è implementato su «Programma svolto (PDF)»: distingue un
  chunk dinamico obsoleto dagli errori generici, rilascia sempre lo stato busy
  e propone «Ricarica pagina» senza reload automatico, passando dalla dirty
  guard esistente. Lo stesso helper tipizzato è ora usato da `CORR-PDF-01` e
  dal Registro Correzioni.
- `CORR-PDF-01` aggiunge alla toolbar delle consegne l'export archivistico: **un
  PDF distinto per ogni studente**. Una selezione multipla produce uno ZIP che
  contiene i PDF separati; **non** viene mai creato un PDF cumulativo.
- Ogni PDF contiene intestazione verifica, studente/classe, domanda, risposta,
  punteggio e correzione per domanda, più feedback generale; esclude soluzioni,
  dati tecnici e alternative VEX non assegnate.
- Generazione locale nel browser, nessuna persistenza, Function, listener o
  polling. Due letture puntuali owner-only per consegna esportabile, concorrenza
  massima 3, modello chiuso e dipendenza ZIP esistente.
- Lo ZIP è all-or-nothing: una consegna incoerente o un renderer fallito
  impedisce ogni download parziale e viene indicato con il nome leggibile dello
  studente.

Ordine residuo: smoke DEV di CORR-PDF-01 e implementazione TWU-04B.
Gate GTWU resta **APERTO**.

---

## TWU-02 — Preferenze predefinite della correzione IA e scelta profilo modello ✅ IMPLEMENTATO

Aggiunge i **valori predefiniti** della correzione IA del docente e la scelta di
un **profilo modello chiuso**. Riusa integralmente il motore IA, il dialog e le
validazioni esistenti (M5, Gate G7 PASS): nessun duplicato. Nessuna nuova
dipendenza, nessuna nuova Cloud Function, nessun nuovo indice, nessun
listener/polling.

### Profili modello (chiusi, risolti server-side)
Il client sceglie **solo** `modelProfile: 'economy' | 'quality'` e **mai** un
model ID o un listino. La risoluzione profilo → (modello tecnico, versione
listino) è **esclusivamente server-side** e fail-closed:

| Profilo | Etichetta | Modello tecnico (server) | Listino |
|---|---|---|---|
| `economy` | Economico | `gpt-5.4-nano-2026-03-17` | `v2-2026-07-17-hg-m5` |
| `quality` | Qualità | `gpt-5.6-luna` | `v5-2026-07-20-luna-dev` |

UI: nome leggibile del profilo, sotto in piccolo il **model ID tecnico** (solo
informativo, non un prezzo) e una descrizione breve (Economico = costo inferiore;
Qualità = feedback più approfonditi, costo maggiore). La **preview esistente**
continua a mostrare la stima reale dell'operazione; nessun prezzo statico inventato.

**Comportamento server (`aiCorrectionModelProfile.ts` + engine):**
- profilo **assente** ⇒ default legacy = profilo del **modello runtime**
  (`settings/aiConfig.model`); su DEV il runtime è Luna ⇒ `quality`. Senza config
  runtime (mock) ⇒ default applicativo `quality`. Comportamento attuale preservato;
- profilo **presente ma nullo/sconosciuto/non-stringa** ⇒ `invalid_input`;
- **nessun fallback silenzioso** Luna↔nano; modello e listino restano una coppia
  accoppiata e verificata (`lookupModelPrice`);
- il profilo **risolto** entra nell'**identità idempotente** (`selectionHash`):
  stesso `requestId` con profilo diverso ⇒ `invalid_input`;
- **preview e run** usano lo **stesso** profilo, modello e listino; la config
  effettiva sostituisce **solo** modello + listino, mantenendo budget, limiti,
  prenotazione conservativa (`costActual ≤ costSettled ≤ costReservation`), retry,
  lease, kill switch e `aiCorrectionRuns` privacy-minimal invariati;
- la risposta continua a riportare modello/listino/costi reali coerenti col
  profilo risolto. Il client non può inviare `model` né `priceListVersion`
  (payload chiuso).

### Preferenze persistenti owner-only — `teacherAiPreferences/{ownerUid}`
Un solo documento, **contratto chiuso**:

```
{ ownerUid, modelProfile: 'economy'|'quality',
  gradingMode: 'compassionate'|'balanced'|'rigorous',
  teacherGuidance?: string, updatedAt: serverTimestamp() }
```

- leggibile/scrivibile **solo** dall'owner; nessun accesso studente; `id == ownerUid`;
  `ownerUid` immutabile e uguale all'utente autenticato; chiavi chiuse; `gradingMode`
  e `modelProfile` enum validati; `teacherGuidance` normalizzata con trim (stringa
  vuota ⇒ campo omesso), stesso limite di 500 caratteri del dialog; `updatedAt`
  sempre `== request.time` (mai timestamp client). Enum sconosciuti, chiavi extra,
  timestamp client e guidance oltre limite **negati** (vedi
  `twu-02-ai-preferences.rules.test.ts`);
- documento **assente** ⇒ default applicativi: `modelProfile` **quality**,
  `gradingMode` **balanced**, `teacherGuidance` vuota. Nessuna migrazione;
- service client tipizzato `loadTeacherAiPreferences` / `saveTeacherAiPreferences`.

**Costo:** **una** get puntuale all'ingresso in Verifiche (StrictMode-safe,
non bloccante), preferenze **in memoria** per la sessione; **una** write solo al
click «Salva». Nessun listener, nessun polling, nessuna lettura per riga/consegna.

### UI — form condiviso
`AiCorrectionSettingsFields` (campi controllati profilo + stile + indicazioni) è
**riusato** sia dal dialog «Impostazioni correzione IA» (pulsante nella barra dei
filtri di Verifiche) sia dalla fase configure di `AiBatchCorrectionDialog`: nessun
markup/logica duplicati. Il dialog impostazioni salva una sola volta (guardia anti
doppio click, feedback `aria-live` save/success/error, nessun update dopo unmount,
Escape/focus trap/restore via `DialogShell`). Il dialog «Correggi con IA» si apre
**precompilato** con le preferenze; le modifiche locali valgono solo per quella
operazione e **non** sovrascrivono le preferenze; ogni cambio dei tre criteri
invalida preview e `requestId`; dopo la stima i criteri sono congelati e
«Modifica impostazioni» torna alla configurazione con una nuova `requestId`.

### Gerarchia minima del prompt
Resa **esplicita** (nessun redesign) in `OPENAI_GRADING_INSTRUCTIONS`, dalla
precedenza più alta alla più bassa: (1) sicurezza, schema e limiti server;
(2) evidenze (domanda, risposta, soluzione docente, `maxPoints`); (3) `gradingMode`;
(4) `teacherGuidance`, applicata concretamente quando compatibile; (5) testo dello
studente, sempre contenuto **non attendibile** e mai istruzione. `teacherGuidance`
non può alterare `maxPoints`, imporre output fuori schema, rendere corretta una
risposta errata, eseguire istruzioni nella risposta studente, né aggirare i
guardrail. Una sola chiamata provider per consegna.

### Letture/scritture (prima → dopo)
- **Preferenze:** prima 0; dopo 1 get all'ingresso in Verifiche + 1 write per
  «Salva». Nessun listener/polling.
- **Correzione IA:** invariata (stesse letture/scritture del run M5); il profilo
  cambia solo modello/listino usati, non il numero di operazioni.

### Fuori perimetro / regressioni evitate
- Non modificati: scoring deterministico delle chiuse, correzione manuale, VEX e
  varianti assegnate, selezione/checkbox batch, azioni Completa/Riapri/Restituisci/
  Azzera, struttura submission/correctionReturn, StudentShell, secret provider,
  budget ceiling, TTL. `settings/aiConfig` resta kill switch e fonte di
  limiti/budget, mai leggibile dal client.
- `firestore.rules` modificato **solo** per il nuovo documento owner-only.
- Gate GTWU **APERTO**; nessun deploy, nessun merge.
