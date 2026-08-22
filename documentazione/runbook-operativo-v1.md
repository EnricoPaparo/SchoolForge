# Runbook operativo V1 — SchoolForge

**Versione:** 1.1 · **Data:** 21 agosto 2026 · **Ambito:** HARD-01A (finding HARD-F01).
**Natura:** procedure operative per il **singolo docente**. Documento di sola operatività: non modifica codice, Rules o configurazione. Le azioni su Firebase Console / Google Cloud Billing sono **manuali** e vanno eseguite dal docente — questo runbook le descrive, non le esegue.

> **Convenzioni.** I comandi shell sono pensati per essere **copiabili in PowerShell (Windows)** oltre che in bash/zsh: usano solo la Firebase CLI / gcloud, che sono identiche tra le shell. Dove serve una variabile o un percorso, si usa un **file** (`.env.local`) invece di export di shell, così non cambia nulla tra PowerShell e bash. Ogni passaggio che **non** ha un comando CLI verificato è marcato **[Console]** ed è da fare a mano dall'interfaccia web.
>
> **Stato ambienti oggi.** DEV e PROD sono due progetti Firebase separati,
> configurati e operativi: `schoolforge-dev` e `schoolforge-prod`. `.firebaserc`
> espone entrambi gli alias. Il rollout PROD è stato autorizzato ed eseguito
> dopo il Gate GHARD; evidenza corrente in
> [`evidenze/prod-rollout-01.md`](evidenze/prod-rollout-01.md).
>
> **Nota residenza dati (HARD-F02, risolto).** DEV: Firestore `europe-west8`,
> Storage/Function `us-central1`. PROD: Firestore, Storage e Functions
> applicative `europe-west8`; la task queue di chiusura programmata usa
> `europe-west3`. Nessun dato DEV è stato migrato.

---

## 1. Scopo e ambienti

| | **DEV** | **PROD** |
|---|---|---|
| Progetto Firebase | `schoolforge-dev` — **operativo** | `schoolforge-prod` — **operativo** |
| Alias `.firebaserc` | `dev` | `prod` |
| URL | https://schoolforge-dev.web.app | https://schoolforge-prod.web.app |
| Piano | Blaze | Blaze; budget e avvisi da verificare periodicamente dal docente |
| Dati | **solo fixture sintetiche** | dati reali di studenti (PII) |
| Prove distruttive | **consentite** su dati di test sacrificabili (vedi sotto) | **vietate** |

- **Cosa si testa su DEV:** deploy, Rules, indici, import ZIP, verifiche online di prova, smoke docente/studente, restore drill, prove di budget alert. Tutto ciò che è distruttivo o sperimentale va **solo** su DEV.
- **Prove distruttive — solo DEV, con cautela:** consentite **esclusivamente su DEV**, **solo su dati di test sacrificabili**, e **dopo un export/backup** quando l'operazione può coinvolgere dati ancora utili (§5). **Mai** eseguire cancellazioni massive indiscriminate sul dataset DEV corrente: anche su DEV, distruggere alla cieca lo stato attuale può cancellare fixture o prove in corso che servono ancora.
- **Divieto su PROD:** nessuna prova distruttiva, nessun import "di test", nessuna cancellazione massiva esplorativa, nessun esperimento su Rules non validato prima su DEV.
- **Cosa NON copiare tra ambienti (mai):**
  - `.env.local` (config client di un ambiente) verso l'altro — ogni ambiente ha la sua config Firebase e il suo bucket;
  - dati Firestore/Storage di PROD verso DEV (contengono PII reali) e viceversa dati DEV verso PROD (sovrascriverebbero dati reali con fixture);
  - `settings/owner`/`ownerPublic` di un ambiente nell'altro (l'owner è legato all'account e al progetto);
  - qualsiasi export contenente PII in una cartella non protetta o nel repository Git.

---

## 2. Deploy ordinario

