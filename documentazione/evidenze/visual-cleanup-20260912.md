# VISUAL-CLEANUP-20260912 — evidenza sintetica

**Task:** `VISUAL-CLEANUP-20260912` (manifest `schoolforge-agent-task/v1`).
**Issue:** #487. **Branch:** `fix/visual-proposal-pool-cleanup`.
**Baseline:** `99a170c60af4c8c1eb39565691eaafe6b1cf639a` (merge PR #486).
**Implementer:** Claude (unico writer sul branch). **Reviewer:** codex.
**Diagnosi:** confermata dal controller, non ripetuta qui.
**PR:** #488, draft, `closes #487`.

## Review ciclo 1 — `fix_required`, entrambi i blocker chiusi

SHA revisionato: `600bc0b9077d61dd6ac6efd4318bd80b3ef9f4df`.

1. **Blocker (functions):** `repairProviderDecision` componeva il conteggio
   etichette e il taglio di lunghezza in sequenza; il taglio poteva scartare
   proprio la coda del subject grezzo dove viveva un difetto di forma
   (etichetta troppo lunga o caporali sbilanciate), mascherandolo. Fix: nuova
   `hasInvalidRawLabelForm`, valutata sul subject **grezzo** prima di
   qualunque riparazione — se la forma è invalida, nessuna delle due
   riparazioni viene applicata e il parser strict rifiuta. Aggiunti due test
   combinati (etichetta di coda troppo lunga e caporale di coda sbilanciata,
   entrambi sovralunghi entro 1.5×, riproducendo esattamente i casi di review)
   che restano invalidi; i test di riparazione benigna (sforamento di
   lunghezza puro, >8 etichette ben formate) restano verdi invariati.
   Dettaglio in §2 sotto (aggiornato) e nel diff di
   `functions/src/aiContentVisualPlanProposal.ts`.
2. **Blocker (evidenza):** §6 di questo documento ometteva che
   `aiVisualPlanAuthorize` esegue direttamente `selectContentProvider`/
   `generateContent` (non passa da `aiContentGateway.ts`) e va quindi incluso
   nel set di deploy. Corretto in §6 con elenco/comando espliciti
   (`--project schoolforge-dev --config firebase.json`, Hosting incluso per il
   fix UI). Nessun deploy eseguito.

Nessun blocker lato UI. Gate completo locale e CI su `600bc0b` verdi (dato dal
controller, non ripetuto qui).

---

## 1. Perimetro toccato

Solo i path del manifest, nessun altro scope:

- `functions/src/aiContentVisualPlanProposal.ts`
- `functions/src/aiContentVisualProposal.ts`
- `functions/src/aiContentPrompt.ts`
- `functions/src/aiContentVisualPlanProposal.test.ts`
- `functions/src/aiContentVisualProposal.test.ts`
- `apps/web/src/features/teacher/CourseWorkspace.tsx`
- `apps/web/src/features/teacher/QuestionPoolEditor.tsx`
- `apps/web/src/features/teacher/__tests__/CourseWorkspace.test.tsx`
- `apps/web/src/features/teacher/__tests__/QuestionPoolEditor.test.tsx`
- `documentazione/evidenze/visual-cleanup-20260912.md` (questo file)

Non toccato: `aiContentPrompt.test.ts` (non esisteva; i test di prompt restano
co-locati come già in uso nei due file `*VisualP*Proposal.test.ts`),
`poolEditorService.ts` (non serviva alcuna modifica: `deletePool` era già
authoritative, vedi §3), `QuestionPoolEditor.crud.test.tsx`/`*.aigen.test.tsx`
(nessuna modifica di comportamento nel loro perimetro; solo eseguiti come gate
di non regressione).

## 2. Fix lato Functions — etichette autorizzate oltre il tetto

**Causa:** una proposta provider ben formata ma con più di 8 etichette «…»
distinte falliva `ai_content_pool_validation_failed` prima di arrivare alle
immagini; la sola riparazione esistente (`repairProviderSubject`, confine
provider) copriva solo un lieve sforamento di lunghezza, non l'eccedenza di
etichette.

**Fix:**

- `aiContentVisualProposal.ts` — `inspectVisualAuthorizedLabels` ora riporta
  anche l'elenco ordinato delle etichette distinte sul ramo `too_many` (prima
  solo su `ok:true`), così il confine provider può riusarlo senza riscannerizzare
  le caporali. Il ramo resta `ok:false`: nessun rilassamento del contratto
  persistito.
- `aiContentVisualPlanProposal.ts` — nuova `repairProviderSubjectLabelCount`,
  composta con `repairProviderSubject` in `repairProviderDecision`: conserva le
  prime 8 etichette distinte (ordine di prima comparsa) e toglie i soli
  caporali alle eccedenti, che restano testo descrittivo — nessuna parola
  persa, nessun aumento del tetto. Non ripara etichette singolarmente troppo
  lunghe né caporali sbilanciate/residue (`invalid_form`): restano invalide,
  stessa disciplina fail-closed di `repairProviderSubject`. Il parser dei run
  persistiti (`validateStoredVisualPlanProposalOutput`) resta strict e non
  passa mai da questa riparazione.
