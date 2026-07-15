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
| 1 | Security header presenti sulla risposta Hosting | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin-allow-popups`, `Referrer-Policy`, `Permissions-Policy` presenti su `/` e su un asset `/assets/*` | **PENDING** |
| 2 | CSP enforced presente | Header `Content-Security-Policy` presente (non `-Report-Only`) con `default-src 'self'` e `frame-ancestors 'none'` | **PENDING** |
| 3 | Login Google docente | `signInWithPopup` completa; il docente entra in TeacherShell; nessun blocco su `*.firebaseapp.com`/`accounts.google.com` | **PENDING** |
| 4 | Login Google studente | Studente approvato entra in StudentShell; nessun errore auth/CSP | **PENDING** |
| 5 | Caricamento lezione docente | Apertura corso→UDA→lezione, rendering Markdown, foto profilo Google visibile | **PENDING** |
| 6 | Caricamento lezione studente | Didattica studente read-only rende la lezione da `publicLessons`; nessun blocco immagini/connessioni | **PENDING** |
| 7 | Modifica/salvataggio Didattica docente | Editing contenuto/metadata/pool salvato via gateway `/api/repository/**` e Firestore | **PENDING** |
| 8 | Download PDF / CSV / ZIP | Generazione browser-side e download via Blob non bloccati (verifica PDF, Registro Correzioni CSV, export ZIP) | **PENDING** |
| 9 | Avvio/svolgimento/consegna verifica online | Avvio sessione, autosave, Fullscreen (Modalità verifica) attivo, consegna completata | **PENDING** |
| 10 | Nessun errore CSP inatteso in Console | Nessuna violazione CSP durante i flussi 3–9 | **PENDING** |
| 11 | Gateway repository funzionante | Chiamate `/api/repository/read\|write\|delete\|batch-read` ok; risposta con `Cache-Control: no-store` (imposto sia dal blocco Hosting dedicato `/api/repository/**` sia dalla Function) | **PENDING** |
| 12 | Cache corretta | `index.html` → `Cache-Control: no-cache`; `/assets/*` → `public, max-age=31536000, immutable`; `/api/repository/*` → `no-store` | **PENDING** |

## Esito

- **Finché tutte le voci non sono `PASS`:** HARD-F03 = **MITIGATED — configurazione pronta, deploy e smoke DEV pending**.
- **Quando tutte le voci sono `PASS`:** HARD-F03 può essere marcato **RESOLVED** e citato come evidenza per il Gate GHARD.
- **Se una voce `FAIL`:** annota la direttiva CSP/header responsabile e correggi in `firebase.json` (es. origine mancante in `connect-src`/`frame-src`) prima di ridichiarare MITIGATED.

> **Nota immagini/CSP:** le immagini nelle lezioni ammesse dalla CSP sono solo same-origin/importate, `data:`, `blob:` o foto profilo Google (`*.googleusercontent.com`). Le immagini remote arbitrarie di terze parti restano **intenzionalmente bloccate** per privacy e sicurezza; `img-src` non va ampliato a `https:`/`*` senza una decisione futura esplicita. Se una lezione mostra un'immagine mancante, verificare che la sorgente sia importata nel repository (non un hotlink esterno), non allargare la CSP.

> Esito parziale dello smoke: Google Auth ha richiesto `https://apis.google.com` in `script-src`; l'origine ufficiale è stata aggiunta dopo che la CSP enforced ne ha confermato la necessità. Il successivo warning su `window.closed` della popup è gestito con `Cross-Origin-Opener-Policy: same-origin-allow-popups`, senza introdurre COEP/CORP. Restano da verificare eventuali redirect di download Storage verso host non inclusi in `connect-src` ed eventuale `blob:`/`worker-src` per i generatori PDF.
