# Gate GAIGEN — checklist manuale DEV

> Stato: **PENDING**. Il rollout tecnico è completato su DEV, ma il Gate non è superato finché TTL, smoke autenticati e conferma docente non sono completati.

## Rollout tecnico

- Progetto: `schoolforge-dev` (`dev`).
- SHA distribuito: `6f5fbc10115a0c57cd037e89c8de0d77b19ae60c`.
- Runtime usata per preflight e deploy: Node `v22.23.1`, pnpm `9.15.9`.
- Ordine eseguito: Functions → Firestore Rules → Hosting.
- Functions distribuite in `us-central1`: `aiContentPreview`, `aiContentGenerate`.
- Firestore Rules: distribuite.
- Hosting: <https://schoolforge-dev.web.app>.
- `AI_CONTENT_MODE`: `mock` dopo verifica fail-closed iniziale in `disabled`.
- Chiamate OpenAI e costo reale durante il rollout: **zero**.

## Evidenza automatica

- `format:check`: PASS.
- `lint`: PASS.
- `typecheck` monorepo: PASS.
- Functions: **623/623**.
- Web: **1866/1866**.
- Rules Emulator: **522/522**.
- Build Functions e web: PASS.
- `git diff --check`: PASS.
- Smoke pubblico Hosting: schermata di accesso caricata correttamente.

## Human Gate

- [x] Configurare la TTL della collection group `aiContentRuns`, campo `expireAt`, e verificarne lo stato `ACTIVE`.
- [ ] Con `AI_CONTENT_MODE=disabled`, autenticarsi come docente e verificare che «Genera con IA» sia presente sia nel pool sia nell’editor della lezione.
- [ ] Verificare che la preview fallisca in modo leggibile e senza creare run, prenotazioni o chiamate provider.
- [ ] In `mock`, generare e applicare un pool, controllando revisione, ID, difficoltà, soluzioni e salvataggio canonico.
- [ ] In `mock`, generare una lezione; verificare che «Usa questa bozza» modifichi solo il draft e che solo «Salva» persista il contenuto.
- [ ] Ripetere lo smoke essenziale su mobile/Brave senza overflow o dialog irraggiungibili.
- [ ] Verificare che uno studente non possa leggere `aiContentRuns` né vedere controlli di generazione.
- [ ] Solo con nuova autorizzazione esplicita al costo: attivare `openai`, provare un pool e una lezione, verificando stima, ledger, run privacy-minimal e costo registrato.
- [ ] Ripristinare immediatamente `disabled` in caso di anomalia.
- [ ] Conferma finale del docente.

## Vincoli per la chiusura

Il Gate resta **PENDING** finché tutte le voci sono verificate. Non sono ammessi fallback silenziosi tra `disabled`, `mock` e `openai`; il provider reale non va attivato prima della TTL e di una nuova autorizzazione esplicita al costo.
