# Gate GVEX — Human Gate post-rollout VEX

**Stato:** `PASS`

**Ambiente:** `schoolforge-dev`

**Data rollout e smoke:** 21 luglio 2026

**SHA baseline server/Rules:** `1399faeb1539b1adf1fd9d0ead1bb485ca5d9d53`

**SHA Hosting finale VEX-02C:** `adba8e3208c33ece05fbc928f598e0197c4ba94b`

**URL:** <https://schoolforge-dev.web.app>

Il rollout automatico e lo smoke manuale richiesto sono completati. Il docente ha confermato
l'esito positivo finale («funziona da dio; gate chiuso»): **Gate GVEX PASS**.

## 1. Evidenza automatica e rollout

- Node portabile ufficiale: `v22.23.1`; SHA-256 ZIP verificato:
  `7df0bc9375723f4a86b3aa1b7cc73342423d9677a8df4538aca31a049e309c29`.
- pnpm: `9.15.9`; anche `pnpm exec node --version` ha restituito `v22.23.1`.
- Format, lint e typecheck monorepo: PASS.
- Functions: **532/532** test PASS sul rollout coordinato.
- Web: **1610/1610** test PASS sul rollout coordinato; **1631/1631** dopo VEX-02C.
- `RoleGate`: **19/19** PASS.
- `StudentShell`: **21/21** PASS.
- Security Rules Emulator: **493/493** test PASS.
- Build Functions, lesson-contract e web: PASS; build web finale VEX-02C: PASS.
- `git diff --check`: PASS; working tree pulito prima e dopo i preflight.

Ordine del rollout coordinato:

1. Functions: `assignVerificationVariant`, `aiCorrectionPreview`, `aiCorrectionRun` — PASS;
2. Firestore Rules — PASS;
3. Hosting — PASS.

Dopo VEX-02C è stato eseguito esclusivamente un nuovo deploy Hosting, preceduto da suite web
1631/1631 e build fresca. Verifica post-deploy: Hosting HTTP 200 con CSP presente; le callable
restano Functions v2, Node.js 22, regione `us-central1`.

Vincoli rispettati: solo DEV; nessun PROD; nessuna chiamata OpenAI; nessuna migrazione o
cleanup; nessun indice; nessuna Storage Rule. VEX-02C non ha aggiunto letture, scritture,
query, listener, dipendenze o backend.

## 2. Configurazione verificata

Lo smoke ha coperto la configurazione VEX con:

- domande comuni e gruppi equivalenti;
- alternative compatibili per UDA, tipo e difficoltà;
- precompilazione assistita VEX-02C, warning pedagogico e selettore con preview;
- svolgimento studente, correzione e restituzione sulla variante assegnata.

Le ripetizioni casuali tra studenti restano ammesse: il contratto non garantisce varianti diverse.

## 3. Checklist manuale docente e studenti

### Builder e attivazione

- [x] Il docente crea/modifica i gruppi dal builder e vede riepilogo, warning e blocchi coerenti.
- [x] La precompilazione usa soltanto UDA, tipo e difficoltà; il docente può modificarla.
- [x] Il selettore mostra metadati e preview leggibili senza overflow.
- [x] Eliminare tutti i gruppi e riattivare `equivalent_variants` esegue il reset assistito
      approvato; i gruppi esistenti non vengono ricalcolati automaticamente.
- [x] Una domanda non può appartenere a più gruppi e un gruppo invalido impedisce
      l'attivazione con un messaggio leggibile.
- [x] La verifica `same_questions` continua ad attivarsi e funzionare come prima.
- [x] La verifica `equivalent_variants` si attiva senza errori inattesi.

### Prima apertura, ripresa e idempotenza

- [x] Lo studente vede tutte le domande comuni più una sola alternativa per gruppo.
- [x] Refresh, logout/login e riapertura mantengono la stessa assegnazione.
- [x] L'apertura non crea consegne duplicate né cambia variante.
- [x] Le assegnazioni multi-studente sono valide; è accettabile che coincidano.
- [x] Navigatore, ordine casuale visivo e limite caratteri lavorano solo sulle domande assegnate.

### Isolamento e sicurezza

- [x] Browser e payload studente non espongono alternative non assegnate o relative soluzioni.
- [x] Non sono esposti `teacherSnapshot`, gruppi completi o soluzioni corrette.
- [x] Le Rules e i test automatici negano risposte per order non assegnati.
- [x] Il PDF studente è nascosto/disabilitato per `equivalent_variants`.

### Consegna e monitor docente

- [x] Salvataggio e consegna riguardano soltanto la variante assegnata.
- [x] Il monitor docente mostra una sola consegna per studente e dati coerenti.
- [x] Eliminazione ammessa e nuovo svolgimento non espongono la vecchia assegnazione.

### Correzione, IA e restituzione

- [x] Il workspace manuale mostra solo le domande assegnate e calcola massimo, totale e
      percentuale sulla variante.
- [x] Salva, completa, azzera e riapri mantengono la variante senza evaluation estranee.
- [x] La preview IA considera solo le domande assegnate e non espone alternative; lo smoke GVEX
      non ha richiesto una nuova chiamata OpenAI.
- [x] La restituzione contiene soltanto domande, risposte, punteggi, feedback e — se abilitate —
      soluzioni della variante assegnata.

### Export e regressione

- [x] Registro PDF/CSV usa punteggio massimo e percentuale della variante.
- [x] Il PDF docente resta completo; il PDF studente VEX resta disabilitato.
- [x] `same_questions` non presenta regressioni nel flusso completo.
- [x] Desktop e mobile non presentano controlli irraggiungibili o overflow bloccanti.

## 4. Chiusura del Gate

- Data verifica: `21 luglio 2026`
- Docente verificatore: `owner SchoolForge DEV`
- Esito: `PASS`
- Anomalie bloccanti: `nessuna`
- Limiti accettati: l'equivalenza tecnica non garantisce quella pedagogica; il docente verifica e
  può modificare i gruppi. Due studenti possono ricevere casualmente la stessa variante.

## Verdetto

**Gate GVEX: PASS.** VEX è operativo su `schoolforge-dev`; non è stato eseguito alcun rollout
PROD e questa evidenza non lo autorizza.
