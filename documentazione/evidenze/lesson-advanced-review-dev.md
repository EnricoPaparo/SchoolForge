# Revisione avanzata lezioni — evidenza DEV

## Contratto implementato

- `lesson` e `lesson_review` sono run distinti, con `requestId`, prenotazione,
  costo, replay e retry indipendenti.
- Le lezioni Economy usano `gpt-5.6-luna`; le lezioni Quality usano
  `gpt-6.1-sol`. Pool, mappe, visuali e correzioni conservano la politica
  esistente.
- `lesson_review` usa il contratto prompt `lesson-review-v1`, incluso
  nell'hash canonico. Output chiuso: `body`, `reviewOutcome`, `issueCodes`.
- La revisione è attiva a ogni apertura dei dialoghi e può essere disattivata.
  La scelta non viene persistita.
- La generazione completa non invoca la pulizia finché non esiste il corpo
  finale revisionato. Mappa, pool e immagini ricevono esclusivamente quel corpo.
- Se la revisione fallisce, il corpo base resta nel client e il retry ripete
  soltanto preview e generate di `lesson_review`; non esiste fallback silenzioso.

## Accounting e rischio residuo DEV

Generazione e revisione usano due prenotazioni indipendenti. Prima della
generazione è mostrata la stima base; la stima autorevole della revisione viene
calcolata appena esiste la bozza, prima della seconda chiamata. Il riepilogo
somma i costi effettivi conosciuti. Una prenotazione atomica aggregata richiede
un orchestratore server dedicato ed è rinviata: in DEV il docente può quindi
vedere il tetto della revisione soltanto durante il workflow, non nella prima
schermata di stima.

## Rollback

Disattivare lo switch conserva il percorso a singola chiamata. Il rollback
tecnico consiste nel rimuovere l'orchestrazione client di `lesson_review`; i run
base e il loro accounting restano indipendenti.

## Gate prima del deploy DEV

1. typecheck Functions e web;
2. test `aiLessonReview`, `aiContent`, dialog lezione e generazione completa;
3. format check, lint, test e build del repository;
4. deploy mirato Functions + hosting DEV;
5. smoke autenticato con revisione ON/OFF e generazione completa.

Nessuna lezione pubblicata viene modificata dai risultati delle verifiche.

## Benchmark congelato

Il corpus tracciato è in `lesson-review-benchmark-v1/`: 12 corpi base con
SHA-256 (8 tuning e 4 holdout), riusati senza duplicazione per Economy e
Quality. Il manifest chiuso produce quattro lotti indipendenti, ciascuno con il
proprio tetto costi:

- tuning: gli otto output Economy del candidato D provenienti da
  `lesson-tune-01-tuning-2026-08-04T13-17-19-871Z`; `LM02-02` e `LM02-03`
  sono i due `FAIL` disciplinari noti, mentre il manifest congela anche i
  difetti minori di `LM02-01`, `LM02-04`, `LT01-09` e `LT01-10`;
- holdout: i quattro output Quality puliti provenienti da
  `lesson-tune-01-holdout-2026-08-15T15-15-18-593Z`, mantenuti separati dal
  tuning.

Ogni fixture dichiara source corpus, nome file, SHA-256 della sorgente,
SHA-256 del corpo tracciato e difetti attesi. Il loader confronta questi valori
con la provenienza congelata nel codice e rifiuta qualunque discrepanza prima
di costruire il piano. Le fixture tuning sono copie byte-per-byte; la regola
mirata in `.gitattributes` conserva quindi anche gli spazi finali presenti negli
output sorgente senza far fallire `git diff --check`.

```text
pnpm --filter @schoolforge/functions benchmark:lesson-review -- \
  --manifest=../documentazione/evidenze/lesson-review-benchmark-v1/manifest.json \
  --split=tuning --profile=economy
```

Sostituire split e profile per gli altri tre lotti. Il comando richiede Node 22
e parte sempre in dry-run. L'esecuzione reale richiede entrambi i flag espliciti
documentati dalla CLI e una conferma interattiva che include il tetto del lotto.
Il runner usa zero retry: ogni sample può produrre al massimo una chiamata.