Deploy **manuale**, solo su autorizzazione esplicita del docente (vedi `CONTRIBUTING.md`). Sequenza:

1. **Preflight**
   - `git status` → working tree pulito;
   - sei sul commit che vuoi distribuire (di norma `main` aggiornata): `git checkout main && git pull`;
   - CI verde sul commit corrispondente.
2. **Install riproducibile**
   ```
   pnpm install --frozen-lockfile
   pnpm --filter @schoolforge/lesson-contract build
   ```
3. **Verifiche proporzionate** (prima di un deploy reale, non a ogni salvataggio)
   ```
   pnpm format:check
   pnpm lint
   pnpm typecheck
   pnpm test
   ```
4. **Build con l'env corretto**
   - DEV usa la configurazione prevista da `firebase.json`;
   - PROD usa `firebase.prod.json`, il cui predeploy esegue `pnpm --dir apps/web build:prod` con `.env.prod` e `VITE_USE_EMULATORS=false`;
   - non copiare mai un file env da un ambiente all'altro.
5. **Selezione ambiente esplicita**
   ```
   firebase use dev
   firebase use prod
   ```
   Prima di ogni deploy verifica comunque il progetto con `firebase use`.
6. **Deploy selettivo** — distribuisci **solo** ciò che è cambiato, non tutto:
   ```
   firebase deploy --project schoolforge-dev --config firebase.json --only hosting
   firebase deploy --project schoolforge-prod --config firebase.prod.json --only hosting
   # sostituisci hosting con firestore:rules,storage,firestore:indexes,functions
   # oppure con l'elenco minimo dei target effettivamente cambiati
   ```
   Evita `firebase deploy` senza `--only`: ridistribuirebbe componenti non modificati (incluse Functions) senza motivo.
7. **Smoke post-deploy** (§ vedi checklist qui sotto)
   - login docente (Google), rendering di una lezione, apertura Verifiche;
   - login studente approvato, vista Didattica read-only, eventuale verifica online di prova (**solo DEV**);
   - nessun errore in console del browser.
8. **Registrazione del commit distribuito** — annota **data, ambiente, commit SHA e cosa è stato deployato** (`--only ...`). Tienilo in un file locale o in un issue; non serve committarlo nel repo.

---

## 3. Rollback

> Un rollback **Hosting** ripristina solo i file statici della SPA. **Non** ripristina: dati Firestore, oggetti Storage, Security Rules, indici, Cloud Functions. Quelli si ripristinano separatamente (Git + redeploy per Rules/indici; §6 Ripristino per i dati).

### 3.1 Rollback Hosting alla versione precedente
- **CLI (verificata):**
  ```
  firebase hosting:rollback
  ```
  ripristina il rilascio Hosting immediatamente precedente sul progetto attivo (`firebase use ...`).
- **[Console] alternativa:** Firebase Console → **Hosting** → *Cronologia rilasci* → sul rilascio buono → **Ripristina** (*Rollback*).

### 3.2 Rollback Rules / indici / config
Non esiste un "undo" server-side: si torna alla versione buona **via Git** e si **ridistribuisce**.
```
git checkout <commit-buono> -- firestore.rules storage.rules firestore.indexes.json firebase.json
firebase deploy --only firestore:rules,storage,firestore:indexes
```
(Ridistribuisci con `--only` solo i target effettivamente ripristinati.)

### 3.3 Cosa NON viene ripristinato da un rollback Hosting
- documenti Firestore già scritti/cancellati dalla versione difettosa;
- file in Storage;
- Rules/indici/Functions;
- lo stato di eventuali migrazioni dati già eseguite.

### 3.4 In caso di migrazione dati coinvolta
Se la versione difettosa ha **scritto o trasformato dati** (non solo servito UI), il rollback Hosting **non basta**: valuta prima §9 (dati incoerenti) e §6 (ripristino), poi decidi se il rollback UI è sufficiente o se serve anche un restore dei dati.

