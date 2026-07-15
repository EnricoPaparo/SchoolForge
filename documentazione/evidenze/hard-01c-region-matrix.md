# HARD-01C — Matrice regioni e residenza dati (finding HARD-F02)

**Data:** 15 luglio 2026 · **Ambito:** finding **HARD-F02** (residenza dati / coerenza doc↔regioni).
**Natura:** audit **read-only**. Nessun servizio creato/abilitato, nessun dato migrato, nessun deploy, nessun costo introdotto.
**Riferimenti:** `functions/src/repositoryGateway.ts`, `firebase.json`, `.firebaserc`, `runbook-operativo-v1.md`, `hardening-audit-v1.md`.

## Legenda stato
- **Esistente/operativo** — risorsa presente e in uso, con evidenza.
- **Non verificato** — non è stato possibile confermare in questa sessione (nessuna CLI/Console disponibile).
- **Non provisionato** — risorsa non ancora creata/abilitata (da fare ex novo in futuro).
- **Regione verificata** — solo se supportata da evidenza reale; altrimenti **NON VERIFICATA** (non si inventano regioni).

## Matrice DEV / PROD

### DEV — `schoolforge-dev`

| Servizio | Stato | Regione | Fonte evidenza | Decisione richiesta |
|---|---|---|---|---|
| Firebase project | Esistente/operativo | — | `.firebaserc` (alias `dev → schoolforge-dev`); deploy DEV attivo `https://schoolforge-dev.web.app` | — |
| Authentication | Esistente/operativo | Globale (Auth non ha regione dati configurabile per progetto) | Login Google verificato in `evidenze/hard-01b-dev-smoke.md`; `apps/web/src/lib/auth.tsx` | — |
| Firestore | Esistente/operativo | **`europe-west8`** (verificata) | `npx firebase firestore:databases:get "(default)" --project schoolforge-dev` → `Location: europe-west8` (15/07/2026) | — |
| Storage | Esistente/operativo | **`us-central1`** (verificata) | `functions/src/repositoryGateway.ts:25-29` cita `gcloud storage buckets describe gs://schoolforge-dev.firebasestorage.app → location: US-CENTRAL1` | — |
| Functions (`repositoryGateway`) | Esistente/operativo | **`us-central1`** (verificata) | `functions/src/repositoryGateway.ts:31` `GATEWAY_REGION = 'us-central1'`; `firebase.json:10` rewrite region `us-central1`; co-locata col bucket per evitare egress cross-region | — |
| Hosting | Esistente/operativo | CDN globale (nessuna regione singola) | `firebase.json` (`hosting`); URL DEV attivo | — |

### PROD — `schoolforge-prod`

| Servizio | Stato | Regione | Fonte evidenza | Decisione richiesta |
|---|---|---|---|---|
| Firebase project | **Esistente** (progetto già creato) | — | Contesto verificato dal docente; **non** presente in `.firebaserc` (alias `prod` non configurato) | — |
| Authentication | **Non provisionato / non verificato** | — | Nessuna evidenza di provisioning | Sì (in fase di provisioning PROD) |
| Firestore | **Non provisionato / non verificato** | **DA DECIDERE** | Nessun database creato/verificato | **Sì**: scegliere regione **UE** prima del provisioning |
| Storage | **Non provisionato / non verificato** | **DA DECIDERE** | Nessun bucket verificato | **Sì**: regione UE, co-locata con Firestore/Functions |
| Functions | **Non provisionato / non verificato** | **DA DECIDERE** | Nessuna Function PROD | **Sì**: regione UE, co-locata col bucket |
| Hosting | **Non provisionato / non verificato** (nessun deploy PROD) | CDN globale | Nessun deploy PROD eseguito | — |

## Strategia formalizzata (residenza dati)

1. **DEV è un ambiente non produttivo**: dati sintetici, prove consentite; le sue regioni reali (Storage/Function `us-central1`; Firestore da verificare) **non** vincolano PROD.
2. **PROD è un progetto separato già esistente ma non autorizzato all'uso**: nessun servizio provisionato/verificato; PROD non è operativo né autorizzato finché il **Gate GHARD** non è superato.
3. **Nessun dato DEV sarà migrato in PROD**: PROD partirà pulito (coerente con `evidenze/hard-01a-human-gate.md` §5/§6).
4. **I servizi PROD verranno provisionati ex novo**, separatamente, in futuro.
5. **Prima del provisioning PROD** si dovrà **scegliere una regione UE compatibile** (es. `europe-west8` Milano, se supporta i servizi richiesti) e **co-locare, quando possibile, Firestore, Storage e Functions** nella stessa regione, per ridurre latenza e costi di egress cross-region — lo stesso principio di co-locazione già applicato su DEV (Function pinnata al bucket).
6. **Nessuna scelta né provisioning PROD viene eseguito in questa PR** (audit e documentazione soltanto).

## Correzioni documentali applicate

Le seguenti affermazioni assolute/non verificate sono state corrette (vedi diff della PR):
- `README.md`, `architettura.md`, `sicurezza.md`: la dicitura «Firestore, Storage e Functions usano Milano `europe-west8`» come stato di fatto era **falsa per DEV** (Storage/Function `us-central1`) e **non verificata** per Firestore. Riformulate come **target UE per PROD** + **stato reale DEV** con rinvio a questa matrice.
- La regione Firestore DEV è ora supportata da evidenza CLI: **`europe-west8`**.
- PROD non è dichiarato «a Milano» come se fosse operativo: è un progetto esistente **non ancora provisionato**, con regione **da decidere (UE)**.

## Limiti dell'audit

- La regione **Firestore DEV** è stata verificata dopo l'audit iniziale tramite Firebase CLI ed è registrata come **`europe-west8`**; non è stata apportata alcuna modifica al database.
- Lo stato di provisioning **PROD** non è ispezionabile da qui (nessuna Console/CLI); riportato come **non verificato/non provisionato** in base al contesto dichiarato.
</content>
