# HARD-00 — Audit generale finale V1 (read-only, evidence-based)

**Data:** 15 luglio 2026
**Ambito:** intera V1 — M1, M2, M3-lite, RE, QE, M3-full, M4 e DUX; Gate G5/G6/GDUX superati. M5/AI fuori scope.
**Natura:** audit di solo-lettura. **Nessun** file di codice, Security Rule, indice, schema, dipendenza o configurazione è stato modificato; nessun deploy. I finding qui elencati **non** sono corretti in questa fase (per mandato).
**Rapporto con audit precedenti:** questo documento **non duplica** `performance-security-audit.md` (PERF-SEC-01A/01B, costi/prestazioni/Rules su M1→M3-full) né le checklist di gate (`g5`, `g6`, `gdux`, `v1-checklist-finale`). Le assume come baseline verificata, ne conferma o riclassifica i residui aperti alla luce di M4/DUX/SDUX ora inclusi, e aggiunge le aree finora non coperte da un audit dedicato: **operatività, supply-chain/configurazione, privacy/residenza dati, accessibilità, coerenza documentazione↔codice**.

---

## 1. Executive summary

SchoolForge arriva alla soglia V1 in stato **solido e coerente con i suoi obiettivi dichiarati** (minimale, single-owner, client-only, costi bassi, nessun polling). La revisione statica di `firestore.rules`, `storage.rules` e del Cloud Function gateway non ha trovato alcun gap di autorizzazione *non enforced*: isolamento studente, immutabilità post-consegna, ID deterministici legati a `request.auth.uid`, transizioni di stato atomiche via `getAfter()`, impossibilità di auto-promozione/auto-approvazione e blocco dell'enumerazione via `list` sono verificati a livello di regola (§A/§B). L'unico accesso privilegiato che bypassa le Storage Rules — il `repositoryGateway` (Admin SDK) — è protetto da verifica ID-token **owner-only** con allowlist di path e difesa dal traversal equivalente o più stretta delle Rules (`repositoryGatewayCore.ts`).

I tre P2 iniziali riguardavano operatività, residenza dati e hardening Hosting: sono stati risolti da HARD-01A/B/C. Anche il fix a11y P2 e il chunking resiliente dell'import sono completati. Restano soltanto deferral P3 espliciti e condizionati a misure reali.

**Nessun finding P0. Nessun finding P1.** Finding: **3 P2**, **5 P3**.

## 2. Verdetto complessivo

> **GATE GHARD: PASS (15/07/2026).**

L'audit e le remediation minime sono completi. Non restano P0/P1; i tre P2 iniziali sono risolti; i residui P3 sono accettati con soglie esplicite. Le evidenze finali sono in `evidenze/ghard-checklist-finale.md`. Il pass autorizza la chiusura della V1 su DEV e l'avvio progettuale di M5; **non** autorizza provisioning o deploy PROD.

## 3. Punti solidi (verificati)