### 3.5 Checklist di verifica dopo rollback
- [ ] la versione servita è quella attesa (hash asset diverso, funzionalità difettosa sparita);
- [ ] login docente e studente ok;
- [ ] Rules attive coerenti con il commit ripristinato (se ridistribuite);
- [ ] nessun errore console;
- [ ] incidente annotato (§ registrazione, §6.7).

---

## 4. Budget e controllo costi

- **Blaze non è un costo fisso:** è pay-as-you-go. Sotto i volumi di un singolo docente si resta in genere entro le quote gratuite, ma **non c'è un tetto automatico**: l'uso oltre quota è fatturato.
- **Il budget alert AVVISA, non blocca.** Un budget di Cloud Billing **non è un hard cap**: al 100% ricevi una notifica, ma i servizi **continuano a funzionare** e la spesa può superare la soglia. Non esiste un blocco automatico della spesa senza costruire automazioni dedicate (fuori ambito di questo task, e comunque non un vero hard cap garantito).

### 4.1 Budget alert proposto — **[Console]** Google Cloud Billing
Percorso: **console.cloud.google.com → Billing → Budgets & alerts → Create budget**.

- **DEV** — proposta minima:
  - importo mensile indicativo: **€5**;
  - ambito: il progetto `schoolforge-dev`;
  - soglie di avviso: **50%, 80%, 100%** (dell'importo);
  - notifiche: all'**owner** (email del docente / amministratore fatturazione del progetto);
  - opzionale: includere anche una soglia previsionale (*forecasted*) se offerta, per essere avvisati in anticipo.
- **PROD** — ambiente operativo: il docente verifica importo, destinatari e
  soglie 50/80/100% prima di caricare dati reali e poi periodicamente. Nessun
  valore di default è imposto dal repository: dipende dall'uso reale.

> Nessuna di queste soglie ferma la spesa. Servono a **reagire in fretta**, non a impedire il costo.

### 4.2 Controllo mensile (vedi anche §10)
- **[Console]** Firebase Console → **Usage & billing** e/o Cloud Billing → **Reports**: guarda Firestore **reads/writes/deletes**, **Storage** (GB + operazioni), **Hosting** (banda). Confronta con il mese precedente.

### 4.3 Controllo straordinario
Esegui un controllo extra **dopo**: una o più **verifiche online numerose**, un **import grande**, o qualsiasi **traffico anomalo** sospetto. Confronta i conteggi con le stime di `hardening-audit-v1.md` §6 (cost model).

### 4.4 Procedura immediata se il costo cresce in modo inatteso
Vedi §8 (incidente costi/traffico). In sintesi: identifica il servizio, riduci temporaneamente la superficie interessata, **non** cancellare dati d'impulso, conserva le evidenze.

- **Nessuna automazione a pagamento** viene introdotta: niente scheduler, niente funzioni di auto-spegnimento, niente servizi ricorrenti.

### 4.5 Correzione IA in DEV — modello runtime, rollout e rollback (G7 PASS)

Il modello del provider reale è deciso **esclusivamente** da `settings/aiConfig` (Admin
SDK, mai dal client). Modelli runtime ammessi e listino **obbligatorio** accoppiato:

- `gpt-5.4-nano-2026-03-17` → `v2-2026-07-17-hg-m5` (rollback esplicito);
- `gpt-5.6-luna` → `v5-2026-07-20-luna-dev` (1.000.000 µUSD/1M input, 6.000.000 µUSD/1M
  output; `cached input` non conteggiato).

Coppie diverse (Luna con listino nano, nano con listino Luna, modello/listino
sconosciuti) sono rifiutate fail-closed: il provider resta disabilitato. Non esiste
fallback automatico tra modelli.

**Rollout controllato di Luna in DEV — completato:**

1. verifica il `settings/aiConfig` attuale (annota `configVersion` e modello);
2. imposta `enabled=false` (kill switch senza deploy);
3. deploy delle **sole** Functions IA interessate;
4. aggiorna `settings/aiConfig`: `provider: openai`, `model: gpt-5.6-luna`,
   `priceListVersion: v5-2026-07-20-luna-dev`, `enabled: false`, nuova `configVersion`
   coerente, budget/limiti **invariati**;
5. esegui una preview col sistema ancora disabilitato e verifica il fail-closed
   (nessuna chiamata provider);
6. imposta `enabled=true`;
7. correggi **una sola** consegna DEV controllata;
8. smoke funzionale finale su una consegna, dichiarato dal docente “impeccabile”.

La chiusura G7 non attribuisce una verifica manuale specifica a `aiCorrectionRuns` o
al ledger: questi aspetti sono coperti dalle evidenze automatiche della
[checklist finale](evidenze/g7-m5-checklist-finale.md).

**Rollback:** `enabled=false` blocca subito il provider senza deploy; per tornare a nano,
aggiorna `settings/aiConfig` con `model: gpt-5.4-nano-2026-03-17`,
`priceListVersion: v2-2026-07-17-hg-m5` e una nuova `configVersion`. Il ritorno a nano è
**esplicito**, mai automatico.

**Gate G7: PASS.** Lo smoke reale DEV e la conferma finale del docente su feedback,
resistenza alle prompt injection e modalità sono completati. Il monitoraggio costi
resta manuale; in caso di anomalia usare subito il kill switch.

**HARD-NODE-01:** l'upgrade repository a Node.js 22, `firebase-functions` 7.3.0 e
`firebase-admin` 14.2.0 è predisposto e verificato; il deploy non fa parte della PR.
Il piano di rollout/rollback vincolante è nell'[evidenza tecnica](evidenze/hard-node-01-runtime-upgrade.md).

---

## 5. Backup ed export

> **Decisione operativa OPS-BACKUP-01 (22/08/2026).** SchoolForge non usa
> backup gestiti o schedulati di Firestore/Storage. Per il singolo docente il
> presidio scelto è un **archivio documentale verificato**: correzioni ed esiti
> esportati dopo le verifiche concluse, più ZIP dei corsi dopo modifiche
> didattiche importanti. Questa scelta conserva i documenti scolastici utili,
> ma **non permette di ripristinare l'applicazione nello stato precedente**:
> classi, configurazioni e dati operativi potrebbero dover essere ricostruiti.
> Il docente accetta esplicitamente questo rischio e rivaluterà un backup
> tecnico se la ricostruzione manuale diventerà troppo onerosa.

### 5.1 DEV
- **Nessun backup schedulato obbligatorio** (dati sintetici, ricreabili).
- **Nessun dato DEV viene migrato o copiato in PROD:** PROD partirà da una base pulita e indipendente.
- Un export DEV è **facoltativo** prima di una migrazione, cancellazione massiva o modifica strutturale: serve solo se il docente vuole conservare dati DEV ancora utili (verifiche, consegne o correzioni di prova). Se tali dati sono sacrificabili, il docente accetta esplicitamente di poterli perdere.

### 5.2 PROD — procedura documentale scelta

1. Dopo ogni verifica conclusa e restituita, esporta l'**archivio delle
   correzioni** (PDF singoli o ZIP multiplo) e il **CSV del Registro
   Correzioni**.
2. Dopo modifiche didattiche importanti, esporta il **corso in ZIP**: è la
   copia portabile di UDA, lezioni e pool.
3. Apri almeno un PDF/ZIP e il CSV appena prodotti: un download non controllato
   non è un archivio verificato.
4. Conserva gli export in **due destinazioni separate**, per esempio PC e uno
   spazio cloud personale protetto o un supporto esterno.
5. Gli archivi contengono dati degli studenti: non inserirli nel repository Git,
   non lasciarli in cartelle pubbliche e limita l'accesso al docente.

Il formato documentale è sufficiente per consultazione, rendicontazione e
conservazione degli elaborati. Non contiene l'intero stato applicativo, gli
audit tecnici o tutte le relazioni Firestore e quindi non è importabile come
restore di SchoolForge.

### 5.3 Export tecnico opzionale

Se in futuro servirà un ripristino applicativo, Firestore e Storage dovranno
essere esportati separatamente. Questa procedura **non è attiva né schedulata**
oggi e comporta costi del provider.

- **Firestore — [Console] (via preferita per un docente):** Firebase/GCP Console → Firestore → **Import/Export** → *Export*, scegliendo un **bucket GCS di destinazione** dedicato agli export. In alternativa CLI (richiede `gcloud`, il progetto attivo e un bucket):
  ```
  gcloud firestore export gs://NOME-BUCKET-EXPORT/firestore/AAAA-MM-GG --project schoolforge-dev
  ```
- **Storage — copia degli oggetti** verso una cartella locale/bucket (richiede `gcloud`/`gsutil`):
  ```
  gcloud storage cp -r gs://NOME-BUCKET-STORAGE/repository ./export-storage-AAAA-MM-GG
  ```
  Sostituisci `NOME-BUCKET-*` con i nomi reali dei bucket dell'ambiente (**non** incollarli nel repository).

### 5.4 Cosa contiene / cosa NON contiene un export tecnico
- **Export Firestore** = documenti (settings, students, classes, programs, verifications, submissions, receipts, corrections, correctionReturns, auditEvents, …). **NON** contiene i file Markdown/pool (quelli sono in Storage) né i PDF (generati al volo nel browser, mai persistiti).
- **Copia Storage** = i file `.md`/`.pool.md` del repository didattico. **NON** contiene i dati Firestore.
- Un ripristino completo richiede **entrambi** + coerenza tra loro (§6).

---

## 6. Ripristino tecnico opzionale

> **Non è la strategia operativa attuale.** Questa procedura è applicabile solo
> se esiste un export tecnico Firestore/Storage. Gli archivi documentali della
> §5.2 sono consultabili, ma non ricostruiscono il database. Nessun RPO/RTO è
> garantito.

1. **Prerequisiti:** un export Firestore verificato e/o una copia Storage verificata, con data nota; accesso owner al progetto; `gcloud`/Firebase CLI configurate.
2. **Scelta dell'ambiente:** conferma con `firebase use` di essere sull'ambiente giusto. **Mai** ripristinare dati di un ambiente nell'altro. Per un **restore drill** usa **DEV**.
3. **Controllo del backup:** verifica che l'export sia leggibile e della data attesa **prima** di toccare l'ambiente da ripristinare.
4. **Restore:**
   - **Firestore — [Console]** Import/Export → *Import*, indicando la cartella di export; oppure CLI:
     ```
     gcloud firestore import gs://NOME-BUCKET-EXPORT/firestore/AAAA-MM-GG --project <progetto>
     ```
   - **Storage:** ricopia gli oggetti dalla copia verso il bucket dell'ambiente (`gcloud storage cp -r ...`).
5. **Verifica dati e collegamenti:** controlla che Firestore e Storage siano **coerenti tra loro** — es. le lezioni referenziate da Firestore hanno i file `.md` corrispondenti in Storage; `publicLessons.content` coerente con le lezioni; nessuna verifica che punti a pool mancanti.
6. **Smoke docente e studente:** login docente (lezioni, verifiche, correzioni), login studente approvato (Didattica read-only, eventuale verifica). Nessun errore console.
7. **Registrazione dell'incidente:** data, causa, export usato (data), passi eseguiti, esito, residui.
8. **Restore drill periodico:** esegui almeno **una** prova completa di
   export→import **su DEV**, poi ripetila quando cambia la strategia di backup —
   un backup mai ripristinato non è un backup verificato.

---

## 7. Incidente account owner (sospetta compromissione)

Checklist ordinata, **nessuna azione distruttiva automatica**:

1. **Proteggi l'account Google** del docente: cambio password, verifica/attiva 2FA.
2. **Revoca le sessioni** attive dell'account Google (Account Google → Sicurezza → dispositivi/sessioni).
3. **Verifica gli accessi** a: Firebase Console, Google Cloud (IAM del progetto), GitHub (repo `EnricoPaparo/SchoolForge`). Rimuovi collaboratori/service account non riconosciuti.
4. **Ruota le credenziali realmente ruotabili:** token GitHub/CI, eventuali service account key. **Le chiavi Firebase client** (`VITE_FIREBASE_*`) sono **pubbliche per design** e non sono un segreto da ruotare — non trattarle come credenziali compromesse.
5. **Verifica `settings/ownerPublic` e `settings/owner`:** l'`ownerUid` corrisponde ancora all'account docente legittimo? Un cambio non autorizzato qui è un segnale grave.
6. **Controlla deploy e audit recenti:** cronologia rilasci Hosting (§3.1), commit/PR recenti, `auditEvents` in Firestore per azioni anomale.
7. **Blocco temporaneo del portale studenti se necessario:** il docente può **[app]** disattivare *Portale studenti* e *Nuove richieste* dai toggle in Studenti (nessuna cancellazione: solo chiusura degli accessi finché la situazione non è chiara).
8. **Verifica dati e costi:** confronta dati Firestore/Storage con l'ultimo stato buono noto (§9 se incoerenti) e i costi recenti (§4/§8).

---

## 8. Incidente costi / traffico anomalo

1. **Identifica il servizio responsabile:** **[Console]** Usage & billing / Cloud Billing Reports → quale voce cresce: **Hosting** (banda), **Firestore** (reads/writes/deletes), **Storage** (operazioni/egress), **Functions** (invocazioni del gateway)?
2. **Riduci temporaneamente la superficie appropriata:**
   - abuso **Firestore/portale studenti** → **[app]** disattiva *Portale studenti* / *Nuove richieste* (blocca gli accessi studente senza cancellare nulla);
   - abuso **Function gateway** (`/api/repository/*`) → **[Console]** valuta di ridurre `maxInstances` o disabilitare temporaneamente la Function (nota: l'import ZIP diretto resta, l'editing pool/lezioni via gateway si ferma);
   - abuso **Hosting** (banda) → è un sito statico; valuta se il traffico è legittimo prima di agire.
3. **Distingui Hosting / Firestore / Storage:** non spegnere ciò che non è la causa.
4. **Preserva le evidenze:** salva i grafici/report di utilizzo **prima** di cambiare configurazione.
5. **Evita cancellazioni impulsive:** non cancellare dati per "far scendere i costi" — rischi perdita dati senza risolvere la causa.
6. **Ripristino controllato:** riattiva le superfici disattivate solo dopo aver capito e mitigato la causa; riverifica i costi nei giorni successivi.

---

## 9. Cancellazione accidentale o dati incoerenti

1. **Ferma le scritture:** se serve, **[app]** disattiva il portale studenti e sospendi import/modifiche in corso, per non peggiorare lo stato.
2. **Non reimportare alla cieca:** un reimport sopra dati parzialmente presenti può creare duplicati o incoerenze peggiori.
3. **Verifica cosa manca davvero:** confronta **Firestore** (documenti), **Storage** (file `.md`/pool) e le **proiezioni** (`publicLessons`, `publishedProjection`) — spesso l'incoerenza è tra questi tre livelli, non una perdita totale.
4. **Restore o ricostruzione mirata:**
   - se hai un export verificato → §6 (restore selettivo dell'area colpita);
   - se manca solo materiale didattico e hai gli **ZIP/Markdown originali** → reimport controllato del solo programma interessato;
   - se manca una proiezione (`publicLessons`) ma i dati sorgente ci sono → usa il **backfill** già previsto dal prodotto invece di ricostruire a mano.
5. **Smoke finale:** docente + studente, verifica coerenza Firestore↔Storage↔proiezioni, annota l'incidente.

---

## 9b. Chiusura programmata orfana (FORCE-SUBMIT-02)

**Sintomo.** Il riepilogo della chiusura multipla riporta «Non riuscite — ripeti l'operazione sulle
stesse righe per ripristinarle» (`failed_cleanup`). Significa che i marcatori di programmazione sono
stati scritti sulla consegna, l'accodamento della Cloud Task **non** è riuscito nemmeno dopo i
tentativi previsti, e nemmeno la compensazione è riuscita. Lo studente vede un banner di preavviso
che, da solo, non porterebbe ad alcuna chiusura.

**Perché può accadere.** Firestore e Cloud Tasks non condividono una transazione: la scrittura viene
prima, l'accodamento dopo. Il caso è raro (richiede due indisponibilità consecutive) ma possibile.

**Recupero — procedura normale, dall'applicazione.**

1. Nella schermata consegne selezionare **le stesse righe** riportate come non riuscite.
2. Premere di nuovo **«Chiudi consegne»**. Il dialog dichiara quante righe hanno già una chiusura
   programmata e che verrà usata **la scadenza originale**.
3. Confermare. Il server **non riprogramma nulla**: rilegge `requestId` e scadenza già persistiti e
   riaccoda la **stessa** task, con lo stesso nome deterministico `fc-{requestId}`. Non si apre una
   nuova finestra di 60 secondi e non viene eseguita alcuna scrittura.
4. L'esito atteso è **«Già programmate (task ripristinata)»**. Se la task esisteva già, Cloud Tasks
   risponde `ALREADY_EXISTS` e l'operazione è comunque un successo.
5. L'operazione è idempotente e sicura da ripetere: se nel frattempo una **programmazione diversa**
   ha preso il posto della precedente, viene riaccodata quella corrente e la vecchia non viene
   toccata.

**Se la coda resta indisponibile.** Ripetere il punto 2 quando Cloud Tasks torna operativa. Nel
frattempo la consegna resta una normale bozza: **lo studente può continuare a lavorare e a
consegnare normalmente**, e una consegna normale rende la programmazione ininfluente.

**Annullamento in sicurezza (fallback amministrativo).** Se si vuole revocare la chiusura invece di
ripristinarla, rimuovere dalla consegna **tutti e tre** i marcatori
(`forceCloseRequestId`, `forceCloseDeadline`, `forceCloseRequestedAt`) con un'unica operazione
amministrativa, **solo dopo** aver verificato che `forceCloseRequestId` sia ancora quello atteso —
per non cancellare una programmazione nel frattempo sostituita. Rimuoverne solo alcuni lascerebbe
uno stato parziale: la task, se esiste, lo riconosce come incoerente e ripulisce da sé, ma il banner
sparisce solo quando i tre campi sono assenti insieme.

**Verifica finale.** Il banner dello studente scompare o mostra il countdown corretto; alla scadenza
la consegna passa a «Consegna acquisita dal docente». Nessuno studente deve restare con scadenza
superata, marcatori presenti e nessuna ricevuta.

---

## 10. Checklist mensile minima (pochi minuti)

- [ ] **Costi:** picco anomalo negli ultimi 30 giorni? (Firestore R/W/D, Storage, Hosting, Functions) — §4.2
- [ ] **Errori:** errori ricorrenti in Cloud Logging / console browser durante l'uso normale?
- [ ] **Utenti/studenti inattesi:** richieste studente `pending` non riconosciute? account owner corretto?
- [ ] **Deploy attivo:** la versione servita corrisponde al commit atteso?
- [ ] **Archivio documentale:** l'ultima verifica conclusa ha archivio correzioni e CSV verificati in due destinazioni? L'ultimo corso modificato ha uno ZIP recente?
- [ ] **Warning Firebase:** avvisi in Console (quota, fatturazione, deprecazioni)?

> Se una voce è rossa, apri la sezione corrispondente (§4/§7/§8/§9). La checklist mensile serve a **notare presto**, non a risolvere tutto sul momento.
