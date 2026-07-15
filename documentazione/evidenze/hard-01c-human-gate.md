# HARD-01C — Human Gate: regioni e residenza dati (finding HARD-F02)

**Data creazione:** 15 luglio 2026 · **Ambito:** finding **HARD-F02**.
**Riferimenti:** [`hard-01c-region-matrix.md`](hard-01c-region-matrix.md), [`runbook-operativo-v1.md`](../runbook-operativo-v1.md), [`hardening-audit-v1.md`](../hardening-audit-v1.md).

Solo il docente può completare queste voci (richiedono CLI/Console o una decisione). Finché non sono tutte `DONE`, HARD-F02 resta **MITIGATED** (contraddizione documentale eliminata, ma verifica/decisione ancora aperte). Aggiorna lo **Stato** da `PENDING` a `DONE` (con data) e annota l'evidenza minima — **nessun** billing ID, project number sensibile o segreto.

### 1. Verifica regione Firestore DEV — **Stato: DONE (15/07/2026)**
- **Come:** `gcloud firestore databases describe --project schoolforge-dev --format='value(locationId)'` (oppure Firebase/GCP Console → Firestore → Impostazioni → Location).
- **Risultato registrato:** `locationId = europe-west8`; matrice `hard-01c-region-matrix.md` aggiornata con l'evidenza effettiva.
- **Perché:** la documentazione dichiarava `europe-west8` senza evidenza; va confermato o corretto con un dato reale.
- **Evidenza minima:** "Firestore DEV location = &lt;valore&gt;, verificata il GG/MM/AAAA".
- **Evidenza registrata:** `npx firebase firestore:databases:get "(default)" --project schoolforge-dev` → `Location: europe-west8` (15/07/2026).

### 2. Decisione regione PROD (UE) + co-locazione — **Stato: PENDING**
- **Come:** decisione del docente, da prendere **prima** di qualsiasi provisioning PROD.
- **Cosa registrare:** la regione **UE** scelta per PROD (es. `europe-west8` Milano, se supporta Firestore/Storage/Functions richiesti) e la conferma di **co-locare** Firestore, Storage e Functions nella stessa regione (latenza/costi egress).
- **Vincolo:** non provisionare nulla in questa fase; è solo la scelta documentata.
- **Evidenza minima:** "Regione PROD scelta = &lt;UE&gt;; co-locazione Firestore/Storage/Functions confermata".

### 3. Politica provisioning PROD ex novo, senza dati DEV — **Stato: DONE (15/07/2026)**
- **Come:** decisione del docente (già confermata); il provisioning effettivo resta fuori da questo pacchetto e dal Gate GHARD finché non autorizzato.
- **Cosa registrare:** conferma che i servizi PROD (Auth, Firestore, Storage, Functions, Hosting) saranno creati **ex novo**, **senza** migrare/copiare dati da DEV.
- **Evidenza registrata:** decisione confermata dal docente il 15/07/2026 — **nessun dato DEV sarà migrato in PROD**; l'eventuale provisioning PROD sarà eseguito **ex novo**; il provisioning PROD è **rinviato e non autorizzato da questa PR**. Coerente con `hard-01a-human-gate.md` §5/§6. (Resta aperta la **scelta della regione UE**: voce 2.)

---

## Esito del gate

- **Stato attuale (15/07/2026):** voci 1 e 3 **DONE**; resta **PENDING** solo la voce 2 (scelta definitiva regione UE per Firestore/Storage/Functions PROD).
- **Finché la voce 2 non è `DONE`:** HARD-F02 = **MITIGATED** — contraddizione documentale eliminata e regione Firestore DEV verificata; resta il solo **blocker PROD** sulla scelta della regione UE.
- **HARD-F02 → RESOLVED** solo quando: la regione Firestore DEV è verificata e registrata **e** la decisione di regione UE per PROD è presa e documentata. Il provisioning PROD effettivo non è richiesto per RESOLVED, ma la **decisione** di regione UE sì.
