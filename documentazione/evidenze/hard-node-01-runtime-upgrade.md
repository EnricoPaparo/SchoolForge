# HARD-NODE-01 — aggiornamento controllato runtime Firebase Functions

**Rilevazione:** 20 luglio 2026

**Base:** `origin/main` con PR #252 e Gate G7 PASS

**Stato:** implementazione repository verificata; **nessun merge e nessun deploy** in questo pacchetto.

## Decisione

Node.js 22 è il runtime GA prudente scelto per sostituire Node.js 20. La tabella
ufficiale Google indica `nodejs20` deprecato dal 30 aprile 2026 e `nodejs22` supportato
fino alla deprecazione pianificata del 30 aprile 2027; Node.js 24 è ancora indicato
come preview nelle release note e non viene adottato.

Fonti ufficiali consultate:

- [Google Cloud — Runtime support](https://docs.cloud.google.com/functions/docs/runtime-support): stato e date di Node.js 20/22;
- [Firebase — Manage functions](https://firebase.google.com/docs/functions/manage-functions): runtime Node supportati e configurazione esplicita tramite `engines.node`/`firebase.json`;
- [Firebase — Get started with Cloud Functions](https://firebase.google.com/docs/functions/get-started): supporto CLI a Node.js 20 e 22 e raccomandazione di mantenere aggiornati gli SDK;
- [Firebase — release notes](https://firebase.google.com/support/releases): breaking change di `firebase-functions` 7;
- [Firebase Admin Node.js SDK release notes](https://firebase.google.com/support/release-notes/admin/node): requisiti e breaking change delle versioni 14.0–14.2;
- [pacchetto ufficiale firebase-functions](https://www.npmjs.com/package/firebase-functions): versione stabile 7.3.0 pubblicata dal maintainer Firebase.

## Versioni prima e dopo

| Componente | Prima (manifest / lock) | Dopo (manifest / lock) | Motivazione |
|---|---|---|---|
| Runtime Functions | `>=20`, `nodejs20` / Node 20 in CI | `22`, `nodejs22` / Node 22 in CI | Elimina il runtime deprecato senza adottare Node 24 preview. |
| `firebase-functions` | `^6.1.0` / 6.6.0 | `^7.3.0` / 7.3.0 | Linea stabile corrente, compatibile con Functions v2 e Admin 14. |
| `firebase-admin` | `^13.0.0` / 13.10.0 | `^14.1.0` / 14.2.0 | La linea 14 richiede Node 22+, elimina il supporto legacy e allinea l'SDK al runtime scelto. |
| `@types/node` Functions | `^20.17.0` / 20.19.43 | `^22.0.0` / 22.20.1 | Tipi coerenti con il runtime target. |
| Firebase CLI | `^14.0.0` / 14.27.0 | invariato | Riconosce Node 22 ed è già la baseline CI; nessun upgrade major non necessario. |
| GitHub Actions | major v4 basate su Node 20 | `checkout@v7`, `pnpm/action-setup@v6`, `setup-node@v7`, `setup-java@v5`, `cache@v6` | Elimina il warning Node 20 del runner; le Actions usano Node 24 internamente, mentre build e test SchoolForge restano su Node 22. |

Il lockfile è stato rigenerato esclusivamente con pnpm 9.15.9.

## Audit breaking change

| Superficie | Verifica | Esito per SchoolForge |
|---|---|---|
| Functions v2 | Import da `firebase-functions/v2/https` | `onCall`, `onRequest`, `HttpsError` e tipi compilano senza modifiche. |
| Config legacy | `functions.config()` rimosso in v7 | Nessun uso nel repository. |
| Secret | `defineSecret` e binding `secrets: [OPENAI_API_KEY]` | Compilano e restano limitati a `aiCorrectionRun`; nessun secret letto durante i test/dry-run. |
| TypeScript/eventi | TypeScript 5 richiesto; `Event` legacy rinominato | TypeScript 5.9 risolto; nessun `LegacyEvent`/handler v1 usato. |
| ESM/CJS | v7 pubblica entry point ESM/CJS espliciti | Il package Functions è già ESM (`type: module`, `NodeNext`) e usa import modulari. |
| Admin SDK | v14 rimuove namespace legacy | Tutti gli import sono modulari (`firebase-admin/app`, `auth`, `firestore`, `storage`). |
| Firestore | Admin 14 usa `@google-cloud/firestore` 8.6 | Initialization, `Timestamp`, `FieldValue`, transazioni e test ledger/lease compilano e passano. |
| Region/trigger | Nomi e opzioni esportate | Invariati: `us-central1`, stessi export e trigger HTTP/callable. |
| Scale-to-zero | `minInstances: 0` | Esplicito e invariato su tutte le Function. |
| Limiti runtime | `maxInstances`, timeout, secret | Valori applicativi invariati; nessun nuovo default impostato per concurrency o memoria. |
| Emulatori | wiring e comportamento errori v7 | Nessuna dipendenza da handler che restano pendenti dopo errore; suite Functions verde. |
| CLI/CI | Firebase CLI e GitHub Actions | CLI invariata; build/test su Node 22 e Actions ufficiali aggiornate alle major basate su Node 24. |

La modifica di v7 che trasforma immediatamente in HTTP 500 gli errori asincroni non
gestiti nell'emulatore non cambia il contratto: i gateway convertono già gli errori
noti in `HttpsError` e sanitizzano quelli interni.

## Invarianti applicativi

Non cambiano nomi, regioni o trigger; contratti callable; `OPENAI_API_KEY`;
`settings/aiConfig`; `aiCorrectionRuns`; `aiBudgetLedger`; lease, retry, timeout,
idempotenza, limiti e contabilità; prompt, modelli Luna/nano e listini. Security Rules,
indici, schema e dipendenze web restano invariati. Nessuna chiamata OpenAI viene
eseguita dalle verifiche.

## Verifiche

- `pnpm format:check`: PASS;
- `pnpm lint`: PASS;
- `pnpm -r typecheck`: PASS su Functions, web e lesson-contract;
- suite Functions completa: PASS, 17 file e 476 test;
- suite web completa: PASS, 102 file e 1.511 test;
- `pnpm build`: PASS per Functions, web e lesson-contract;
- benchmark M5 dry-run nano: PASS, modello/listino riconosciuti, 36 chiamate soltanto
  pianificate e nessun provider costruito;
- benchmark M5 dry-run Luna: PASS, modello/listino riconosciuti, 36 chiamate soltanto
  pianificate e nessun provider costruito.

`test:rules` non è stato eseguito perché Rules e configurazione emulatori sono
invariati. I dry-run non hanno letto `OPENAI_API_KEY`, aperto rete o generato costi.

La sessione locale usa il runtime Codex Node.js 24.14.0 e mostra quindi il warning
`engines` atteso rispetto al target esatto 22. La CI costituisce la verifica eseguita
su Node.js 22; il warning locale non è un warning del runtime di deploy. Le GitHub
Actions sono aggiornate alle major che usano Node 24 internamente, eliminando
l'annotazione di deprecazione Node 20 senza cambiare il runtime applicativo.

## Piano di rollout DEV — non eseguito

1. Merge della PR con CI verde.
2. Deploy DEV delle sole Functions.
3. Verifica che non vengano ricreate o rinominate Function inattese.
4. Smoke con `settings/aiConfig.enabled=false`.
5. Verifica fail-closed.
6. Riabilitazione esplicita.
7. Una sola correzione IA DEV controllata.
8. Controllo log, `aiCorrectionRuns`, ledger e costo.
9. In caso di problema, rollback immediato con `enabled=false`.

## Rollback

Mantenere prima di tutto `enabled=false`, quindi ripristinare il commit precedente e
il relativo `functions/package.json`/lockfile. Tornare a `nodejs20` è ammesso soltanto
finché Google lo supporta ancora; non è una strategia valida oltre la data di
decommissione. Il rollback non crea, ruota o elimina secret e non modifica Firestore,
ledger, run M5 o altri dati.

## Rischi residui

- Il passaggio Admin 13→14 include Firestore 7→8.6: è coperto da typecheck e test, ma
  richiede comunque smoke DEV post-deploy.
- Il runtime locale disponibile è Node 24; l'esecuzione Node 22 è demandata alla CI e
  poi al runtime DEV.
- Node.js 22 ha una futura data di deprecazione pianificata: dovrà essere rivalutato
  prima del 30 aprile 2027.
- Nessuna verifica di deploy, log reali o comportamento del provider è dichiarata in
  questa PR.
