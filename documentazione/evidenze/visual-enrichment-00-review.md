# VISUAL-ENRICHMENT-00 — review di fase

> **Gate GVISUAL: PENDING.** Questo documento registra che cosa è stato deciso,
> che cosa è stato verificato e — soprattutto — **che cosa non è stato
> verificato**. Non dichiara superato alcun gate e non approva alcuna resa
> visiva: l'approvazione è del docente e nessuna misura automatica la sostituisce.

**Fase:** VISUAL-ENRICHMENT-00 — contratto e prototipo.
**Data:** 22 agosto 2026.
**Base:** `main` @ `00eb45e` (`docs(ops): record SGW-02C production rollout (#399)`).
**Contratto:** [`../visual-enrichment-roadmap.md`](../visual-enrichment-roadmap.md)
**Prototipo:** [`../prototipi/lesson-visual-enrichment.html`](../prototipi/lesson-visual-enrichment.html)

---

## 1. Perimetro effettivo della fase

**Fatto:** contratto architetturale, forma chiusa del manifest, politica di
ancoraggio, ciclo di vita dell'asset, modello di autorizzazione, cost model,
principi di sicurezza congelati, roadmap VE-01→05, prototipo statico a dieci
stati.

**Non fatto, per mandato:** runtime, UI React, Cloud Functions, provider,
Firebase, Rules, Storage, dipendenze, chiamate OpenAI. **Nessuna immagine reale
è stata generata.** L'illustrazione del prototipo è un `<svg>` inline disegnato
a mano.

Il diff tocca **esclusivamente** `documentazione/**`.

---

## 2. Documenti letti e codice ispezionato

### 2.1 Documentazione

Letta nell'ordine prescritto: `INDEX.md`, `lesson-manual-contract.md`,
`mappa-concettuale-roadmap.md`, `ai-content-generation-roadmap.md`,
`storage-gateway-roadmap.md`, `architettura.md`, `api-contract.md`,
`sicurezza.md`, `piano-implementazione.md`.

### 2.2 Codice — percorsi reali verificati

Nessun file risulta spostato rispetto ai percorsi indicati nel mandato. Tutti
esistono agli indirizzi attesi:

| File | Percorso reale | Righe |
|---|---|---|
| Prompt IA contenuti | `functions/src/aiContentPrompt.ts` | 583 |
| Payload/schema IA | `functions/src/aiContentPayload.ts` | 295 |
| Core IA contenuti | `functions/src/aiContentCore.ts` | 770 |
| Corpo lezione manuale | `apps/web/src/components/LessonManualBody.tsx` | 28 |
| Parser manuale isolato | `apps/web/src/components/lessonManualMarkdown.ts` | 236 |
| Workspace docente | `apps/web/src/features/teacher/CourseWorkspace.tsx` | 3030 |
| Primitivo dialog | `apps/web/src/components/DialogShell.tsx` | 153 |

**Repository Storage Gateway** — il mandato lo indicava genericamente; i file
reali sono:

- `functions/src/repositoryGateway.ts` + `functions/src/repositoryGatewayCore.ts`
  (+ `repositoryGatewayCore.test.ts`);
- `apps/web/src/features/repository/gateway/repositoryGatewayClient.ts`;
- rewrite `/api/repository/**` in `firebase.json`.

**Contratto privato/pubblico di mappe concettuali e lezioni svolte** — la
coppia autorevole è `LessonDoc.conceptMapMarkdown` (privato, owner-only) /
`PublicLessonDoc.conceptMapMarkdown` (proiezione presente **solo** con
`completed === true`), con `conceptMapContract.ts`, `conceptMapService.ts`,
`lessonProjectionIdentity.ts` e la transazione `setLessonCompleted`.

---

## 3. Il vincolo che ha determinato l'architettura

La verifica più importante della fase è stata su `storage.rules`:

```
match /repository/{ownerUid}/{allPaths=**} {
  allow read, write: if request.auth != null && request.auth.uid == ownerUid;
}
match /{allPaths=**} { allow read, write: if false; }
```

**Lo studente non ha alcun accesso a Storage, e non per omissione.** M3F-08 ha
rimosso deliberatamente il "second hop" che concedeva a un non-owner
autenticato la lettura diretta del Markdown, chiudendo la lacuna interim di
`sicurezza.md` §3.2a. In più, SGW-01→02C ha rimosso ogni accesso dati diretto a
Storage dal runtime web, e il gateway è **testuale per contratto** (allowlist
`.md` / `.pool.md`, UTF-8): non esiste oggi alcun percorso binario.

