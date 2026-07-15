# HARD-01B — Smoke DEV: security header e CSP di Hosting

**Versione:** 1.0 · **Data creazione:** 15 luglio 2026 · **Ambito:** finding **HARD-F03**.
**Riferimenti:** `firebase.json` (`hosting.headers`), [`sicurezza.md §7.1`](../sicurezza.md), [`hardening-audit-v1.md`](../hardening-audit-v1.md), test statico `apps/web/src/hostingHeaders.test.ts`.

Smoke eseguito su DEV (`https://schoolforge-dev.web.app`) il **15/07/2026**, dopo il deploy dei security header e della cache (PR #179/#180/#181). **Esito: tutte le 12 voci PASS → HARD-F03 RESOLVED.**

**Tipi di evidenza (distinti):**
- **HTTP-auto** — evidenza HTTP automatica reale, osservata sulle response header di DEV (`curl -I` / DevTools Network).
- **Manuale DEV** — flusso applicativo confermato manualmente dal docente su DEV.

**Header/cache osservati su DEV (HTTP reale, 15/07/2026):**
- shell SPA: `HTTP 200`, `Cache-Control: no-cache`, CSP **enforced** (non report-only), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin-allow-popups`;
- `/assets/*`: `Cache-Control: public, max-age=31536000, immutable`;
- `/api/repository/*`: `Cache-Control: no-store`;
- `script-src` consente `https://apis.google.com` (loader Google Auth).

| # | Controllo | Evidenza | Stato |
|---|---|---|---|
| 1 | Security header presenti sulla risposta Hosting | **HTTP-auto**: su `/` e su `/assets/*` presenti `nosniff`, `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin-allow-popups`, `Referrer-Policy`, `Permissions-Policy` | **PASS (15/07/2026)** |
| 2 | CSP enforced presente | **HTTP-auto**: `Content-Security-Policy` presente (non `-Report-Only`) con `default-src 'self'` e `frame-ancestors 'none'` | **PASS (15/07/2026)** |
| 3 | Login Google docente | **Manuale DEV**: `signInWithPopup` completa; il docente entra in TeacherShell; nessun blocco CSP su `*.firebaseapp.com`/`accounts.google.com`/`apis.google.com` | **PASS (15/07/2026)** |
| 4 | Login Google studente | **Manuale DEV**: studente approvato entra in StudentShell; nessun errore auth/CSP | **PASS (15/07/2026)** |
| 5 | Caricamento lezione docente | **Manuale DEV**: apertura corso→UDA→lezione, rendering Markdown, foto profilo Google visibile | **PASS (15/07/2026)** |
| 6 | Caricamento lezione studente | **Manuale DEV**: Didattica studente read-only rende la lezione da `publicLessons`; nessun blocco immagini/connessioni | **PASS (15/07/2026)** |
| 7 | Modifica/salvataggio Didattica docente | **Manuale DEV**: editing contenuto/metadata/pool salvato via gateway `/api/repository/**` e Firestore | **PASS (15/07/2026)** |
| 8 | Download PDF / CSV / ZIP | **Manuale DEV**: generazione browser-side e download via Blob non bloccati (PDF, Registro Correzioni CSV, export ZIP) | **PASS (15/07/2026)** |
| 9 | Avvio/svolgimento/consegna verifica online | **Manuale DEV**: avvio sessione, autosave, Fullscreen (Modalità verifica) attivo, consegna completata | **PASS (15/07/2026)** |
| 10 | Nessun errore CSP inatteso in Console | **Manuale DEV**: nessuna violazione CSP durante i flussi 3–9 (i soli avvisi osservati sono i warning COOP, vedi nota) | **PASS (15/07/2026)** |
| 11 | Gateway repository funzionante | **HTTP-auto + Manuale DEV**: chiamate `/api/repository/read\|write\|delete\|batch-read` ok; risposta con `Cache-Control: no-store` (blocco Hosting dedicato + Function) | **PASS (15/07/2026)** |
| 12 | Cache corretta | **HTTP-auto**: `index.html` → `no-cache`; `/assets/*` → `public, max-age=31536000, immutable`; `/api/repository/*` → `no-store` | **PASS (15/07/2026)** |

## Warning COOP (rumore browser noto, non bloccante)

Durante il login, Chrome può mostrare fino a due avvisi:

> *Cross-Origin-Opener-Policy policy would block the window.close / window.closed call.*

Sono **warning diagnostici** prodotti dal **polling della popup Firebase/Google** su `window.closed`, non errori CSP e non violazioni di sicurezza. Il login **completa correttamente**: `Cross-Origin-Opener-Policy: same-origin-allow-popups` è la policy scelta apposta per **consentire** la comunicazione con la popup Auth (a differenza di `same-origin`, che la bloccherebbe). Sono rumore atteso del browser, **non un finding aperto** e **non richiedono modifiche** al flusso Auth né alla configurazione.

## Esito

- **Tutte le 12 voci `PASS` (15/07/2026):** **HARD-F03 = RESOLVED**. HARD-01B è **COMPLETATO**.
- Le origini richieste dai flussi reali sono state confermate e sono già in `firebase.json`: `https://apis.google.com` in `script-src` (loader Google Auth) e `Cross-Origin-Opener-Policy: same-origin-allow-popups` (comunicazione popup). Nessun redirect di download Storage e nessun `blob:`/`worker-src` aggiuntivo è risultato necessario: PDF/CSV/ZIP e gateway funzionano con la CSP corrente.

> **Nota immagini/CSP:** le immagini nelle lezioni ammesse dalla CSP sono solo same-origin/importate, `data:`, `blob:` o foto profilo Google (`*.googleusercontent.com`). Le immagini remote arbitrarie di terze parti restano **intenzionalmente bloccate** per privacy e sicurezza; `img-src` non va ampliato a `https:`/`*` senza una decisione futura esplicita. Se una lezione mostra un'immagine mancante, verificare che la sorgente sia importata nel repository (non un hotlink esterno), non allargare la CSP.
