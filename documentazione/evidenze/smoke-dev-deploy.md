# Smoke test — Deploy DEV (schoolforge-dev)

**Versione:** 1.0
**Commit testato:** `92bef38` (fix(lesson-content): use getBytes instead of getDownloadURL+fetch)
**Data:** 2026-07-07
**Ambiente:** Firebase DEV — https://schoolforge-dev.web.app
**Metodo:** test manuale (Docente), osservazione diretta nel browser

---

## Configurazione DEV attiva

| Risorsa | Valore |
|---|---|
| Firebase Project | `schoolforge-dev` |
| Hosting URL | https://schoolforge-dev.web.app |
| Firestore | `europe-west8` (o default progetto) |
| Storage | `schoolforge-dev.firebasestorage.app` |
| Auth | Firebase Authentication abilitata |

### Fix operativo extra: CORS bucket Storage

`getDownloadURL` + `fetch` richiedeva CORS configurato sul bucket. Anche dopo il passaggio a `getBytes` (PR #29), il bucket Storage DEV richiedeva configurazione CORS per consentire accesso dall'origine web app.

Configurazione CORS applicata al bucket `schoolforge-dev.firebasestorage.app`:

```json
[
  {
    "origin": ["https://schoolforge-dev.web.app", "http://localhost:5173"],
    "method": ["GET"],
    "maxAgeSeconds": 3600
  }
]
```

Questa configurazione è un'azione operativa sul progetto Firebase DEV, non un file nel repository.

---

## Checklist smoke test

### 1. Caricamento app

| Verifica | Expected | Risultato |
|---|---|---|
| `https://schoolforge-dev.web.app` risponde | Pagina login visibile | ✅ PASS |
| Nessun errore console critico al caricamento | Console pulita | ✅ PASS |

### 2. Login docente

| Verifica | Expected | Risultato |
|---|---|---|
| Login con account Firebase Auth reale | Reindirizzamento a OwnerSetup o TeacherShell | ✅ PASS |
| Click "Diventa proprietario" (primo avvio) | TeacherShell caricata con navigazione | ✅ PASS |

### 3. Import ZIP didattico

| Verifica | Expected | Risultato |
|---|---|---|
| Selezione file `.zip` valido | File selezionato, button "Importa ZIP" abilitato | ✅ PASS |
| Click "Importa ZIP" | Messaggio "Import completato: N UDA, N lezioni, N domande" | ✅ PASS |

### 4. UDA e lezioni visibili

| Verifica | Expected | Risultato |
|---|---|---|
| UDA importata visibile nel pannello | Nome UDA nel panel | ✅ PASS |
| Lezione visibile e caricabile | Contenuto Markdown della lezione caricato | ✅ PASS |
| Errore CORS Storage assente | Nessun errore CORS in console | ✅ PASS (dopo fix CORS bucket) |

### 5–9. Flusso verifica (ereditato da smoke locale)

Il flusso creazione classe → verifica draft → selezione domande → attivazione → PDF studente è stato verificato in ambiente locale (vedi [smoke-mvp-docente-cartaceo.md](smoke-mvp-docente-cartaceo.md)) e confermato funzionante su DEV.

---

## Verdict complessivo

**DEV SMOKE PASS** — SchoolForge MVP docente cartaceo è funzionante su Firebase DEV (https://schoolforge-dev.web.app).

---

## Fix richiesti rispetto all'ambiente locale

| Fix | Tipo | Note |
|---|---|---|
| PR #29: `getBytes` al posto di `getDownloadURL+fetch` | Codice (mergiato su main) | Evita CORS per lettura file Storage |
| Configurazione CORS bucket Storage DEV | Operativa (Firebase Console / gsutil) | Non nel repository |

---

## Limiti residui

- UX/UI rozza: navigazione, layout e feedback visivo da rifinire in fase successiva.
- La voce "Classi" è sotto "Impostazioni" (non intuitivo).
- Dati su Firebase DEV sono persistenti ma non di produzione.
- Security Rules non verificate su carico reale.
- Portale studenti (M3), correzione (M4) e AI (M5) non implementati.
- Test E2E Playwright non integrati in CI.
- CORS bucket Storage configurato manualmente su DEV; da replicare su PROD al momento del deploy produzione.

---

## Prossimo lavoro

**UX/Product Polish** — fase separata. Obiettivo: rendere l'interfaccia docente sufficientemente rifinita per un uso regolare. Non è un prerequisito tecnico per M3; è un prerequisito di usabilità.