Da qui la decisione di §3.3 del contratto — byte canonici in Storage sotto
l'owner, proiezione studente come documento Firestore dedicato — e lo scarto
esplicito delle quattro alternative (Rules per lo studente, `getDownloadURL`,
lettura via Function a ogni apertura, base64 dentro `publicLessons`).

Se in VE-03 si volesse riaprire una di quelle strade, va riaperta **questa**
review, non decisa in implementazione.

---

## 4. Verifiche eseguite

### 4.1 Perimetro del diff

| Verifica | Esito |
|---|---|
| Il diff tocca solo `documentazione/**` | **PASS** |
| Nessun file runtime creato o modificato | **PASS** |
| Nessuna dipendenza aggiunta (`package.json`, lockfile invariati) | **PASS** |
| Nessuna chiamata OpenAI eseguita | **PASS** — nessun codice eseguibile introdotto |
| Nessuna immagine reale generata | **PASS** |
| `git diff --check` (spazi finali, conflitti) | **PASS** |
| `pnpm format:check` | **PASS** |
| Nessun merge, nessun deploy | **PASS** |

> `format:check` copre `{ts,tsx,json,md,yaml,yml}`: i due Markdown di questa fase
> vi rientrano, il prototipo `.html` **no**. È il comportamento preesistente del
> repository, condiviso con tutti i prototipi già presenti, e non è stato
> modificato per questa fase.

### 4.2 Prototipo — verifiche statiche

Eseguite sul file, con esito riproducibile:

| Verifica | Comando / metodo | Esito |
|---|---|---|
| Nessun URL esterno | `grep -nE 'https?://\|src="//\|url\('` | **PASS** — nessuna occorrenza |
| Nessuna risorsa remota | `grep -nE '<link\|<script[^>]+src=\|@import'` | **PASS** — nessuna occorrenza |
| Nessuna chiamata di rete | `grep -nE 'fetch\(\|XMLHttpRequest'` | **PASS** — nessuna occorrenza |
| Nessun `data:` URI | `grep -n 'data:'` | **PASS** — nessuna occorrenza |
| Dieci stati presenti | `grep -c 'class="panel"'` | **PASS** — 10 |
| Nessuna larghezza fissa su contenitori | ispezione delle regole `width` | **PASS** — solo `max-width` e media query |
| `overflow-x: hidden` su `html, body` | ispezione | **PASS** |
| `prefers-reduced-motion: reduce` gestito | ispezione | **PASS** — animazioni e `scroll-behavior` neutralizzati |
| `:focus-visible` con contrasto | ispezione | **PASS** — contorno arancione 2 px, `outline-offset` 2 px |
| Target touch ≥ 44 px | token `--touch: 44px` su `.btn`, `.demo-bar button`, campi | **PASS** strutturale |
| Immagini fluide | `img, svg { max-width: 100%; height: auto }` | **PASS** |
| Riserva di spazio (no layout shift) | `width`/`height` dichiarati sull'`<svg>` della figura | **PASS** strutturale |

### 4.3 I dieci stati richiesti

| # | Stato | Pannello | Presente |
|---|---|---|---|
| 1 | Proposta | `#s1` | ✅ |
| 2 | Generazione | `#s2` | ✅ |
| 3 | Anteprima riuscita | `#s3` | ✅ |
| 4 | Errore | `#s4` | ✅ |
| 5 | Sostituzione di immagine già approvata | `#s5` | ✅ |
| 6 | Conferma di abbandono senza perdita accidentale | `#s6` | ✅ |
| 7 | Vista lezione con lo schizzo inserito | `#s7` | ✅ |
| 8 | Vista studente con immagine | `#s8` | ✅ |
| 9 | Vista studente senza immagine (lezione non svolta) | `#s9` | ✅ |
| 10 | Nessuna immagine utile | `#s10` | ✅ |

Note di merito su tre stati, perché sono quelli che dicono qualcosa di
architetturale e non solo grafico:

- **#5 Sostituzione** mostra **entrambe** le immagini e l'azione si chiama
  «Sostituisci l'immagine attuale», non «Applica». È la resa visiva del
  vincolo «la rigenerazione non sostituisce nulla finché il docente non
  conferma».
- **#9 Studente senza immagine** non contiene **alcun** segnaposto, riquadro
  vuoto o messaggio «disponibile più avanti». Un teaser sarebbe un invito a
  cercare la scorciatoia, ed è lo stesso principio già applicato alla mappa
  concettuale.
