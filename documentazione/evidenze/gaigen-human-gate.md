# Gate GAIGEN — checklist finale DEV

**Stato finale:** **PASS — 15 agosto 2026.**

## Esito sintetico

La generazione IA di lezioni, pool e mappe concettuali è implementata,
distribuita e usabile su `schoolforge-dev`. Il gate storico era rimasto
`PENDING` perché fotografava il primo rollout in modalità `disabled`; le prove
successive hanno superato quei prerequisiti senza essere riportate qui.

## Evidenze infrastrutturali

- `AI_CONTENT_MODE=openai` nella configurazione Functions DEV;
- `aiContentPreview` e `aiContentGenerate` distribuite in `us-central1`;
- secret `OPENAI_API_KEY` operativo, dimostrato dalle generazioni reali
  completate dal docente senza esporne mai il valore;
- TTL Firestore verificata il 15 agosto 2026 tramite
  `firebase firestore:indexes --project schoolforge-dev`:
  `aiContentRuns.expireAt` risulta `ttl: true`;
- run IA server-only e isolamento studente coperti dalle Rules e dalle suite di
  regressione; nessun controllo di generazione nel portale studente;
- stima, prenotazione, ledger, lease, replay, takeover e settlement
  fail-closed coperti dai test del core.

## Smoke reali confermati dal docente

- generazione e applicazione di lezioni con profilo Quality;
- generazione di un nuovo pool e append a un pool esistente;
- review e modifica locale delle domande prima del singolo salvataggio
  canonico;
- generazione e rigenerazione di mappe concettuali su più lezioni;
- dialog e review raggiungibili su desktop e mobile, senza perdita della
  proposta per click sul backdrop;
- nessun salvataggio implicito: la bozza lezione/mappa diventa persistente solo
  tramite il comando esplicito di salvataggio;
- qualità reale dei pool e delle mappe accettata dal docente.

Le evidenze qualitative di dettaglio sono in
[`pool-e-mappe-conferma-docente.md`](pool-e-mappe-conferma-docente.md),
[`pool-tune-03-holdout-review.md`](pool-tune-03-holdout-review.md) e nelle review
LESSON-TUNE.

## Vincoli che restano validi

- Quality è il solo profilo qualificato per i pool; Economy resta rifiutato
  fail-closed per quel `kind`;
- le mappe restano compatibili in lettura con v1 e v2;
- il PASS riguarda DEV e non autorizza provisioning o deploy PROD;
- budget e alert restano controlli operativi: non costituiscono un hard cap.

## Verdetto

**Gate GAIGEN superato (PASS).** Non resta alcun pacchetto applicativo AIGEN
aperto; eventuali miglioramenti futuri richiedono una roadmap distinta.
