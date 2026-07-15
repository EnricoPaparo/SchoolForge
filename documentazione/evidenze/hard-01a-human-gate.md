# HARD-01A — Human Gate operativo (azioni manuali del docente)

**Versione:** 1.0 · **Data creazione:** 15 luglio 2026 · **Ambito:** finding **HARD-F01**.
**Riferimenti:** [`runbook-operativo-v1.md`](../runbook-operativo-v1.md), [`hardening-audit-v1.md`](../hardening-audit-v1.md).

Questa checklist elenca le azioni **manuali** che solo il docente può eseguire (Console / account). Finché non sono completate, HARD-F01 resta **MITIGATED — documentazione pronta, configurazione manuale pending**, **non** risolto.

**Regole di compilazione**
- Aggiorna lo **Stato** di ogni voce da `PENDING` a `DONE` (con data) man mano che completi l'azione.
- Nell'**Evidenza** annota solo il minimo indispensabile a dimostrare che è fatto: **mai** ID di fatturazione, numeri di billing account, token, credenziali o screenshot che li contengano.
- Se alleghi uno screenshot, **oscura** billing account ID, project number sensibili e importi di fatturazione reali.

---

### 1. Budget DEV creato — **Stato: PENDING**
- **Percorso Console:** console.cloud.google.com → **Billing** → **Budgets & alerts** → **Create budget**, ambito progetto `schoolforge-dev`.
- **Cosa inserire:** importo mensile indicativo **€5**; ambito = solo `schoolforge-dev`.
- **Cosa NON pubblicare:** billing account ID, project number, importi di fatturazione reali.
- **Evidenza minima:** "Budget DEV €5 creato il GG/MM/AAAA" (senza ID).

### 2. Soglie 50% / 80% / 100% abilitate — **Stato: PENDING**
- **Percorso Console:** nello stesso budget → sezione **Threshold rules / Actions**.
- **Cosa inserire:** tre soglie sull'importo: **50%, 80%, 100%** (facoltativa una soglia *forecasted*).
- **Cosa NON pubblicare:** nulla oltre la conferma testuale.
- **Evidenza minima:** "Soglie 50/80/100% attive".

### 3. Destinatario notifiche verificato — **Stato: PENDING**
- **Percorso Console:** budget → **Email notifications / Monitoring** → destinatari (owner fatturazione / email docente).
- **Cosa inserire:** l'email dell'owner che deve ricevere gli avvisi; verifica che sia corretta e monitorata.
- **Cosa NON pubblicare:** l'indirizzo email nel repository (annota solo "verificato").
- **Evidenza minima:** "Destinatario avvisi verificato".

### 4. Alert di prova / configurazione verificata visivamente — **Stato: PENDING**
- **Percorso Console:** budget → riepilogo configurazione (rivedi soglie + destinatario).
- **Cosa inserire:** nessuna spesa reale da forzare; è sufficiente **verificare visivamente** che soglie e destinatario siano salvati e attivi (un vero alert arriverà al superamento reale della soglia — il budget **avvisa, non blocca**, vedi runbook §4).
- **Cosa NON pubblicare:** screenshot con billing ID.
- **Evidenza minima:** "Configurazione budget verificata a video il GG/MM/AAAA".

### 5. Politica backup DEV approvata — **Stato: PENDING**
- **Percorso:** decisione del docente (nessuna Console richiesta) — vedi runbook §5.1.
- **Cosa inserire:** conferma di adottare la politica DEV: **nessun backup schedulato**; **export puntuale prima di** migrazioni / cancellazioni massive / modifiche strutturali.
- **Cosa NON pubblicare:** nulla di sensibile.
- **Evidenza minima:** "Politica backup DEV approvata".

### 6. Politica backup PROD — rinviata **oppure** approvata esplicitamente — **Stato: PENDING**
- **Percorso:** decisione del docente — vedi runbook §5.2.
- **Cosa inserire:** una delle due: (a) **rinviata** finché PROD non viene aperto; oppure (b) **approvata** con cadenza, retention e **costi di storage degli export accettati esplicitamente**.
- **Cosa NON pubblicare:** nomi bucket, importi di fatturazione.
- **Evidenza minima:** "Backup PROD: rinviato" **oppure** "Backup PROD approvato (cadenza/retention concordate)".

### 7. Procedura rollback letta e verificata — **Stato: PENDING**
- **Percorso:** runbook §3; opzionale prova reale del **rollback Hosting su DEV** (`firebase hosting:rollback` o Console).
- **Cosa inserire:** conferma di aver letto §3 e comprendere cosa un rollback Hosting **non** ripristina (dati, Rules, Storage, Functions).
- **Cosa NON pubblicare:** nulla di sensibile.
- **Evidenza minima:** "Rollback letto" (e, se provato su DEV, "rollback Hosting DEV provato il GG/MM/AAAA").

### 8. Procedura incidente owner letta — **Stato: PENDING**
- **Percorso:** runbook §7.
- **Cosa inserire:** conferma di aver letto la checklist di compromissione account owner e sapere dove agire (Google account, Firebase/GCP IAM, GitHub, toggle portale studenti).
- **Cosa NON pubblicare:** nulla di sensibile.
- **Evidenza minima:** "Procedura incidente owner letta".

### 9. Nessun segreto inserito nel repository — **Stato: PENDING**
- **Percorso:** verifica finale del docente prima di considerare il gate chiuso.
- **Cosa inserire:** conferma che, nel completare i punti sopra, **non** sono stati committati billing ID, token, credenziali o export con PII. Le chiavi `VITE_FIREBASE_*` restano pubbliche per design (non sono segreti).
- **Cosa NON pubblicare:** —
- **Evidenza minima:** "Verificato: nessun segreto nel repository".

---

## Esito del gate

- **Finché tutte le voci non sono `DONE`:** HARD-F01 = **MITIGATED — documentazione pronta, configurazione manuale pending**.
- **Quando tutte le voci sono `DONE`:** il docente può marcare HARD-F01 come **risolto** e citare questo file come evidenza nella futura checklist del Gate GHARD.

> Questo documento **non** deve contenere screenshot con ID sensibili, token o dati di fatturazione. Annota esiti in forma testuale minima.