- **#10 Nessuna immagine utile** non offre alcun pulsante «genera comunque».
  L'esito è di prima classe, non un guasto da aggirare.

---

## 5. Verifiche NON eseguite — e perché

Questa sezione è la ragione per cui il gate resta PENDING.

### 5.1 Smoke reale a 1440 / 1024 / 390 / 320 px — **NON ESEGUITO**

**Motivo:** l'ambiente di questa sessione non dispone di alcun browser
(`chromium`, `chrome`, Playwright assenti). Le verifiche di §4.2 sono
**statiche**: leggono il CSS e la struttura, non misurano un layout reso.

**Perché la distinzione conta e non è una formalità.** L'evidenza
[`vdif-00-prototipo-visivo.md`](vdif-00-prototipo-visivo.md) §3 documenta due
difetti reali trovati **soltanto** dagli screenshot, con i controlli automatici
**verdi** — fra cui un `display: flex` su classe che batteva per specificità la
regola UA `[hidden] { display: none }`, lasciando visibili insieme tutti i
pannelli. Dichiarare qui un PASS responsive sulla base di un `grep` ripeterebbe
esattamente l'errore che quel documento esiste per non ripetere.

> Nota: il prototipo di questa fase usa `.panel[hidden] { display: none !important }`
> proprio per neutralizzare quella classe di difetto per costruzione. Resta una
> mitigazione, non una verifica.

**Procedura richiesta prima del gate**, identica a quella già usata per VDIF-00:

Chromium reale in headless, pilotato via **Chrome DevTools Protocol** con
`Emulation.setDeviceMetricsOverride` e `Page.captureScreenshot`. **Non**
`--window-size`: su Windows Chrome impone una larghezza minima di finestra di
500 px, e una cattura a 390 px risulterebbe un layout desktop ritagliato.

Per ciascuna combinazione, registrare prima dello scatto:

```
<larghezza>-<stato>   viewport=WxH   scrollW=…   overflowX=sì|no
```

Matrice minima — quattro larghezze × gli stati che le stressano davvero:

| Larghezza | Stati da catturare | Che cosa può rompersi |
|---|---|---|
| 1440 | 3 · 5 · 7 | colonna di lettura 42rem, griglia di confronto a due colonne |
| 1024 | 5 · 8 | passaggio della griglia di confronto, barra della lezione |
| 390 | 1 · 3 · 6 · 9 | footer del dialog a pulsanti impilati, target touch, textarea |
| 320 | 3 · 5 · 10 | griglia metriche a 2 colonne, confronto a 1 colonna, titoli lunghi |

Controlli aggiuntivi al gate: focus visibile con navigazione da tastiera reale;
footer raggiungibile scorrendo a ogni larghezza; console del browser pulita;
`prefers-reduced-motion` verificato attivandolo davvero.

### 5.2 Console pulita — **NON VERIFICATA**

Richiede un browser. Il file non contiene chiamate di rete né dipendenze, quindi
non esistono sorgenti attese di errore, ma «atteso» non è «verificato».

### 5.3 Qualità didattica delle immagini — **NON MISURATA**

Nessuna immagine è stata generata. Che «SchoolForge Sketch v1» produca figure
utili invece di scarabocchi plausibili resta **un'ipotesi**. È il lavoro di
VISUAL-ENRICHMENT-05, ed è legittimo che il Gate GVISUAL concluda che la
funzione non vale il suo costo.

---

## 6. Stato dichiarato

| Elemento | Stato |
|---|---|
| VISUAL-ENRICHMENT-00 | **Implementato come contratto/prototipo** |
| VISUAL-ENRICHMENT-01 | **Aperto** |
| VISUAL-ENRICHMENT-02 | **Aperto** |
| VISUAL-ENRICHMENT-03 | **Aperto** |
| VISUAL-ENRICHMENT-04 | **Aperto** |
| VISUAL-ENRICHMENT-05 | **Aperto** |
| Gate GVISUAL | **PENDING** |

---

## 7. Domande aperte per il gate umano

Nessuna di queste è risolvibile in implementazione: sono decisioni del docente.

1. **La funzione vale il suo costo?** Ogni immagine è una spesa di provider per
   una lezione. È la domanda che il gate esiste per porre, e la risposta «no»
   è pienamente ammissibile.
