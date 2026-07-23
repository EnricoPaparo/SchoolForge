# AIGEN-00 — Evidenza di review (contratto + prototipi)

> Pacchetto **solo documentazione e prototipi statici**. Nessun file applicativo, test runtime, Function, Rule, indice, configurazione o dipendenza è modificato. Nessuna API key letta, nessuna chiamata OpenAI, zero costo reale, nessun deploy.

## 1. File creati (solo nuovi)

| File | Tipo | Scopo |
|---|---|---|
| `documentazione/ai-content-generation-roadmap.md` | Markdown | Contratto congelato: architettura, payload, `aiContentRuns`, prompt/sicurezza, cost model, roadmap AIGEN-01/02/03 + Gate GAIGEN. |
| `documentazione/prototipi/ai-pool-generator.html` | HTML statico | Mock UI generazione pool (pool assente/esistente, dialog, stati, responsive, a11y). |
| `documentazione/prototipi/ai-lesson-generator.html` | HTML statico | Mock UI generazione lezione (editor, dialog, warning sostituzione, `Usa questa bozza`, stati). |
| `documentazione/evidenze/aigen-00-review.md` | Markdown | Questa evidenza. |

Nessun file esistente è stato toccato (verifica in §4).

## 2. Decisioni congelate (checklist)

- [x] Nomi callable: `aiContentPreview`, `aiContentGenerate`.
- [x] Discriminante `kind`: `pool` | `lesson`.
- [x] Profili modello: `economy` | `quality` (mapping server-side, riuso `MODEL_PROFILE_RESOLUTIONS`).
- [x] Stile pool e range: Base 1–3, Bilanciato 1–5, Avanzato 3–5.
- [x] Profondità lezione: Sintetica / Completa / Approfondita.
- [x] Quantità: interi ≥ 0 per tipo, totale ≥ 1, **max 30**.
- [x] Limite guidance: 500 caratteri, trim, nessun troncamento silenzioso.
- [x] Output temporaneo + TTL: `aiContentRuns/{opaqueRunId}`, TTL 24h, server-only.
- [x] Replay: completato→stesso risultato/zero costo; running/lease valida→`running`; lease scaduta→takeover; input diverso→`invalid_input`; legacy→fail-closed.
- [x] Applicazione manuale: pool via service canonico dopo conferma; lezione via `Usa questa bozza`→draft dirty→`Salva` canonico.
- [x] Nessun autosave IA.
- [x] Posizione pulsanti: pool assente (`Crea pool`/`Genera con IA`), pool esistente (toolbar), lezione (MarkdownBodyEditor).
- [x] Campi dialog, validazioni, gestione pool assente/esistente, sostituzione bozza lezione.
- [x] Una sola chiamata logica; retry ≤ 1.
- [x] Error codes: riuso esistenti + `content_too_large`, `output_invalid`, `output_too_large`, `run_conflict`.
- [x] Cosa persistere / non persistere in `aiContentRuns`.
- [x] Costi Firestore/provider (prima/dopo) e soglie di stop.
- [x] Criteri Gate GAIGEN.

## 3. Cap dimensionali coerenti col repository

- Output lezione ≤ `MAX_LESSON_CONTENT_BYTES = 700_000` byte (riuso `lessonContentSize.ts`).
- Output pool ≤ 200_000 byte, max 30 domande. Entrambi ≪ 1 MiB (limite documento Firestore).
- Costo per operazione ≤ 250_000 µUSD (riuso `aiCorrectionRuntimeConfig`).

## 4. Verifiche eseguite

- `pnpm format:check` — atteso PASS (solo Markdown/HTML nuovi, formattati Prettier).
- `git diff --check` — nessun whitespace error, nessuna riga in conflitto.
- `node --check` sul JavaScript estratto da entrambi i prototipi — sintassi valida.
- Verifica statica prototipi: ogni `role="dialog"` ha `aria-modal` + `aria-labelledby` risolto; ogni campo ha `label`/`aria-label`; stati errore/attesa hanno `role="alert"`/`role="status"`+`aria-live`; nessuna icona senza nome accessibile (le decorative usano `aria-hidden`); spinner rispetta `prefers-reduced-motion`.
- Ricerca finale: nessun `.ts/.tsx/.rules/.json` applicativo, Function, config o dipendenza modificati (solo `documentazione/**`).
- Nessuna API key referenziata; nessuna chiamata di rete nei prototipi (nessun `fetch`/`XMLHttpRequest`/`<script src>` esterno).

## 5. Responsive prototipi (breakpoint verificati staticamente)

I CSS includono `@media (max-width: 640px)` che porta griglie a colonna singola e pulsanti full-width; larghezze massime `max-width` sui dialog evitano overflow orizzontale a 1440/1024/390/320. Nessun elemento a larghezza fissa maggiore del viewport.

## 6. Rischi residui

Vedi §11 di `ai-content-generation-roadmap.md`: deriva di costo profilo quality (mitigata da cap+budget+preview), qualità/allucinazioni (proposta sempre rivista dal docente), prompt injection (gerarchia+delimitazione+validazione, fixture in AIGEN-01), estensione enum error codes senza rotture, TTL differito.

## 7. Conferma

Nessun codice runtime, nessun merge, nessun deploy, nessuna chiamata OpenAI. AIGEN-01 **non** inizia in questa PR.
