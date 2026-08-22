# PROD-ROLLOUT-01 — stato operativo di produzione

**Data verifica:** 21 agosto 2026  
**Progetto:** `schoolforge-prod`  
**Esito:** **PROD operativo**

## Evidenze verificate

- `.firebaserc` contiene gli alias separati `dev → schoolforge-dev` e
  `prod → schoolforge-prod`.
- `firebase.prod.json` usa Hosting con build PROD, rewrite same-origin del
  Repository Storage Gateway in `europe-west8`, Functions Node.js 22, Rules e
  indici dedicati allo stesso progetto.
- La configurazione client PROD punta a `schoolforge-prod` e non abilita gli
  emulatori. Nessun segreto o valore dell'API key è riportato in questa
  evidenza.
- Firebase Hosting espone `https://schoolforge-prod.web.app`; il 21 agosto
  2026 la pagina ha risposto HTTP 200 con `Cache-Control: no-cache`.
- L'asset JavaScript servito da PROD contiene l'identità `schoolforge-prod` e
  non contiene `schoolforge-dev` né il marcatore di uso emulatori.
- L'inventario Firebase conferma Functions v2 su Node.js 22: le Functions
  applicative PROD sono in `europe-west8`; la coda di chiusura programmata
  delle consegne usa `europe-west3`, come previsto dalla configurazione
  operativa.
- Firestore e Storage PROD sono separati da DEV. Per decisione esplicita del
  docente non è stata eseguita alcuna migrazione dei dati DEV.

## Confine di questa evidenza

Questa verifica sostituisce, per lo **stato corrente**, le vecchie frasi
«PROD non operativo» o «non ancora provisionato». I documenti di gate datati
luglio/agosto che dichiaravano di non autorizzare PROD restano corretti come
evidenze storiche: quel singolo gate non costituiva l'autorizzazione. Il
rollout è stato autorizzato ed eseguito successivamente.

La configurazione del budget e il controllo periodico dei costi restano
attività manuali del docente. La politica di conservazione è invece definita da
[OPS-BACKUP-01](ops-backup-01.md): archivio documentale verificato, senza backup
gestiti o schedulati di Firestore/Storage. Un budget Cloud Billing invia avvisi
ma non costituisce un hard cap.

Il batch-write del Repository Storage Gateway introdotto da SGW-02C è coperto
da test e CI nella relativa modifica; la presente evidenza non dichiara un
deploy successivo di quel commit.