2. **Il duplicato dei byte è accettabile?** WebP canonico in Storage **e**
   base64 in Firestore quando la lezione è svolta (§3.3, §17.2). Costo
   trascurabile, ma sono due sorgenti di verità legate da `sha256`.
3. **Il limite dell'export ZIP fino a VE-03 è accettabile?** Il manifest viaggia,
   il binario no (§12). In alternativa VE-03 può precedere VE-04.
4. **La coda della lezione è il posto giusto per un'immagine che ha perso
   l'ancora?** L'alternativa scartata era indovinare; l'altra era eliminare.
5. **Una sola immagine per lezione resta il limite giusto** dopo averne viste
   alcune reali, o è una restrizione che si rivelerà arbitraria?
6. **Il tasso di «nessuna immagine utile» sarà credibile?** Se in VE-05
   risultasse vicino a zero, va trattato come **blocker** del prompt, non come
   un buon risultato.
7. **Serve un tetto di spesa dedicato** alle immagini, distinto da quello della
   generazione testuale? Il contratto non ne introduce uno: riusa i tetti
   esistenti.

---

## 8. Scope esatto di VISUAL-ENRICHMENT-01

Fase **backend-only e pura**. Nessuna immagine, nessuna UI, nessuna
persistenza, nessun deploy, nessuna chiamata a provider di immagini.

**Da produrre:**

1. **Nuovo `kind: 'visual_proposal'`** in `AiContentRequest`
   (`functions/src/aiContentCore.ts`), di prima classe: payload chiuso e
   validato, partecipazione esplicita a `canonicalRequest`, `inputHash`,
   `computeOpaqueRunId`, `computeBudgetReservationKey`, stima, prenotazione e
   validazione. **Mai** veicolato come una richiesta `lesson` o `concept_map`.
2. **Payload chiuso**: metadati didattici autorevoli (titolo, sottotitolo,
   difficoltà, concetti chiave, obiettivi, contesto UDA) + corpo della lezione
   come dato **non attendibile**. Profilo forzato a `quality`: `economy` non è
   accettato, nemmeno se inviato.
3. **Prompt dedicato** in `aiContentPrompt.ts`, con `fence()` sul corpo e
   ordine di precedenza esplicito; versione di prompt **propria**
   (`AI_VISUAL_PROPOSAL_PROMPT_VERSION`), separata dalle esistenti. Deve
   istruire esplicitamente il modello a preferire «nessuna immagine utile»
   quando la funzione didattica richiede precisione verificabile (§2.1 del
   contratto).
4. **Structured Output strict** a campi chiusi, con l'esito negativo di prima
   classe:
   ```ts
   { decision: 'none'; reason: string }
   | { decision: 'image'; subject: string; rationale: string;
       anchorHeadingText: string; caption: string; altText: string }
   ```
5. **Validatore del `subject`** puro e fail-closed: ≤ 400 caratteri, non vuoto,
   nessun carattere di controllo, rifiuto di artisti viventi / marchi / persone
   riconoscibili / tentativi di sovrascrivere il preambolo di stile.
6. **Tipi e validatore del manifest** (`LessonVisualManifest`,
   `LessonVisualAnchor`): forma chiusa a chiavi esatte, nessuna proprietà extra,
   nessuna correzione silenziosa. Puri, senza Firebase.
7. **Risolutore d'ancora puro**: dato uno slug e l'elenco degli slug presenti nel
   documento, restituisce `resolved` oppure `fallback`, secondo §5.3. Nessuna
   euristica di somiglianza, in nessuna forma.
8. **Costanti**: `MAX_VISUAL_BYTES = 204_800`, `MAX_VISUAL_LONG_EDGE = 1200`,
   `VISUAL_STYLE_VERSION = 'schoolforge-sketch/v1'`, TTL staging allineato a
   `AI_CONTENT_RUN_TTL_MS`.
9. **Test di non-regressione byte-identica**: gli `inputHash` congelati di pool
   e lezione — già costanti nei test esistenti — **non devono spostarsi di un
   byte**, e va aggiunto l'equivalente per `concept_map`. Un terzo kind non può
   invalidare in silenzio i run già memorizzati.

**Esplicitamente fuori da VE-01:** provider di immagini, byte, Storage,
gateway binario, Firestore, Rules, UI, proiezione studente, export/import,
deploy.

**Definition of Done:** `pnpm typecheck`, `pnpm lint`, `pnpm test` verdi;
non-regressione degli `inputHash` dimostrata; nessuna dipendenza nuova; nessun
file web modificato; nessun deploy.