| # | Area | Evidenza |
|---|---|---|
| 1 | Default-deny globale | `firestore.rules:965` `match /{document=**} { allow read, write: if false }`; `storage.rules:27` default deny. |
| 2 | Owner singleton, nessuna auto-promozione | `settings/owner` create-once (`firestore.rules:220-224`); `isOwner()` confronta `request.auth.uid` con `settings/owner.ownerUid` (:11-16). Lo studente non può scriverlo. |
| 3 | Nessuna auto-approvazione studente | `students/{uid}`: create solo `status=='pending'`, `classId==null`, keyset chiuso; ogni modifica successiva è `update` → owner-only (:279-296). |
| 4 | Isolamento studente | `submissions`/`submissionReceipts`/`correctionReturns` legati a ID deterministico `{verificationId}_{uid}` con `idBelongsToCaller()` (:130-133); `allow get` mai `list` → nessuna enumerazione (:633-635, 696-698). |
| 5 | Immutabilità post-consegna | Nessuna regola di update matcha una submission già `submitted` (:539-541); snapshot domande immutabile in `teacherSnapshot.questions` (SEC-02 risolto). |
| 6 | Atomicità multi-doc | `getAfter()` lega submission↔receipt (:565-575), correction↔return (`correctionDataAfter`, :155-157, 925-931), mirror correction-status. |
| 7 | Class-gate server-side | `publishedProjection`/`publicLessons`/`programs` filtrati per `classId` risolto dal server (`isClassmateOf`, :59-63), mai da un `classId` fornito dal client. |
| 8 | Modalità verifica | `examModeAppliesToClass()` (:76-89) inibisce discovery Didattica alla classe interessata senza toccare le submission in corso. |
| 9 | Storage owner-only | `repository/{ownerUid}/**` richiede `request.auth.uid == ownerUid` (:22-24); lo studente legge il corpo lezione solo da `publicLessons.content` (proiezione Firestore) — gap M3F-07 chiuso da M3F-08. |
| 10 | Gateway privilegiato blindato | `authorizeOwner()` su `settings/owner` (fonte autoritativa), allowlist path + anti-traversal + cap dimensioni + log non sensibile (`repositoryGatewayCore.ts`). |
| 11 | Nessun segreto nel repo | Solo `.env.example`; `.env`/`.env.local` git-ignored; chiavi Firebase client pubbliche per design (`lib/firebase.ts`). |
| 12 | XSS Markdown mitigato | `DOMPurify.sanitize` prima di `dangerouslySetInnerHTML` (`MarkdownRenderer.tsx:16-18`). |
| 13 | Costi/prestazioni | code-splitting per ruolo (PERF-10), autosave dirty-only 120s, zero polling, listener singoli con cleanup, count aggregato server-side, guard di cancellazione mirate (PERF-SEC-01B). |

## 4. Matrice delle superfici analizzate

| Area | Metodo | Esito |
|---|---|---|
| A. Auth/autorizzazione | Lettura Rules + gateway core, incrocio con service client | Nessun gap enforced; owner/student/pending/blocked/unknown coerenti |
| B. Firestore/Storage Rules | Lettura integrale `firestore.rules`/`storage.rules`, matrice CRUD per collezione | Coerente col client; transizioni e immutabilità verificate |
| C. Ciclo di vita dati | Lettura service import/pool/verifiche/correzione + Rules | Coerente; orfani noti innocui (proiezione sotto verifica cancellata) |
| D. Concorrenza/resilienza | Lettura service + Rules `getAfter`/batch/transaction | Atomicità sui path critici; PERF-03 (chunking) deferral |
| E. Costi/prestazioni Firebase | Baseline PERF-SEC-01A/01B + conteggi operazioni + M4 | Entro quote per scenari A/B; §6 cost model |
| F. Performance frontend | `pnpm build` in sessione | Entry 643.67 KB / 164.05 KB gzip; split ruolo confermato |
| G. Privacy/dati personali | Grep PII/log/storage + residenza | F02 (residenza), sessionStorage non-PII, DOMPurify ok |
| H. Supply-chain/config | `package.json`, lockfile, CI, `.gitignore`, `firebase.json` | F03 (headers), F04 (App Check); lockfile frozen in CI |
| I. Operatività | Ricerca runbook/backup/budget | F01 (assenti/non documentati) |
| J. Accessibilità/UX | Baseline GDUX + spot-check | F08 (nessun audit a11y formale) |
| K. Coerenza doc↔codice | Incrocio doc/region/SGW | F02 (region); SGW-02C import diretto = limite accettato |

**Verifiche eseguite:** `pnpm format:check` (PASS); `pnpm build` (PASS, baseline bundle §F). **Non** rieseguito `pnpm test:rules`: la matrice Rules è coperta dalla suite esistente inclusa nella **CI verde corrente** (baseline del mandato) ed è stata rivista staticamente riga per riga qui — nessun dubbio concreto ne richiedeva la riesecuzione. Nessun test aggiunto (per mandato).

## 5. Finding

Classificazione: **P0** perdita dati/accesso critico/segreto esposto · **P1** rischio concreto importante · **P2** debito reale non urgente · **P3** polish.