- `aiContentPrompt.ts` — entrambi i prompt (`buildVisualProposalPrompt` e
  `buildVisualPlanProposalPrompt`) ora chiedono esplicitamente di puntare a
  poche etichette (2–4) e di contare le stringhe distinte fra caporali prima
  di rispondere; il plan-proposal prompt non aveva questa istruzione esplicita
  (solo il singolo VE-01 l'aveva). Versioni bumpate:
  `AI_VISUAL_PROPOSAL_PROMPT_VERSION` v6→v7,
  `AI_VISUAL_PLAN_PROPOSAL_PROMPT_VERSION` v1→v2 (bookkeeping benchmark, non
  campo del contratto persistito — non tocca `inputHash`).

**Test aggiunti** (`aiContentVisualPlanProposal.test.ts`, describe
`normalizzazione confinata delle etichette in eccesso del provider`): >8
etichette distinte (conserva 8, declassa il resto), ripetizioni esatte non
contano come nuove distinte, duplicati oltre le prime 8 declassati a ogni
occorrenza, etichetta singolarmente troppo lunga non riparata, caporali
sbilanciate non riparate, confine provider vs parser persistito (stesso
subject: l'envelope grezzo normalizza, `validateStoredVisualPlanProposalOutput`
resta fail-closed). Aggiornato anche il test pinnato
`inspectVisualAuthorizedLabels(...)` too_many in `aiContentVisualProposal.test.ts`
per il nuovo campo `labels`, e i due hash/versioni congelati nel test
"l'aggiunta del quinto kind non sposta un byte degli altri quattro" (rottura
attesa: il prompt VE-01 è stato deliberatamente cambiato in questo task).

## 3. Fix lato UI — cancellazione pool authoritative + reload editor

**Causa 1:** `handlePoolCountChange` (CourseWorkspace) aggiorna solo
`questionCount`/`poolStatus` nell'albero locale, mai `poolStorageRef`. Dopo una
generazione pool nella stessa sessione (partendo da `absent`), il ref locale
resta `null`. `clearLessonData` condizionava la chiamata a `deletePool` su
`lesson.poolStatus !== 'absent' && lesson.poolStorageRef`: con ref locale
`null` la cancellazione veniva saltata, pur essendo il pool realmente presente
su Firestore/Storage. `deletePool` (in `poolEditorService.ts`, non modificato)
rilegge già Firestore in modo authoritative e ritorna senza effetti se lì il
pool è assente — non serviva alcun cambiamento lì, solo rimuovere il gate
locale che lo bypassava.

**Fix 1:** `clearLessonData` chiama sempre `deletePool` (dopo il cleanup
visuale, come da ordine già esistente), lasciando authoritative la decisione
al backend. Guard su verifiche draft e gestione errori invariati (nessuna
modifica a `poolEditorService.ts`).

**Causa 2:** `QuestionPoolEditor` ricarica il pool in un effetto con
dipendenze `[programId, importId, lesson.id, reloadNonce]`. Restando sulla
stessa lezione, una cancellazione lato server non rientra in nessuna di queste
dipendenze: l'editor restava montato con le domande della sessione precedente
anche dopo la cancellazione authoritative.

**Fix 2:** nuova prop opzionale `reloadToken` su `QuestionPoolEditor`,
aggiunta alle dipendenze dell'effetto di caricamento. `CourseWorkspace` tiene
uno stato `poolReloadToken`, incrementato in `clearLessonData` subito dopo
l'aggiornamento dell'albero, e lo passa giù via `LessonDetail`. Nessun
listener o polling aggiunto: è un valore reattivo ordinario, stesso pattern di
`reloadNonce` interno al componente.

**Test aggiunti:**

- `QuestionPoolEditor.test.tsx` — `reloadToken` che cambia forza un nuovo
  `loadPool` anche a `lesson.id` invariato, e lo stato passa da domande
  visibili ad "assente" dopo il reload (issue #487).
- `CourseWorkspace.test.tsx` — regressione end-to-end del bug riportato: pool
  "generato" nella stessa sessione via `onPoolCountChange` (stub esistente
  `set-count-7`, ref locale mai impostato) seguito da "Pulisci lezione" deve
  comunque chiamare `deletePool` e bumpare il reload token dell'editor
  montato. Il mock di `QuestionPoolEditor` in questo file espone ora anche
  `reloadToken` nel testo renderizzato per l'asserzione.

## 4. Gate eseguiti (locali, proporzionati allo scope)

Tutti in questa sessione, cartella di lavoro invariata (`fix/visual-proposal-pool-cleanup`):

| Gate | Comando | Esito |
|---|---|---|
| Format | `prettier --check` sui 9 file toccati | PASS |
| Lint (functions) | `eslint` sui 5 file `functions/src/*` toccati | PASS |
| Lint (web) | `eslint` sui 4 file `apps/web/src/...` toccati | PASS |
| Typecheck (functions) | `tsc --noEmit -p functions` | PASS |
| Typecheck (web) | `tsc --noEmit` in `apps/web` | PASS |
| Test mirati (functions) | `vitest run aiContentVisualPlanProposal.test.ts aiContentVisualProposal.test.ts` | 239/239 PASS |
| Test completi (functions) | `vitest run` (intera cartella `functions`) | 2054 passed, 214 skipped (esistenti, non toccati) |
| Test mirati (web) | `vitest run` su `CourseWorkspace.test.tsx`, `QuestionPoolEditor.test.tsx`, `QuestionPoolEditor.crud.test.tsx`, `QuestionPoolEditor.aigen.test.tsx` | 159/159 PASS |
| Build (functions) | `tsc -p functions` (stesso compilatore del deploy) | PASS |
| `git diff --check` | sui file toccati | PASS, nessun whitespace/marker residuo |

Non eseguiti in questa sessione (fuori scope/proporzionalità dichiarata dal
controller, da coprire nel gate orchestratore completo prima del merge):
`pnpm -r build` (build web completa), `pnpm test:rules` (Security Rules
Emulator — nessuna regola toccata), lint/test dell'intero monorepo.

## 5. Cosa NON è stato fatto (per mandato)

- Nessuna chiamata a provider IA reale: tutti i test usano transport/mock
  esistenti (`jsonTransport`, `createContentProvider({mode:'mock'})`).
- Nessuna lettura di path protetti, secret o dati PROD.
- Nessun merge, nessun deploy (DEV o PROD).
- Nessuna modifica al codice sorgente di `poolEditorService.ts` o di
  `aiVisualPlanGateway.ts` — restano nel bundle di deploy in quanto
  importatori dei moduli toccati (§6), non perché siano stati editati.

## 6. Componenti da distribuire quando autorizzato (corretto in review ciclo 1)

**Correzione rispetto alla prima stesura:** l'evidenza iniziale elencava solo
`aiContentPreview`/`aiContentGenerate` come consumatori dei moduli toccati,
omettendo che `aiVisualPlanAuthorize` importa ed esegue **direttamente**
`selectContentProvider` (`functions/src/aiVisualPlanGateway.ts:336`) e
`generateContent` (stesso file, riga 1283) per la fase testuale della
proposta coordinata — non passa attraverso `aiContentGateway.ts`. Il suo
bundle include quindi la stessa `aiContentPrompt.ts` /
`aiContentVisualProposal.ts` / `aiContentVisualPlanProposal.ts` modificate in
questo task, e va incluso nel set da distribuire.

Nessuna modifica al codice sorgente di `aiVisualPlanAuthorize` stesso: cambia
solo il comportamento dei moduli puri che importa.

Funzioni il cui comportamento osservabile cambia:

- `aiContentPreview`, `aiContentGenerate` (`functions/src/aiContentGateway.ts`)
  — kind `visual_proposal`/`visual_plan_proposal` in preview/generazione.
- `aiVisualPlanAuthorize` (`functions/src/aiVisualPlanGateway.ts`) — stessa
  fase testuale, eseguita inline dentro l'autorizzazione del piano.

Il fix lato UI (§3) tocca `apps/web`, quindi il componente Hosting va incluso
insieme alle tre funzioni in un unico deploy mirato DEV.

Un deploy mirato eventuale (solo DEV, solo se autorizzato dal task corrente,
non eseguito da questo agente) sarebbe quindi:

```
firebase deploy --project schoolforge-dev --config firebase.json \
  --only hosting,functions:aiContentPreview,functions:aiContentGenerate,functions:aiVisualPlanAuthorize
```

seguito da uno smoke umano: generare una lezione con più di 8 etichette
richieste nel soggetto e verificare che la proposta visuale/coordinata superi
la validazione senza ricorrere a tre tentativi falliti (sia dal flusso
`aiContentGenerate` sia da `aiVisualPlanAuthorize`), poi generare un pool
nella stessa sessione da lezione "absent" e verificare che "Pulisci lezione"
elimini davvero pool e indice domande e che l'editor mostri lo stato vuoto.

## 7. SHA e stato finale

- Baseline: `99a170c60af4c8c1eb39565691eaafe6b1cf639a`.
- Commit di questo task: vedi log del branch dopo questo documento (nessun
  merge eseguito da questo agente).
- Nessuna PR preesistente per questo task: aperta una sola PR draft, collegata
  a issue #487, come richiesto.
