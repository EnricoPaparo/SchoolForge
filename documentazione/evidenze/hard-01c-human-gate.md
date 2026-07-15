# HARD-01C — Human Gate: regioni e residenza dati (finding HARD-F02)

**Data creazione:** 15 luglio 2026 · **Ambito:** finding **HARD-F02**.
**Riferimenti:** [`hard-01c-region-matrix.md`](hard-01c-region-matrix.md), [`runbook-operativo-v1.md`](../runbook-operativo-v1.md), [`hardening-audit-v1.md`](../hardening-audit-v1.md).

Solo il docente può completare queste voci (richiedono CLI/Console o una decisione). Tutte le voci sono ora `DONE`; nessun billing ID, project number sensibile o segreto è registrato.

### 1. Verifica regione Firestore DEV — **Stato: DONE (15/07/2026)**
- **Come:** `gcloud firestore databases describe --project schoolforge-dev --format='value(locationId)'` (oppure Firebase/GCP Console → Firestore → Impostazioni → Location).
- **Risultato registrato:** `locationId = europe-west8`; matrice `hard-01c-region-matrix.md` aggiornata con l'evidenza effettiva.
- **Perché:** la documentazione dichiarava `europe-west8` senza evidenza; va confermato o corretto con un dato reale.
- **Evidenza minima:** "Firestore DEV location = &lt;valore&gt;, verificata il GG/MM/AAAA".
- **Evidenza registrata:** `npx firebase firestore:databases:get "(default)" --project schoolforge-dev` → `Location: europe-west8` (15/07/2026).

### 2. Decisione regione PROD (UE) + co-locazione — **Stato: DONE (15/07/2026)**
- **Come:** decisione del docente, presa **prima** di qualsiasi provisioning PROD.
- **Decisione registrata:** target PROD **`europe-west8` (Milano)** per Firestore, Storage e Functions, da co-locare. Prima di creare ogni servizio va verificato che la combinazione richiesta sia supportata; in caso contrario il provisioning si ferma e la decisione viene riaperta, senza scegliere silenziosamente una regione diversa.
- **Vincolo:** non provisionare nulla in questa fase; è solo la scelta documentata.
- **Evidenza registrata:** decisione confermata dal docente il 15/07/2026; nessun servizio PROD creato, abilitato o fatturato da questa decisione.

### 3. Politica provisioning PROD ex novo, senza dati DEV — **Stato: DONE (15/07/2026)**
- **Come:** decisione del docente (già confermata); il provisioning effettivo resta fuori da questo pacchetto e dal Gate GHARD finché non autorizzato.
- **Cosa registrare:** conferma che i servizi PROD (Auth, Firestore, Storage, Functions, Hosting) saranno creati **ex novo**, **senza** migrare/copiare dati da DEV.
- **Evidenza registrata:** decisione confermata dal docente il 15/07/2026 — **nessun dato DEV sarà migrato in PROD**; l'eventuale provisioning PROD sarà eseguito **ex novo**; il provisioning PROD è **rinviato e non autorizzato da questa PR**. Coerente con `hard-01a-human-gate.md` §5/§6.

---

## Esito del gate

- **Stato finale (15/07/2026): PASS.** Tutte le voci sono **DONE**.
- **HARD-F02 = RESOLVED:** regione Firestore DEV verificata; regioni DEV reali documentate; target PROD `europe-west8` e co-locazione formalizzati; nessun dato DEV sarà migrato.
- Il provisioning PROD effettivo non fa parte di HARD-F02 né del Gate GHARD: resta una futura operazione esplicitamente autorizzata, preceduta dalla verifica di compatibilità dei servizi.
