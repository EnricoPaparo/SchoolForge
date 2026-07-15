# HARD-01C — Human Gate: regioni e residenza dati (finding HARD-F02)

**Data creazione:** 15 luglio 2026 · **Ambito:** finding **HARD-F02**.
**Riferimenti:** [`hard-01c-region-matrix.md`](hard-01c-region-matrix.md), [`runbook-operativo-v1.md`](../runbook-operativo-v1.md), [`hardening-audit-v1.md`](../hardening-audit-v1.md).

Solo il docente può completare queste voci (richiedono CLI/Console o una decisione). Finché non sono tutte `DONE`, HARD-F02 resta **MITIGATED** (contraddizione documentale eliminata, ma verifica/decisione ancora aperte). Aggiorna lo **Stato** da `PENDING` a `DONE` (con data) e annota l'evidenza minima — **nessun** billing ID, project number sensibile o segreto.

### 1. Verifica regione Firestore DEV — **Stato: PENDING**
- **Come:** `gcloud firestore databases describe --project schoolforge-dev --format='value(locationId)'` (oppure Firebase/GCP Console → Firestore → Impostazioni → Location).
- **Cosa registrare:** la `locationId` reale del database Firestore DEV, aggiornando la matrice (`hard-01c-region-matrix.md`) da **NON VERIFICATA** al valore effettivo.
- **Perché:** la documentazione dichiarava `europe-west8` senza evidenza; va confermato o corretto con un dato reale.
- **Evidenza minima:** "Firestore DEV location = &lt;valore&gt;, verificata il GG/MM/AAAA".

### 2. Decisione regione PROD (UE) + co-locazione — **Stato: PENDING**
- **Come:** decisione del docente, da prendere **prima** di qualsiasi provisioning PROD.
- **Cosa registrare:** la regione **UE** scelta per PROD (es. `europe-west8` Milano, se supporta Firestore/Storage/Functions richiesti) e la conferma di **co-locare** Firestore, Storage e Functions nella stessa regione (latenza/costi egress).
- **Vincolo:** non provisionare nulla in questa fase; è solo la scelta documentata.
- **Evidenza minima:** "Regione PROD scelta = &lt;UE&gt;; co-locazione Firestore/Storage/Functions confermata".

### 3. Autorizzazione provisioning PROD ex novo, senza dati DEV — **Stato: PENDING**
- **Come:** decisione del docente; il provisioning effettivo resta fuori da questo pacchetto e dal Gate GHARD finché non autorizzato.
- **Cosa registrare:** conferma che i servizi PROD (Auth, Firestore, Storage, Functions, Hosting) saranno creati **ex novo** nella regione UE scelta, **senza** migrare/copiare dati da DEV.
- **Evidenza minima:** "Provisioning PROD ex novo autorizzato/rinviato; nessun dato DEV migrato".

---

## Esito del gate

- **Finché le voci 1–3 non sono `DONE`:** HARD-F02 = **MITIGATED** — contraddizione documentale eliminata; **blocker PROD** (decisione regione UE + provisioning ex novo) e **verifica Firestore DEV** ancora aperti.
- **HARD-F02 → RESOLVED** solo quando: la regione Firestore DEV è verificata e registrata **e** non resta alcuna decisione manuale rilevante (la decisione PROD è presa e documentata). Il provisioning PROD effettivo non è richiesto per RESOLVED, ma la **decisione** di regione UE sì.
</content>
