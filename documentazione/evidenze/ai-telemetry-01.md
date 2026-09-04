# AI-TELEMETRY-01 — evidenza tecnica

## Obiettivo

Rendere diagnosticabili durata ed esito dei gateway `aiContentPreview` e
`aiContentGenerate` senza introdurre servizi, chiamate, letture o scritture e
senza registrare materiale didattico o dati personali.

## Contratto dell'evento

Ogni callable conclusa emette un solo evento `aiContentGateway` con quattro
campi applicativi:

- `phase`: `preview` oppure `generate`;
- `mode`: modalità runtime già risolta (`disabled`, `mock`, `openai`);
- `outcome`: `ok`, codice applicativo chiuso oppure `internal`;
- `durationMs`: durata totale non negativa osservata dal gateway.

Non vengono registrati UID, request ID, prompt, guidance, titoli, contenuti,
output, token, costi o errori grezzi. Gli errori applicativi conservano il
mapping HTTPS esistente; gli errori imprevisti restano `internal`.

## Impatto prestazioni e costi

La modifica usa il logger già incluso nel runtime e non aggiunge Function,
documenti Firestore, listener, polling o dipendenze. Timeout, memoria,
concorrenza, scaling, provider, retry, lease, budget e idempotenza restano
invariati. Il volume è un solo evento terminale per invocazione già esistente.

## Rollback

Revert della PR e ridistribuzione delle sole `aiContentPreview` e
`aiContentGenerate` in DEV.