### P0 — nessuno
### P1 — nessuno

### P2

---
**HARD-F01 — Operatività: nessun runbook di provisioning/incidente, backup automatico o budget alert documentati.**
- **Stato (dopo HARD-01A):** **RESOLVED (15/07/2026).** Runbook operativo (`runbook-operativo-v1.md`) e Human Gate (`evidenze/hard-01a-human-gate.md`) completati; budget alert DEV configurato e verificato, politiche operative approvate. DEV e PROD restano separati e nessun dato DEV sarà migrato in PROD.
- **Area:** I (operatività) / E (costi).
- **Evidenza:** assenza di `documentazione/firebase-provisioning-runbook.md` (verificata: non presente in `documentazione/`); `README.md:104` dichiara "RPO V1: best-effort (export manuale del Docente), RTO non garantito"; nessun documento descrive una soglia di **budget alert** Blaze, una cadenza di export Firestore/Storage, o una procedura per account owner compromesso. `performance-security-audit.md:398` nota il budget alert come "da riverificare", non come configurato.
- **Scenario concreto:** (a) su piano Blaze, un picco di costo — o l'abuso del Function endpoint da bot non autenticati (vedi F04) — non ha alcun tetto automatico che avvisi o fermi la spesa; (b) una cancellazione accidentale (es. `deleteProgram` sul programma sbagliato, o cancellazione manuale in Console) non ha una procedura di restore documentata oltre all'export manuale, la cui cadenza non è fissata; (c) se l'account Google owner viene compromesso non esiste una procedura scritta.
- **Impatto:** costo non limitato + perdita dati potenzialmente non recuperabile. **Probabilità:** bassa (uso personale) ma impatto alto se si verifica. **Impatto economico:** potenzialmente illimitato in assenza di budget alert su Blaze.
- **Soluzione minima:** un runbook (`firebase-provisioning-runbook.md`) che documenti: soglia e destinatario del **budget alert** Cloud Billing; cadenza di **export** Firestore (scheduled export o export manuale con periodicità dichiarata) e conferma del **versioning** bucket Storage (già citato in `architettura.md:250`); passi minimi per **account owner compromesso** (revoca sessioni, rotazione, ri-claim `settings/owner`); separazione DEV/PROD già presente in `architettura.md:258`. **Nessuna** nuova Cloud Function o dipendenza richiesta.
- **File probabilmente coinvolti (in remediation):** solo documentazione + configurazione Console (fuori repo). **Test:** n/a (operatività). **Confidenza:** alta.

---
**HARD-F02 — Privacy/residenza dati: la documentazione dichiara `europe-west8` (Milano) ma bucket Storage e Function gateway reali sono `us-central1`.**
- **Stato (dopo HARD-01C):** **RESOLVED (15/07/2026).** Stato DEV riconciliato (Storage/Function `us-central1`, Firestore `europe-west8` verificata); target PROD **`europe-west8`**, co-locazione e stop-on-incompatibility formalizzati; nessun dato DEV sarà migrato. Nessun servizio PROD creato, abilitato o fatturato.
- **Area:** G (privacy) / K (coerenza).
- **Evidenza:** `architettura.md:26,249,250,536` e `README.md:104` affermano Firestore/Storage/Functions in `europe-west8` (Milano); `functions/src/repositoryGateway.ts:26-31` documenta invece, con output `gcloud storage buckets describe … → location: US-CENTRAL1`, che il bucket DEV e la Function girano in `us-central1`. Il gateway trasporta contenuti lezione/pool; i dati personali studente (nome, cognome, email, risposte, punteggi, attention events) risiedono in Firestore, la cui region non è stata verificabile in questa sessione ma è dichiarata anch'essa Milano.
- **Scenario concreto:** una scuola italiana adotta SchoolForge assumendo — dalla documentazione — residenza UE dei dati personali degli studenti; i dati (o almeno Storage/Function) sono in realtà negli USA. Contraddizione doc↔codice e potenziale questione di residenza/GDPR per PII di minori.
- **Impatto:** conformità/aspettativa di residenza dati non soddisfatta; documentazione fuorviante. **Probabilità:** certa (già vero oggi su DEV). **Impatto economico:** nullo diretto; potenziale reputazionale/conformità.
- **Soluzione minima:** riconciliare **verificando la region reale di Firestore, Storage e Functions su PROD** e poi *o* allineare le risorse alla region documentata *o* correggere `architettura.md`/`README.md` per dichiarare le region effettive e l'implicazione di residenza. Decisione del docente, non risolvibile in un audit.
- **File probabilmente coinvolti:** `architettura.md`, `README.md`; eventuale re-provisioning Console (fuori repo). **Test:** n/a. **Confidenza:** alta sullo stato DEV (Storage/Function verificati in `us-central1`; Firestore verificata via Firebase CLI in `europe-west8`), media sulla futura configurazione PROD ancora da decidere.

