# HARD-01B — Smoke DEV: security header e CSP di Hosting

**Versione:** 1.0 · **Data creazione:** 15 luglio 2026 · **Ambito:** finding **HARD-F03**.
**Riferimenti:** `firebase.json` (`hosting.headers`), [`sicurezza.md §7.1`](../sicurezza.md), [`hardening-audit-v1.md`](../hardening-audit-v1.md), test statico `apps/web/src/hostingHeaders.test.ts`.

La configurazione degli header è pronta e coperta da un guardrail statico, **ma HARD-F03 resta MITIGATED — non RESOLVED — finché questa checklist non è completata su DEV dopo un deploy**. Il deploy DEV lo esegue il docente (nessun deploy da questo pacchetto).

**Come eseguire (DEV, https://schoolforge-dev.web.app):**
- header di risposta: DevTools → **Network** → seleziona il documento / gli asset → **Response Headers**; oppure `curl -I https://schoolforge-dev.web.app`.
- errori CSP: DevTools → **Console** (le violazioni CSP compaiono come `Refused to … because it violates the following Content Security Policy directive …`).

Aggiorna lo **Stato** di ogni voce da `PENDING` a `PASS`/`FAIL` (con data); se `FAIL`, annota la direttiva CSP o l'header coinvolto.

| # | Controllo | Come verificarlo | Stato |
|---|---|---|---|
| 1 | Security header presenti sulla risposta Hosting | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` presenti su `/` e su un asset `/assets/*` | **PENDING** |
| 2 | CSP enforced presente | Header `Content-Security-Policy` presente (non `-Report-Only`) con `default-src 'self'` e `frame-ancestors 'none'` | **PENDING** |
| 3 | Login Google docente | `signInWithPopup` completa; il docente entra in TeacherShell; nessun blocco su `*.firebaseapp.com`/`accounts.google.com` | **PENDING** |
| 4 | Login Google studente | Studente approvato entra in StudentShell; nessun errore auth/CSP | **PENDING** |
| 5 | Caricamento lezione docente | Apertura corso→UDA→lezione, rendering Markdown, foto profilo Google visibile | **PENDING** |
| 6 | Caricamento lezione studente | Didattica studente read-only rende la lezione da `publicLessons`; nessun blocco immagini/connessioni | **PENDING** |
| 7 | Modifica/salvataggio Didattica docente | Editing contenuto/metadata/pool salvato via gateway `/api/repository/**` e Firestore | **PENDING** |
| 8 | Download PDF / CSV / ZIP | Generazione browser-side e download via Blob non bloccati (verifica PDF, Registro Correzioni CSV, export ZIP) | **PENDING** |
| 9 | Avvio/svolgimento/consegna verifica online | Avvio sessione, autosave, Fullscreen (Modalità verifica) attivo, consegna completata | **PENDING** |
| 10 | Nessun errore CSP inatteso in Console | Nessuna violazione CSP durante i flussi 3–9 | **PENDING** |
| 11 | Gateway repository funzionante | Chiamate `/api/repository/read|write|delete|batch-read` ok; risposta con `Cache-Control: no-store` | **PENDING** |
| 12 | Cache corretta | `index.html` → `Cache-Control: no-cache`; `/assets/*` → `public, max-age=31536000, immutable` | **PENDING** |

## Esito

- **Finché tutte le voci non sono `PASS`:** HARD-F03 = **MITIGATED — configurazione pronta, deploy e smoke DEV pending**.
- **Quando tutte le voci sono `PASS`:** HARD-F03 può essere marcato **RESOLVED** e citato come evidenza per il Gate GHARD.
- **Se una voce `FAIL`:** annota la direttiva CSP/header responsabile e correggi in `firebase.json` (es. origine mancante in `connect-src`/`frame-src`) prima di ridichiarare MITIGATED.

> Rischi noti da confermare in smoke (se `FAIL`, aggiungere l'origine e ri-testare): eventuale necessità di `https://apis.google.com` in `script-src` per alcuni flussi Auth; eventuale redirect di download Storage verso un host non incluso in `connect-src`; eventuale `blob:`/`worker-src` per generatori PDF. Nessuno di questi è risultato necessario dall'analisi statica, ma vanno confermati con il deploy reale.
