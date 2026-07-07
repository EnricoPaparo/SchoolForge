# Smoke test — MVP docente cartaceo

**Versione:** 1.0
**Commit testato:** `4c1a05c` (feat(M2-D): import UI + readZipFile hardening)
**Data:** 2026-06-26
**Ambiente:** emulatori Firebase locali (auth:9099, firestore:8080, storage:9199) + Vite dev server
**Metodo:** Playwright/Chromium headless, osservazione diretta output app

---

## Setup

```bash
# Avvia emulatori
npx firebase emulators:start --project demo-schoolforge --only auth,firestore,storage

# Avvia app
cd apps/web && pnpm dev

# Crea utente docente nell'emulatore Auth (una tantum)
curl -X POST 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key' \
  -H 'Content-Type: application/json' \
  -d '{"email":"docente@test.it","password":"password123","returnSecureToken":true}'
```

---

## Checklist smoke test

### 1. Login docente

| Verifica | Expected | Risultato |
|---|---|---|
| Pagina login visibile a `localhost:5173` | Form email/password | ✅ PASS |
| Login con `docente@test.it` / `password123` | Reindirizzamento a OwnerSetup | ✅ PASS |
| Click "Diventa proprietario" | TeacherShell caricata con navigazione | ✅ PASS |

### 2. Creazione programma

| Verifica | Expected | Risultato |
|---|---|---|
| Navigazione a "Programmi / UDA / Lezioni" | Vista programmi con form creazione | ✅ PASS |
| Inserimento titolo + click "Crea programma" | Programma appare nella lista | ✅ PASS |
| Click sul programma | Pannello dettaglio con "Importa ZIP didattico" | ✅ PASS |

### 3. Import ZIP didattico

| Verifica | Expected | Risultato |
|---|---|---|
| Selezione file `.zip` valido | File selezionato, button "Importa ZIP" abilitato | ✅ PASS |
| Click "Importa ZIP" | Messaggio "Import completato: N UDA, N lezioni, N domande" | ✅ PASS |
| ZIP senza front matter UDA | Alert con messaggio di errore specifico | ✅ PASS |
| Wrapper folder strippato automaticamente | Percorsi corretti nel risultato | ✅ PASS (test unitari) |
| Artefatti OS filtrati (`__MACOSX`, `.DS_Store`) | Non presenti nel risultato | ✅ PASS (test unitari) |

**Dati importati nel test:**
- 1 UDA (`uda-01-reti`)
- 1 lezione (`lezione-001-http.md`)
- 2 domande (1 aperta peso 2pt, 1 chiusa_singola peso 3pt)

### 4. UDA e lezioni visibili

| Verifica | Expected | Risultato |
|---|---|---|
| UDA `uda-01-reti` visibile nel pannello | Nome UDA nel panel | ✅ PASS |
| Dashboard prontezza: "Generazione verifiche ✓" | Check verde | ✅ PASS |
| Dashboard prontezza: "Import attivo ✓" | Check verde | ✅ PASS |
| Dashboard prontezza: "Pool validi ✓" | Check verde | ✅ PASS |

### 5. Creazione classe

| Verifica | Expected | Risultato |
|---|---|---|
| Navigazione a "Impostazioni" | ClassesView con form | ✅ PASS |
| Inserimento "3A Informatica" + click "Crea classe" | Classe appare nella lista | ✅ PASS |

### 6. Creazione verifica draft

| Verifica | Expected | Risultato |
|---|---|---|
| Navigazione a "Verifiche cartacee" | Form "Crea nuova verifica" visibile | ✅ PASS |
| Programma disponibile nel select | "Reti Informatiche" presente | ✅ PASS |
| Classe disponibile nel select | "3A Informatica" presente | ✅ PASS |
| Compilazione titolo + selezione programma + classe + click "Crea verifica" | Verifica in lista con badge BOZZA | ✅ PASS |

### 7. Selezione domande dal questionIndex

| Verifica | Expected | Risultato |
|---|---|---|
| Click sulla verifica in lista | Pannello dettaglio con sezione "Selezione domande" | ✅ PASS |
| Domande caricate dal questionIndex | 2 domande visibili con tipo/difficoltà/peso/punti | ✅ PASS |
| Selezione checkbox prima domanda | Contatore "1 domanda/e selezionata/e" | ✅ PASS |
| Selezione tutte le domande | Contatore "2 domanda/e selezionate", button "Attiva verifica" abilitato | ✅ PASS |

### 8. Attivazione verifica

| Verifica | Expected | Risultato |
|---|---|---|
| Click "Attiva verifica" | Pannello conferma visibile | ✅ PASS |
| Click "Conferma attivazione" | Status verifica → ATTIVA | ✅ PASS |
| Pulsante "Scarica PDF" visibile | Button abilitato | ✅ PASS |
| Verifica draft: nessun pulsante PDF | Button assente | ✅ PASS (test UI) |
| Verifica chiusa: nessun pulsante PDF | Button assente | ✅ PASS (test UI) |

### 9. Download PDF studente

| Verifica | Expected | Risultato |
|---|---|---|
| Click "Scarica PDF" | File `<titolo>_studente.pdf` scaricato | ✅ PASS |
| Nessun errore UI dopo il click | Nessun alert di errore | ✅ PASS |
| File PDF generato (dimensione > 0) | 4864 bytes | ✅ PASS |

### 10. Ispezione contenuto PDF

PDF: `Verifica_HTTP_studente.pdf` — estratto grezzo:

```
'Verifica HTTP'
'Classe: 3A Informatica'
'Nome e Cognome: _________________________________________'
'Data: ____________________'
'1.  Spiega cosa si intende per protocollo HTTP.  [2 pt]'
'2.  Quale porta usa HTTP di default?  [3 pt]'
'Punteggio: ________ / 5'
```

| Verifica | Expected | Risultato |
|---|---|---|
| Titolo verifica presente | "Verifica HTTP" | ✅ PASS |
| Classe presente | "Classe: 3A Informatica" | ✅ PASS |
| Campo "Nome e Cognome" presente | Riga con trattini | ✅ PASS |
| Campo "Data" presente | Riga con trattini | ✅ PASS |
| Domande numerate con punteggio `[N pt]` | "1. ... [2 pt]", "2. ... [3 pt]" | ✅ PASS |
| Totale punteggio in calce | "Punteggio: ________ / 5" | ✅ PASS |
| `soluzione` assente nel PDF | Non trovato | ✅ PASS |
| `correctAnswer` assente nel PDF | Non trovato | ✅ PASS |
| Marker risposta corretta assente | Non trovato | ✅ PASS |

---

## Test automatici (eseguiti nella stessa sessione)

```
pnpm format:check  → OK (tutti i file formattati)
pnpm lint          → OK (0 errori, 1 warning preesistente)
pnpm typecheck     → OK
pnpm test          → OK — 197/197 test passati (24 test file)
pnpm build         → OK (warning chunk size jsPDF preesistente)
```

---

## Verdict complessivo

**PASS** — SchoolForge è usabile come MVP docente cartaceo in ambiente dev.

---

## Limiti residui

- Dati negli emulatori sono temporanei (persi al riavvio).
- Nessun deploy su dominio pubblico — solo `localhost:5173`.
- Portale studenti (M3), correzione (M4) e AI (M5) non implementati.
- La sezione "Classi" si trova sotto "Impostazioni" (UX non intuitiva).
- Test E2E Playwright non integrati in CI (smoke test eseguito manualmente).
- Security Rules non testate su progetto Firebase reale.