---
**HARD-F03 — Configurazione: nessun security header né policy di cache su Firebase Hosting.**
- **Stato (dopo HARD-01B):** **RESOLVED (15/07/2026).** Aggiunto in `firebase.json` il blocco `headers` (X-Content-Type-Options, X-Frame-Options, Cross-Origin-Opener-Policy `same-origin-allow-popups`, Referrer-Policy, Permissions-Policy, CSP enforced con `script-src` che include `https://apis.google.com`) e la strategia cache (`no-cache` sulla shell, `immutable` su `/assets/**`, `no-store` su `/api/repository/**`); guardrail statico in `apps/web/src/hostingHeaders.test.ts`. Deployato su `schoolforge-dev` (PR #179/#180/#181) e verificato: header/cache via HTTP reale, flussi applicativi (login Google docente/studente, lezioni, salvataggio Didattica, gateway, download PDF/CSV/ZIP, verifica online) confermati manualmente dal docente su DEV. I warning COOP di Chrome sul polling della popup Auth sono rumore browser noto, non violazioni CSP. Evidenze in `evidenze/hard-01b-dev-smoke.md` (12/12 PASS).
- **Area:** H (config) / difesa in profondità.
- **Evidenza:** `firebase.json` (hosting) non ha alcun blocco `headers`: nessun `X-Content-Type-Options: nosniff`, `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`, `Content-Security-Policy`, né `Cache-Control` per gli asset con hash in `/assets/*`.
- **Scenario concreto:** l'app monta HTML sanificato da Markdown (`MarkdownRenderer`), quindi il vettore XSS principale è già mitigato da DOMPurify; l'assenza di CSP resta però una mancanza di **difesa in profondità** (una singola svista futura nella sanificazione non avrebbe un secondo argine), e l'assenza di `nosniff`/`frame-ancestors` lascia aperti MIME-sniffing e framing/clickjacking. La mancanza di `Cache-Control immutable` sugli asset con hash è una piccola inefficienza di banda su Hosting.
- **Impatto:** basso e indiretto (nessun buco attivo noto). **Probabilità:** bassa. **Impatto economico:** trascurabile.
- **Soluzione minima:** aggiungere a `firebase.json` un blocco `headers` con `nosniff`, `X-Frame-Options: DENY` (o CSP `frame-ancestors 'none'`), `Referrer-Policy: strict-origin-when-cross-origin`, una CSP conservativa compatibile con Firebase Auth/Firestore, e `Cache-Control: public, max-age=31536000, immutable` su `/assets/**`. Modifica di sola configurazione, da validare con uno smoke DEV (login Google + rendering).
- **File probabilmente coinvolti:** `firebase.json`. **Test:** smoke DEV manuale (login popup, rendering Markdown, download PDF non rotti dalla CSP). **Confidenza:** alta.

### P3

---
**HARD-F04 — App Check non configurato (valutazione, non obbligo).**
- **Area:** H (config) / E (abuso costi).
- **Evidenza:** nessun riferimento ad App Check in `apps/web/src`, `functions/src` o config. Il `repositoryGateway` verifica l'ID token e respinge i non-owner con 401/403 rapidi (`repositoryGatewayCore.ts:222-245`); Firestore/Storage sono protetti da Rules.
- **Scenario concreto:** bot non autenticati possono comunque *invocare* l'endpoint Function (`/api/repository/*`) prima del rifiuto 401 → invocazioni fatturate. Mitigato da `minInstances:0`, `maxInstances:3` e rifiuto immediato.
- **Impatto:** basso. **Probabilità:** bassa. **Soluzione minima:** valutare App Check sul Function (attestation) **solo se** una misura reale mostra invocazioni anomale; non introdurlo preventivamente. **Confidenza:** alta. **Non dichiarato obbligatorio** (sproporzionato all'uso attuale).

---
**HARD-F05 — `listVerifications` senza tetto/paginazione sullo storico (carry-over PERF-01, P2→confermato P3 ai volumi attuali).**
- **Area:** E. **Evidenza:** `verificationsService.ts` (getDocs collezione intera, vedi PERF-01 in `performance-security-audit.md:181-190`). **Deferral già documentato** con soglia di rivalutazione (centinaia di verifiche archiviate). Nessuna azione ora. **Confidenza:** alta.

---
**HARD-F06 — Import ZIP + swap `publicLessons` non gestiscono il limite di 500 mutazioni per batch/transazione (carry-over PERF-03).**
- **Area:** D/E. **Evidenza (pre-fix):** `import/importRepository.ts` (batch A = `1+U+L+Q`; transazione B = `2+L₀+L`; nessun chunking). **Scenario:** import di un intero anno con molti pool → fallimento a soglia.
- **Stato: RESOLVED (15/07/2026) con HARD-02B-2.** L'import è ora **chunked e resiliente**: helper condiviso `repository/firestoreChunks.ts` (`BATCH_CHUNK_SIZE=400`, `commitOpsInChunks`, `deleteDocRefsInBatches`) riusato da `importRepository.ts` e `poolEditorService.ts`; protocollo **staging (chunked, invisibile) → switch atomico ≤3 mutazioni (`activeImportId` + `imports/{id}.status='active'` + audit) → cleanup differito** delle **sole** `publicLessons` del vecchio import (`programId+oldImportId`, chunk ≤400, `superseded` best-effort se il doc esiste; mai UDA/lezioni/questionIndex/Storage — `import/stalePublicLessonsCleanup.ts`, idempotente e ritentabile via `retryStalePublicLessonsCleanup`). Macchina a stati `staging→active→superseded` (`ImportDoc.status`, legacy `'committed'`/assente = active se `== activeImportId`, altrimenti superseded; nessuna migrazione automatica). Risultato tipizzato: errore pre-switch → `not_applied` («Import non applicato: il corso precedente è rimasto intatto.», nessun rollback finto); switch riuscito → `committed`; cleanup fallito → `committed`+`cleanupPending: true` (avviso soft «Import completato. Pulizia delle vecchie proiezioni rinviata.»). Guardia doppio-click su Import + guardia unmount (`mountedRef`). Test: helper 0/1/400/401/>800 + ordine sequenziale + no perdita/duplicazione; import piccolo, `>500` mutazioni multi-chunk, invariante `activeImportId` durante staging, forma esatta dello switch, errore Storage/chunk pre-switch, cleanup solo stale (mai dati tecnici), 0/`>400` doc, idempotenza, `cleanupPending` true/false; `test:rules` completo verde (incl. re-import end-to-end su emulatore). Nessuna nuova dipendenza/Function/scheduler/polling.
- **Stato (dopo HARD-02B-1):** fondazione implementata (prerequisito di 02B-2). HARD-02B-1 ha introdotto gli ID `publicLessons` import-scoped (`LessonDoc.publicLessonId` + helper `publicLessonId.ts`), la query studente `programId + activeImportId`, le **Rules obbligatorie** `importId == activeImportId` (non-owner) e l'indice `publicLessons(programId, importId)`; la transazione import restava atomica. Progettazione:
- **Stato (dopo HARD-02B-00):** **design-ready.** Progettazione tecnica completata in `hard-02b-import-chunking-design.md`: soluzione raccomandata = `publicLessons` con **ID import-scoped** + query studente vincolata ad `activeImportId` (staging invisibile → switch atomico ≤3 mutazioni → cleanup chunked), chunk ≤400, macchina a stati `staging→active→superseded`, +1 indice `publicLessons(programId,importId)`, **modifica Rules obbligatoria** (lettura non-owner richiede `importId == program.activeImportId`; owner invariato), campo `LessonDoc.publicLessonId` + helper puro di risoluzione, **cleanup solo delle `publicLessons`** (mai dati tecnici/Storage), risultato `committed` + `cleanupPending` non bloccante, ordine di rollout indice→Rules→Hosting→smoke. **Implementazione = HARD-02B** (fase successiva). **Confidenza:** alta.

---
**HARD-F07 — Monitor consegne trasferisce documenti submission interi, incluse le risposte (carry-over PERF-07).**
- **Area:** E (banda) / G (superficie dati). **Evidenza:** `submissionsMonitorService.ts` (Firestore non proietta campi su `onSnapshot`; UI scarta `answers`/`flagged` lato client). Costo di banda, non di read; lo split di schema è sproporzionato. **Deferral.** **Confidenza:** alta.

---
**HARD-F08 — Nessun audit di accessibilità end-to-end formale.**
- **Stato (dopo HARD-02A + HARD-02A-FIX):** **audit svolto; unico P2 risolto.** `DialogShell` gestisce Escape, focus trap, ripristino focus e `aria-labelledby`; test dedicati verdi e smoke manuale DEV PASS. Restano solo P3 di polish accettati.
- **Area:** J. **Evidenza:** il Gate GDUX (`gdux-checklist-finale.md`) copre a11y a livello di componente; HARD-02A aggiunge la passata end-to-end formale. **Confidenza:** alta.

## 6. Cost model (quattro scenari)

> Conteggi di operazioni Firestore/Storage **dedotti dal codice**, non misure da un progetto reale. **Nessun prezzo inventato**: quote Spark storiche (50 000 read, 20 000 write, 20 000 delete/giorno, 1 GiB) da riverificare sulla pagina ufficiale; tariffe Blaze parametriche. Baseline dettagliata in `performance-security-audit.md §4-5`; qui esteso a M4.

| Scenario | Profilo operazioni (indicativo) | Giudizio |
|---|---|---|
| **1. Uso personale docente** (1 docente, 5 classi, 150 studenti, ~20 verifiche/mese) | Apertura portale ≈ 4 collection-read (decine-centinaia doc) + ciclo vita verifica ~20-30 op/verifica + correzione M4 (create correction + eventi + return, poche op/consegna) | **Ampio margine** sotto quota giornaliera. Rischio = crescita storico nel tempo (F05), non volume attuale. |
| **2. Verifica online, 30 studenti, 60 min** | ≤30 autosave/studente dirty-only (worst ~900 write) + 30 consegne (batch) + monitor ~900 read-delta + avvio 30-90 read | **~1 800-2 000 op combinate**; margine sotto quota giornaliera salvo molte sessioni sovrapposte lo stesso giorno. Da confermare in Console. |
| **3. Uso scolastico ampliato** | Architettura **single-owner per progetto**: "più docenti" non supportato nello stesso progetto (§scenario C perf-audit). Strategia proporzionata = un progetto Firebase per docente/istituto → N istanze indipendenti dello scenario 1/2, ciascuna con quota separata. | Nessun moltiplicatore multi-tenant nell'attuale design. Multi-tenant reale = redesign fuori V1. |
| **4. Traffico ostile / account sconosciuti** | Firestore/Storage: default-deny + `isApprovedStudent()`/`isOwner()` → nessuna superficie pubblica letta in massa (nessun `allow read: if true`). Function gateway: invocazioni respinte 401/403 rapide ma **fatturabili** (F04). Hosting: banda su asset statici. | Dati protetti. Vettore di costo residuo = invocazioni Function da bot (F04) e banda Hosting; **nessun budget alert** che lo limiti (F01). |

**Elemento che può compromettere la quota gratuita / crescita non limitata:** (a) storico `verifications` senza tetto nel tempo (F05); (b) invocazioni Function non autenticate senza budget alert (F04+F01). Entrambi bassi ai volumi attuali, entrambi mitigabili senza nuove funzionalità.

## 7. Rischi accettati (documentati, non finding)

- **`settings/studentAccess` leggibile da qualsiasi autenticato** — espone quali `classId` sono in Modalità verifica a un account Google non ancora approvato; scrittura owner-only e ogni gate di contenuto ri-legge il doc server-side. Tradeoff dichiarato in `sicurezza.md`/`performance-security-audit.md:288`.
- **Import ZIP ancora su accesso Storage diretto** (`importRepository.ts:74`, `uploadBytes`) fino a **SGW-02C** — noto e tracciato in `storage-gateway-roadmap.md`; bloccabile su Brave, gateway per il resto operativo. Limite accettato, non regressione.
- **Proiezione `publishedProjection` orfana** sotto una verifica cancellata — irraggiungibile dalle Rules (path genitore assente), solo costo storage residuo (PERF-audit §4).
- **Verifiche legacy senza `teacherSnapshot.questions`** rileggono i pool correnti per il PDF — comportamento invariato, nessuna migrazione automatica (SEC-02).
- **RPO best-effort / export manuale** — dichiarato in `README.md:104`; HARD-F01 chiede solo di *documentarne la procedura*, non di cambiare il modello.

## 8. Falsi positivi esclusi

- **`TODO/FIXME/XXX` nel codice** → tutte occorrenze di pattern `lezione-XXX`/`SF-YYYY-XXXX` in stringhe/commenti, **nessun** debito marcato. Escluso.
- **`console.*` residui** → un solo `console.error` legittimo (`CourseWorkspace.tsx:521`, errore load contenuto). Non un finding.
- **`sessionStorage`** → memorizza solo `verificationId` (hint sessione/ultima consegna), **nessun PII**. Escluso.
- **Filtro `where('ownerUid',…)` mancante sulle query** → nel modello single-owner non riduce letture (l'intera collezione è già del docente); **non** è un finding di costo (chiarito in PERF-SEC-01A §1).
- **Chiavi Firebase nel bundle** → chiavi client pubbliche per design, non segreti (`.env.example` lo esplicita). Escluso.

## 9. Roadmap minima (HARD-01 / HARD-02 / HARD-03)

Pacchetti indipendenti, ciascuno approvabile da solo. **Nessuno** introduce funzionalità, AI/M5, Cloud Functions nuove o dipendenze non necessarie.

- **HARD-01 — Operatività & configurazione (P2).** Suddiviso in tre sotto-pacchetti indipendenti:
  - **HARD-01A** (✅ **RESOLVED**) — **F01**: runbook operativo, budget alert DEV, backup/ripristino, incidenti. Vedi `runbook-operativo-v1.md` e `evidenze/hard-01a-human-gate.md`.
  - **HARD-01B** (✅ **COMPLETATO; F03 RESOLVED 15/07/2026**) — **F03**: security header + strategia cache in `firebase.json` (incl. COOP `same-origin-allow-popups` e `script-src https://apis.google.com`), guardrail statico `hostingHeaders.test.ts`, deployato e verificato su DEV. Vedi `evidenze/hard-01b-dev-smoke.md`.
  - **HARD-01C** (✅ **RESOLVED**) — **F02**: matrice regioni e riconciliazione documentale; Firestore DEV verificata in `europe-west8`; target PROD `europe-west8` e co-locazione formalizzati; nessun dato DEV migrato (`evidenze/hard-01c-human-gate.md`).
- **HARD-02 — Accessibilità & resilienza (P3).** **HARD-02A** (✅ audit a11y end-to-end, `evidenze/hard-02a-a11y-audit.md` — READY FOR REMEDIATION, 1 P2); **HARD-02A-FIX** (Escape/focus-trap/restore in `DialogShell` + smoke a11y manuale DEV); **F06** / HARD-02B (✅ **RESOLVED 15/07/2026**: 02B-00 design → 02B-1 fondazione import-scoped → 02B-2 chunking ≤400 staging→switch atomico→cleanup differito, tocca `importRepository.ts`, helper condiviso `firestoreChunks.ts`, cleanup `stalePublicLessonsCleanup.ts`).
- **HARD-03 — Costi a lungo termine (P3, condizionato a misura).** **F05** (paginazione storico `verifications` con UX dedicata) e valutazione **F04** (App Check) — entrambi **solo se** una misura reale in Firebase Console mostra un impatto concreto; altrimenti restano deferral.

## 10. Ordine di intervento e dipendenze

1. **HARD-01 completato:** operatività, Hosting e regioni risolti.
2. **HARD-02 completato:** fix a11y e import resiliente applicati.
3. **HARD-03 rinviato e condizionato:** non intervenire senza una misura reale che confermi il beneficio.

Nessun ordine di deploy speciale (interventi di config/doc + un eventuale codice import isolato); nessuna migrazione dati richiesta.

## 11. Criteri del Gate GHARD (finale)

Il Gate **GHARD** si considera superabile quando:

1. **Nessun P0/P1 aperto** (già soddisfatto oggi).
2. **F01 chiuso** ✅ (HARD-01A, 15/07/2026): budget alert configurato e documentato; cadenza di export/backup e procedura di ripristino scritte; procedura account owner compromesso scritta.
3. **F02 risolto** ✅ (HARD-01C, 15/07/2026): regioni DEV verificate e documentate; target PROD `europe-west8`, co-locazione e provisioning ex novo senza dati DEV formalizzati.
4. **F03 applicato** ✅ (HARD-01B, 15/07/2026): security header presenti su Hosting e smoke DEV che conferma login/rendering/PDF non rotti — vedi `evidenze/hard-01b-dev-smoke.md`.
5. **P3 residui** (F04–F08) esplicitamente accettati o pianificati con soglia, non silenziosamente ignorati.
6. **CI verde** invariata; `format:check`/`build` puliti; nessuna regressione nei test esistenti.
7. **Evidenze registrate** ✅ in `evidenze/ghard-checklist-finale.md`, con distinzione automatica/manuale DEV/limite residuo.

## 12. Limiti dell'audit

- **Nessuna osservazione da un progetto Firebase reale** (Firebase Console non consultata): le stime di costo sono conteggi di operazioni dedotti dal codice, non misure; la region **Firestore** di PROD non è stata verificata live (F02 a confidenza media).
- **`pnpm test:rules` non rieseguito** in questa sessione: ci si è basati sulla CI verde corrente (baseline del mandato) e sulla revisione statica riga-per-riga delle Rules; nessun test aggiunto (per mandato).
- **Checklist manuali con browser reale** (login Google, verifica online end-to-end, a11y con screen reader) restano da eseguire da un umano su DEV — nessun browser interattivo collegato a un progetto reale in questa sessione.
- **Tariffe Blaze** citate altrove sono parametriche e vanno riverificate sulla pagina ufficiale prima di qualunque decisione di budget.
- L'audit **non** ha misurato la dimensione reale dei documenti Firestore su dati di produzione né la latenza di rete.

## 13. HARD-NODE-01 — runtime Functions

Il residuo post-G7 relativo a Node.js 20 e agli SDK Firebase server-side è trattato da
**HARD-NODE-01**. Il repository usa ora Node.js 22 in manifest, configurazione Firebase
e CI, con `firebase-functions` 7.3.0 e `firebase-admin` 14.2.0 risolti nel lockfile.
Nessun deploy è compreso nel pacchetto: stato, fonti, audit breaking change e piano di
rollout/rollback sono registrati in
[`evidenze/hard-node-01-runtime-upgrade.md`](evidenze/hard-node-01-runtime-upgrade.md).
</content>
</invoke>
